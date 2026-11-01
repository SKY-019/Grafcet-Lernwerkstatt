/*
 * app.js – Zentraler Zustand, Befehle, Tastenkürzel und Start.
 */
(function (GE) {
  'use strict';

  var M = GE.model;
  var V = GE.validate;
  var L = GE.layout;
  var U = GE.util;

  var app = (GE.app = {
    project: null,
    pageId: null,
    sel: {},              // ausgewählte Element-ids
    primary: null,        // zuletzt angeklicktes Element (Bezug fürs Ausrichten)
    tool: 'select',
    mode: 'edit',         // 'edit' = Zeichnen, 'sim' = Simulieren
    view: { x: 40, y: 30, k: 1 },
    issues: [],
    issueMap: {},
    clipboard: null,
    pasteCount: 0,
    pendingConnect: null
  });

  app.page = function () {
    return M.getPage(app.project, app.pageId) || app.project.pages[0];
  };

  function getState() { return JSON.stringify(app.project); }
  function setState(s) {
    if (app.mode === 'sim') app.setMode('edit');
    app.project = JSON.parse(s);
    if (!M.getPage(app.project, app.pageId)) app.pageId = app.project.pages[0].id;
    pruneSelection();
    app.refresh();
  }
  /** Eigene Rückgängig-Liste (je Tab eine, siehe files.js). */
  app.newHistory = function () { return new GE.History(getState, setState); };
  app.history = app.newHistory();

  /** Leerer GRAFCET mit Anfangsschritt. */
  app.blankProject = function () {
    var p = M.createProject('Neuer GRAFCET');
    M.addStep(p, p.pages[0], 160, 100, { initial: true });
    return p;
  };

  /** Änderung als ein Rückgängig-Schritt ausführen und neu zeichnen. */
  app.change = function (fn) {
    app.history.begin();
    var r = fn();
    app.history.commit();
    app.refresh();
    return r;
  };

  /**
   * Prüfen, zeichnen, Seitenleiste und Werkzeugleiste aktualisieren.
   * opts.panel === false: Eigenschaftsfeld nicht neu aufbauen (z. B. beim Tippen darin);
   * opts.validate === false: nicht neu prüfen (reine Auswahl, laufendes Ziehen – die
   * vollständige Prüfung folgt beim Loslassen).
   */
  app.refresh = function (opts) {
    opts = opts || {};
    var page = app.page();
    if (opts.validate !== false) {
      app.issues = V.page(page);
      app.issueMap = {};
      var rank = { error: 3, warning: 2, info: 1 };
      app.issues.forEach(function (i) {
        i.ids.forEach(function (id) {
          if (!app.issueMap[id] || rank[i.level] > rank[app.issueMap[id]]) app.issueMap[id] = i.level;
        });
      });
    }
    GE.editor.render();
    if (opts.panel !== false) GE.panel.render();
    if (opts.validate !== false) GE.panel.renderIssues(app.issues);
    GE.taskui.refresh();
    app.updateToolbar();
    GE.files.refresh();
  };

  function pruneSelection() {
    var page = app.page();
    Object.keys(app.sel).forEach(function (id) { if (!M.find(page, id)) delete app.sel[id]; });
    if (app.primary && !app.sel[app.primary]) app.primary = null;
  }

  app.select = function (ids, primary) {
    app.sel = {};
    ids.forEach(function (id) { app.sel[id] = true; });
    app.primary = primary || ids[ids.length - 1] || null;
    if (app.pendingConnect && !app.sel[app.pendingConnect]) app.pendingConnect = null;
    app.refresh({ validate: false });   // die Auswahl ändert nichts an den Prüfmeldungen
  };

  app.toggleSelect = function (id) {
    if (app.sel[id]) delete app.sel[id];
    else { app.sel[id] = true; app.primary = id; }
    app.refresh({ validate: false });
  };

  app.selectedIds = function () {
    return Object.keys(app.sel);
  };

  app.selectedNodeIds = function () {
    var page = app.page();
    return Object.keys(app.sel).filter(function (id) { return M.node(page, id); });
  };

  /** Ausgewählte Schritte, Transitionen und freie Kommentare. */
  app.selectedMovableIds = function () {
    var page = app.page();
    return Object.keys(app.sel).filter(function (id) { return M.movable(page, id); });
  };

  app.setTool = function (tool) {
    GE.editor.closeMenu();
    app.tool = tool;
    app.pendingConnect = null;
    GE.editor.cancel();
    var btns = document.querySelectorAll('#palette [data-tool]');
    for (var i = 0; i < btns.length; i++) btns[i].classList.toggle('on', btns[i].getAttribute('data-tool') === tool);
    document.getElementById('canvas').setAttribute('data-tool', tool);
    document.getElementById('overlay').innerHTML = '';
    app.updateHint();
    if (app.project) GE.editor.render();   // Anschlusspunkte je nach Werkzeug
  };

  app.updateHint = function () {
    var hint = GE.editor.TOOL_HINTS[app.tool] || '';
    if (app.mode === 'sim') hint = 'Simulation: Zeichnung gesperrt · Ziehen verschiebt die Ansicht · Strg+Mausrad zoomt · Strg+Enter zurück zum Zeichnen';
    if (app.pendingConnect) {
      var f = M.find(app.page(), app.pendingConnect);
      var name = f ? (f.kind === 'step' ? 'Schritt ' + f.el.name : 'Transition') : '';
      hint = 'Quelle: ' + name + ' – jetzt das Ziel anklicken oder mit Strg+Pfeiltasten wählen und Enter drücken (Esc bricht ab).';
    }
    document.getElementById('statusHint').textContent = hint;
  };

  app.updateToolbar = function () {
    document.getElementById('btnUndo').disabled = !app.history.canUndo();
    document.getElementById('btnRedo').disabled = !app.history.canRedo();
    var n = app.selectedNodeIds().length;
    // Ausrichten nur zeigen, wenn mehrere Elemente ausgewählt sind
    document.getElementById('btnAlignV').hidden = n < 2;
    document.getElementById('btnAlignH').hidden = n < 2;
    var t = document.getElementById('projectTitle');
    if (document.activeElement !== t) t.value = app.project.title;
  };

  var toastTimer = null;
  app.toast = function (text, level) {
    var el = document.getElementById('toast');
    el.textContent = text;
    el.className = 'toast show' + (level ? ' ' + level : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.className = 'toast'; }, level ? 4200 : 2800);
  };

  /** Zwischen Zeichnen ('edit') und Simulieren ('sim') umschalten. */
  app.setMode = function (mode) {
    if (mode === app.mode) return;
    if (mode === 'sim') {
      GE.editor.finishInline(true);
      var page = app.page();
      if (!page.steps.length) return app.toast('Es gibt noch nichts zu simulieren.', 'warn');
      if (!page.steps.some(function (s) { return s.initial; })) {
        return app.toast('Ohne Anfangsschritt kann die Simulation nicht starten. Setze zuerst einen Anfangsschritt (Taste I).', 'error');
      }
      app.setTool('select');
      app.sel = {};
      app.mode = 'sim';
      document.body.classList.add('mode-sim');
      document.getElementById('simPanel').hidden = false;
      GE.simui.enter();
    } else {
      GE.simui.leave();
      app.mode = 'edit';
      document.body.classList.remove('mode-sim');
      document.getElementById('simPanel').hidden = true;
    }
    var btns = document.querySelectorAll('.mode-switch [data-mode]');
    for (var i = 0; i < btns.length; i++) btns[i].classList.toggle('on', btns[i].getAttribute('data-mode') === app.mode);
    app.updateHint();
    app.refresh();
    // Die Zeichenfläche ändert ihre Größe (Zeitverlauf ein/aus): Ansicht anpassen
    GE.editor.fit();
  };

  /**
   * fn ausführen, wenn dabei nichts Ungespeichertes verloren geht – sonst erst nachfragen
   * (eigener Dialog, siehe ui.js).
   */
  app.whenDiscardOk = function (question, okLabel, fn) {
    if (!GE.files.isDirty()) return fn();
    GE.ui.ask({
      title: 'Ungespeicherte Änderungen',
      text: question + ' Die Zeichnung in diesem Tab hat ungespeicherte Änderungen; sie gehen dabei verloren. ' +
        'Tipp: Mit „+“ oben öffnest du einen neuen Tab.',
      buttons: [{ label: 'Abbrechen', value: false }, { label: okLabel, value: true, kind: 'danger' }]
    }).then(function (ok) { if (ok) fn(); });
  };

  /**
   * Nach dem Umbenennen eines Schritts bzw. Teil-GRAFCET: gibt es Bezüge auf den alten
   * Namen, nachfragen und sie als ein Rückgängig-Schritt mitändern (Standard: Mitändern).
   */
  app.offerRenameRefs = function (art, alt, neu) {
    if (!alt || !neu || alt === neu) return;
    var page = app.page();
    var n = M.renameRefs(page, alt, neu, art, false);
    if (!n) return;
    var was = art === 'step' ? 'X' + alt : alt;
    var wird = art === 'step' ? 'X' + neu : neu;
    GE.ui.ask({
      title: 'Bezüge mitändern?',
      text: n + (n === 1 ? ' Bezug' : ' Bezüge') + ' auf ' + was + ' in ' + wird + ' ändern?',
      buttons: [{ label: 'Nicht ändern', value: false }, { label: 'Mitändern', value: true, kind: 'primary' }]
    }).then(function (ok) {
      if (!ok) return;
      app.change(function () { M.renameRefs(app.page(), alt, neu, art, true); });
      app.toast(n + (n === 1 ? ' Bezug geändert' : ' Bezüge geändert'));
    });
  };

  app.loadProject = function (project) {
    app.project = M.normalize(project);
    app.project.pages.forEach(M.normalizeConditions);
    app.pageId = app.project.pages[0].id;
    app.sel = {};
    app.primary = null;
    app.history.clear();
    GE.files.loaded();
    app.refresh();
    if (app.mode === 'sim') GE.simui.enter();
    GE.editor.fit();
  };

  // ------------------------------------------------------------ Befehle

  app.cmd = {
    undo: function () { if (app.history.undo()) app.toast('Rückgängig gemacht'); },
    redo: function () { if (app.history.redo()) app.toast('Wiederholt'); },

    del: function () {
      var ids = app.selectedIds();
      if (!ids.length) return;
      var frames = ids.filter(function (id) { return M.kindOf(app.page(), id) === 'frame'; }).length;
      app.change(function () { M.remove(app.page(), ids); });
      app.select([]);
      if (frames) app.toast('Rahmen aufgelöst – der Inhalt bleibt erhalten.');
    },

    /** Auswahl (mit allem Verbundenen) mit einem neuen Teil-GRAFCET-Rahmen umgeben. */
    groupFrame: function () {
      var page = app.page();
      var ids = app.selectedMovableIds();
      if (!ids.length) return app.toast('Bitte zuerst Elemente auswählen.', 'warn');
      var all = {};
      ids.forEach(function (id) {
        if (M.node(page, id)) M.component(page, id).forEach(function (cid) { all[cid] = true; });
        else all[id] = true;
      });
      var rect = GE.render.fitRect(page, Object.keys(all).map(function (id) { return M.movable(page, id); }));
      if (!rect) return;
      var fr = app.change(function () { return M.addFrame(app.project, page, null, rect); });
      app.select([fr.id]);
      app.toast('Teil-GRAFCET ' + fr.name + ' angelegt.');
    },

    /** Ausgewählten Rahmen auf seinen Inhalt (samt eingebetteter Rahmen) anpassen. */
    fitFrame: function () {
      var page = app.page();
      var fr = app.selectedIds().map(function (id) { return M.find(page, id); }).filter(function (f) { return f && f.kind === 'frame'; })[0];
      if (!fr) return;
      fr = fr.el;
      var rect = GE.render.frameFitRect(page, fr);
      if (!rect) return app.toast('Der Rahmen ist leer.', 'warn');
      app.change(function () { fr.x = rect.x; fr.y = rect.y; fr.w = rect.w; fr.h = rect.h; });
    },

    selectAll: function () {
      var page = app.page();
      app.select(M.nodes(page).concat(page.links).map(function (n) { return n.id; }));
    },

    copy: function () {
      var ids = app.selectedMovableIds();
      if (!ids.length) return false;
      app.clipboard = M.extract(app.page(), ids);
      app.pasteCount = 0;
      app.toast(ids.length + (ids.length === 1 ? ' Element' : ' Elemente') + ' kopiert');
      return true;
    },

    cut: function () {
      if (app.cmd.copy()) app.cmd.del();
    },

    paste: function () {
      if (!app.clipboard) return;
      app.pasteCount++;
      var off = 2 * M.GRID * app.pasteCount;
      var created = app.change(function () {
        return M.paste(app.project, app.page(), app.clipboard, off, off);
      });
      app.select(created);
    },

    /** Kopie so einfügen, dass ihre linke obere Ecke an der Stelle liegt (Rechtsklick-Menü). */
    pasteAt: function (world) {
      if (!app.clipboard) return;
      var o = M.fragmentOrigin(app.clipboard);
      var dx = U.snap(world.x - o.x, M.GRID);
      var dy = U.snap(world.y - o.y, M.GRID);
      var created = app.change(function () {
        return M.paste(app.project, app.page(), app.clipboard, dx, dy);
      });
      app.select(created);
    },

    duplicate: function () {
      var keep = app.clipboard;
      if (!app.cmd.copy()) return;
      app.cmd.paste();
      app.clipboard = keep || app.clipboard;
    },

    layout: function () {
      if (!app.page().steps.length) return;
      app.change(function () {
        L.auto(app.page());
        if (GE.prefs.get('originZero')) moveOriginToInitial(app.page());
      });
      GE.editor.fit();
      app.toast('Automatisch angeordnet');
    },

    alignV: function () {
      var ids = app.selectedNodeIds();
      if (ids.length < 2) return app.toast('Bitte mindestens zwei Elemente auswählen.', 'warn');
      app.change(function () { L.alignVertical(app.page(), ids, app.primary); });
    },

    alignH: function () {
      var ids = app.selectedNodeIds();
      if (ids.length < 2) return app.toast('Bitte mindestens zwei Elemente auswählen.', 'warn');
      app.change(function () { L.alignHorizontal(app.page(), ids, app.primary); });
    },

    numberTransitions: function () {
      app.change(function () { M.numberTransitions(app.page()); });
      app.toast('Transitionen mit T1, T2, … bezeichnet');
    },

    clearTransitionNames: function () {
      app.change(function () { app.page().transitions.forEach(function (t) { t.name = ''; }); });
    },

    toggleInitial: function () {
      var page = app.page();
      var steps = app.selectedIds().map(function (id) { return M.find(page, id); })
        .filter(function (f) { return f && f.kind === 'step'; });
      if (!steps.length) {
        app.setTool('initial');
        return;
      }
      var on = !steps.every(function (f) { return f.el.initial; });
      app.change(function () { steps.forEach(function (f) { f.el.initial = on; }); });
    },

    append: function () {
      var ids = app.selectedNodeIds();
      if (ids.length !== 1) return app.toast('Bitte genau einen Schritt oder eine Transition auswählen.', 'warn');
      var res = app.change(function () { return M.append(app.project, app.page(), ids[0]); });
      if (!res.ok) return app.toast(res.message, 'warn');
      app.select([res.select]);
      GE.editor.reveal(res.select);
      var t = res.created.filter(function (id) { return M.kindOf(app.page(), id) === 'transition'; })[0];
      if (t) {
        // Bedingung der neuen Transition gleich abfragen
        GE.editor.startInline(t);
      }
    },

    edit: function () {
      var fa = app.selectedIds().length === 1 ? M.find(app.page(), app.selectedIds()[0]) : null;
      if (fa && fa.kind === 'action') {
        app.select([fa.step.id]);
        GE.panel.focusAction(fa.el.id);
        return;
      }
      var ids = app.selectedIds().filter(function (id) { return M.kindOf(app.page(), id) !== 'link'; });
      if (ids.length === 1) GE.editor.startInline(ids[0]);
    },

    nudge: function (dx, dy) {
      var page = app.page();
      var sel = app.selectedIds();
      var fa = sel.length === 1 ? M.find(page, sel[0]) : null;
      if (fa && fa.kind === 'action') {
        // ausgewählte Aktion mit den Pfeiltasten umsortieren
        var list = fa.step.actions;
        var i = list.indexOf(fa.el);
        var j = i + (dx > 0 || dy > 0 ? 1 : -1);
        if (j < 0 || j >= list.length) return;
        app.change(function () { list[i] = list[j]; list[j] = fa.el; });
        return;
      }
      var ids = app.selectedMovableIds();
      if (!ids.length) return;
      app.change(function () {
        ids.forEach(function (id) {
          var nd = M.movable(app.page(), id);
          nd.x += dx;
          nd.y += dy;
        });
      });
    },

    zoomIn: function () { GE.editor.zoomAt(1.2); },
    zoomOut: function () { GE.editor.zoomAt(1 / 1.2); },
    zoomReset: function () { GE.editor.setZoom(1); },
    fit: function () { GE.editor.fit(); },
    help: function () { document.getElementById('helpDialog').showModal(); },

    newProject: function () {
      app.whenDiscardOk('Neuen GRAFCET in diesem Tab beginnen?', 'Neu beginnen', function () {
        var p = app.blankProject();
        app.loadProject(p);
        app.view.x = 40; app.view.y = 30; app.view.k = 1;
        GE.editor.applyView();
        app.select([p.pages[0].steps[0].id]);
        app.setTool('select');
      });
    },

    save: function () { GE.files.save(false); },
    saveAs: function () { GE.files.save(true); },
    open: function () { GE.files.open(); },

    example: function (id) {
      var ex = GE.examples.get(id) || GE.examples.list[0];
      app.loadProject(ex.build());
      app.toast('Beispiel geladen: ' + ex.title);
    }
  };

  /** Alles so verschieben, dass der Anfangsschritt mit dem kleinsten Namen bei 0/0 liegt. */
  function moveOriginToInitial(page) {
    var init = page.steps.filter(function (s) { return s.initial; })
      .sort(function (a, b) { return U.naturalCompare(a.name, b.name); })[0];
    if (!init) return;
    var dx = -init.x;
    var dy = -init.y;
    M.nodes(page).concat(page.notes || [], page.frames || []).forEach(function (el) {
      el.x += dx;
      el.y += dy;
    });
  }

  /** Einstellungen öffnen (optional mit der aktuellen Mausposition als Ziel). */
  function openSettings() {
    var dlg = document.getElementById('settingsDialog');
    var boxes = dlg.querySelectorAll('[data-pref]');
    for (var i = 0; i < boxes.length; i++) boxes[i].checked = !!GE.prefs.get(boxes[i].getAttribute('data-pref'));
    var w = GE.editor.lastWorld();
    document.getElementById('gotoX').value = Math.round(w.x / M.GRID) * M.GRID;
    document.getElementById('gotoY').value = Math.round(w.y / M.GRID) * M.GRID;
    dlg.showModal();
  }

  function initSettings() {
    var dlg = document.getElementById('settingsDialog');
    bind('btnSettings', openSettings);
    document.getElementById('statusPos').addEventListener('click', openSettings);
    dlg.addEventListener('change', function (e) {
      if (e.target.id === 'themeSelect') return GE.ui.setTheme(e.target.value);
      var k = e.target.getAttribute('data-pref');
      if (!k) return;
      GE.prefs.set(k, e.target.checked);
      if (k === 'timingOpen' && GE.simui.applyTimingPrefs) GE.simui.applyTimingPrefs();
      if (k === 'showSolution') GE.taskui.render();
    });
    bind('gotoBtn', function () {
      var x = parseFloat(document.getElementById('gotoX').value) || 0;
      var y = parseFloat(document.getElementById('gotoY').value) || 0;
      dlg.close();
      GE.editor.centerOn(x, y);
      app.toast('Ansicht auf x ' + x + ', y ' + y + ' gesetzt');
    });
    bind('gotoOrigin', function () { dlg.close(); GE.editor.centerOn(0, 0); });
    bind('gotoFit', function () { dlg.close(); GE.editor.fit(); });
    var nums = dlg.querySelectorAll('input[type=number]');
    for (var j = 0; j < nums.length; j++) {
      nums[j].addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); document.getElementById('gotoBtn').click(); }
      });
    }
  }

  // ------------------------------------------------------------ Tastatur

  function isTyping(e) {
    var t = e.target;
    return t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
  }

  /** Fokus auf einem Knopf: Enter und Leertaste gehören dann dem Knopf, nicht den Kürzeln. */
  function onButton(e) {
    var t = e.target;
    return !!(t && t.closest && t.closest('button, a[href], summary, [role="button"], [role="tab"], [role="menuitem"]'));
  }

  var TOOL_KEYS = { v: 'select', a: 'initial', s: 'step', t: 'transition', c: 'connect', j: 'jump', o: 'or', u: 'and', k: 'comment', g: 'frame' };

  function onKey(e) {
    if (document.querySelector('dialog[open]')) return;
    if (GE.editor.isMenuOpen()) {
      if (e.key === 'Escape') { e.preventDefault(); GE.editor.closeMenu(); }
      else if (GE.editor.menuKey(e.key)) e.preventDefault();
      return;
    }
    var k = e.key;
    var lower = k.length === 1 ? k.toLowerCase() : k;
    var ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && k === 'Enter') {
      e.preventDefault();
      app.setMode(app.mode === 'sim' ? 'edit' : 'sim');
      return;
    }
    // Datei: gilt auch beim Tippen in einem Feld
    if (ctrl && !e.altKey && (lower === 's' || lower === 'o' || lower === 'p')) {
      e.preventDefault();
      if (isTyping(e)) e.target.blur();
      if (lower === 's') app.cmd[e.shiftKey ? 'saveAs' : 'save']();
      else if (lower === 'o') app.cmd.open();
      else GE.exporter.print();
      return;
    }
    // Esc in einem Feld rechts: Feld verlassen (Eingabe bleibt), Werkzeug und laufendes Verbinden zurücksetzen
    if (k === 'Escape' && isTyping(e)) {
      e.target.blur();
      app.setTool('select');
      return;
    }
    if (isTyping(e)) return;
    if ((k === 'Enter' || k === ' ') && onButton(e)) return;
    if (app.mode === 'edit' && (k === 'ContextMenu' || (e.shiftKey && k === 'F10'))) {
      e.preventDefault();
      GE.editor.keyboardMenu();
      return;
    }
    if (app.mode === 'sim') {
      onSimKey(e, k, lower, ctrl);
      return;
    }

    // Strg/Alt + Pfeiltaste: zum benachbarten Element wechseln (Bedienung ohne Maus)
    var NAV = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
    if ((ctrl || e.altKey) && NAV[k] && !e.shiftKey) {
      e.preventDefault();
      GE.editor.selectNeighbor(NAV[k][0], NAV[k][1]);
      return;
    }
    if (ctrl) {
      var map = {
        z: e.shiftKey ? app.cmd.redo : app.cmd.undo,
        y: app.cmd.redo,
        a: app.cmd.selectAll,
        c: app.cmd.copy,
        x: app.cmd.cut,
        v: app.cmd.paste,
        d: app.cmd.duplicate
      };
      if (map[lower]) {
        e.preventDefault();
        map[lower]();
      }
      return;
    }
    if (e.altKey) return;

    if (k === ' ') {
      e.preventDefault();
      GE.editor.setSpace(true);
      return;
    }
    if (TOOL_KEYS[lower]) {
      e.preventDefault();
      app.setTool(TOOL_KEYS[lower]);
      return;
    }
    var step = e.shiftKey ? 5 * M.GRID : M.GRID;
    switch (k) {
      case 'Escape':
        if (app.pendingConnect) { app.pendingConnect = null; app.updateHint(); }
        else if (app.tool !== 'select') app.setTool('select');
        else app.select([]);
        break;
      case 'Delete':
      case 'Backspace':
        e.preventDefault();
        app.cmd.del();
        break;
      case 'Enter':
        e.preventDefault();
        // mit gewähltem Werkzeug: auf die Auswahl anwenden (ohne Mausklick), sonst beschriften
        if (app.tool !== 'select') GE.editor.applyToolByKey();
        else app.cmd.edit();
        break;
      case 'F2':
        e.preventDefault();
        app.cmd.edit();
        break;
      case 'ArrowLeft': e.preventDefault(); app.cmd.nudge(-step, 0); break;
      case 'ArrowRight': e.preventDefault(); app.cmd.nudge(step, 0); break;
      case 'ArrowUp': e.preventDefault(); app.cmd.nudge(0, -step); break;
      case 'ArrowDown': e.preventDefault(); app.cmd.nudge(0, step); break;
      case '+':
      case '=': app.cmd.zoomIn(); break;
      case '-': app.cmd.zoomOut(); break;
      case '0': app.cmd.zoomReset(); break;
      case '?':
      case 'F1': e.preventDefault(); app.cmd.help(); break;
      default:
        if (lower === 'n') { e.preventDefault(); app.cmd.append(); }
        else if (lower === 'i') app.cmd.toggleInitial();
        else if (lower === 'l') app.cmd.layout();
        else if (lower === 'f') app.cmd.fit();
    }
  }

  /** Tasten im Simulationsmodus: nur Ansicht und Simulationssteuerung. */
  function onSimKey(e, k, lower, ctrl) {
    if (ctrl || e.altKey) return;
    if (k === ' ') { e.preventDefault(); GE.editor.setSpace(true); return; }
    switch (lower) {
      case 'p': GE.simui.togglePlay(); break;
      case 'e': GE.simui.step(); break;
      case 'r': GE.simui.reset(); break;
      case 'f': app.cmd.fit(); break;
      case '+':
      case '=': app.cmd.zoomIn(); break;
      case '-': app.cmd.zoomOut(); break;
      case '0': app.cmd.zoomReset(); break;
      case '?':
      case 'F1': e.preventDefault(); app.cmd.help(); break;
    }
  }

  // ------------------------------------------------------------ Start

  function bind(id, fn) {
    document.getElementById(id).addEventListener('click', function () { fn(); });
  }

  /** Menü „Datei“: Neu, Öffnen, Speichern, Export (Kürzel bleiben erhalten). */
  function fileMenu(btn) {
    var old = document.getElementById('fileMenu');
    if (old) { old.remove(); return; }
    var items = [
      ['Neu (in diesem Tab)', '', app.cmd.newProject],
      ['Neuer Tab', '', function () { GE.files.newTab(); }],
      ['Öffnen …', 'Strg+O', app.cmd.open],
      ['Speichern', 'Strg+S', app.cmd.save],
      ['Speichern unter …', 'Strg+Umschalt+S', app.cmd.saveAs],
      null,
      ['Als SVG-Bild speichern', '', GE.exporter.svg],
      ['Als PNG-Bild speichern', '', GE.exporter.png],
      ['Drucken / als PDF speichern', 'Strg+P', GE.exporter.print],
      ['Zeitverlauf als PNG speichern', '', GE.exporter.timingPng]
    ];
    var menu = document.createElement('div');
    menu.id = 'fileMenu';
    menu.className = 'menu';
    menu.setAttribute('role', 'menu');
    menu.innerHTML = items.map(function (it, i) {
      if (!it) return '<div class="sep"></div>';
      return '<button class="menu-item" role="menuitem" data-i="' + i + '"><span>' + U.esc(it[0]) + '</span>' + (it[1] ? '<kbd>' + U.esc(it[1]) + '</kbd>' : '') + '</button>';
    }).join('');
    var r = btn.getBoundingClientRect();
    menu.style.left = Math.max(4, Math.min(r.left, window.innerWidth - 300)) + 'px';
    menu.style.top = r.bottom + 4 + 'px';
    document.body.appendChild(menu);
    menu.querySelector('button').focus();
    menu.addEventListener('click', function (e) {
      var b = e.target.closest('[data-i]');
      if (!b) return;
      menu.remove();
      items[+b.getAttribute('data-i')][2]();
    });
    menu.addEventListener('keydown', function (e) {
      var bs = Array.prototype.slice.call(menu.querySelectorAll('button'));
      var i = bs.indexOf(document.activeElement);
      if (e.key === 'Escape') { menu.remove(); btn.focus(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); bs[(i + 1) % bs.length].focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); bs[(i - 1 + bs.length) % bs.length].focus(); }
      e.stopPropagation();
    });
    setTimeout(function () {
      document.addEventListener('pointerdown', function close(e) {
        if (!menu.contains(e.target) && e.target !== btn) menu.remove();
        document.removeEventListener('pointerdown', close);
      });
    });
  }

  function exampleMenu(btn) {
    var old = document.getElementById('exampleMenu');
    if (old) { old.remove(); return; }
    var menu = document.createElement('div');
    menu.id = 'exampleMenu';
    menu.className = 'menu';
    menu.innerHTML = GE.examples.list.map(function (ex) {
      return '<button data-ex="' + ex.id + '">' + U.esc(ex.title) + '</button>';
    }).join('');
    var r = btn.getBoundingClientRect();
    menu.style.left = r.left + 'px';
    menu.style.top = r.bottom + 4 + 'px';
    document.body.appendChild(menu);
    menu.addEventListener('click', function (e) {
      var b = e.target.closest('[data-ex]');
      if (!b) return;
      menu.remove();
      app.whenDiscardOk('Beispiel in diesem Tab laden?', 'Beispiel laden', function () { app.cmd.example(b.getAttribute('data-ex')); });
    });
    setTimeout(function () {
      document.addEventListener('pointerdown', function close(e) {
        if (!menu.contains(e.target) && e.target !== btn) { menu.remove(); }
        document.removeEventListener('pointerdown', close);
      });
    });
  }

  function init() {
    GE.editor.init(app);
    GE.panel.init(app);
    GE.simui.init(app);
    GE.taskui.init(app);
    initSettings();

    GE.ui.applyTheme();
    GE.exporter.init(app);
    document.getElementById('btnFile').addEventListener('click', function (e) { fileMenu(e.currentTarget); });
    bind('btnMulti', function () {
      app.multiSelect = !app.multiSelect;
      document.getElementById('btnMulti').classList.toggle('on', app.multiSelect);
      app.toast(app.multiSelect ? 'Mehrfachauswahl an: Antippen fügt hinzu bzw. entfernt, Ziehen auf freier Fläche wählt einen Bereich.' : 'Mehrfachauswahl aus');
    });
    document.getElementById('btnExample').addEventListener('click', function (e) { exampleMenu(e.currentTarget); });
    bind('btnUndo', app.cmd.undo);
    bind('btnRedo', app.cmd.redo);
    bind('btnLayout', app.cmd.layout);
    bind('btnAlignV', app.cmd.alignV);
    bind('btnAlignH', app.cmd.alignH);
    bind('btnZoomIn', app.cmd.zoomIn);
    bind('btnZoomOut', app.cmd.zoomOut);
    bind('btnZoomReset', app.cmd.zoomReset);
    bind('btnFit', app.cmd.fit);
    bind('btnHelp', app.cmd.help);

    var title = document.getElementById('projectTitle');
    title.addEventListener('focus', function () { app.history.begin(); });
    title.addEventListener('input', function () { app.project.title = title.value; });
    title.addEventListener('change', function () { app.history.commit(); app.updateToolbar(); });
    title.addEventListener('keydown', function (e) { if (e.key === 'Enter') title.blur(); });

    document.querySelector('.mode-switch').addEventListener('click', function (e) {
      var b = e.target.closest('[data-mode]');
      if (b) app.setMode(b.getAttribute('data-mode'));
    });

    document.getElementById('frameNav').addEventListener('click', function (e) {
      var b = e.target.closest('[data-frame]');
      if (!b) return;
      var fid = b.getAttribute('data-frame');
      if (fid) {
        if (app.mode !== 'sim') app.select([fid]);
        GE.editor.showFrame(fid);
      } else {
        GE.editor.fit();
      }
    });

    var palette = document.getElementById('palette');
    palette.addEventListener('pointerdown', function (e) {
      var b = e.target.closest('[data-tool]');
      if (b && e.button === 0) GE.editor.paletteDown(b.getAttribute('data-tool'), e);
    });
    palette.addEventListener('click', function (e) {
      if (GE.editor.consumePaletteClick()) return;   // war ein Ziehen auf die Fläche
      var b = e.target.closest('[data-tool]');
      if (b) app.setTool(b.getAttribute('data-tool'));
    });

    document.addEventListener('keydown', onKey);
    document.addEventListener('keyup', function (e) { if (e.key === ' ') GE.editor.setSpace(false); });
    window.addEventListener('blur', function () { GE.editor.setSpace(false); });

    // Start: leerer GRAFCET mit Anfangsschritt im ersten Tab
    GE.files.init(app);
    app.loadProject(app.blankProject());
    app.view.x = 40; app.view.y = 30; app.view.k = 1;
    GE.editor.applyView();
    app.setTool('select');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(globalThis.GE = globalThis.GE || {});
