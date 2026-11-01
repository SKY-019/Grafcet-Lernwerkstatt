/*
 * model.js – Datenmodell des GRAFCET.
 *
 * Projekt (wird 1:1 als JSON gespeichert):
 *   { format, version, title, nextId, pages:[Seite], variables:[], plant, task }
 *   plant = virtuelle Anlage { id, map, options } oder null; task = { id } der Übungsaufgabe (optional)
 * Seite:
 *   { id, name, kind:'main', steps:[], transitions:[], links:[], notes:[], frames:[] }
 * Schritt:
 *   { id, name, x, y, initial, actions:[Aktion], comment,
 *     kind:'normal'|'macro'|'entry'|'exit'|'enclosing', encInit, actionsLayout:'row'|'column',
 *     commentPos:'left'|'right'|'above'|'below', commentDx, commentDy }   (Lage des Kommentars)
 *   macro: Makroschritt (Expansion im Rahmen der Art 'macro' mit owner = Schritt-id,
 *          darin Eingangsschritt kind 'entry' und Ausgangsschritt kind 'exit')
 *   enclosing: einschließender Schritt (Inhalt im Rahmen 'enclosed'; Schritte mit
 *          encInit = true werden mit ihm aktiviert)
 * Aktion:
 *   { id, type:'continuous'|'conditional'|'stored'|'event'|'forcing',
 *     var, value:'1'|'0'|'inc'|'dec', when:'activation'|'deactivation', cond }
 *   Zwangssteuerung (type 'forcing'): target = Name des Teil-GRAFCET,
 *     forceMode 'steps'|'init'|'freeze'|'empty', forceSteps z. B. '5,6'
 *     → gezeichnet als G2{5,6}, G2{INIT}, G2{*}, G2{}
 * Transition:
 *   { id, x, y, cond, name, comment, commentPos, commentDx, commentDy }
 * Wirkverbindung:
 *   { id, from, to, jump, dx, dy }   dx/dy = mit der Maus verschobene Stücke
 * Freier Kommentar (Textfeld auf der Fläche):
 *   { id, x, y, text }   x/y = linke obere Ecke
 * Rahmen (Teil-GRAFCET, Makro-Expansion, eingeschlossener Inhalt):
 *   { id, kind:'partial'|'macro'|'enclosed', name, x, y, w, h, owner }
 *   x/y = linke obere Ecke, w/h = Größe. Zugehörigkeit ergibt sich aus der Lage:
 *   ein Element gehört zum innersten Rahmen, in dem sein Mittelpunkt liegt.
 *   owner = id des Makroschritts bzw. einschließenden Schritts (nur macro/enclosed).
 *   Schrittnamen laufen über alle Rahmen eines Projekts fortlaufend weiter.
 *
 * Verzweigungen werden nicht gespeichert, sondern aus der Struktur abgeleitet:
 *   Schritt mit mehreren Folgetransitionen   -> ODER-Verzweigung
 *   mehrere Transitionen vor einem Schritt    -> ODER-Zusammenführung
 *   Transition mit mehreren Folgeschritten    -> UND-Verzweigung
 *   mehrere Schritte vor einer Transition     -> UND-Zusammenführung
 * Koordinaten (x, y) bezeichnen jeweils die Mitte des Elements.
 */
(function (GE) {
  'use strict';

  var M = (GE.model = {});
  var U = GE.util;

  M.GRID = 20;        // Rasterweite
  M.PITCH = 60;       // Abstand Schritt -> Transition -> Schritt
  M.BRANCH = 120;     // halber Abstand zweier Zweige

  M.ACTION_TYPES = {
    continuous: 'Kontinuierlich',
    conditional: 'Bedingt',
    stored: 'Speichernd',
    event: 'Bei Ereignis',
    forcing: 'Zwangssteuerung'
  };

  M.FORCE_MODES = { steps: 'Schritte', init: 'INIT', freeze: '*', empty: '{}' };

  /** Schreibweise einer Zwangssteuerung, z. B. G2{5,6}, G2{INIT}, G2{*}, G2{}. */
  M.forcingLabel = function (a) {
    var inner = a.forceMode === 'init' ? 'INIT' : a.forceMode === 'freeze' ? '*' : a.forceMode === 'empty' ? ''
      : M.forceStepNames(a).join(',');
    return (a.target || '?') + '{' + inner + '}';
  };

  /** Liste der Schrittnamen einer Zwangssteuerung „Schritte“. */
  M.forceStepNames = function (a) {
    return String(a.forceSteps || '').split(/[,;\s]+/).map(function (s) { return s.trim(); }).filter(Boolean);
  };

  // ---------------------------------------------------------------- Projekt

  M.createProject = function (title) {
    var p = {
      format: 'grafcet-editor',
      version: 1,
      title: title || 'Neuer GRAFCET',
      nextId: 1,
      pages: [],
      variables: []
    };
    M.addPage(p, 'Hauptablauf', 'main');
    return p;
  };

  M.newId = function (project, prefix) {
    return prefix + project.nextId++;
  };

  M.addPage = function (project, name, kind) {
    var page = {
      id: M.newId(project, 'p'),
      name: name || 'Seite ' + (project.pages.length + 1),
      kind: kind || 'main',
      steps: [],
      transitions: [],
      links: [],
      notes: [],
      frames: []
    };
    project.pages.push(page);
    return page;
  };

  M.getPage = function (project, id) {
    for (var i = 0; i < project.pages.length; i++) if (project.pages[i].id === id) return project.pages[i];
    return null;
  };

  // ---------------------------------------------------------------- Datei

  M.FILE_VERSION = 1;

  /** Projekt als Dateiinhalt (JSON). */
  M.toFileText = function (project) {
    return JSON.stringify(project, null, 1);
  };

  /** Dateiname aus dem Titel, z. B. „Bohrstation.grafcet.json“. */
  M.fileName = function (title) {
    var base = String(title || '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').replace(/\s+/g, ' ').trim().replace(/^\.+/, '');
    return (base || 'GRAFCET').slice(0, 80) + '.grafcet.json';
  };

  /**
   * Dateiinhalt lesen und prüfen.
   * @returns {{ok:true, project:Object}|{ok:false, message:string}}
   */
  M.parseFile = function (text) {
    var data;
    try {
      data = JSON.parse(String(text).replace(/^﻿/, ''));
    } catch (e) {
      return { ok: false, message: 'Die Datei ist keine GRAFCET-Datei (kein lesbares JSON).' };
    }
    if (!data || data.format !== 'grafcet-editor' || !Array.isArray(data.pages) || !data.pages.length) {
      return { ok: false, message: 'Die Datei ist keine GRAFCET-Datei dieser Lernwerkstatt.' };
    }
    if (+data.version > M.FILE_VERSION) {
      return { ok: false, message: 'Die Datei stammt aus einer neueren Version der Lernwerkstatt (Format ' + data.version + ').' };
    }
    try {
      var p = M.normalize(data);
      p.pages.forEach(M.normalizeConditions);
      return { ok: true, project: p };
    } catch (e2) {
      return { ok: false, message: 'Die Datei ist beschädigt und kann nicht gelesen werden.' };
    }
  };

  /**
   * Ergänzt fehlende Felder (z. B. nach dem Laden älterer Dateien) und bereinigt
   * Daten aus fremden Dateien: Listen sind Arrays, Zahlen sind Zahlen, Texte sind
   * Texte, IDs haben die Form „Buchstabe + Zahl“ und sind eindeutig, Verbindungen
   * zeigen auf vorhandene Elemente. So gelangt nichts Ungeprüftes in die Zeichnung.
   */
  M.normalize = function (project) {
    function arr(v) { return Array.isArray(v) ? v.filter(function (x) { return x && typeof x === 'object'; }) : []; }
    function num(v) { v = +v; return isFinite(v) ? v : 0; }
    function str(v) { return v == null ? '' : String(v); }
    project.format = 'grafcet-editor';
    project.version = project.version || 1;
    project.title = str(project.title) || 'GRAFCET';
    project.pages = arr(project.pages);
    project.variables = arr(project.variables);
    project.variables.forEach(function (v) {
      v.name = str(v.name);
      v.comment = str(v.comment);
      v.mode = v.mode === 'button' ? 'button' : 'switch';
      if (v.initial !== undefined && v.initial !== '') v.initial = num(v.initial);
    });
    // virtuelle Anlage der Simulation: { id, map: {signal: Variable}, options }
    var pl = project.plant;
    project.plant = pl && typeof pl === 'object' && pl.id
      ? { id: str(pl.id), map: pl.map && typeof pl.map === 'object' ? pl.map : {}, options: pl.options && typeof pl.options === 'object' ? pl.options : {} }
      : null;
    if (project.task && typeof project.task === 'object') project.task = { id: str(project.task.id) };
    else delete project.task;

    // IDs: gültig und eindeutig; ungültige bzw. doppelte werden nach dem Durchlauf neu vergeben
    var maxId = 0;
    var used = {};
    var redo = [];
    function checkId(el, prefix) {
      var id = el.id;
      if (typeof id === 'string' && /^[a-z]\d+$/.test(id) && !used[id]) {
        used[id] = true;
        maxId = Math.max(maxId, +id.slice(1));
        return;
      }
      redo.push({ el: el, prefix: prefix });
    }
    var COMMENT_POS = { left: 1, right: 1, above: 1, below: 1 };
    project.pages.forEach(function (pg) {
      checkId(pg, 'p');
      pg.name = str(pg.name) || 'Hauptablauf';
      pg.kind = 'main';
      pg.steps = arr(pg.steps);
      pg.transitions = arr(pg.transitions);
      pg.links = arr(pg.links);
      pg.notes = arr(pg.notes);
      pg.frames = arr(pg.frames);
      pg.frames.forEach(function (fr) {
        checkId(fr, 'g');
        fr.kind = fr.kind === 'macro' || fr.kind === 'enclosed' ? fr.kind : 'partial';
        fr.name = str(fr.name);
        fr.x = num(fr.x);
        fr.y = num(fr.y);
        fr.w = Math.max(80, num(fr.w) || 320);
        fr.h = Math.max(60, num(fr.h) || 260);
        if (fr.owner != null) fr.owner = str(fr.owner);
      });
      // ältere Form (Zugehörigkeit am Element) wird nicht mehr verwendet
      pg.steps.concat(pg.transitions, pg.notes).forEach(function (el) {
        delete el.frame;
        el.x = num(el.x);
        el.y = num(el.y);
        if (el.commentDx !== undefined) el.commentDx = num(el.commentDx);
        if (el.commentDy !== undefined) el.commentDy = num(el.commentDy);
        if (el.commentPos !== undefined && !COMMENT_POS[el.commentPos]) delete el.commentPos;
      });
      pg.notes.forEach(function (nt) {
        checkId(nt, 'c');
        nt.text = str(nt.text);
      });
      pg.steps.forEach(function (s) {
        checkId(s, 's');
        s.name = str(s.name);
        s.initial = !!s.initial;
        s.comment = str(s.comment);
        s.actionsLayout = s.actionsLayout === 'column' ? 'column' : 'row';
        s.kind = { macro: 1, entry: 1, exit: 1, enclosing: 1 }[s.kind] ? s.kind : 'normal';
        s.encInit = !!s.encInit;
        s.actions = arr(s.actions);
        s.actions.forEach(function (a) {
          checkId(a, 'a');
          M.normalizeAction(a);
        });
      });
      pg.transitions.forEach(function (t) {
        checkId(t, 't');
        t.cond = str(t.cond);
        t.name = str(t.name);
        t.comment = str(t.comment);
      });
      pg.links.forEach(function (l) {
        checkId(l, 'l');
        l.from = str(l.from);
        l.to = str(l.to);
        l.jump = !!l.jump;
        if (l.dx !== undefined) l.dx = num(l.dx);
        if (l.dy !== undefined) l.dy = num(l.dy);
      });
    });
    project.nextId = Math.max(num(project.nextId) || 1, maxId + 1);
    // neu vergebene IDs: Bezüge auf die alte ID (Verbindungen, Rahmen-Besitzer) mitziehen,
    // soweit sie eindeutig war
    var count = {};
    redo.forEach(function (r) { count[r.el.id] = (count[r.el.id] || 0) + 1; });
    redo.forEach(function (r) {
      var old = r.el.id;
      var id = M.newId(project, r.prefix);
      r.el.id = id;
      if (typeof old !== 'string' || count[old] > 1 || used[old]) return;
      project.pages.forEach(function (pg) {
        pg.links.forEach(function (l) {
          if (l.from === old) l.from = id;
          if (l.to === old) l.to = id;
        });
        pg.frames.forEach(function (fr) { if (fr.owner === old) fr.owner = id; });
      });
    });
    // Verbindungen ins Leere und doppelte Verbindungen entfernen
    project.pages.forEach(function (pg) {
      var nodes = {};
      pg.steps.concat(pg.transitions).forEach(function (n) { nodes[n.id] = true; });
      var pairs = {};
      pg.links = pg.links.filter(function (l) {
        var key = l.from + '>' + l.to;
        if (!nodes[l.from] || !nodes[l.to] || l.from === l.to || pairs[key]) return false;
        pairs[key] = true;
        return true;
      });
    });
    if (!project.pages.length) M.addPage(project, 'Hauptablauf', 'main');
    return project;
  };

  M.normalizeAction = function (a) {
    a.type = M.ACTION_TYPES[a.type] ? a.type : 'continuous';
    a.var = a.var == null ? '' : String(a.var);
    // '1'/'0' setzen bzw. rücksetzen, 'inc'/'dec' zählen (Zähler wie C1 := C1 + 1)
    a.value = a.value === 'inc' || a.value === 'dec' ? a.value : a.value === '0' || a.value === 0 ? '0' : '1';
    a.when = a.when === 'deactivation' ? 'deactivation' : 'activation';
    a.cond = a.cond == null ? '' : String(a.cond);
    if (a.type === 'forcing') {
      a.target = a.target == null ? '' : String(a.target);
      a.forceMode = M.FORCE_MODES[a.forceMode] ? a.forceMode : 'init';
      a.forceSteps = a.forceSteps == null ? '' : String(a.forceSteps);
    }
    return a;
  };

  // ---------------------------------------------------------------- Variablen

  /** Typische Namen von Tastern (z. B. S1, 1S2, Start, Stop, Quit). */
  M.looksLikeButton = function (name) {
    return /^\d*S\d|start|stop|quit|taster/i.test(name);
  };

  /**
   * Zusatzangaben zu einer Variablen (Kommentar, Schalter/Taster).
   * Fehlt ein Eintrag, werden sinnvolle Vorgaben geliefert.
   */
  M.varMeta = function (project, name) {
    var list = project.variables || [];
    for (var i = 0; i < list.length; i++) if (list[i].name === name) return list[i];
    return { name: name, mode: M.looksLikeButton(name) ? 'button' : 'switch', comment: '' };
  };

  M.setVarMeta = function (project, name, patch) {
    project.variables = project.variables || [];
    var cur = null;
    project.variables.forEach(function (v) { if (v.name === name) cur = v; });
    if (!cur) {
      cur = M.varMeta(project, name);
      cur = { name: name, mode: cur.mode, comment: cur.comment };
      project.variables.push(cur);
    }
    Object.keys(patch).forEach(function (k) { cur[k] = patch[k]; });
    return cur;
  };

  // ---------------------------------------------------------------- Abfragen

  /** Liefert {kind, el} für eine Element-id oder null. */
  M.find = function (page, id) {
    var i;
    for (i = 0; i < page.steps.length; i++) if (page.steps[i].id === id) return { kind: 'step', el: page.steps[i] };
    for (i = 0; i < page.transitions.length; i++) if (page.transitions[i].id === id) return { kind: 'transition', el: page.transitions[i] };
    for (i = 0; i < page.links.length; i++) if (page.links[i].id === id) return { kind: 'link', el: page.links[i] };
    var notes = page.notes || [];
    for (i = 0; i < notes.length; i++) if (notes[i].id === id) return { kind: 'note', el: notes[i] };
    var frames = page.frames || [];
    for (i = 0; i < frames.length; i++) if (frames[i].id === id) return { kind: 'frame', el: frames[i] };
    // Aktionen sind einzeln auswählbar; step = Schritt, zu dem sie gehören
    for (i = 0; i < page.steps.length; i++) {
      var acts = page.steps[i].actions || [];
      for (var j = 0; j < acts.length; j++) if (acts[j].id === id) return { kind: 'action', el: acts[j], step: page.steps[i] };
    }
    return null;
  };

  /** Schritt oder Transition (Knoten des Ablaufs) mit dieser id. */
  M.node = function (page, id) {
    var f = M.find(page, id);
    return f && (f.kind === 'step' || f.kind === 'transition') ? f.el : null;
  };

  /** Verschiebbares Element (Schritt, Transition oder freier Kommentar). */
  M.movable = function (page, id) {
    var f = M.find(page, id);
    return f && f.kind !== 'link' && f.kind !== 'frame' && f.kind !== 'action' ? f.el : null;
  };

  // ---------------------------------------------------------------- Rahmen (Teil-GRAFCETs u. a.)

  M.FRAME_MIN_W = 80;
  M.FRAME_MIN_H = 60;

  /** Nächster freier Name G1, G2, … */
  M.nextFrameName = function (page) {
    var max = 0;
    (page.frames || []).forEach(function (fr) {
      var m = /^G(\d+)$/.exec(fr.name);
      if (m) max = Math.max(max, +m[1]);
    });
    return 'G' + (max + 1);
  };

  /** Neuer Rahmen; rect = {x, y, w, h}. */
  M.addFrame = function (project, page, name, rect, kind, owner) {
    page.frames = page.frames || [];
    rect = rect || { x: 0, y: 0, w: 320, h: 260 };
    var fr = {
      id: M.newId(project, 'g'),
      kind: kind || 'partial',
      name: name || M.nextFrameName(page),
      x: rect.x, y: rect.y,
      w: Math.max(M.FRAME_MIN_W, rect.w), h: Math.max(M.FRAME_MIN_H, rect.h)
    };
    if (owner) fr.owner = owner;
    page.frames.push(fr);
    return fr;
  };

  /** Bezugspunkt eines Elements für die Zugehörigkeit (Mitte bzw. bei Kommentaren die obere linke Ecke). */
  /** Art eines Elements (Schritt, Transition, freier Kommentar) – an einer Stelle festgelegt. */
  M.isStep = function (el) { return !!el && Array.isArray(el.actions); };
  M.isTransition = function (el) { return !!el && el.cond !== undefined && !Array.isArray(el.actions); };
  M.isNote = function (el) { return !!el && el.text !== undefined && el.cond === undefined && !Array.isArray(el.actions); };

  M.anchorPoint = function (el) {
    if (M.isNote(el)) return { x: el.x + 8, y: el.y + 8 };
    return { x: el.x, y: el.y };
  };

  function inRect(fr, p) {
    return p.x >= fr.x && p.x <= fr.x + fr.w && p.y >= fr.y && p.y <= fr.y + fr.h;
  }
  M.frameContains = inRect;

  /** Innerster Rahmen (kleinste Fläche), der den Punkt enthält; kinds optional zum Filtern. */
  M.frameAtPoint = function (page, p, kinds) {
    var best = null;
    (page.frames || []).forEach(function (fr) {
      if (kinds && kinds.indexOf(fr.kind) < 0) return;
      if (inRect(fr, p) && (!best || fr.w * fr.h < best.w * best.h)) best = fr;
    });
    return best;
  };

  /** Innerster Rahmen eines Elements (oder null). */
  M.frameOf = function (page, el, kinds) {
    return M.frameAtPoint(page, M.anchorPoint(el), kinds);
  };

  /** Teil-GRAFCET (Rahmen der Art 'partial'), zu dem ein Element gehört. */
  M.partialOf = function (page, el) {
    return M.frameOf(page, el, ['partial']);
  };

  /** Rahmen, in dem ein anderer Rahmen liegt (Mitte des Rahmens, nur größere Rahmen). */
  M.parentFrame = function (page, fr) {
    var p = { x: fr.x + fr.w / 2, y: fr.y + fr.h / 2 };
    var best = null;
    (page.frames || []).forEach(function (o) {
      if (o === fr || o.w * o.h <= fr.w * fr.h) return;
      if (inRect(o, p) && (!best || o.w * o.h < best.w * best.h)) best = o;
    });
    return best;
  };

  /**
   * Elemente eines Rahmens. deep=false: nur Elemente, deren innerster Rahmen
   * dieser ist; deep=true: alles, was innerhalb des Rahmens liegt.
   */
  M.frameMembers = function (page, frameId, deep) {
    var fr = M.find(page, frameId);
    if (!fr || fr.kind !== 'frame') return [];
    fr = fr.el;
    return page.steps.concat(page.transitions, page.notes || []).filter(function (el) {
      var p = M.anchorPoint(el);
      if (!inRect(fr, p)) return false;
      return deep || M.frameAtPoint(page, p) === fr;
    });
  };

  /** Rahmen samt allem Inhalt (auch eingebettete Rahmen) verschieben. */
  M.moveFrame = function (page, frameId, dx, dy) {
    var f = M.find(page, frameId);
    if (!f || f.kind !== 'frame') return;
    var fr = f.el;
    var inner = (page.frames || []).filter(function (o) {
      return o !== fr && o.w * o.h < fr.w * fr.h && inRect(fr, { x: o.x + o.w / 2, y: o.y + o.h / 2 });
    });
    M.frameMembers(page, frameId, true).forEach(function (el) { el.x += dx; el.y += dy; });
    inner.concat([fr]).forEach(function (o) { o.x += dx; o.y += dy; });
  };

  // ---------------------------------------------------------------- Makroschritte, einschließende Schritte

  /** Rahmen (Expansion bzw. Inhalt), der zu einem Makro-/einschließenden Schritt gehört. */
  M.ownedFrame = function (page, stepId) {
    return (page.frames || []).filter(function (fr) { return fr.owner === stepId; })[0] || null;
  };

  /** Teile eines Makroschritts: Rahmen, Eingangs- und Ausgangsschritte darin. */
  M.macroParts = function (page, stepId) {
    var fr = M.ownedFrame(page, stepId);
    var inside = fr ? M.frameMembers(page, fr.id, true).filter(M.isStep) : [];
    return {
      frame: fr,
      entries: inside.filter(function (s) { return s.kind === 'entry'; }),
      exits: inside.filter(function (s) { return s.kind === 'exit'; })
    };
  };

  /** Schritte, die mit einem einschließenden Schritt aktiviert werden. */
  M.enclosedInitSteps = function (page, stepId) {
    var fr = M.ownedFrame(page, stepId);
    return fr ? M.frameMembers(page, fr.id, true).filter(function (el) { return el.actions && el.encInit; }) : [];
  };

  /**
   * Freie Stelle für einen neuen Rahmen: von der Wunschlage aus so weit nach
   * rechts schieben, bis er weder einen Rahmen noch ein Element überdeckt.
   */
  M.freeFrameSpot = function (page, rect) {
    var r = { x: rect.x, y: rect.y, w: rect.w, h: rect.h };
    for (var i = 0; i < 100; i++) {
      var hit = null;
      (page.frames || []).forEach(function (o) {
        if (r.x < o.x + o.w && o.x < r.x + r.w && r.y < o.y + o.h && o.y < r.y + r.h) hit = Math.max(hit || -Infinity, o.x + o.w + 40);
      });
      M.nodes(page).concat(page.notes || []).forEach(function (el) {
        if (inRect(r, M.anchorPoint(el))) hit = Math.max(hit || -Infinity, r.x + 2 * M.GRID);
      });
      if (hit === null) return r;
      r.x = Math.ceil(hit / M.GRID) * M.GRID;
    }
    return r;
  };

  /** Nummernteil für M/E/S-Namen (aus vorhandenem Namen oder nächster freier Nummer). */
  function macroNumber(page, s) {
    var m = /(\d+)$/.exec(s ? s.name : '');
    return m ? m[1] : M.nextStepName(page);
  }

  /**
   * Makroschritt anlegen (an x/y) oder einen vorhandenen Schritt umwandeln.
   * Rechts daneben entsteht die Expansion: Rahmen mit E…, Transition, S….
   */
  M.createMacro = function (project, page, x, y, stepId) {
    var s = stepId ? M.node(page, stepId) : null;
    var num = macroNumber(page, s);
    if (!s) s = M.addStep(project, page, x, y);
    s.kind = 'macro';
    s.name = 'M' + num;
    s.initial = false;
    var spot = M.freeFrameSpot(page, { x: s.x + 260, y: s.y - 70, w: 300, h: 300 });
    var fx = spot.x;
    var fy = spot.y;
    var fr = M.addFrame(project, page, 'M' + num, spot, 'macro', s.id);
    var e = M.addStep(project, page, fx + 120, fy + 100, { name: 'E' + num });
    e.kind = 'entry';
    var t = M.addTransition(project, page, fx + 120, fy + 160, '');
    var x2 = M.addStep(project, page, fx + 120, fy + 220, { name: 'S' + num });
    x2.kind = 'exit';
    M.addLink(project, page, e.id, t.id);
    M.addLink(project, page, t.id, x2.id);
    return { step: s, frame: fr };
  };

  /**
   * Einschließenden Schritt anlegen bzw. umwandeln. Rechts daneben entsteht
   * der Rahmen mit dem eingeschlossenen Inhalt (ein Kreislauf aus zwei
   * Schritten, der erste wird mit dem einschließenden Schritt aktiviert).
   */
  M.createEnclosing = function (project, page, x, y, stepId) {
    var s = stepId ? M.node(page, stepId) : M.addStep(project, page, x, y);
    s.kind = 'enclosing';
    var spot = M.freeFrameSpot(page, { x: s.x + 260, y: s.y - 70, w: 340, h: 320 });
    var fx = spot.x;
    var fy = spot.y;
    var fr = M.addFrame(project, page, '', spot, 'enclosed', s.id);
    var a = M.addStep(project, page, fx + 140, fy + 100);
    a.encInit = true;
    var b = M.node(page, M.append(project, page, a.id).select);
    M.connect(project, page, b.id, a.id);
    return { step: s, frame: fr };
  };

  /**
   * Aktion verschieben: an einen anderen Schritt (ans Ende bzw. vor beforeId)
   * oder innerhalb des eigenen Schritts umsortieren.
   */
  M.moveAction = function (page, actionId, toStepId, beforeId) {
    var f = M.find(page, actionId);
    var to = M.node(page, toStepId);
    if (!f || f.kind !== 'action' || !to || !to.actions) return false;
    f.step.actions.splice(f.step.actions.indexOf(f.el), 1);
    var idx = beforeId ? to.actions.map(function (a) { return a.id; }).indexOf(beforeId) : -1;
    if (idx < 0) to.actions.push(f.el);
    else to.actions.splice(idx, 0, f.el);
    return true;
  };

  /** Alle Knoten, die (in beliebiger Richtung) mit id verbunden sind, einschließlich id. */
  M.component = function (page, id) {
    var seen = {};
    var stack = [id];
    seen[id] = true;
    // Knoten einmal sammeln statt je Verbindung zu suchen
    var nodes = {};
    M.nodes(page).forEach(function (n) { nodes[n.id] = true; });
    while (stack.length) {
      var cur = stack.pop();
      page.links.forEach(function (l) {
        var other = l.from === cur ? l.to : l.to === cur ? l.from : null;
        if (other && !seen[other] && nodes[other]) {
          seen[other] = true;
          stack.push(other);
        }
      });
    }
    return Object.keys(seen);
  };

  /** Zusammenhängende Abläufe der Seite (Listen von Knoten-ids). */
  M.components = function (page) {
    var done = {};
    var res = [];
    M.nodes(page).forEach(function (n) {
      if (done[n.id]) return;
      var comp = M.component(page, n.id);
      comp.forEach(function (id) { done[id] = true; });
      res.push(comp);
    });
    return res;
  };

  M.kindOf = function (page, id) {
    var f = M.find(page, id);
    return f ? f.kind : null;
  };

  M.nodes = function (page) {
    return page.steps.concat(page.transitions);
  };

  M.outLinks = function (page, id) {
    return page.links.filter(function (l) { return l.from === id; });
  };

  M.inLinks = function (page, id) {
    return page.links.filter(function (l) { return l.to === id; });
  };

  M.stepByName = function (page, name) {
    for (var i = 0; i < page.steps.length; i++) if (page.steps[i].name === name) return page.steps[i];
    return null;
  };

  /** Nächster freier Schrittname: größte vorhandene Nummer + 1. */
  M.nextStepName = function (page, extraUsed) {
    var max = 0;
    var used = {};
    page.steps.forEach(function (s) {
      used[s.name] = true;
      // auch Nummern in Makro-/Eingangs-/Ausgangsschritten (M3, E3, S3) zählen mit
      var m = /^[MES]?(\d+)$/.exec(s.name);
      if (m) max = Math.max(max, +m[1]);
    });
    (extraUsed || []).forEach(function (n) {
      used[n] = true;
      var mm = /^[MES]?(\d+)$/.exec(n);
      if (mm) max = Math.max(max, +mm[1]);
    });
    var n = max + 1;
    while (used[String(n)]) n++;
    return String(n);
  };

  // ---------------------------------------------------------------- Erzeugen

  M.addStep = function (project, page, x, y, opts) {
    opts = opts || {};
    var s = {
      id: M.newId(project, 's'),
      name: opts.name != null ? String(opts.name) : M.nextStepName(page),
      x: x,
      y: y,
      initial: !!opts.initial,
      actions: [],
      actionsLayout: 'row',   // 'row' = Aktionen nebeneinander, 'column' = untereinander
      kind: 'normal',
      encInit: false,
      comment: ''
    };
    page.steps.push(s);
    return s;
  };

  // ------------------------------------------------------- Bedingungen

  /**
   * Schrittvariable, auf die sich die Kurzform t>3s einer Transition bezieht:
   * nur eindeutig, wenn genau ein Vorgängerschritt existiert.
   */
  M.stepVarForTransition = function (page, t) {
    var pre = M.inLinks(page, t.id)
      .map(function (l) { return M.find(page, l.from); })
      .filter(function (f) { return f && f.kind === 'step'; });
    return pre.length === 1 ? 'X' + pre[0].el.name : null;
  };

  /** Alle Bedingungen der Seite in die einheitliche Schreibweise bringen. */
  M.normalizeConditions = function (page) {
    var E = GE.expr;
    page.transitions.forEach(function (t) {
      if (t.cond) t.cond = E.normalize(t.cond, M.stepVarForTransition(page, t));
    });
    page.steps.forEach(function (s) {
      s.actions.forEach(function (a) {
        if (a.cond) a.cond = E.normalize(a.cond, 'X' + s.name);
      });
    });
  };

  /** Transitionen in Lesereihenfolge mit T1, T2, … bezeichnen. */
  M.numberTransitions = function (page) {
    page.transitions.slice()
      .sort(function (a, b) { return a.y - b.y || a.x - b.x; })
      .forEach(function (t, i) { t.name = 'T' + (i + 1); });
  };

  M.addTransition = function (project, page, x, y, cond) {
    var t = { id: M.newId(project, 't'), x: x, y: y, cond: cond || '', name: '', comment: '' };
    page.transitions.push(t);
    return t;
  };

  /** Freier Kommentar an der Stelle (x, y). */
  M.addNote = function (project, page, x, y, text) {
    page.notes = page.notes || [];
    var nt = { id: M.newId(project, 'c'), x: x, y: y, text: text || '' };
    page.notes.push(nt);
    return nt;
  };

  M.newAction = function (project, type, variable) {
    return M.normalizeAction({ id: M.newId(project, 'a'), type: type || 'continuous', var: variable || '' });
  };

  /**
   * Legt eine Wirkverbindung an (ohne automatische Ergänzung).
   * @returns {{link?:Object, error?:string}}
   */
  M.addLink = function (project, page, from, to, opts) {
    opts = opts || {};
    var a = M.find(page, from);
    var b = M.find(page, to);
    if (!a || !b || a.kind === 'link' || b.kind === 'link') return { error: 'Verbindung nur zwischen Schritten und Transitionen möglich.' };
    if (from === to) return { error: 'Ein Element kann nicht mit sich selbst verbunden werden.' };
    if (a.kind === b.kind) {
      return { error: a.kind === 'step'
        ? 'Zwei Schritte dürfen nicht direkt verbunden werden – dazwischen gehört eine Transition.'
        : 'Zwei Transitionen dürfen nicht direkt verbunden werden – dazwischen gehört ein Schritt.' };
    }
    if (opts.jump && !(a.kind === 'transition' && b.kind === 'step')) {
      return { error: 'Ein Sprung führt immer von einer Transition zu einem Schritt.' };
    }
    for (var i = 0; i < page.links.length; i++) {
      if (page.links[i].from === from && page.links[i].to === to) return { error: 'Diese Verbindung gibt es schon.' };
    }
    var l = { id: M.newId(project, 'l'), from: from, to: to, jump: !!opts.jump };
    page.links.push(l);
    return { link: l };
  };

  /**
   * Waagerecht freier Platz für ein eingefügtes Element: Liegt bei (x, y) schon ein
   * Schritt oder eine Transition, wird um einen Zweigabstand nach rechts ausgewichen.
   */
  function freeX(page, x, y) {
    var nodes = M.nodes(page);
    function taken(px) {
      return nodes.some(function (n) { return Math.abs(n.x - px) < M.BRANCH && Math.abs(n.y - y) < M.PITCH; });
    }
    for (var i = 0; i < 20 && taken(x); i++) x += 2 * M.BRANCH;
    return x;
  }

  /**
   * Verbindet zwei Elemente so, wie Lernende es erwarten:
   * Schritt -> Schritt fügt eine Transition dazwischen ein,
   * Transition -> Transition fügt einen Schritt dazwischen ein.
   * Bei jump=true entsteht ein Sprung (Transition -> Zielschritt).
   * @returns {{ok:boolean, created:string[], message?:string}}
   */
  M.connect = function (project, page, from, to, opts) {
    opts = opts || {};
    var G = M.GRID;
    var a = M.find(page, from);
    var b = M.find(page, to);
    if (!a || !b) return { ok: false, created: [], message: 'Element nicht gefunden.' };
    if (from === to) return { ok: false, created: [], message: 'Ein Element kann nicht mit sich selbst verbunden werden.' };
    var created = [];
    var r;

    if (opts.jump) {
      if (b.kind !== 'step') return { ok: false, created: [], message: 'Ein Sprung muss zu einem Schritt führen.' };
      var src = a.el;
      if (a.kind === 'step') {
        // Transition unter dem Schritt ergänzen, von dort springen
        var t0 = M.addTransition(project, page, freeX(page, src.x, src.y + M.PITCH), src.y + M.PITCH, '');
        M.addLink(project, page, src.id, t0.id);
        created.push(t0.id);
        src = t0;
      }
      r = M.addLink(project, page, src.id, b.el.id, { jump: true });
      if (r.error) return { ok: false, created: created, message: r.error };
      created.push(r.link.id);
      return { ok: true, created: created };
    }

    if (a.kind === b.kind) {
      var mx = U.snap((a.el.x + b.el.x) / 2, G);
      var my = U.snap((a.el.y + b.el.y) / 2, G);
      if (b.el.y - a.el.y < 2 * M.PITCH) {
        // Rückführung oder enger Abstand: Zwischenelement direkt unter die Quelle
        mx = a.el.x;
        my = a.el.y + M.PITCH;
      }
      mx = freeX(page, mx, my);   // nicht deckungsgleich auf ein vorhandenes Element legen
      var mid = a.kind === 'step'
        ? M.addTransition(project, page, mx, my, '')
        : M.addStep(project, page, mx, my);
      M.addLink(project, page, a.el.id, mid.id);
      M.addLink(project, page, mid.id, b.el.id);
      created.push(mid.id);
      return {
        ok: true,
        created: created,
        message: a.kind === 'step'
          ? 'Zwischen zwei Schritten muss eine Transition stehen – sie wurde eingefügt.'
          : 'Zwischen zwei Transitionen muss ein Schritt stehen – er wurde eingefügt.'
      };
    }
    r = M.addLink(project, page, from, to);
    if (r.error) return { ok: false, created: [], message: r.error };
    return { ok: true, created: [r.link.id] };
  };

  /** Entfernt Elemente; Verbindungen an entfernten Knoten werden mit entfernt. */
  M.remove = function (page, ids) {
    var del = {};
    ids.forEach(function (id) { del[id] = true; });
    page.steps = page.steps.filter(function (s) { return !del[s.id]; });
    page.transitions = page.transitions.filter(function (t) { return !del[t.id]; });
    page.links = page.links.filter(function (l) { return !del[l.id] && !del[l.from] && !del[l.to]; });
    page.notes = (page.notes || []).filter(function (nt) { return !del[nt.id]; });
    // Ein gelöschter Rahmen löscht nicht seinen Inhalt
    page.frames = (page.frames || []).filter(function (fr) { return !del[fr.id]; });
    // einzeln ausgewählte Aktionen
    page.steps.forEach(function (s) {
      s.actions = s.actions.filter(function (a) { return !del[a.id]; });
    });
  };

  /** Wie extendTo, aber nach oben: neues Element an (x, y) wird Vorgänger von toId. */
  M.extendFrom = function (project, page, toId, x, y) {
    var kind = M.kindOf(page, toId);
    if (kind !== 'step' && kind !== 'transition') return null;
    var dst = M.node(page, toId);
    if (Math.abs(x - dst.x) <= 2 * M.GRID) x = dst.x;
    var el = kind === 'step' ? M.addTransition(project, page, x, y, '') : M.addStep(project, page, x, y);
    M.addLink(project, page, el.id, toId);
    return el.id;
  };

  /**
   * Aus einem Element heraus weiterzeichnen (Ziehen ins Leere):
   * an einen Schritt wird eine Transition, an eine Transition ein Schritt
   * an der Stelle (x, y) angehängt und verbunden.
   * @returns {string|null} id des neuen Elements
   */
  M.extendTo = function (project, page, fromId, x, y) {
    var kind = M.kindOf(page, fromId);
    if (kind !== 'step' && kind !== 'transition') return null;
    var src = M.node(page, fromId);
    if (Math.abs(x - src.x) <= 2 * M.GRID) x = src.x;   // gerade Linie, wenn fast darunter
    var el = kind === 'step' ? M.addTransition(project, page, x, y, '') : M.addStep(project, page, x, y);
    M.addLink(project, page, fromId, el.id);
    return el.id;
  };

  /** Verschiebt alle Knoten unterhalb von y (strikt größer) um dy. */
  M.shiftBelow = function (page, y, dy, except) {
    M.nodes(page).forEach(function (n) {
      if (n.y > y && !(except && except[n.id])) n.y += dy;
    });
  };

  /**
   * Hängt an einen Schritt Transition + Schritt an bzw. an eine Transition
   * einen Schritt (+ Transition, falls schon Nachfolger existieren).
   * Hat das Element schon Nachfolger, wird die neue Folge dazwischen
   * eingefügt und der Rest nach unten geschoben.
   * @returns {{ok:boolean, created:string[], select:string}}
   */
  M.append = function (project, page, id) {
    var f = M.find(page, id);
    if (!f || f.kind === 'link') return { ok: false, created: [], message: 'Bitte zuerst einen Schritt oder eine Transition auswählen.' };
    var n = f.el;
    var P = M.PITCH;
    var outs = M.outLinks(page, id).filter(function (l) { return !l.jump; });
    var created = [];
    var insert = outs.length > 0;
    var t, s;

    if (f.kind === 'step') {
      if (insert) M.shiftBelow(page, n.y, 2 * P);
      t = M.addTransition(project, page, n.x, n.y + P, '');
      s = M.addStep(project, page, n.x, n.y + 2 * P);
      if (insert) outs.forEach(function (l) { l.from = s.id; });
      M.addLink(project, page, n.id, t.id);
      M.addLink(project, page, t.id, s.id);
      created.push(t.id, s.id);
      return { ok: true, created: created, select: s.id };
    }
    // Transition
    if (insert) {
      M.shiftBelow(page, n.y, 2 * P);
      s = M.addStep(project, page, n.x, n.y + P);
      t = M.addTransition(project, page, n.x, n.y + 2 * P, '');
      outs.forEach(function (l) { l.from = t.id; });
      M.addLink(project, page, n.id, s.id);
      M.addLink(project, page, s.id, t.id);
      created.push(s.id, t.id);
      return { ok: true, created: created, select: t.id };
    }
    s = M.addStep(project, page, n.x, n.y + P);
    M.addLink(project, page, n.id, s.id);
    created.push(s.id);
    return { ok: true, created: created, select: s.id };
  };

  // ------------------------------------------------------- Verzweigungen

  /** Knoten, die von id aus vorwärts (nach unten) erreichbar sind. */
  function reachableBelow(page, id) {
    var res = {};
    var queue = [id];
    while (queue.length) {
      var cur = queue.shift();
      var cn = M.node(page, cur);
      M.outLinks(page, cur).forEach(function (l) {
        var nx = M.node(page, l.to);
        if (!nx || l.jump || nx.y <= cn.y || res[l.to]) return;
        res[l.to] = true;
        queue.push(l.to);
      });
    }
    return res;
  }

  /** Gemeinsamer Zusammenführungsknoten mehrerer Zweige (oberster). */
  function findJoin(page, starts, kind) {
    if (!starts.length) return null;
    var sets = starts.map(function (id) {
      var r = reachableBelow(page, id);
      r[id] = true;
      return r;
    });
    var best = null;
    var list = kind === 'step' ? page.steps : page.transitions;
    list.forEach(function (n) {
      if (sets.every(function (st) { return st[n.id]; }) && (!best || n.y < best.y)) best = n;
    });
    return best;
  }

  /** Größte x-Position der Knoten im y-Bereich (für neue Zweige rechts). */
  function maxXBetween(page, y1, y2) {
    var mx = -Infinity;
    M.nodes(page).forEach(function (n) {
      if (n.y > y1 && n.y < y2) mx = Math.max(mx, n.x);
    });
    return mx;
  }

  /**
   * ODER-Verzweigung: am Schritt stepId (ohne Nachfolger) einen kompletten
   * Block anlegen, bei vorhandener Verzweigung einen weiteren Zweig ergänzen.
   * Ohne stepId wird an (x, y) ein neuer Schritt als Beginn angelegt.
   */
  M.insertOr = function (project, page, opts) {
    var P = M.PITCH;
    var B = M.BRANCH;
    var G = M.GRID;
    var created = [];
    var s = opts.stepId ? M.node(page, opts.stepId) : null;
    if (opts.stepId && M.kindOf(page, opts.stepId) !== 'step') {
      return { ok: false, created: [], message: 'Eine ODER-Verzweigung beginnt an einem Schritt. Klicke auf einen Schritt.' };
    }
    if (!s) {
      s = M.addStep(project, page, opts.x, opts.y);
      created.push(s.id);
    }
    var outs = M.outLinks(page, s.id).filter(function (l) { return !l.jump && M.kindOf(page, l.to) === 'transition'; });

    if (outs.length) {
      // weiteren Zweig ergänzen
      var firstT = M.node(page, outs[0].to);
      var join = findJoin(page, outs.map(function (l) { return l.to; }), 'step');
      var bottom = join ? join.y : Infinity;
      var nx = U.snap(Math.max(maxXBetween(page, s.y, bottom), firstT.x) + 2 * B, G);
      if (join && join.y < firstT.y + 3 * P) {
        // Zu wenig Platz bis zur Zusammenführung: Rest nach unten schieben
        M.shiftBelow(page, join.y - 1, firstT.y + 3 * P - join.y);
      }
      var t1 = M.addTransition(project, page, nx, firstT.y, '');
      var s1 = M.addStep(project, page, nx, firstT.y + P);
      M.addLink(project, page, s.id, t1.id);
      M.addLink(project, page, t1.id, s1.id);
      created.push(t1.id, s1.id);
      if (join) {
        var t2 = M.addTransition(project, page, nx, Math.max(s1.y + P, join.y - P), '');
        M.addLink(project, page, s1.id, t2.id);
        M.addLink(project, page, t2.id, join.id);
        created.push(t2.id);
      }
      return { ok: true, created: created, select: s1.id, message: 'Ein weiterer ODER-Zweig wurde angelegt.' };
    }

    var x = s.x;
    var y = s.y;
    var sj = M.addStep(project, page, x, y + 4 * P);
    [-B, B].forEach(function (dx) {
      var ta = M.addTransition(project, page, x + dx, y + P, '');
      var sa = M.addStep(project, page, x + dx, y + 2 * P);
      var tb = M.addTransition(project, page, x + dx, y + 3 * P, '');
      M.addLink(project, page, s.id, ta.id);
      M.addLink(project, page, ta.id, sa.id);
      M.addLink(project, page, sa.id, tb.id);
      M.addLink(project, page, tb.id, sj.id);
      created.push(ta.id, sa.id, tb.id);
    });
    created.push(sj.id);
    // Neue Schritte von oben nach unten, links nach rechts nummerieren
    renumber(page, created);
    return { ok: true, created: created, select: s.id };
  };

  /**
   * UND-Verzweigung: an einer Transition (ohne Nachfolger) einen Block
   * anlegen bzw. einen weiteren parallelen Zweig ergänzen. Bei einem
   * Schritt ohne Nachfolger wird zuerst eine Transition darunter angelegt.
   */
  M.insertAnd = function (project, page, opts) {
    var P = M.PITCH;
    var B = M.BRANCH;
    var G = M.GRID;
    var created = [];
    var t = null;
    var k = opts.nodeId ? M.kindOf(page, opts.nodeId) : null;

    if (k === 'step') {
      var st = M.node(page, opts.nodeId);
      var so = M.outLinks(page, st.id).filter(function (l) { return !l.jump; });
      if (so.length === 1) {
        t = M.node(page, so[0].to);
      } else if (so.length === 0) {
        t = M.addTransition(project, page, st.x, st.y + P, '');
        M.addLink(project, page, st.id, t.id);
        created.push(t.id);
      } else {
        return { ok: false, created: [], message: 'Dieser Schritt hat schon mehrere Folgetransitionen. Klicke auf die Transition, an der die UND-Verzweigung beginnen soll.' };
      }
    } else if (k === 'transition') {
      t = M.node(page, opts.nodeId);
    } else if (k === 'link') {
      return { ok: false, created: [], message: 'Klicke auf eine Transition, einen Schritt oder eine freie Stelle.' };
    } else {
      var s0 = M.addStep(project, page, opts.x, opts.y);
      t = M.addTransition(project, page, opts.x, opts.y + P, '');
      M.addLink(project, page, s0.id, t.id);
      created.push(s0.id, t.id);
    }

    var outs = M.outLinks(page, t.id).filter(function (l) { return !l.jump && M.kindOf(page, l.to) === 'step'; });
    if (outs.length) {
      var firstS = M.node(page, outs[0].to);
      var join = findJoin(page, outs.map(function (l) { return l.to; }), 'transition');
      var bottom = join ? join.y : Infinity;
      var nx = U.snap(Math.max(maxXBetween(page, t.y, bottom), firstS.x) + 2 * B, G);
      var s1 = M.addStep(project, page, nx, firstS.y);
      M.addLink(project, page, t.id, s1.id);
      created.push(s1.id);
      if (join) M.addLink(project, page, s1.id, join.id);
      return { ok: true, created: created, select: s1.id, message: 'Ein weiterer paralleler Zweig wurde angelegt.' };
    }

    var x = t.x;
    var y = t.y;
    var sa = M.addStep(project, page, x - B, y + P);
    var sb = M.addStep(project, page, x + B, y + P);
    var t2 = M.addTransition(project, page, x, y + 2 * P, '');
    var sj = M.addStep(project, page, x, y + 3 * P);
    M.addLink(project, page, t.id, sa.id);
    M.addLink(project, page, t.id, sb.id);
    M.addLink(project, page, sa.id, t2.id);
    M.addLink(project, page, sb.id, t2.id);
    M.addLink(project, page, t2.id, sj.id);
    created.push(sa.id, sb.id, t2.id, sj.id);
    renumber(page, created);
    return { ok: true, created: created, select: t.id };
  };

  /** Vergibt den neuen Schritten Nummern in Lesereihenfolge. */
  function renumber(page, ids) {
    var mine = {};
    ids.forEach(function (id) { mine[id] = true; });
    var news = page.steps.filter(function (s) { return mine[s.id]; });
    var others = page.steps.filter(function (s) { return !mine[s.id]; });
    var max = 0;
    // wie M.nextStepName: auch Nummern von Makro-/Eingangs-/Ausgangsschritten (M3, E3, S3) zählen mit
    others.forEach(function (s) {
      var m = /^[MES]?(\d+)$/.exec(s.name);
      if (m) max = Math.max(max, +m[1]);
    });
    news.sort(function (a, b) { return a.y - b.y || a.x - b.x; });
    news.forEach(function (s, i) { s.name = String(max + 1 + i); });
  }

  // ------------------------------------------------------- Kopieren

  /** Teilgraph (Knoten + Verbindungen zwischen ihnen) als Kopie. */
  M.extract = function (page, ids) {
    var sel = {};
    ids.forEach(function (id) { sel[id] = true; });
    var frag = {
      steps: page.steps.filter(function (s) { return sel[s.id]; }),
      transitions: page.transitions.filter(function (t) { return sel[t.id]; }),
      notes: (page.notes || []).filter(function (nt) { return sel[nt.id]; }),
      links: []
    };
    var inside = {};
    frag.steps.concat(frag.transitions).forEach(function (n) { inside[n.id] = true; });
    frag.links = page.links.filter(function (l) { return inside[l.from] && inside[l.to]; });
    return U.clone(frag);
  };

  /** Fügt eine Kopie mit Versatz ein, Schritte erhalten freie Namen. */
  /**
   * Kopie einfügen (um dx/dy versetzt). Kopierte Schritte bekommen freie Namen; Bezüge
   * innerhalb der Kopie (X1, 5s/X1) werden auf die neuen Namen umgeschrieben, Bezüge auf
   * nicht kopierte Schritte bleiben.
   */
  M.paste = function (project, page, frag, dx, dy) {
    var map = {};
    var created = [];
    var names = [];
    var renamed = {};   // Schrittvariable alt -> neu
    var newSteps = [];
    frag.steps.forEach(function (s0) {
      var s = U.clone(s0);
      s.id = M.newId(project, 's');
      s.x += dx;
      s.y += dy;
      if (M.stepByName(page, s.name) || names.indexOf(s.name) >= 0) s.name = M.nextStepName(page, names);
      names.push(s.name);
      if (s.name !== s0.name) renamed['X' + s0.name] = 'X' + s.name;
      s.actions.forEach(function (a) { a.id = M.newId(project, 'a'); });
      map[s0.id] = s.id;
      page.steps.push(s);
      newSteps.push(s);
      created.push(s.id);
    });
    frag.transitions.forEach(function (t0) {
      var t = U.clone(t0);
      t.id = M.newId(project, 't');
      t.x += dx;
      t.y += dy;
      map[t0.id] = t.id;
      if (t.cond) t.cond = GE.expr.renameVars(t.cond, renamed);
      page.transitions.push(t);
      created.push(t.id);
    });
    newSteps.forEach(function (s) {
      s.actions.forEach(function (a) { if (a.cond) a.cond = GE.expr.renameVars(a.cond, renamed); });
    });
    frag.links.forEach(function (l0) {
      var l = { id: M.newId(project, 'l'), from: map[l0.from], to: map[l0.to], jump: !!l0.jump };
      page.links.push(l);
      created.push(l.id);
    });
    (frag.notes || []).forEach(function (n0) {
      var nt = M.addNote(project, page, n0.x + dx, n0.y + dy, n0.text);
      created.push(nt.id);
    });
    return created;
  };

  /**
   * Bezüge nach dem Umbenennen eines Schritts (art 'step': X<alt> in Bedingungen, Schritte
   * in G…{5,6}) bzw. eines Teil-GRAFCET (art 'frame': Ziel von Zwangssteuerungen) ändern.
   * Ohne apply wird nur gezählt. Liefert die Zahl der betroffenen Stellen.
   */
  M.renameRefs = function (page, alt, neu, art, apply) {
    var count = 0;
    var vars = {};
    vars['X' + alt] = 'X' + neu;
    function cond(el) {
      if (!el.cond) return;
      var c = GE.expr.renameVars(el.cond, vars);
      if (c === el.cond) return;
      count++;
      if (apply) el.cond = c;
    }
    page.steps.forEach(function (s) {
      s.actions.forEach(function (a) {
        if (art === 'step') {
          cond(a);
          if (a.type === 'forcing' && a.forceMode === 'steps') {
            var names = M.forceStepNames(a);
            if (names.indexOf(alt) >= 0) {
              count++;
              if (apply) a.forceSteps = names.map(function (n) { return n === alt ? neu : n; }).join(',');
            }
          }
        } else if (a.type === 'forcing' && a.target === alt) {
          count++;
          if (apply) a.target = neu;
        }
      });
    });
    if (art === 'step') page.transitions.forEach(cond);
    return count;
  };

  /** Linke obere Ecke eines kopierten Teils (für Einfügen an einer Stelle). */
  M.fragmentOrigin = function (frag) {
    var all = frag.steps.concat(frag.transitions, frag.notes || []);
    if (!all.length) return { x: 0, y: 0 };
    return {
      x: Math.min.apply(null, all.map(function (n) { return n.x; })),
      y: Math.min.apply(null, all.map(function (n) { return n.y; }))
    };
  };
})(globalThis.GE = globalThis.GE || {});
