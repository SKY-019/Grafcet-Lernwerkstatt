/*
 * files.js – Mehrere Projekte als Tabs, Speichern und Laden als Datei,
 * Notfallkopie im Browser.
 *
 * Jeder Tab ist ein Dokument mit eigenem Projekt, eigener Rückgängig-Liste
 * und eigener Ansicht. Das aktive Dokument steht wie bisher in app.project,
 * app.history und app.view.
 *
 * Gespeichert wird immer als Datei. Die Notfallkopie im Browser hält nur
 * ungespeicherte Änderungen fest und wird beim nächsten Start angeboten.
 */
(function (GE) {
  'use strict';

  var F = (GE.files = {});
  var M = GE.model;
  var U = GE.util;
  var app;

  var RECOVERY_KEY = 'grafcet-lernwerkstatt.recovery';
  var RECOVERY_DELAY_MS = 1500;   // Notfallkopie so lange nach der letzten Änderung schreiben
  var docs = [];
  var cur = null;
  var nextId = 1;
  var recoveryTimer = null;
  var recoveryOpen = false;   // Rückfrage „Wiederherstellen?“ noch offen: Kopie nicht überschreiben

  var FILE_TYPES = [{ description: 'GRAFCET-Datei', accept: { 'application/json': ['.json'] } }];

  function projectOf(d) {
    return d === cur ? app.project : d.project;
  }

  /** Ungespeichert, wenn sich seit dem Laden/Speichern etwas geändert hat (Änderungszähler der Rückgängig-Liste). */
  function isDirty(d) {
    var h = d === cur ? app.history : d.history;
    return h.version !== d.savedVersion;
  }
  F.isDirty = function () { return !!cur && isDirty(cur); };

  /** Unveränderter leerer GRAFCET ohne Datei: darf beim Öffnen ersetzt werden. */
  function isBlank(d) {
    var p = projectOf(d);
    var pg = p.pages[0];
    return !d.fileName && !isDirty(d) && !p.task && p.pages.length === 1 &&
      pg.steps.length <= 1 && !pg.transitions.length && !(pg.notes || []).length && !(pg.frames || []).length;
  }

  function makeDoc() {
    return { id: 'd' + nextId++, project: null, history: app.newHistory(), view: { x: 40, y: 30, k: 1 }, pageId: null, fileName: null, handle: null, savedVersion: -1 };
  }

  /** Zustand des aktiven Dokuments ablegen. */
  function store() {
    if (!cur) return;
    cur.project = app.project;
    cur.history = app.history;
    cur.pageId = app.pageId;
    cur.view = { x: app.view.x, y: app.view.y, k: app.view.k };
  }

  function activate(d) {
    if (d === cur) return;
    if (app.mode === 'sim') app.setMode('edit');
    GE.editor.finishInline(true);
    GE.editor.closeMenu();
    store();
    cur = d;
    app.project = d.project;
    app.history = d.history;
    app.pageId = d.pageId || d.project.pages[0].id;
    app.sel = {};
    app.primary = null;
    app.pendingConnect = null;
    app.view.x = d.view.x;
    app.view.y = d.view.y;
    app.view.k = d.view.k;
    GE.editor.applyView();
    app.refresh();
  }

  // ------------------------------------------------------------ Tabs

  /** Neuer Tab; ohne Projekt mit einem leeren GRAFCET. */
  F.newTab = function (project) {
    if (app.mode === 'sim') app.setMode('edit');
    GE.editor.finishInline(true);
    store();
    var d = makeDoc();
    docs.push(d);
    cur = d;
    app.history = d.history;
    var p = project || app.blankProject();
    app.loadProject(p);
    if (!project) {
      app.view.x = 40; app.view.y = 30; app.view.k = 1;
      GE.editor.applyView();
      app.select([app.page().steps[0].id]);
    }
    renderTabs();
    return d;
  };

  F.closeTab = function (id) {
    var d = docs.filter(function (x) { return x.id === id; })[0];
    if (!d) return;
    function go() {
      var i = docs.indexOf(d);
      docs.splice(i, 1);
      if (d === cur) {
        cur = null;
        if (!docs.length) {
          F.newTab();
          writeRecovery();
          return;
        }
        activate(docs[Math.min(i, docs.length - 1)]);
      }
      renderTabs();
      writeRecovery();
    }
    if (!isDirty(d)) return go();
    activate(d);   // zeigen, um welche Zeichnung es geht
    GE.ui.ask({
      title: 'Tab schließen',
      text: '„' + (projectOf(d).title || 'GRAFCET') + '“ hat ungespeicherte Änderungen. Vor dem Schließen speichern?',
      buttons: [
        { label: 'Abbrechen', value: null },
        { label: 'Nicht speichern', value: 'discard', kind: 'danger' },
        { label: 'Speichern', value: 'save', kind: 'primary' }
      ]
    }).then(function (v) {
      if (v === 'discard') go();
      else if (v === 'save') F.save().then(function () { if (!isDirty(d)) go(); });
    });
  };

  function renderTabs() {
    var bar = document.getElementById('docTabs');
    if (!bar) return;
    bar.innerHTML = docs.map(function (d) {
      var title = projectOf(d).title || 'GRAFCET';
      var dirty = isDirty(d);
      var tip = (d.fileName ? 'Datei: ' + d.fileName : 'noch nicht gespeichert') + (dirty ? ' – ungespeicherte Änderungen' : '');
      return '<div class="doc-tab' + (d === cur ? ' on' : '') + '">' +
        '<button class="doc-tab-name" data-doc="' + d.id + '" role="tab" aria-selected="' + (d === cur) + '" title="' + U.esc(tip) + '">' +
        U.esc(title) + (dirty ? ' <span class="doc-dirty" aria-label="ungespeichert">*</span>' : '') + '</button>' +
        '<button class="doc-tab-close" data-close="' + d.id + '" title="Tab schließen" aria-label="Tab ' + U.esc(title) + ' schließen">×</button></div>';
    }).join('') + '<button class="doc-tab-add" data-add="1" title="Neuer Tab mit leerem GRAFCET" aria-label="Neuer Tab">+</button>';
    var dirtyNow = cur && isDirty(cur);
    document.title = (app.project.title || 'GRAFCET') + (dirtyNow ? ' *' : '') + ' – GRAFCET Lernwerkstatt';
  }
  F.renderTabs = renderTabs;

  /** Nach jeder Änderung (app.refresh): Tabs beschriften, Notfallkopie vormerken. */
  F.refresh = function () {
    if (!cur) return;
    renderTabs();
    if (!recoveryTimer) recoveryTimer = setTimeout(writeRecovery, RECOVERY_DELAY_MS);
  };

  /** app.loadProject hat das aktive Dokument ersetzt (Neu, Beispiel, Aufgabe, Öffnen). */
  F.loaded = function () {
    if (!cur) return;
    cur.fileName = null;
    cur.handle = null;
    cur.savedVersion = app.history.version;
    cur.pageId = app.pageId;
  };

  // ------------------------------------------------------------ Speichern

  function download(name, blob) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  F.download = download;

  /**
   * Speichern. Wo der Browser es kann (Chrome, Edge), mit dem Speichern-Dialog;
   * danach überschreibt „Speichern“ dieselbe Datei. Sonst als Download.
   */
  F.save = function (saveAs) {
    var d = cur;
    var text = M.toFileText(app.project);
    var version = app.history.version;
    var suggested = M.fileName(app.project.title);
    function done(name, how) {
      d.savedVersion = version;
      d.fileName = name;
      renderTabs();
      writeRecovery();
      app.toast(how + name);
    }
    function viaDownload() {
      download(suggested, new Blob([text], { type: 'application/json' }));
      done(suggested, 'Gespeichert in den Download-Ordner: ');
    }
    if (!window.showSaveFilePicker) {
      viaDownload();
      return Promise.resolve();
    }
    var handle = !saveAs && d.handle ? Promise.resolve(d.handle) : window.showSaveFilePicker({ suggestedName: suggested, types: FILE_TYPES });
    return handle.then(function (h) {
      return h.createWritable()
        .then(function (w) { return w.write(text).then(function () { return w.close(); }); })
        .then(function () { d.handle = h; done(h.name, 'Gespeichert: '); });
    }).catch(function (err) {
      if (err && err.name === 'AbortError') return;   // Dialog abgebrochen
      viaDownload();
    });
  };

  // ------------------------------------------------------------ Öffnen

  function openText(text, name, handle) {
    var r = M.parseFile(text);
    if (!r.ok) {
      app.toast(name + ': ' + r.message, 'error');
      return;
    }
    if (!isBlank(cur)) F.newTab();
    app.loadProject(r.project);
    cur.fileName = name;
    cur.handle = handle || null;
    renderTabs();
    app.toast('Geöffnet: ' + name);
  }

  var MAX_FILE = 5 * 1024 * 1024;

  /** Datei lesen (mit Größengrenze und Meldung bei Fehlern). */
  function readFile(f, handle) {
    if (f.size > MAX_FILE) return app.toast(f.name + ': Die Datei ist größer als 5 MB und keine GRAFCET-Datei dieser Lernwerkstatt.', 'error');
    f.text().then(function (t) { openText(t, f.name, handle); }, function () {
      app.toast(f.name + ': Die Datei konnte nicht gelesen werden.', 'error');
    });
  }

  function openFiles(files) {
    Array.prototype.forEach.call(files, function (f) { readFile(f, null); });
  }

  F.open = function () {
    if (window.showOpenFilePicker) {
      window.showOpenFilePicker({ types: FILE_TYPES, multiple: true }).then(function (hs) {
        hs.forEach(function (h) {
          h.getFile().then(function (f) { readFile(f, h); }, function () {
            app.toast(h.name + ': Die Datei konnte nicht geöffnet werden.', 'error');
          });
        });
      }).catch(function (err) {
        if (!err || err.name !== 'AbortError') document.getElementById('fileInput').click();
      });
      return;
    }
    document.getElementById('fileInput').click();
  };

  // ------------------------------------------------------------ Notfallkopie

  function writeRecovery() {
    clearTimeout(recoveryTimer);
    recoveryTimer = null;
    if (recoveryOpen) return;
    store();
    var dirty = docs.filter(isDirty);
    try {
      if (!dirty.length) window.localStorage.removeItem(RECOVERY_KEY);
      else {
        window.localStorage.setItem(RECOVERY_KEY, JSON.stringify({
          time: Date.now(),
          docs: dirty.map(function (d) { return { project: projectOf(d), fileName: d.fileName }; })
        }));
      }
    } catch (e) {
      // ohne Browserspeicher gibt es keine Notfallkopie
    }
  }

  function readRecovery() {
    try {
      var r = JSON.parse(window.localStorage.getItem(RECOVERY_KEY) || 'null');
      if (!r || !Array.isArray(r.docs)) return null;
      // defekte Einträge überspringen
      r.docs = r.docs.filter(function (x) { return x && x.project && Array.isArray(x.project.pages); });
      return r.docs.length ? r : null;
    } catch (e) {
      return null;
    }
  }

  function offerRecovery() {
    var r = readRecovery();
    if (!r) return;
    var when = new Date(r.time);
    var n = r.docs.length;
    recoveryOpen = true;
    GE.ui.ask({
      title: 'Ungespeicherte Zeichnungen gefunden',
      text: 'Beim letzten Mal ' + (n === 1 ? 'wurde 1 Zeichnung' : 'wurden ' + n + ' Zeichnungen') + ' nicht gespeichert (' +
        r.docs.map(function (x) { return '„' + (x.project.title || 'GRAFCET') + '“'; }).join(', ') +
        '; Notfallkopie vom ' + when.toLocaleDateString('de-DE') + ', ' + when.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) +
        '). Wiederherstellen? Danach bitte als Datei speichern.',
      buttons: [{ label: 'Verwerfen', value: false, kind: 'danger' }, { label: 'Wiederherstellen', value: true, kind: 'primary' }]
    }).then(function (ok) {
      recoveryOpen = false;
      if (!ok) {
        writeRecovery();   // enthält jetzt nur noch Ungespeichertes aus dieser Sitzung
        return;
      }
      r.docs.forEach(function (x) {
        var p = M.parseFile(JSON.stringify(x.project));
        if (!p.ok) return;
        if (!isBlank(cur)) F.newTab();
        app.loadProject(p.project);
        cur.fileName = x.fileName || null;
        cur.savedVersion = -1;   // gilt als ungespeichert, bis es als Datei gespeichert ist
        renderTabs();
      });
      writeRecovery();
      app.toast('Wiederhergestellt – bitte als Datei speichern (Strg+S).');
    });
  }

  // ------------------------------------------------------------ Start

  F.init = function (theApp) {
    app = theApp;
    var d = makeDoc();
    d.history = app.history;
    docs.push(d);
    cur = d;   // das Projekt lädt app.js gleich danach (loadProject → loaded)

    var bar = document.getElementById('docTabs');
    bar.addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      if (b.hasAttribute('data-close')) F.closeTab(b.getAttribute('data-close'));
      else if (b.hasAttribute('data-add')) F.newTab();
      else if (b.hasAttribute('data-doc')) {
        var t = docs.filter(function (x) { return x.id === b.getAttribute('data-doc'); })[0];
        if (t) { activate(t); renderTabs(); }
      }
    });
    // mittlere Maustaste schließt einen Tab
    bar.addEventListener('auxclick', function (e) {
      var b = e.target.closest('[data-doc]');
      if (b && e.button === 1) F.closeTab(b.getAttribute('data-doc'));
    });

    var input = document.getElementById('fileInput');
    input.addEventListener('change', function () {
      openFiles(input.files);
      input.value = '';
    });

    // Datei auf das Fenster ziehen
    window.addEventListener('dragover', function (e) {
      if (e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types, 'Files') >= 0) e.preventDefault();
    });
    window.addEventListener('drop', function (e) {
      if (!e.dataTransfer || !e.dataTransfer.files.length) return;
      e.preventDefault();
      openFiles(e.dataTransfer.files);
    });

    document.getElementById('projectTitle').addEventListener('input', renderTabs);

    window.addEventListener('beforeunload', function (e) {
      writeRecovery();
      if (docs.some(isDirty)) {
        e.preventDefault();
        e.returnValue = '';
      }
    });
    window.addEventListener('pagehide', writeRecovery);

    setTimeout(offerRecovery, 300);
  };
})(globalThis.GE = globalThis.GE || {});
