/*
 * panel.js – Seitenleiste: Eigenschaften des ausgewählten Elements und
 * Liste der Prüfmeldungen.
 *
 * Eingaben wirken sofort auf die Zeichnung. Für Rückgängig werden
 * Tippfolgen zu einem Schritt zusammengefasst (begin beim ersten Zeichen,
 * commit beim Verlassen des Feldes oder nach einer kurzen Pause).
 */
(function (GE) {
  'use strict';

  var P = (GE.panel = {});
  var M = GE.model;
  var E = GE.expr;
  var R = GE.render;
  var U = GE.util;
  var esc = U.esc;

  var app;
  var root;
  var commitTimer = null;

  var TYPE_LABELS = {
    continuous: 'Kontinuierlich – solange aktiv',
    conditional: 'Bedingt – solange aktiv und Bedingung',
    stored: 'Speichernd – beim Aktivieren/Deaktivieren',
    event: 'Bei Ereignis – speichernd bei Flanke',
    forcing: 'Zwangssteuerung – Teil-GRAFCET zwingen'
  };
  var TYPE_HINTS = {
    continuous: 'Die Variable ist 1, solange der Schritt aktiv ist.',
    conditional: 'Die Variable ist 1, solange der Schritt aktiv und die Bedingung erfüllt ist. Zeitverzögert z. B. mit 3s/X2.',
    stored: 'Der Wert wird beim Aktivieren (Pfeil ↑ über dem Kasten) bzw. Deaktivieren (Pfeil ↓ unter dem Kasten) des Schritts gespeichert und bleibt danach erhalten.',
    event: 'Der Wert wird gespeichert, wenn das Ereignis eintritt, während der Schritt aktiv ist (Fähnchen über dem Kasten).',
    forcing: 'Solange der Schritt aktiv ist, wird der gewählte Teil-GRAFCET in die angegebene Situation gezwungen und entwickelt sich nicht selbst weiter.'
  };

  var COMMIT_DELAY_MS = 1200;   // Tippen im Feld: so lange Ruhe, dann ein Rückgängig-Schritt

  var SYMBOLS = [
    { label: '·', title: 'UND', ins: ' * ' },
    { label: '+', title: 'ODER', ins: ' + ' },
    { label: '¬', title: 'NICHT (wird als Überstrich gezeichnet)', ins: '/' },
    { label: '↑', title: 'steigende Flanke', ins: '↑' },
    { label: '↓', title: 'fallende Flanke', ins: '↓' },
    { label: '( )', title: 'Klammern um die Markierung', wrap: true },
    { label: '[ ]', title: 'eckige Klammern um einen Vergleich, z. B. [C1 >= 3]', wrap: true, open: '[', close: ']' },
    { label: 't/X', title: 'Zeitbedingung, z. B. 5s/X3', ins: '5s/X' },
    { label: '=1', title: 'immer erfüllt', set: '1' }
  ];

  P.init = function (theApp) {
    app = theApp;
    root = document.getElementById('props');
    root.addEventListener('focusin', function (e) {
      if (!isField(e.target)) return;
      app.history.begin();
      // alten Namen merken: nach dem Umbenennen Bezüge mitändern (siehe onChange)
      var f = current();
      nameBefore = e.target.getAttribute('data-f') === 'name' && f && (f.kind === 'step' || f.kind === 'frame')
        ? { id: f.el.id, kind: f.kind, name: f.el.name } : null;
    });
    root.addEventListener('focusout', function (e) { if (isField(e.target)) commitNow(); });
    root.addEventListener('input', onInput);
    root.addEventListener('change', onChange);
    root.addEventListener('click', onClick);
    root.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && e.target.tagName === 'INPUT') e.target.blur();
    });
    var issueList = document.getElementById('issueList');
    issueList.addEventListener('click', onIssueClick);
    // Tastatur: Eintrag mit Tab erreichen, Enter/Leertaste wie Klick
    issueList.addEventListener('keydown', function (e) {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.closest('li[data-ids]')) {
        e.preventDefault();
        onIssueClick(e);
      }
    });
  };

  function isField(t) {
    return t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName);
  }

  function commitNow() {
    clearTimeout(commitTimer);
    if (app.history.commit()) app.updateToolbar();
  }

  function commitSoon() {
    clearTimeout(commitTimer);
    commitTimer = setTimeout(commitNow, COMMIT_DELAY_MS);
  }

  /** Aktuell bearbeitetes Element. */
  function current() {
    var id = root.getAttribute('data-id');
    return id ? M.find(app.page(), id) : null;
  }

  function actionOf(el, t) {
    var row = t.closest('[data-aid]');
    if (!row || !el.actions) return null;
    var aid = row.getAttribute('data-aid');
    for (var i = 0; i < el.actions.length; i++) if (el.actions[i].id === aid) return el.actions[i];
    return null;
  }

  // ------------------------------------------------------------ Ereignisse

  function onInput(e) {
    var t = e.target;
    if (t.type === 'checkbox' || t.tagName === 'SELECT') return;
    app.history.begin();
    if (t.hasAttribute('data-pf')) {
      app.page()[t.getAttribute('data-pf')] = t.value;
    } else {
      var f = current();
      if (!f) return;
      if (t.hasAttribute('data-f')) {
        var key = t.getAttribute('data-f');
        // Kommentare und freier Text bleiben unverändert (auch mehrzeilig)
        f.el[key] = key === 'comment' || key === 'text' ? t.value : t.value.trim();
        if (t.getAttribute('data-f') === 'cond') updateCondFeedback(t.value);
      } else if (t.hasAttribute('data-af')) {
        var a = actionOf(f.el, t);
        if (a) a[t.getAttribute('data-af')] = t.value.trim();
      }
    }
    app.refresh({ panel: false });
    commitSoon();
  }

  /** Bedingungsfeld nach dem Bestätigen in die einheitliche Schreibweise bringen. */
  function normalizeField(t) {
    var f = current();
    if (!f) return;
    var target;
    var key;
    var stepVar;
    if (t.getAttribute('data-f') === 'cond' && f.kind === 'transition') {
      target = f.el;
      key = 'cond';
      stepVar = M.stepVarForTransition(app.page(), f.el);
    } else if (t.getAttribute('data-af') === 'cond' && f.kind === 'step') {
      target = actionOf(f.el, t);
      key = 'cond';
      stepVar = 'X' + f.el.name;
    }
    if (!target || !target[key]) return;
    var norm = E.normalize(target[key], stepVar);
    if (norm === target[key]) return;
    app.history.begin();
    target[key] = norm;
    t.value = norm;
    if (t.getAttribute('data-f') === 'cond') updateCondFeedback(norm);
    app.refresh({ panel: false });
  }

  var nameBefore = null;

  function onChange(e) {
    var t = e.target;
    if (t.type !== 'checkbox' && t.tagName !== 'SELECT') {
      normalizeField(t);
      commitNow();
      var f0 = current();
      if (nameBefore && f0 && f0.el.id === nameBefore.id && t.getAttribute('data-f') === 'name') {
        var before = nameBefore;
        nameBefore = { id: before.id, kind: before.kind, name: f0.el.name };
        app.offerRenameRefs(before.kind === 'step' ? 'step' : 'frame', before.name, f0.el.name);
      }
      return;
    }
    var f = current();
    if (!f) return;
    app.history.begin();
    if (t.hasAttribute('data-f')) {
      f.el[t.getAttribute('data-f')] = t.type === 'checkbox' ? t.checked : t.value;
    } else if (t.hasAttribute('data-af')) {
      var a = actionOf(f.el, t);
      if (a) a[t.getAttribute('data-af')] = t.value;
    }
    commitNow();
    app.refresh();
    var row = t.closest('[data-aid]');
    if (row) {
      var again = root.querySelector('[data-aid="' + CSS.escape(row.getAttribute('data-aid')) + '"] [data-af="' + CSS.escape(t.getAttribute('data-af')) + '"]');
      if (again) again.focus();
    }
  }

  function onClick(e) {
    var b = e.target.closest('button');
    if (!b) return;
    var cmd = b.getAttribute('data-cmd');
    var f = current();
    if (b.hasAttribute('data-sym')) {
      var row = b.closest('[data-aid]');
      insertSymbol(SYMBOLS[+b.getAttribute('data-sym')], row ? row.querySelector('[data-af="cond"]') : null);
      return;
    }
    switch (cmd) {
      case 'addAction':
        var na;
        app.change(function () {
          na = M.newAction(app.project, 'continuous', '');
          f.el.actions.push(na);
        });
        P.focusAction(na.id);
        break;
      case 'delAction':
      case 'upAction':
      case 'downAction':
        var a = actionOf(f.el, b);
        if (!a) return;
        app.change(function () {
          var list = f.el.actions;
          var i = list.indexOf(a);
          if (cmd === 'delAction') list.splice(i, 1);
          else {
            var j = cmd === 'upAction' ? i - 1 : i + 1;
            if (j < 0 || j >= list.length) return;
            list[i] = list[j];
            list[j] = a;
          }
        });
        break;
      case 'showFrame':
        GE.editor.showFrame(root.getAttribute('data-id'));
        break;
      case 'resetComment':
        app.change(function () { f.el.commentDx = 0; f.el.commentDy = 0; });
        break;
      case 'showOwned':
        var ownF = M.ownedFrame(app.page(), root.getAttribute('data-id'));
        if (ownF) GE.editor.showFrame(ownF.id);
        break;
      case 'goto':
        app.select([b.getAttribute('data-target')]);
        GE.editor.reveal(b.getAttribute('data-target'));
        break;
      default:
        if (cmd && app.cmd[cmd]) app.cmd[cmd]();
    }
  }

  /** Symbol an der Cursorstelle einfügen – im Bedingungsfeld der Transition bzw. der Aktion (input). */
  function insertSymbol(sym, input) {
    input = input || root.querySelector('[data-f="cond"]');
    if (!input) return;
    var s = input.selectionStart == null ? input.value.length : input.selectionStart;
    var en = input.selectionEnd == null ? s : input.selectionEnd;
    var v = input.value;
    var caret;
    if (sym.set) {
      v = sym.set;
      caret = v.length;
    } else if (sym.wrap) {
      v = v.slice(0, s) + (sym.open || '(') + v.slice(s, en) + (sym.close || ')') + v.slice(en);
      caret = en + 2;
    } else {
      v = v.slice(0, s) + sym.ins + v.slice(en);
      caret = s + sym.ins.length;
    }
    input.focus();
    input.value = v;
    input.setSelectionRange(caret, caret);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function onIssueClick(e) {
    var li = e.target.closest('li[data-ids]');
    if (!li) return;
    var ids = li.getAttribute('data-ids').split(',').filter(Boolean);
    if (!ids.length) return;
    var fit = li.getAttribute('data-fit');
    if (fit) {
      // Inhalt ragt aus dem Rahmen: Rahmen anpassen
      app.select([fit]);
      app.cmd.fitFrame();
      app.toast('Rahmen an den Inhalt angepasst.');
      GE.editor.showFrame(fit);
      return;
    }
    app.select(ids);
    GE.editor.reveal(ids[0]);
  }

  // ------------------------------------------------------------ Darstellung

  P.render = function () {
    clearTimeout(commitTimer);
    var ids = Object.keys(app.sel);
    var page = app.page();
    var html;
    var id = '';
    var focusAid = null;
    if (!ids.length) {
      html = pageHtml(page);
    } else if (ids.length === 1) {
      var f = M.find(page, ids[0]);
      id = ids[0];
      if (!f) html = pageHtml(page);
      else if (f.kind === 'step') html = stepHtml(page, f.el);
      else if (f.kind === 'transition') html = transHtml(page, f.el);
      else if (f.kind === 'note') html = noteHtml(f.el);
      else if (f.kind === 'frame') html = frameHtml(page, f.el);
      else if (f.kind === 'action') {
        // einzeln ausgewählte Aktion: Feld des Schritts, Aktion hervorgehoben
        html = stepHtml(page, f.step);
        id = f.step.id;
        focusAid = f.el.id;
      }
      else html = linkHtml(page, f.el);
    } else {
      html = multiHtml(page, ids);
    }
    root.setAttribute('data-id', id);
    root.innerHTML = html;
    if (focusAid) {
      var row = root.querySelector('[data-aid="' + CSS.escape(focusAid) + '"]');
      if (row) { row.classList.add('focus'); row.scrollIntoView({ block: 'nearest' }); }
    }
    var cond = root.querySelector('[data-f="cond"]');
    if (cond) updateCondFeedback(cond.value);
  };

  function field(label, attrs, value, cls) {
    return '<label class="field"><span>' + label + '</span><input ' + attrs + (cls ? ' class="' + cls + '"' : '') +
      ' value="' + esc(value) + '" spellcheck="false" autocomplete="off"></label>';
  }

  function describe(page, id) {
    var f = M.find(page, id);
    if (!f) return '?';
    if (f.kind === 'step') return 'Schritt ' + esc(f.el.name);
    return 'Transition' + (f.el.cond ? ' „' + esc(f.el.cond) + '“' : '');
  }

  function variables(page) {
    var outs = {};
    var ins = {};
    var steps = {};
    page.steps.forEach(function (s) {
      steps['X' + s.name] = true;
      s.actions.forEach(function (a) { if (a.var) outs[a.var] = true; });
    });
    function scan(text) {
      var r = E.parse(text);
      if (r.ok) E.info(r.ast).vars.forEach(function (v) { if (!steps[v] && !outs[v] && v !== 't') ins[v] = true; });
    }
    page.transitions.forEach(function (t) { scan(t.cond); });
    page.steps.forEach(function (s) { s.actions.forEach(function (a) { if (a.cond) scan(a.cond); }); });
    return {
      inputs: Object.keys(ins).sort(U.naturalCompare),
      outputs: Object.keys(outs).sort(U.naturalCompare)
    };
  }

  function pageHtml(page) {
    var acts = page.steps.reduce(function (s, st) { return s + st.actions.length; }, 0);
    var vars = variables(page);
    return '<h2>GRAFCET</h2>' +
      '<label class="field"><span>Name der Seite</span><input data-pf="name" value="' + esc(page.name) + '"></label>' +
      '<dl class="stats">' +
      '<dt>Schritte</dt><dd>' + page.steps.length + '</dd>' +
      '<dt>Transitionen</dt><dd>' + page.transitions.length + '</dd>' +
      '<dt>Aktionen</dt><dd>' + acts + '</dd>' +
      '<dt>Eingänge</dt><dd>' + (vars.inputs.map(esc).join(', ') || '–') + '</dd>' +
      '<dt>Ausgänge</dt><dd>' + (vars.outputs.map(esc).join(', ') || '–') + '</dd>' +
      '</dl>' +
      (page.transitions.length
        ? '<div class="btn-row"><button data-cmd="numberTransitions" title="Bezeichnet alle Transitionen von oben nach unten mit T1, T2, …">Transitionen nummerieren</button>' +
          '<button data-cmd="clearTransitionNames">Bezeichnungen entfernen</button></div>'
        : '') +
      '<h3>So geht es los</h3><ol class="tips">' +
      '<li><b>Anfangsschritt</b> wählen (Taste A) und auf die Fläche klicken.</li>' +
      '<li>Schritt auswählen und <kbd>N</kbd> drücken: Transition und nächster Schritt werden angehängt.</li>' +
      '<li>Doppelklick auf eine Transition: Bedingung eintippen.</li>' +
      '<li>Schritt auswählen und hier rechts Aktionen hinzufügen.</li>' +
      '<li>Mit <b>Verbinden</b> (C) vom letzten Schritt zurück zum Anfangsschritt ziehen.</li>' +
      '</ol>';
  }

  function stepHtml(page, s) {
    var rows = s.actions.map(function (a, i) { return actionRow(a, i, s.actions.length, page); }).join('');
    return '<h2>Schritt <span class="muted">' + esc(s.name) + '</span></h2>' +
      field('Name (meist eine Nummer)', 'data-f="name"', s.name) +
      '<p class="prop-hint">Tipp: Doppelklick auf den Schritt benennt ihn direkt in der Zeichnung; Aktionen fügst du unten mit „+ Aktion“ hinzu.</p>' +
      '<label class="check"><input type="checkbox" data-f="initial"' + (s.initial ? ' checked' : '') + '> Anfangsschritt (Doppelrahmen)</label>' +
      stepKindInfo(page, s) +
      '<h3>Aktionen</h3>' +
      '<div class="actions-list">' + (rows || '<p class="muted" style="margin:0">Noch keine Aktion.</p>') + '</div>' +
      '<div class="btn-row"><button class="primary" data-cmd="addAction">+ Aktion</button>' +
      (s.actions.length > 1
        ? '<select data-f="actionsLayout" aria-label="Anordnung der Aktionen">' +
          '<option value="row"' + (s.actionsLayout !== 'column' ? ' selected' : '') + '>nebeneinander</option>' +
          '<option value="column"' + (s.actionsLayout === 'column' ? ' selected' : '') + '>untereinander</option></select>'
        : '') +
      '</div>' +
      '<label class="field" style="margin-top:14px"><span>Kommentar (wird in „Anführungszeichen“ gezeichnet)</span><textarea data-f="comment">' + esc(s.comment) + '</textarea></label>' +
      commentPosField(s, 'left') +
      '<div class="btn-row"><button data-cmd="append" title="Transition und Schritt anhängen (N)">Folgeschritt anhängen</button>' +
      '<button data-cmd="toggleInitial" title="Taste I">Anfangsschritt ein/aus</button>' +
      '<button class="danger" data-cmd="del">Löschen</button></div>';
  }

  /** Auswahl der Kommentarlage (nur, wenn ein Kommentar vorhanden ist). */
  function commentPosField(el, def) {
    if (!el.comment) return '';
    var cur = el.commentPos || def;
    var opts = [['left', 'links'], ['right', 'rechts'], ['above', 'oben'], ['below', 'unten']].map(function (o) {
      return '<option value="' + o[0] + '"' + (o[0] === cur ? ' selected' : '') + '>' + o[1] + '</option>';
    }).join('');
    return '<div class="btn-row" style="margin-top:-4px;align-items:center"><label class="muted" style="font-size:12.5px">Lage des Kommentars ' +
      '<select data-f="commentPos">' + opts + '</select></label>' +
      (el.commentDx || el.commentDy ? '<button data-cmd="resetComment" title="Mit der Maus verschobenen Kommentar zurücksetzen">Versatz zurücksetzen</button>' : '') +
      '</div><p class="muted" style="font-size:12px;margin:2px 0 10px">Tipp: Den Kommentar kannst du auch direkt in der Zeichnung mit der Maus verschieben.</p>';
  }

  /** Hinweise zu Makro-, Eingangs-, Ausgangs- und einschließenden Schritten. */
  function stepKindInfo(page, s) {
    var html = '';
    var own = M.ownedFrame(page, s.id);
    if (s.kind === 'macro') {
      var mp = M.macroParts(page, s.id);
      html += '<p class="kind-info"><b>Makroschritt.</b> Seine Expansion steht im Rahmen ' + esc(s.name) +
        (mp.entries[0] ? ' (Eingang ' + esc(mp.entries[0].name) + ', Ausgang ' + (mp.exits[0] ? esc(mp.exits[0].name) : '?') + ')' : '') +
        '. Die Transition nach dem Makroschritt kann erst schalten, wenn der Ausgangsschritt aktiv ist.</p>';
    } else if (s.kind === 'entry') {
      html += '<p class="kind-info"><b>Eingangsschritt</b> einer Makro-Expansion: wird aktiv, wenn der Makroschritt aktiviert wird.</p>';
    } else if (s.kind === 'exit') {
      html += '<p class="kind-info"><b>Ausgangsschritt</b> einer Makro-Expansion: erst wenn er aktiv ist, geht es nach dem Makroschritt weiter.</p>';
    } else if (s.kind === 'enclosing') {
      html += '<p class="kind-info"><b>Einschließender Schritt.</b> Sein Inhalt steht im Rahmen daneben. Mit * markierte Schritte werden mit ihm aktiviert, ' +
        'beim Verlassen wird der ganze Inhalt deaktiviert.</p>';
    }
    if (own) html += '<div class="btn-row" style="margin-top:-4px"><button data-cmd="showOwned">' + (s.kind === 'macro' ? 'Expansion' : 'Inhalt') + ' anzeigen</button></div>';
    if (M.frameOf(page, s, ['enclosed'])) {
      html += '<label class="check"><input type="checkbox" data-f="encInit"' + (s.encInit ? ' checked' : '') + '> Mit dem einschließenden Schritt aktivieren (*)</label>';
    }
    return html;
  }

  function actionRow(a, i, n, page) {
    var opts = Object.keys(TYPE_LABELS).map(function (k) {
      return '<option value="' + k + '"' + (a.type === k ? ' selected' : '') + '>' + TYPE_LABELS[k] + '</option>';
    }).join('');
    var hasValue = a.type === 'stored' || a.type === 'event';
    var s = '<div class="action-row" data-aid="' + esc(a.id) + '">' +
      '<select data-af="type" class="wide" aria-label="Art der Aktion">' + opts + '</select>';
    if (a.type === 'forcing') return s + forcingFields(a, page) + rowTools(a, i, n);
    s +=
      '<input data-af="var" class="' + (hasValue ? '' : 'wide') + '" value="' + esc(a.var) + '" placeholder="Variable, z. B. 1M1" aria-label="Variable" spellcheck="false">';
    if (hasValue) {
      s += '<select data-af="value" aria-label="Wert">' +
        '<option value="1"' + (a.value === '1' ? ' selected' : '') + '>:= 1 (setzen)</option>' +
        '<option value="0"' + (a.value === '0' ? ' selected' : '') + '>:= 0 (rücksetzen)</option>' +
        '<option value="inc"' + (a.value === 'inc' ? ' selected' : '') + '>:= +1 (hochzählen)</option>' +
        '<option value="dec"' + (a.value === 'dec' ? ' selected' : '') + '>:= −1 (herunterzählen)</option></select>';
    }
    if (a.type === 'stored') {
      s += '<select data-af="when" class="wide" aria-label="Zeitpunkt">' +
        '<option value="activation"' + (a.when === 'activation' ? ' selected' : '') + '>beim Aktivieren des Schritts (↑)</option>' +
        '<option value="deactivation"' + (a.when === 'deactivation' ? ' selected' : '') + '>beim Deaktivieren des Schritts (↓)</option></select>';
    }
    if (a.type === 'conditional') {
      s += '<input data-af="cond" class="wide" value="' + esc(a.cond) + '" placeholder="Bedingung, z. B. B2 oder 3s/X2" aria-label="Bedingung" spellcheck="false">' + symBar(true);
    }
    if (a.type === 'event') {
      s += '<input data-af="cond" class="wide" value="' + esc(a.cond) + '" placeholder="Ereignis, z. B. ↑B1" aria-label="Ereignis" spellcheck="false">' + symBar(true);
    }
    s += '<div class="hint">' + TYPE_HINTS[a.type] + '</div>' +
      '<div class="row-tools">' +
      '<button data-cmd="upAction" title="nach links"' + (i === 0 ? ' disabled' : '') + '>◀</button>' +
      '<button data-cmd="downAction" title="nach rechts"' + (i === n - 1 ? ' disabled' : '') + '>▶</button>' +
      '<button data-cmd="delAction" class="danger">Entfernen</button></div>' +
      '</div>';
    return s;
  }

  /** Eingabefelder einer Zwangssteuerung G{…}. */
  function forcingFields(a, page) {
    var names = (page.frames || []).filter(function (fr) { return fr.kind === 'partial'; }).map(function (fr) { return fr.name; });
    if (a.target && names.indexOf(a.target) < 0) names.unshift(a.target);
    var s = '<select data-af="target" class="wide" aria-label="Gezwungener Teil-GRAFCET">' +
      (names.length ? '' : '<option value="">– zuerst einen Teil-GRAFCET anlegen –</option>') +
      names.map(function (nm) { return '<option value="' + esc(nm) + '"' + (nm === a.target ? ' selected' : '') + '>' + esc(nm) + '</option>'; }).join('') +
      '</select>' +
      '<select data-af="forceMode" class="wide" aria-label="Situation">' +
      [['init', '{INIT} – Anfangssituation'], ['steps', '{…} – bestimmte Schritte'], ['freeze', '{*} – einfrieren'], ['empty', '{} – alle Schritte inaktiv']]
        .map(function (o) { return '<option value="' + o[0] + '"' + (a.forceMode === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') +
      '</select>';
    if (a.forceMode === 'steps') {
      s += '<input data-af="forceSteps" class="wide" value="' + esc(a.forceSteps) + '" placeholder="Schritte, z. B. 5,6" aria-label="Schritte" spellcheck="false">';
    }
    return s + '<div class="hint">' + TYPE_HINTS.forcing + ' Gezeichnet als <b>' + esc(M.forcingLabel(a)) + '</b>.</div>';
  }

  function rowTools(a, i, n) {
    return '<div class="row-tools">' +
      '<button data-cmd="upAction" title="nach links"' + (i === 0 ? ' disabled' : '') + '>◀</button>' +
      '<button data-cmd="downAction" title="nach rechts"' + (i === n - 1 ? ' disabled' : '') + '>▶</button>' +
      '<button data-cmd="delAction" class="danger">Entfernen</button></div></div>';
  }

  /** Einfügeknöpfe für Bedingungen (forAction: ohne „=1“, kleiner). */
  function symBar(forAction) {
    return '<div class="sym-bar' + (forAction ? ' act-sym-bar' : '') + '">' + SYMBOLS.map(function (s, i) {
      if (forAction && s.set) return '';
      return '<button data-sym="' + i + '" title="' + esc(s.title) + '" aria-label="' + esc(s.title) + '">' + esc(s.label) + '</button>';
    }).join('') + '</div>';
  }

  function transHtml(page, t) {
    return '<h2>Transition</h2>' +
      field('Bedingung (Transitionsbedingung)', 'data-f="cond" placeholder="z. B. B1 * /B2"', t.cond, 'mono') +
      symBar(false) +
      '<p class="prop-hint">Tipp: Doppelklick auf die Transition beschriftet sie direkt in der Zeichnung.</p>' +
      '<div class="cond-feedback" id="condFeedback"></div>' +
      field('Bezeichnung (optional, wird als (T1) links gezeichnet)', 'data-f="name" placeholder="z. B. T1"', t.name) +
      '<label class="field"><span>Kommentar (wird in „Anführungszeichen“ gezeichnet)</span><textarea data-f="comment">' + esc(t.comment) + '</textarea></label>' +
      commentPosField(t, 'right') +
      '<details class="syntax"><summary>Schreibweise</summary><table>' +
      '<tr><td><code>B1 * B2</code></td><td>UND</td></tr>' +
      '<tr><td><code>B1 + B2</code></td><td>ODER</td></tr>' +
      '<tr><td><code>/B1</code></td><td>NICHT (Überstrich)</td></tr>' +
      '<tr><td><code>↑B1</code>, <code>RE(B1)</code></td><td>steigende Flanke</td></tr>' +
      '<tr><td><code>↓B1</code>, <code>FE(B1)</code></td><td>fallende Flanke</td></tr>' +
      '<tr><td><code>5s/X3</code></td><td>Schritt 3 seit 5 s aktiv (<code>t/X3/5s</code> und <code>t>5s</code> werden umgewandelt)</td></tr>' +
      '<tr><td><code>X3</code></td><td>Schritt 3 ist aktiv</td></tr>' +
      '<tr><td><code>1</code></td><td>immer erfüllt</td></tr>' +
      '<tr><td><code>C1 >= 5</code></td><td>Vergleich, gezeichnet als [C1 ≥ 5]</td></tr>' +
      '</table></details>' +
      '<div class="btn-row"><button data-cmd="append" title="Taste N">Folgeschritt anhängen</button>' +
      '<button class="danger" data-cmd="del">Löschen</button></div>';
  }

  function updateCondFeedback(text) {
    var box = document.getElementById('condFeedback');
    if (!box) return;
    if (!String(text).trim()) {
      box.className = 'cond-feedback bad';
      box.textContent = 'Noch keine Bedingung. Jede Transition braucht eine – für „immer erfüllt“ schreibe 1.';
      return;
    }
    var r = E.parse(text);
    if (!r.ok) {
      box.className = 'cond-feedback bad';
      box.innerHTML = esc(r.error.message) + '<br><code>' + esc(text.slice(0, r.error.pos)) +
        '<u>' + esc(text.slice(r.error.pos, r.error.pos + 1) || ' ') + '</u>' + esc(text.slice(r.error.pos + 1)) + '</code>';
      return;
    }
    var info = E.info(r.ast);
    var pre = R.exprSvg(text, 6, 24, 'start');
    var w = Math.ceil(pre.width + 14);
    var parts = [];
    var stepVars = info.vars.filter(function (v) { return /^X/.test(v) && M.stepByName(app.page(), v.slice(1)); });
    var others = info.vars.filter(function (v) { return stepVars.indexOf(v) < 0; });
    if (others.length) parts.push('Variablen: ' + others.map(esc).join(', '));
    if (stepVars.length) parts.push('Schrittvariablen: ' + stepVars.map(esc).join(', '));
    if (info.edges) parts.push('mit Flanke');
    if (info.timers.length) parts.push('mit Zeit');
    box.className = 'cond-feedback good';
    box.innerHTML = '✓ So wird die Bedingung gezeichnet:' +
      '<svg width="' + w + '" height="32" viewBox="0 0 ' + w + ' 32">' + pre.svg + '</svg>' +
      (parts.length ? '<span class="muted">' + parts.join(' · ') + '</span>' : '');
  }

  function linkHtml(page, l) {
    var fromK = M.kindOf(page, l.from);
    var toK = M.kindOf(page, l.to);
    var canJump = fromK === 'transition' && toK === 'step';
    return '<h2>Wirkverbindung</h2>' +
      '<p>von <button class="linkish" data-cmd="goto" data-target="' + l.from + '">' + describe(page, l.from) + '</button><br>' +
      'nach <button class="linkish" data-cmd="goto" data-target="' + l.to + '">' + describe(page, l.to) + '</button></p>' +
      (canJump ? '<label class="check"><input type="checkbox" data-f="jump"' + (l.jump ? ' checked' : '') + '> Als Sprung darstellen (Pfeil mit Zielschritt)</label>' : '') +
      '<p class="muted">Verbindungen nach oben (Rückführungen) werden automatisch links vorbei geführt und mit einem Pfeil gezeichnet.</p>' +
      '<div class="btn-row"><button class="danger" data-cmd="del">Verbindung löschen</button></div>';
  }

  function frameHtml(page, fr) {
    var members = M.frameMembers(page, fr.id, true);
    var steps = members.filter(function (el) { return el.actions; });
    var trans = members.filter(function (el) { return el.cond !== undefined; });
    var title = { partial: 'Teil-GRAFCET', macro: 'Expansion', enclosed: 'Eingeschlossener Inhalt' }[fr.kind] || 'Rahmen';
    return '<h2>' + title + ' <span class="muted">' + esc(GE.render.frameLabel(page, fr)) + '</span></h2>' +
      (fr.kind === 'partial' ? field('Name (üblich: G und Nummer oder Kurzname, z. B. G2, G_Sicherheit)', 'data-f="name"', fr.name) : '') +
      '<dl class="stats"><dt>Schritte</dt><dd>' + steps.length + ' (' + (steps.map(function (s) { return esc(s.name); }).join(', ') || '–') + ')</dd>' +
      '<dt>Transitionen</dt><dd>' + trans.length + '</dd>' +
      '<dt>Anfangsschritt</dt><dd>' + (steps.filter(function (s) { return s.initial; }).map(function (s) { return esc(s.name); }).join(', ') || 'keiner') + '</dd></dl>' +
      '<p class="muted">Alles, was im Rahmen liegt, gehört dazu. Am Namen ziehen verschiebt den Rahmen samt Inhalt, ' +
      'der Anfasser unten rechts ändert die Größe. Ein zusammenhängender Ablauf muss ganz in einem Rahmen liegen.</p>' +
      '<div class="btn-row"><button data-cmd="showFrame">Anzeigen</button>' +
      '<button data-cmd="fitFrame">An Inhalt anpassen</button>' +
      '<button class="danger" data-cmd="del">Rahmen entfernen (Inhalt bleibt)</button></div>';
  }

  function noteHtml(nt) {
    return '<h2>Kommentar</h2>' +
      '<label class="field"><span>Text (mehrere Zeilen möglich)</span><textarea data-f="text" rows="5">' + esc(nt.text) + '</textarea></label>' +
      '<p class="muted">Freie Kommentare erklären den Ablauf, z. B. als Überschrift oder Hinweis. Sie haben keinen Einfluss auf die Simulation.</p>' +
      '<div class="btn-row"><button class="danger" data-cmd="del">Kommentar löschen</button></div>';
  }

  function multiHtml(page, ids) {
    var nodes = ids.filter(function (id) { return M.node(page, id); }).length;
    return '<h2>' + ids.length + ' Elemente ausgewählt</h2>' +
      '<p class="muted">' + nodes + ' Schritte/Transitionen, ' + (ids.length - nodes) + ' Verbindungen</p>' +
      '<div class="btn-row">' +
      '<button data-cmd="alignV">Senkrecht ausrichten</button>' +
      '<button data-cmd="alignH">Waagerecht ausrichten</button>' +
      '<button data-cmd="duplicate">Duplizieren</button>' +
      '<button data-cmd="groupFrame">Als Teil-GRAFCET</button>' +
      '<button class="danger" data-cmd="del">Löschen</button></div>' +
      '<p class="muted">Ausgerichtet wird am zuletzt angeklickten Element.</p>';
  }

  /** Panel für den Schritt zeigen und das Variablenfeld der Aktion fokussieren. */
  P.focusAction = function (aid) {
    var fa = M.find(app.page(), aid);
    if (fa && fa.kind === 'action' && !app.sel[fa.step.id]) app.sel = {}, app.sel[fa.step.id] = true;
    P.render();
    var row = root.querySelector('[data-aid="' + CSS.escape(aid) + '"]');
    if (!row) return;
    row.classList.add('focus');
    row.scrollIntoView({ block: 'nearest' });
    var inp = row.querySelector('[data-af="var"]') || row.querySelector('[data-af="target"]');
    if (inp) inp.focus();
  };

  // ------------------------------------------------------------ Prüfmeldungen

  P.renderIssues = function (issues) {
    var list = document.getElementById('issueList');
    var c = GE.validate.count(issues);
    var parts = [];
    if (c.error) parts.push(c.error + ' Fehler');
    if (c.warning) parts.push(c.warning + (c.warning === 1 ? ' Warnung' : ' Warnungen'));
    if (c.info) parts.push(c.info + (c.info === 1 ? ' Hinweis' : ' Hinweise'));
    document.getElementById('issueCount').textContent = parts.join(' · ');
    var page = app.page();
    if (!issues.length) {
      list.innerHTML = '<li class="none">' + (page.steps.length ? '✓ Keine Probleme gefunden.' : 'Noch nichts gezeichnet.') + '</li>';
      return;
    }
    var order = { error: 0, warning: 1, info: 2 };
    var icon = { error: '!', warning: '▲', info: 'i' };
    list.innerHTML = issues.slice().sort(function (a, b) { return order[a.level] - order[b.level]; }).map(function (i) {
      return '<li class="' + i.level + '" data-ids="' + i.ids.join(',') + '"' + (i.ids.length ? ' tabindex="0" role="button"' : '') +
        (i.fit ? ' data-fit="' + i.fit + '" title="Klicken passt den Rahmen an den Inhalt an">' : ' title="Klicken zeigt das Element">') +
        '<span class="ico">' + icon[i.level] + '</span><span>' + esc(i.text) + '</span></li>';
    }).join('');
  };
})(globalThis.GE = globalThis.GE || {});
