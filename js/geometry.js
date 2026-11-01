/*
 * geometry.js – Maße und Lage der Elemente (ohne DOM, ohne SVG-Ausgabe).
 *
 * Gemeinsame Grundlage für die Zeichnung (render.js) und die Prüfung
 * (validate.js): Konstanten, Textbreiten, Ausdehnung von Schritten,
 * Transitionen und Aktionen, Rahmen, Verzweigungslinien und Rückführungen.
 */
(function (GE) {
  'use strict';

  var G = (GE.geometry = {});
  var U = GE.util;
  var E = GE.expr;
  var M = GE.model;

  /** Maße der Zeichnung in Pixeln (bei Zoom 100 %). */
  var C = (G.C = {
    STEP: 50,          // Schrittgröße
    H: 25,             // halbe Schrittgröße
    TBAR: 20,          // halbe Breite des Transitionsstrichs
    COND_X: 30,        // Abstand Bedingungstext von der Transitionsmitte
    ACT_GAP: 22,       // Verbindungslinie Schritt -> erste Aktion
    ACT_H: 40,         // Höhe eines Aktionskastens
    COND_LINE: 12,     // Strich über bedingten Aktionen
    FLAG_LINE: 18,     // Strich mit Fähnchen über Aktionen bei Ereignis
    ARROW: 18,         // Pfeil über/unter speichernden Aktionen
    FS_NAME: 18,       // Schriftgröße Schrittname
    FS: 15,            // Schriftgröße Bedingungen und Aktionen
    FS_COMMENT: 14,    // Schriftgröße Kommentare
    COMMENT_MAX: 40,   // Kommentare in der Zeichnung werden danach gekürzt
    MARK_X: 12,        // Lage von Pfeil/Fähnchen/Bedingungsstrich: so weit rechts vom linken Kastenrand
    NOTE_LINE: 20,     // Zeilenhöhe freier Kommentare
    FRAME_PAD: 26,     // Abstand Rahmen – Inhalt
    FRAME_LEFT: 60,    // zusätzlicher Platz links (Rückführungen laufen links vorbei)
    FRAME_HEAD: 34,    // Platz oben für den Namen des Teil-GRAFCET
    JUMP_LEN: 36,      // Länge der Sprungpfeile (Quelle nach unten, Ziel von oben)
    JUMP_LABEL_UP: 22, // Angabe der Herkunft über dem Zielschritt
    JUMP_SIDE_Y: 11,   // Sprungziel von rechts: Abstand über dem Schritt
    JUMP_SIDE_LEN: 44, // Sprungziel von rechts: Länge des Pfeils
    BACK_DOWN_STEP: 16,  // Rückführung: erst so weit nach unten (unter einem Schritt) …
    BACK_DOWN_TRANS: 26, // … bzw. unter einer Transition
    BACK_ENTRY: 20,    // Rückführung: so weit über dem Zielschritt hinein
    BACK_SIDE: 34,     // Rückführung: Abstand links neben der Zeichnung
    BACK_STEP: 16      // jede weitere Rückführung so viel weiter links
  });

  function tw(text, size, bold) {
    return U.textWidth(text, size || C.FS, bold);
  }

  /** Halbe Breite eines Schrittkastens (wächst bei langen Namen). */
  G.stepHalf = function (s) {
    return Math.max(C.H, (tw(s.name, C.FS_NAME, true) + 16) / 2);
  };

  G.actionLabel = function (a) {
    if (a.type === 'forcing') return M.forcingLabel(a);
    var v = a.var || '?';
    if (a.type !== 'stored' && a.type !== 'event') return v;
    if (a.value === 'inc') return v + ' := ' + v + ' + 1';
    if (a.value === 'dec') return v + ' := ' + v + ' − 1';
    return v + ' := ' + a.value;
  };

  G.actionWidth = function (a) {
    var w = tw(G.actionLabel(a)) + 22;
    // Bedingung/Ereignis steht links über dem Kasten und darf nicht überstehen
    if (a.type === 'conditional' || a.type === 'event') w = Math.max(w, exprWidth(a.cond) + C.MARK_X + 6);
    return Math.max(46, Math.ceil(w));
  };

  /** Platzbedarf über einem Aktionskasten (Bedingung, Ereignis mit Fähnchen, Pfeil). */
  function markTop(a) {
    if (a.type === 'conditional') return C.COND_LINE + C.FS + 6;
    if (a.type === 'event') return C.FLAG_LINE + C.FS + 6;
    if (a.type === 'stored' && a.when !== 'deactivation') return C.ARROW + 2;
    return 0;
  }

  /** Platzbedarf unter einem Aktionskasten (Pfeil bei Deaktivierung). */
  function markBottom(a) {
    return a.type === 'stored' && a.when === 'deactivation' ? C.ARROW + 2 : 0;
  }

  /**
   * Lage der Aktionskästen relativ zur Schrittmitte:
   * nebeneinander (Standard) oder untereinander (actionsLayout 'column').
   * @returns {{boxes:[{a,x,y,w}], right, top, bottom}}  y = Oberkante
   */
  G.actionBoxes = function (s) {
    var h = G.stepHalf(s);
    var res = { boxes: [], right: h, top: C.H, bottom: C.H };
    var acts = s.actions || [];
    if (!acts.length) return res;
    var x0 = h + C.ACT_GAP;
    var y0 = -C.ACT_H / 2;
    if (s.actionsLayout === 'column') {
      var w = Math.max.apply(null, acts.map(G.actionWidth));
      var y = y0;
      acts.forEach(function (a, i) {
        if (i) y += markBottom(acts[i - 1]) + markTop(a);
        res.boxes.push({ a: a, x: x0, y: y, w: w });
        y += C.ACT_H;
      });
      var last = acts[acts.length - 1];
      res.right = x0 + w;
      res.top = Math.max(C.H, C.ACT_H / 2 + markTop(acts[0]));
      res.bottom = Math.max(C.H, y + markBottom(last));
    } else {
      var x = x0;
      var mt = 0;
      var mb = 0;
      acts.forEach(function (a) {
        var bw = G.actionWidth(a);
        res.boxes.push({ a: a, x: x, y: y0, w: bw });
        x += bw;
        mt = Math.max(mt, markTop(a));
        mb = Math.max(mb, markBottom(a));
      });
      res.right = x;
      res.top = Math.max(C.H, C.ACT_H / 2 + mt);
      res.bottom = Math.max(C.H, C.ACT_H / 2 + mb);
    }
    return res;
  };

  /** Kommentarzeilen für die Zeichnung: in Anführungszeichen, lange Zeilen gekürzt. */
  G.commentLines = function (c) {
    var lines = String(c || '').replace(/\s+$/, '').split(/\r?\n/);
    if (!lines.join('').trim()) return [];
    lines = lines.map(function (t) { return t.length > C.COMMENT_MAX ? t.slice(0, C.COMMENT_MAX - 1) + '…' : t; });
    lines[0] = '„' + lines[0];
    lines[lines.length - 1] += '“';
    return lines;
  };

  /** Erste Zeile (für Tooltips u. Ä.). */
  G.commentText = function (c) {
    var l = G.commentLines(c);
    return l.length === 1 ? l[0] : l.length ? l[0] + ' …“' : '';
  };

  function commentWidth(c) {
    var l = G.commentLines(c);
    return l.length ? Math.max.apply(null, l.map(function (t) { return tw(t, C.FS_COMMENT); })) + 12 : 0;
  }

  /** Begrenzung eines Rahmens (feste Lage und Größe). */
  G.frameBounds = function (page, fr) {
    return {
      x1: fr.x, y1: fr.y, x2: fr.x + fr.w, y2: fr.y + fr.h,
      empty: !M.frameMembers(page, fr.id).length && !(page.frames || []).some(function (o) { return M.parentFrame(page, o) === fr; })
    };
  };

  /** Beschriftung eines Rahmens: Name des Teil-GRAFCET bzw. des zugehörigen Schritts. */
  G.frameLabel = function (page, fr) {
    if (fr.owner) {
      var o = M.node(page, fr.owner);
      if (o) return o.name;
    }
    return fr.name || '?';
  };

  /** Ausdehnung eines Elements als Rechteck (für Rahmen und Layout). */
  G.elementBox = function (page, el) {
    if (M.isNote(el)) {
      var sz = G.noteSize(el);
      return { x1: el.x, y1: el.y, x2: el.x + sz.w, y2: el.y + sz.h };
    }
    var ex = G.extent(page, el);
    var step = M.isStep(el);
    var left = ex.left + (step ? C.FRAME_LEFT : 0);
    return { x1: el.x - left, y1: el.y - ex.top, x2: el.x + ex.right, y2: el.y + ex.bottom + (step ? 0 : 30) };
  };

  /** Rahmen-Rechteck {x, y, w, h}, das Elemente und Rechtecke mit Abstand umschließt. */
  G.fitRect = function (page, els, rects) {
    var b = { x1: Infinity, y1: Infinity, x2: -Infinity, y2: -Infinity };
    function add(r) {
      b.x1 = Math.min(b.x1, r.x1); b.y1 = Math.min(b.y1, r.y1);
      b.x2 = Math.max(b.x2, r.x2); b.y2 = Math.max(b.y2, r.y2);
    }
    els.forEach(function (el) { add(G.elementBox(page, el)); });
    (rects || []).forEach(add);
    if (b.x1 === Infinity) return null;
    var g = M.GRID;
    var x = Math.floor((b.x1 - C.FRAME_PAD) / g) * g;
    var y = Math.floor((b.y1 - C.FRAME_PAD - C.FRAME_HEAD) / g) * g;
    return { x: x, y: y, w: Math.ceil((b.x2 + C.FRAME_PAD) / g) * g - x, h: Math.ceil((b.y2 + C.FRAME_PAD) / g) * g - y };
  };

  /** Größe eines freien Kommentars (mehrzeilig). */
  G.noteSize = function (nt) {
    var lines = String(nt.text || '').split(/\r?\n/);
    if (!String(nt.text || '').trim()) lines = ['(leerer Kommentar)'];
    var w = Math.max.apply(null, lines.map(function (l) { return tw(l); }));
    return { lines: lines, w: Math.max(60, Math.ceil(w) + 16), h: lines.length * C.NOTE_LINE + 12 };
  };

  /** Ausdehnung links/rechts der Mitte, für Layout und Begrenzung. */
  G.extent = function (page, node) {
    if (node.cond !== undefined) {
      var left = C.TBAR + 6 + (node.name ? tw('(' + node.name + ')') + 8 : 0);
      var tpos = node.commentPos || 'right';
      var right = C.COND_X + exprWidth(node.cond || '?') + (node.comment && tpos === 'right' ? commentWidth(node.comment) + 2 : 0);
      if (node.comment && tpos === 'left') left += commentWidth(node.comment);
      return { left: left, right: right, top: 14, bottom: 14 };
    }
    var ab = G.actionBoxes(node);
    var cw = commentWidth(node.comment);
    var pos = node.commentPos || 'left';
    return {
      left: G.stepHalf(node) + (pos === 'left' ? cw : 0),
      right: ab.right + (pos === 'right' ? cw + 12 : 0),
      top: ab.top, bottom: ab.bottom
    };
  };

  var parseCache = {};

  var parseCount = 0;

  /** E.parse mit Zwischenspeicher je Text (der Baum wird nur gelesen, nie verändert). */
  function parse(text) {
    var key = String(text == null ? '' : text);
    if (parseCache.hasOwnProperty(key)) return parseCache[key];
    if (++parseCount > 2000) { parseCache = {}; parseCount = 1; }
    return (parseCache[key] = E.parse(key));
  }

  function exprWidth(text) {
    var r = parse(text);
    if (!r.ok) return tw(text || '?');
    return E.runs(r.ast).reduce(function (s, run) { return s + tw(run.text); }, 0);
  }

  G.exprWidth = exprWidth;
  G.tw = tw;
  G.parse = parse;
  G.commentWidth = commentWidth;
  G.markTop = markTop;
  G.markBottom = markBottom;

  /** Ermittelt Ein-/Ausgänge und die Lage der Verzweigungslinien. */
  function analyze(page) {
    var info = {};
    function mk(kind, el) {
      return { kind: kind, el: el, fin: [], fout: [], bin: [], bout: [], jin: [], jout: [] };
    }
    page.steps.forEach(function (s) { info[s.id] = mk('step', s); });
    page.transitions.forEach(function (t) { info[t.id] = mk('transition', t); });
    page.links.forEach(function (l) {
      var a = info[l.from];
      var b = info[l.to];
      if (!a || !b) return;
      if (l.jump) { a.jout.push(l); b.jin.push(l); return; }
      if (b.el.y > a.el.y + 5) { a.fout.push(l); b.fin.push(l); } else { a.bout.push(l); b.bin.push(l); }
    });
    function ys(list, end) { return list.map(function (l) { return info[l[end]].el.y; }); }
    Object.keys(info).forEach(function (id) {
      var nd = info[id];
      var e = nd.el;
      if (nd.kind === 'step') {
        var bottom = e.y + C.H;
        var top = e.y - C.H;
        if (nd.fout.length >= 2) nd.orDiv = bottom + U.clamp((Math.min.apply(null, ys(nd.fout, 'to')) - bottom) / 2, 6, 20);
        if (nd.fin.length >= 2) nd.orConv = top - U.clamp((top - Math.max.apply(null, ys(nd.fin, 'from'))) / 2, 6, 20);
      } else {
        if (nd.fout.length >= 2) nd.andDiv = e.y + U.clamp((Math.min.apply(null, ys(nd.fout, 'to')) - C.H - e.y) / 2 - 2, 6, 18);
        if (nd.fin.length >= 2) nd.andConv = e.y - U.clamp((e.y - Math.max.apply(null, ys(nd.fin, 'from')) - C.H) / 2 - 2, 6, 18);
      }
    });
    return info;
  }

  G.analyze = analyze;
  G.backRoute = function (page, info, ext, l, index) { return backRoute(page, info, ext, l, index); };

  var frameCacheFor = null;

  var frameCache = {};

  /**
   * Linienzug einer Rückführung nach oben: links an der Zeichnung vorbei.
   * index = laufende Nummer der Rückführung (jede weitere läuft etwas weiter links).
   */
  function backRoute(page, info, ext, l, index) {
    var a = info[l.from];
    var t = info[l.to];
    var start = a.kind === 'step' ? { x: a.el.x, y: a.el.y + C.H } : { x: a.el.x, y: a.el.y };
    var downY = start.y + (a.kind === 'step' ? C.BACK_DOWN_STEP : C.BACK_DOWN_TRANS);
    var topY = t.kind === 'step' ? t.el.y - C.H : t.el.y;
    var entryY = t.orConv !== undefined ? t.orConv : topY - C.BACK_ENTRY;
    var minLeft = Infinity;
    // nur Elemente im selben Rahmen berücksichtigen (sonst läuft die Linie durch andere Teil-GRAFCETs)
    // Rahmen je Knoten einmal je Zeichnung (info gehört zu genau einem Durchlauf)
    if (frameCacheFor !== info) { frameCacheFor = info; frameCache = {}; }
    var frameOf = frameCache;
    function fr(nd) { return frameOf.hasOwnProperty(nd.id) ? frameOf[nd.id] : (frameOf[nd.id] = M.frameOf(page, nd)); }
    var ownFrame = fr(a.el);
    M.nodes(page).forEach(function (nd) {
      if (fr(nd) !== ownFrame) return;
      if (nd.y >= entryY - C.H && nd.y <= downY + C.H) minLeft = Math.min(minLeft, nd.x - ext[nd.id].left);
    });
    var sideX = Math.min(minLeft, start.x, t.el.x) - C.BACK_SIDE - C.BACK_STEP * index + (l.dx || 0);
    return [start, { x: start.x, y: downY }, { x: sideX, y: downY }, { x: sideX, y: entryY }, { x: t.el.x, y: entryY }, { x: t.el.x, y: topY }];
  }

  /** Rückführungen mit ihrer Begrenzung: [{link, from (Element), box {x1,y1,x2,y2}}]. */
  G.backBoxes = function (page) {
    var info = analyze(page);
    var ext = {};
    M.nodes(page).forEach(function (nd) { ext[nd.id] = G.extent(page, nd); });
    var res = [];
    var index = 0;
    page.links.forEach(function (l) {
      var a = info[l.from];
      if (!a || !info[l.to] || l.jump || a.fout.indexOf(l) >= 0) return;
      var pts = backRoute(page, info, ext, l, index++);
      res.push({ link: l, from: a.el, box: { x1: pts[2].x - 8, y1: pts[3].y, x2: pts[0].x, y2: pts[1].y } });
    });
    return res;
  };

  /**
   * Was über den Rand seines Rahmens hinausragt (Aktionen, Kommentare, Bedingungen,
   * Rückführungen). Liefert {Rahmen-id: [Element- bzw. Verbindungs-ids]}.
   */
  G.overhang = function (page) {
    var res = {};
    if (!(page.frames || []).length) return res;
    function check(el, id, b) {
      var fr = M.frameOf(page, el);
      if (fr && (b.x1 < fr.x || b.y1 < fr.y || b.x2 > fr.x + fr.w || b.y2 > fr.y + fr.h)) (res[fr.id] = res[fr.id] || []).push(id);
    }
    M.nodes(page).forEach(function (nd) {
      var e = G.extent(page, nd);
      check(nd, nd.id, { x1: nd.x - e.left, y1: nd.y - e.top, x2: nd.x + e.right, y2: nd.y + e.bottom });
    });
    (page.notes || []).forEach(function (nt) { check(nt, nt.id, G.elementBox(page, nt)); });
    G.backBoxes(page).forEach(function (bb) { check(bb.from, bb.link.id, bb.box); });
    return res;
  };

  /** Rahmen-Rechteck für „An Inhalt anpassen“: Inhalt, eingebettete Rahmen und Rückführungen. */
  G.frameFitRect = function (page, fr) {
    var inner = (page.frames || []).filter(function (o) { return M.parentFrame(page, o) === fr; })
      .map(function (o) { return { x1: o.x, y1: o.y, x2: o.x + o.w, y2: o.y + o.h }; });
    var members = M.frameMembers(page, fr.id, false);
    var mine = {};
    members.forEach(function (el) { mine[el.id] = true; });
    G.backBoxes(page).forEach(function (bb) { if (mine[bb.from.id]) inner.push(bb.box); });
    return G.fitRect(page, members, inner);
  };
})(globalThis.GE = globalThis.GE || {});
