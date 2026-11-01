/*
 * taskui.js – Übungsmodus: Aufgabe wählen, Aufgabentext oben in der
 * Seitenleiste, Prüfen mit Rückmeldung ohne Lösung, Tipps, Abspielen eines
 * Prüfablaufs in der Simulation und (nur wenn in den Einstellungen erlaubt)
 * die Musterlösung.
 *
 * Gelöste Aufgaben werden als Vorliebe im Browser gemerkt (prefs), nicht
 * die Zeichnung selbst.
 */
(function (GE) {
  'use strict';

  var TU = (GE.taskui = {});
  var K = GE.tasks;
  var M = GE.model;
  var U = GE.util;
  var esc = U.esc;

  var app;
  var root;
  var state = { id: null, hints: 0, result: null, checked: '', textOpen: true };

  TU.init = function (theApp) {
    app = theApp;
    root = document.getElementById('taskPanel');
    root.addEventListener('click', onClick);
    root.addEventListener('toggle', function (e) {
      if (e.target.id === 'taskText') state.textOpen = e.target.open;
    }, true);
    document.getElementById('btnTask').addEventListener('click', openList);
    document.getElementById('taskListBody').addEventListener('click', function (e) {
      var b = e.target.closest('[data-start]');
      if (b) start(b.getAttribute('data-start'));
    });
  };

  /** Aktuelle Aufgabe des Projekts (oder null). */
  TU.task = function () {
    return app.project && app.project.task ? K.get(app.project.task.id) : null;
  };

  function solved() {
    return Object.assign({}, GE.prefs.get('solvedTasks') || {});
  }

  function snapshot() {
    return JSON.stringify(app.project.pages);
  }

  /** Nach jeder Änderung: Feld zeigen/verstecken, veraltete Prüfung kennzeichnen. */
  TU.refresh = function () {
    var task = TU.task();
    var id = task ? task.id : null;
    if (id !== state.id) {
      state = { id: id, hints: 0, result: null, checked: '', textOpen: true };
      TU.render();
      return;
    }
    var stale = root.querySelector('.task-stale');
    if (stale) stale.hidden = !state.result || state.checked === snapshot();
  };

  TU.render = function () {
    var task = TU.task();
    root.hidden = !task;
    if (!task) { root.innerHTML = ''; return; }
    var done = solved()[task.id];
    var vars = K.vars(task);
    var kinds = { button: 'Taster', switch: 'Schalter', num: 'Zahl', out: 'Ausgang', mem: 'Merker/Zähler' };
    var rows = vars.map(function (v) {
      return '<tr><td><b>' + esc(v.name) + '</b></td><td>' + esc(v.comment) + '</td><td>' + kinds[v.kind] + '</td>' +
        '<td class="num">' + (v.initial !== undefined ? esc(String(v.initial)) : '') + '</td></tr>';
    }).join('');
    var nh = task.hints.length;
    var s = '<div class="task-head"><span class="task-badge">Aufgabe</span><b>' + esc(task.title) + '</b>' +
      (done ? '<span class="task-done" title="In diesem Browser schon einmal gelöst">✓ gelöst</span>' : '') + '</div>' +
      '<p class="muted task-meta">Stufe ' + task.level + ' – ' + esc(K.LEVELS[task.level]) + ' · ' + esc(task.topic) + '</p>' +
      '<div class="btn-row">' +
      '<button class="primary" data-task="check" title="Struktur und Verhalten deiner Lösung prüfen">Prüfen</button>' +
      '<button data-task="hint"' + (state.hints >= nh ? ' disabled' : '') + '>' +
      (state.hints ? 'Noch ein Tipp' : 'Tipp') + ' (' + state.hints + '/' + nh + ')</button>' +
      (GE.prefs.get('showSolution') ? '<button data-task="solution" title="Musterlösung laden (in den Einstellungen freigeschaltet)">Musterlösung</button>' : '') +
      '<button data-task="close" title="Aufgabe schließen – die Zeichnung bleibt">Schließen</button>' +
      '</div>' +
      '<details class="task-text-box" id="taskText"' + (state.textOpen ? ' open' : '') + '>' +
      '<summary>Aufgabentext und Variablen</summary>' +
      '<p class="task-text">' + esc(task.text) + '</p>' +
      '<table class="vartable task-vars"><thead><tr><th>Name</th><th>Bedeutung</th><th>Art</th>' +
      '<th title="Wert in der Grundstellung">Start</th></tr></thead><tbody>' + rows + '</tbody></table>' +
      '</details>';
    if (state.hints) {
      s += '<ol class="tips task-hints">' + task.hints.slice(0, state.hints).map(function (h) { return '<li>' + esc(h) + '</li>'; }).join('') + '</ol>';
    }
    s += '<div class="task-result" id="taskResult">' + resultHtml(task) + '</div>';
    root.innerHTML = s;
    TU.refresh();
  };

  function resultHtml(task) {
    var r = state.result;
    if (!r) return '<p class="muted task-intro">Zeichne den GRAFCET und klicke auf „Prüfen“. Verglichen wird, was die Ausgänge tun – ' +
      'Schrittnummern und eigene Merker darfst du frei wählen.</p>';
    var s = '<p class="muted task-stale" hidden>Seit der Prüfung wurde die Zeichnung geändert – bitte erneut prüfen.</p>';
    var passed = r.runs.filter(function (x) { return x.ok; }).length;
    if (r.ok) {
      s += '<div class="msg ok">✓ Geschafft! Alle ' + r.runs.length + ' Prüfabläufe bestanden.</div>';
    } else if (r.blocked) {
      s += '<div class="msg error">Erst die Fehler in der Zeichnung beheben – dann wird das Verhalten geprüft.</div>';
    } else {
      s += '<div class="msg warn">Noch nicht ganz: ' + passed + ' von ' + r.runs.length + ' Prüfabläufen bestanden.</div>';
    }
    var icon = { error: '!', warning: '▲', info: 'i' };
    var items = r.problems.map(function (p) {
      return '<li class="' + p.level + '"><span class="ico">' + icon[p.level] + '</span><span>' + esc(p.text) + '</span></li>';
    });
    r.runs.forEach(function (run, i) {
      if (run.ok) {
        items.push('<li class="ok"><span class="ico">✓</span><span>' + esc(run.name) + '</span></li>');
      } else {
        items.push('<li class="error"><span class="ico">✗</span><span><b>' + esc(run.name) + '</b><br>' + esc(run.text) +
          '<br><button class="task-play" data-play="' + i + '" title="Diesen Prüfablauf in der Simulation abspielen; ' +
          'sie hält dort an, wo dein GRAFCET abweicht">▶ Abspielen</button></span></li>');
      }
    });
    return s + '<ul class="task-list">' + items.join('') + '</ul>';
  }

  // ------------------------------------------------------------ Bedienung

  function onClick(e) {
    var task = TU.task();
    if (!task) return;
    var play = e.target.closest('[data-play]');
    if (play) return TU.play(+play.getAttribute('data-play'));
    var b = e.target.closest('[data-task]');
    if (!b) return;
    switch (b.getAttribute('data-task')) {
      case 'check': TU.check(); break;
      case 'hint':
        state.hints = Math.min(task.hints.length, state.hints + 1);
        TU.render();
        break;
      case 'solution': showSolution(task); break;
      case 'close':
        app.change(function () { delete app.project.task; });
        app.toast('Aufgabe geschlossen. Mit Rückgängig (Strg+Z) kommt sie zurück.');
        break;
    }
  }

  TU.check = function () {
    var task = TU.task();
    if (!task) return null;
    GE.editor.finishInline(true);
    state.result = K.check(task, app.project);
    state.checked = snapshot();
    if (state.result.ok) {
      var s = solved();
      s[task.id] = true;
      GE.prefs.set('solvedTasks', s);
      app.toast('Geschafft! Alle Prüfabläufe bestanden.');
    }
    state.textOpen = false;   // Platz für die Rückmeldung; der Text lässt sich wieder aufklappen
    TU.render();
    root.scrollTop = 0;
    return state.result;
  };

  /** Prüfablauf in der Simulation abspielen; hält an, wo die Lösung abweicht. */
  TU.play = function (i) {
    var task = TU.task();
    if (!task || !state.result) return;
    var run = state.result.runs[i];
    if (app.mode !== 'sim') app.setMode('sim');
    if (app.mode !== 'sim') return;
    GE.simui.playScript({
      timeline: K.timeline(task, i),
      failTime: run && run.fail ? run.fail.time : null,
      failText: run ? run.text : ''
    });
  };

  function showSolution(task) {
    GE.ui.confirm('Musterlösung laden? Sie ersetzt deine Zeichnung. Mit Rückgängig (Strg+Z) kommst du zurück.', 'Musterlösung laden')
      .then(function (ok) { if (ok) loadSolution(task); });
  }

  function loadSolution(task) {
    if (app.mode === 'sim') app.setMode('edit');
    var sol = M.normalize(K.solutionProject(task));
    sol.pages.forEach(M.normalizeConditions);
    app.history.begin();
    app.project = sol;
    app.pageId = sol.pages[0].id;
    app.sel = {};
    app.primary = null;
    app.history.commit();
    app.refresh();
    GE.editor.fit();
    app.toast('Musterlösung geladen – Rückgängig (Strg+Z) zeigt wieder deine Zeichnung.');
  }

  // ------------------------------------------------------------ Auswahl

  function openList() {
    var done = solved();
    var body = document.getElementById('taskListBody');
    var s = '<p class="muted">Du zeichnest den GRAFCET selbst. „Prüfen“ vergleicht das Verhalten deiner Lösung mit einer ' +
      'versteckten Musterlösung und sagt dir, wo es noch nicht stimmt – ohne die Lösung zu verraten.</p>';
    [1, 2, 3].forEach(function (lv) {
      s += '<h3>Stufe ' + lv + ' – ' + esc(K.LEVELS[lv]) + '</h3><div class="task-items">';
      K.list.filter(function (t) { return t.level === lv; }).forEach(function (t) {
        s += '<button class="task-item" data-start="' + t.id + '"><b>' + esc(t.title) + '</b>' +
          '<span class="muted">' + esc(t.topic) + (t.plant ? ' · mit Anlage' : '') + '</span>' +
          (done[t.id] ? '<span class="task-done">✓ gelöst</span>' : '') + '</button>';
      });
      s += '</div>';
    });
    s += '<p class="muted">Gelöste Aufgaben merkt sich nur dieser Browser. Deine Lösung speicherst du mit „Speichern“ (Strg+S) als Datei.</p>';
    body.innerHTML = s;
    document.getElementById('taskDialog').showModal();
  }

  function start(id) {
    var task = K.get(id);
    if (!task) return;
    document.getElementById('taskDialog').close();
    app.whenDiscardOk('Aufgabe „' + task.title + '“ in diesem Tab beginnen?', 'Aufgabe beginnen', function () { begin(task); });
  }

  function begin(task) {
    if (app.mode === 'sim') app.setMode('edit');
    var p = K.startProject(task);
    app.loadProject(p);
    app.view = { x: 40, y: 30, k: 1 };
    GE.editor.applyView();
    app.select([p.pages[0].steps[0].id]);
    app.setTool('select');
    app.toast('Aufgabe: ' + task.title);
  }
  TU.start = start;
})(globalThis.GE = globalThis.GE || {});
