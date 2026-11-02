/*
 * plcui.js – Modus „SPS“: Übersetzung als FUP, KOP, ST oder AS anzeigen, kopieren,
 * speichern und drucken; dazu die Live-Ansicht (FUP oder KOP) in der Simulation.
 */
(function (GE) {
  'use strict';

  var PU = (GE.plcui = {});
  var P = GE.plc;
  var U = GE.util;
  var esc = U.esc;

  var app = null;
  var panel = null;
  var view = null;
  var prog = null;          // zuletzt erzeugtes Programm (Modus SPS)
  var liveProg = null;      // Programm für die Live-Ansicht (je Simulationslauf)
  var simView = 'grafcet';  // Simulation: 'grafcet' (Zeichnung), 'fbd' oder 'ld' (SPS-Programm live)

  function pref(name, def) {
    var v = GE.prefs.get(name);
    return v === undefined || v === null ? def : v;
  }
  function method() { return pref('plcMethod', 'trans') === 'chain' ? 'chain' : 'trans'; }
  var VIEWS = { fbd: 'FUP', ld: 'KOP', st: 'ST', as: 'AS' };
  var VIEW_TITLE = { fbd: 'Funktionsplan (FUP, engl. FBD)', ld: 'Kontaktplan (KOP, engl. LD)', st: 'Strukturierter Text (ST, bei Siemens SCL)', as: 'Ablaufsprache (AS, engl. SFC, bei Siemens GRAPH)' };
  function display() { var v = pref('plcView', 'fbd'); return VIEWS[v] ? v : 'fbd'; }
  function textLang() { return display() === 'as' ? 'as' : 'st'; }

  PU.init = function (theApp) {
    app = theApp;
    panel = document.getElementById('plcPanel');
    view = document.getElementById('plcView');
    panel.addEventListener('click', function (e) {
      var b = e.target.closest('[data-view], [data-cmd], [data-qa]');
      if (!b) return;
      if (b.hasAttribute('data-qa')) {
        answer(+b.getAttribute('data-qa'));
      } else if (b.hasAttribute('data-view')) {
        GE.prefs.set('plcView', b.getAttribute('data-view'));
        PU.render();
        view.scrollTop = 0;
      } else {
        PU[b.getAttribute('data-cmd')]();
      }
    });
    // „im GRAFCET zeigen“ an einem Netzwerk (Modus SPS und Live-Ansicht in der Simulation)
    view.addEventListener('click', function (e) {
      var b = e.target.closest('[data-goto]');
      if (b) PU.goto(b.getAttribute('data-goto'));
    });
    panel.addEventListener('change', function (e) {
      if (e.target.id === 'plcMethod') {
        GE.prefs.set('plcMethod', e.target.value);
        PU.render();
      }
    });
  };

  // ------------------------------------------------------------ Modus SPS

  PU.enter = function () {
    view.hidden = false;
    panel.hidden = false;
    view.scrollTop = 0;
    PU.render();
  };

  PU.leave = function () {
    panel.hidden = true;
    if (simView === 'grafcet' || app.mode !== 'sim') view.hidden = true;
    panel.innerHTML = '';
  };

  function translate() {
    return P.translate(app.page(), { method: method(), project: app.project });
  }

  /** ST mit einfacher Hervorhebung (Kommentare, Schlüsselwörter). */
  var KW = /\b(INITIAL_STEP|STEP|END_STEP|TRANSITION|END_TRANSITION|ACTION|END_ACTION|FROM|TO|PROGRAM|END_PROGRAM|VAR_INPUT|VAR_OUTPUT|VAR|END_VAR|IF|THEN|END_IF|AND|OR|NOT|TRUE|FALSE|BOOL|INT|TON|TOF|R_TRIG|F_TRIG)\b/g;
  function highlight(st) {
    return st.split('\n').map(function (line) {
      var i = line.indexOf('(*');
      var code = i >= 0 ? line.slice(0, i) : line;
      var c = i >= 0 ? line.slice(i) : '';
      return esc(code).replace(KW, '<b class="k">$1</b>') + (c ? '<span class="c">' + esc(c) + '</span>' : '');
    }).join('\n');
  }

  var ART = { input: 'Eingang', output: 'Ausgang', memory: 'Merker', step: 'Schritt', trans: 'Transition', force: 'Zwang', init: 'Erstzyklus', fb: 'Baustein' };

  PU.render = function () {
    if (app.mode !== 'plc') return;
    prog = translate();
    var disp = display();
    var errs = app.issues.filter(function (i) { return i.level === 'error'; }).length;
    var m = method();
    // Fokus nach dem Neuaufbau wiederherstellen (Bedienung mit der Tastatur)
    var ae = document.activeElement;
    var refocus = ae && panel.contains(ae)
      ? (ae.id ? '#' + ae.id : ae.hasAttribute('data-cmd') ? '[data-cmd="' + ae.getAttribute('data-cmd') + '"]' : ae.hasAttribute('data-view') ? '[data-view="' + ae.getAttribute('data-view') + '"]' : null)
      : null;
    panel.innerHTML =
      '<h2>SPS-Programm <span class="plc-badge">IEC 61131-3</span></h2>' +
      '<p class="prop-hint">Hier steht kein GRAFCET, sondern das daraus erzeugte SPS-Programm. Zum Ändern zurück zu „Zeichnen“.</p>' +
      '<div class="seg" role="group" aria-label="Programmiersprache">' +
      Object.keys(VIEWS).map(function (k) {
        return '<button data-view="' + k + '" class="' + (disp === k ? 'on' : '') + '" aria-pressed="' + (disp === k) + '" title="' + VIEW_TITLE[k] + '">' + VIEWS[k] + '</button>';
      }).join('') + '</div>' +
      '<label class="field"><span>Übersetzungsart</span><select id="plcMethod">' +
      '<option value="trans"' + (m === 'trans' ? ' selected' : '') + '>Transitionsmerker (Standard)</option>' +
      '<option value="chain"' + (m === 'chain' ? ' selected' : '') + '>Klassische Schrittkette</option></select></label>' +
      '<p class="prop-hint">' + (m === 'trans'
        ? 'Erst alle Transitionen berechnen (T1 := X1 AND B1), dann die Schritte setzen bzw. rücksetzen. Schaltet wie der GRAFCET: alle schaltbaren Transitionen gleichzeitig.'
        : 'Setzen = Vorgängerschritt UND Bedingung, Rücksetzen = Folgeschritt. So oft in der Berufsschule gezeigt.') + '</p>' +
      '<div class="btn-row"><button data-cmd="copy" title="Programmtext in die Zwischenablage kopieren">' + textLang().toUpperCase() + ' kopieren</button>' +
      '<button data-cmd="save" title="Programmtext als Datei speichern">Als .' + textLang() + ' speichern</button>' +
      '<button data-cmd="print" title="Druckansicht, auch „Als PDF speichern“">Drucken</button>' +
      '<button data-cmd="xml" title="PLCopen XML (z. B. in CODESYS über „PLCopenXML importieren“)">PLCopen XML</button></div>' +
      (errs ? '<div class="msg warn">Der GRAFCET hat noch ' + errs + (errs === 1 ? ' Fehler' : ' Fehler') +
        ' (siehe Zeichnen → Prüfung). Die Übersetzung kann deshalb unvollständig sein.</div>' : '') +
      '<p class="prop-hint">Tipp: In der Simulation zeigen „FUP live“ und „KOP live“ das Programm mit den aktuellen Signalen.</p>' +
      (disp === 'as' ? '<h3>GRAFCET und AS – Unterschiede</h3><ul class="plc-hints">' + P.SFC_DIFF.map(function (h) { return '<li>' + esc(h) + '</li>'; }).join('') + '</ul>' : '') +
      '<h3>Selbsttest</h3><div id="plcQuiz">' + quizHtml() + '</div>' +
      '<h3>Variablen</h3>' + declTable(prog) +
      '<h3>Hinweise</h3><ul class="plc-hints">' + hintsFor(disp).map(function (h) { return '<li>' + esc(h) + '</li>'; }).join('') + '</ul>';
    var head = '<div class="plc-head"><span class="plc-badge">SPS-Programm</span> <strong>' + esc(VIEW_TITLE[disp]) + '</strong> · ' + esc(prog.title) +
      (disp === 'as' ? '' : ' · ' + esc(P.METHODS[prog.method]) + ' · ' + prog.networks.length + ' Netzwerke') + '</div>';
    if (disp === 'st') view.innerHTML = head + '<pre class="plc-st" tabindex="0" aria-label="Strukturierter Text">' + highlight(P.toST(prog)) + '</pre>';
    else if (disp === 'as') view.innerHTML = head + asHtml();
    else if (disp === 'ld') view.innerHTML = head + GE.ladder.render(prog, {});
    else view.innerHTML = head + GE.fbd.render(prog, {});
    if (refocus && panel.querySelector(refocus)) panel.querySelector(refocus).focus();
  };

  function hintsFor(disp) {
    var h = P.hints(prog);
    if (disp === 'as') h = h.concat(P.toSFC(app.page(), prog).notes);
    if (disp === 'ld') h = h.concat(['KOP: Schließer –| |–, Öffner –|/|–, Flankenkontakt –|P|– bzw. –|N|–, Spule –( )–, Setzspule –(S)–, Rücksetzspule –(R)–. ' +
      'Ein Schrittmerker hat zwei Strombahnen: erst Rücksetzen, dann Setzen – die spätere gewinnt (setzdominant).']);
    return h;
  }

  function asHtml() {
    var r = P.toSFC(app.page(), prog);
    return '<table class="plc-vars plc-q"><thead><tr><th>Schritt</th><th>Aktion</th><th>Bestimmungszeichen</th><th>Bedeutung</th></tr></thead><tbody>' +
      (r.rows.length ? r.rows.map(function (x) {
        return '<tr><td>' + esc(x.step) + '</td><td><code>' + esc(x.action) + '</code></td><td><b>' + esc(x.q) + '</b></td><td>' + esc(x.text) + '</td></tr>';
      }).join('') : '<tr><td colspan="4">keine Aktionen</td></tr>') + '</tbody></table>' +
      '<pre class="plc-st" tabindex="0" aria-label="Ablaufsprache, textuelle Form">' + highlight(r.text) + '</pre>';
  }

  function declTable(p) {
    return '<table class="var-table plc-vars"><thead><tr><th>Name</th><th>Typ</th><th>Art</th><th>Bedeutung</th></tr></thead><tbody>' +
      p.decls.filter(function (d) { return d.art !== 'fb'; }).map(function (d) {
        var extra = d.grafcet && d.grafcet !== d.name ? 'im GRAFCET ' + d.grafcet + (d.comment ? ': ' : '') : '';
        return '<tr><td><code>' + esc(d.name) + '</code></td><td>' + d.type + '</td><td>' + ART[d.art] + '</td><td>' + esc(extra + d.comment) + '</td></tr>';
      }).join('') + '</tbody></table>';
  }

  function stText() {
    var p = prog || translate();
    return textLang() === 'as' ? P.toSFC(app.page(), p).text : P.toST(p);
  }

  PU.copy = function () {
    var text = stText();
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      ta.remove();
      app.toast(ok ? textLang().toUpperCase() + ' in die Zwischenablage kopiert' : 'Kopieren nicht möglich – bitte den Text markieren und mit Strg+C kopieren.', ok ? '' : 'warn');
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { app.toast(textLang().toUpperCase() + ' in die Zwischenablage kopiert'); }, fallback);
    } else fallback();
  };

  PU.save = function () {
    var name = GE.model.fileName(app.project.title).replace(/\.grafcet\.json$/, '') + '.' + textLang();
    GE.files.download(name, new Blob([stText().replace(/\n/g, '\r\n')], { type: 'text/plain;charset=utf-8' }));
    app.toast('Gespeichert als ' + name);
  };

  PU.xml = function () {
    var name = GE.model.fileName(app.project.title).replace(/\.grafcet\.json$/, '') + '.xml';
    GE.files.download(name, new Blob([P.toPLCopen(prog || translate())], { type: 'application/xml;charset=utf-8' }));
    app.toast('Gespeichert als ' + name + ' (PLCopen XML)');
  };

  /** Schritt bzw. Transition eines Netzwerks in der Zeichnung zeigen. */
  PU.goto = function (id) {
    if (!GE.model.find(app.page(), id)) return;
    if (app.mode === 'sim') {
      PU.setSimView('grafcet');
      setTimeout(function () { GE.editor.reveal(id); }, 0);
      return;
    }
    app.setMode('edit');
    app.select([id]);
    GE.editor.reveal(id);
    app.toast('Im GRAFCET ausgewählt – mit „SPS“ oben geht es zurück zum Programm.');
  };

  // ------------------------------------------------------------ Selbsttest

  var quiz = null;          // aktuelle Frage {q, options, answer, explain, chosen}
  var score = { right: 0, total: 0 };

  function quizHtml() {
    var head = '<p class="prop-hint">Fragen zum angezeigten Programm. Richtig: ' + score.right + ' von ' + score.total + '.</p>';
    if (!quiz) return head + '<div class="btn-row"><button data-cmd="quizNext" class="primary">Frage stellen</button></div>';
    var done = quiz.chosen !== undefined;
    return head + '<p class="quiz-q"><b>' + esc(quiz.q) + '</b></p><div class="quiz-opts">' +
      quiz.options.map(function (o, i) {
        var cls = done ? (i === quiz.answer ? ' class="ok"' : i === quiz.chosen ? ' class="bad"' : '') : '';
        return '<button data-qa="' + i + '"' + cls + (done ? ' disabled' : '') + '><code>' + esc(o) + '</code></button>';
      }).join('') + '</div>' +
      (done ? '<div class="msg ' + (quiz.chosen === quiz.answer ? 'ok">Richtig. ' : 'warn">Leider falsch. ') + esc(quiz.explain) + '</div>' +
        '<div class="btn-row"><button data-cmd="quizNext" class="primary">Nächste Frage</button></div>' : '');
  }

  function showQuiz(focusSel) {
    var box = document.getElementById('plcQuiz');
    if (!box) return;
    box.innerHTML = quizHtml();
    var f = box.querySelector(focusSel);
    if (f) f.focus();
  }

  PU.quizNext = function () {
    var p = prog || translate();
    var last = quiz && quiz.q;
    var q = null;
    for (var i = 0; i < 5; i++) {
      q = P.quiz(p);
      if (!q || q.q !== last) break;
    }
    quiz = q;
    if (!q) app.toast('Für diesen GRAFCET gibt es noch keine Fragen.', 'warn');
    showQuiz('[data-qa="0"]');
  };

  function answer(i) {
    if (!quiz || quiz.chosen !== undefined) return;
    quiz.chosen = i;
    score.total++;
    if (i === quiz.answer) score.right++;
    showQuiz('[data-cmd="quizNext"]');
  }

  PU.print = function () {
    var p = prog || translate();
    var area = document.getElementById('printArea');
    area.className = 'print-area plc';
    area.innerHTML = '<h1>' + esc(p.title) + ' – SPS-Programm (' + VIEWS[display()] + ')</h1>' +
      '<p>' + new Date().toLocaleDateString('de-DE') + ' · ' + esc(P.METHODS[p.method]) + ' · IEC 61131-3 · GRAFCET Lernwerkstatt</p>' +
      (display() === 'st' ? '<pre class="plc-st">' + esc(P.toST(p)) + '</pre>' : display() === 'as' ? '<pre class="plc-st">' + esc(P.toSFC(app.page(), p).text) + '</pre>'
        : display() === 'ld' ? GE.ladder.render(p, { noLinks: true }) : GE.fbd.render(p, { noLinks: true }));
    window.print();
    // Druckbereich für die normale Druckansicht der Zeichnung zurücksetzen
    setTimeout(function () { area.className = 'print-area'; }, 0);
  };

  // ------------------------------------------------------------ Live-Ansicht in der Simulation

  /** Beim Start der Simulation: Programm für die Live-Ansicht neu erzeugen. */
  PU.simEnter = function () {
    liveProg = null;
    PU.applySimView();
  };

  PU.simLeave = function () {
    liveProg = null;
    document.body.classList.remove('sim-fbd');
    if (app.mode !== 'plc') view.hidden = true;
  };

  PU.simView = function () { return simView; };

  PU.setSimView = function (v) {
    simView = v === 'fbd' || v === 'ld' ? v : 'grafcet';
    PU.applySimView();
    if (simView === 'grafcet') GE.editor.fit();
  };

  PU.applySimView = function () {
    var on = simView !== 'grafcet' && app.mode === 'sim';
    document.body.classList.toggle('sim-fbd', on);
    view.hidden = !on && app.mode !== 'plc';
    var btns = document.querySelectorAll('[data-simview]');
    for (var i = 0; i < btns.length; i++) {
      var me = btns[i].getAttribute('data-simview') === simView;
      btns[i].classList.toggle('on', me);
      btns[i].setAttribute('aria-pressed', me ? 'true' : 'false');
    }
  };

  /** FUP mit den aktuellen Werten der Simulation zeichnen (nur wenn die Live-Ansicht an ist). */
  PU.live = function (sim) {
    if (simView === 'grafcet' || app.mode !== 'sim' || !sim) return;
    if (!liveProg) liveProg = P.translate(app.page(), { method: method(), project: app.project });
    var lv = P.liveValues(liveProg, sim);
    var R = simView === 'ld' ? GE.ladder : GE.fbd;
    view.innerHTML = '<div class="plc-head"><span class="plc-badge">SPS-Programm</span> <strong>' + (simView === 'ld' ? 'KOP' : 'FUP') + ' live</strong> · ' +
      esc(P.METHODS[liveProg.method]) + ' · <span class="plc-on">grün = Signal 1' + (simView === 'ld' ? ' bzw. Strom fließt' : '') + '</span> · ' +
      'Werte aus der GRAFCET-Simulation (zeigt die stabile Situation, nicht jeden SPS-Zyklus)</div>' +
      R.render(liveProg, { value: lv.value, variable: lv.variable });
  };
})(globalThis.GE = globalThis.GE || {});
