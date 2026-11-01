/*
 * tasks.js – Übungsaufgaben: Aufbau einer Aufgabe und Prüfung einer Lösung
 * (ohne DOM, in Node testbar). Die Aufgaben selbst stehen in tasklist.js.
 *
 * Aufgabe:
 *   { id, level: 1|2|3, topic, title, text,
 *     vars: { Name: [Bedeutung, Art, Grundstellung] },
 *       Art: 'button' (Taster) | 'switch' (Schalter) | 'num' (Zahl) – Eingänge
 *            'out' (Ausgang, wird verglichen) | 'mem' (Merker/Zähler, frei)
 *     plant: { id, options }              virtuelle Anlage zum Ausprobieren
 *     require: ['or', 'and', …]            nur, wenn der Text es ausdrücklich verlangt
 *     solution: { steps, trans, links, layout, frames }   versteckte Musterlösung
 *     runs: [[Name, [Aktion, …]]],          Prüfabläufe
 *     hints: [Tipp, …] }
 *
 * Aktionen eines Prüfablaufs (mehrere durch Leerzeichen getrennt):
 *   'S1^'    Taster S1 kurz drücken (0,2 s)
 *   'B1=1'   Eingang setzen
 *   '5s'     warten (ohne Angabe dauert eine Aktion 0,5 s)
 *
 * Prüfung: Zuerst die Struktur (Fehler der normalen Prüfung, geforderte
 * Ausgänge, unbekannte Namen, Strukturvorgaben). Dann laufen Lösung und
 * Musterlösung mit denselben Eingängen; nach jeder Aktion und alle 0,1 s
 * werden die Ausgänge verglichen. Schrittnummern und eigene Merker sind
 * frei – verglichen wird nur, was nach außen wirkt.
 */
(function (GE) {
  'use strict';

  var T = (GE.tasks = {});
  var M = GE.model;
  var E = GE.expr;
  var S = GE.sim;
  var U = GE.util;
  var V = GE.validate;

  T.STEP_MS = 100;       // Abstand der Vergleiche
  T.PRESS_MS = 200;      // Dauer eines Tasterdrucks
  T.ACTION_MS = 500;     // Dauer einer Aktion ohne Zeitangabe

  T.LEVELS = { 1: 'Grundlagen', 2: 'Mittel', 3: 'Fortgeschritten' };

  var INPUT_KINDS = { button: 1, switch: 1, num: 1 };

  /** Strukturvorgaben: Text für die Meldung und Test an der Seite. */
  T.REQUIRE = {
    or: {
      text: 'eine ODER-Verzweigung (ein Schritt mit mehreren Folgetransitionen)',
      test: function (page) { return page.steps.some(function (s) { return M.outLinks(page, s.id).length > 1; }); }
    },
    and: {
      text: 'eine UND-Verzweigung (eine Transition mit mehreren Folgeschritten)',
      test: function (page) { return page.transitions.some(function (t) { return M.outLinks(page, t.id).length > 1; }); }
    },
    time: {
      text: 'eine Zeitbedingung wie 5s/X3',
      test: function (page) { return anyAst(page, function (n) { return n.type === 'timer'; }); }
    },
    stored: {
      text: 'speichernde Aktionen (z. B. M1 := 1)',
      test: function (page) { return anyAction(page, function (a) { return a.type === 'stored' && a.var; }); }
    },
    counter: {
      text: 'einen Zähler (Aktion C1 := C1 + 1)',
      test: function (page) { return anyAction(page, function (a) { return a.value === 'inc' && a.var && a.type !== 'forcing'; }); }
    },
    partial: {
      text: 'mindestens zwei Teil-GRAFCETs (Rahmen mit Namen)',
      test: function (page) { return (page.frames || []).filter(function (fr) { return fr.kind === 'partial'; }).length >= 2; }
    },
    forcing: {
      text: 'eine Zwangssteuerung wie G1{INIT}',
      test: function (page) { return anyAction(page, function (a) { return a.type === 'forcing'; }); }
    }
  };

  function anyAction(page, fn) {
    return page.steps.some(function (s) { return s.actions.some(fn); });
  }

  function anyAst(page, fn) {
    var texts = page.transitions.map(function (t) { return t.cond; });
    page.steps.forEach(function (s) { s.actions.forEach(function (a) { if (a.cond) texts.push(a.cond); }); });
    return texts.some(function (txt) {
      var r = E.parse(txt);
      var hit = false;
      if (r.ok) E.walk(r.ast, function (n) { if (fn(n)) hit = true; });
      return hit;
    });
  }

  function fmtS(ms) {
    return String(Math.round(ms / 100) / 10).replace('.', ',') + ' s';
  }
  T.fmtS = fmtS;

  // ------------------------------------------------------------ Variablen

  function varDef(task, name) {
    var d = task.vars[name];
    return d ? { name: name, comment: d[0] || '', kind: d[1] || 'switch', initial: d[2] } : null;
  }

  T.vars = function (task) {
    return Object.keys(task.vars).map(function (n) { return varDef(task, n); });
  };

  T.inputs = function (task) {
    return T.vars(task).filter(function (v) { return INPUT_KINDS[v.kind]; });
  };

  T.outputs = function (task) {
    return T.vars(task).filter(function (v) { return v.kind === 'out'; });
  };

  /** Werte der Eingänge in der Grundstellung. */
  T.startValues = function (task) {
    var res = {};
    T.inputs(task).forEach(function (v) { if (v.initial !== undefined) res[v.name] = +v.initial || 0; });
    return res;
  };

  function nameWithComment(task, n) {
    var d = varDef(task, n);
    return d && d.comment ? n + ' (' + d.comment + ')' : n;
  }

  /** Variablentabelle eines Projekts mit den Angaben der Aufgabe füllen. */
  function applyVars(task, project) {
    T.vars(task).forEach(function (v) {
      var meta = { comment: v.comment };
      if (v.kind === 'button' || v.kind === 'switch') meta.mode = v.kind;
      if (INPUT_KINDS[v.kind] && v.initial !== undefined) meta.initial = v.initial;
      M.setVarMeta(project, v.name, meta);
    });
  }

  // ------------------------------------------------------------ Projekte

  /** Leeres Projekt zum Bearbeiten: Anfangsschritt, Variablen, Anlage, Bezug zur Aufgabe. */
  T.startProject = function (task) {
    var p = M.createProject(task.title);
    M.addStep(p, p.pages[0], 160, 100, { initial: true });
    applyVars(task, p);
    if (task.plant) p.plant = { id: task.plant.id, map: {}, options: Object.assign({}, task.plant.options || {}) };
    p.task = { id: task.id };
    return p;
  };

  /** Musterlösung als Projekt (für den Vergleich und für Lehrkräfte). */
  T.solutionProject = function (task) {
    var sol = task.solution;
    var vars = {};
    T.vars(task).forEach(function (v) {
      vars[v.name] = [v.comment, v.kind === 'button' || v.kind === 'switch' ? v.kind : undefined, INPUT_KINDS[v.kind] ? v.initial : undefined];
    });
    var p = GE.examples.build(task.title + ' – Musterlösung', sol.steps, sol.trans, sol.links, {
      vars: vars,
      layout: sol.layout,
      frames: sol.frames,
      plant: task.plant
    });
    p.task = { id: task.id };
    return p;
  };

  var refCache = {};
  function referencePage(task) {
    if (!refCache[task.id]) refCache[task.id] = T.solutionProject(task).pages[0];
    return refCache[task.id];
  }

  // ------------------------------------------------------------ Prüfabläufe

  /** Eine Aktion wie 'S1^ B2=0 3s' zerlegen. */
  T.parseAction = function (task, text) {
    var a = { text: text, set: {}, press: [], wait: 0 };
    String(text).trim().split(/\s+/).forEach(function (tok) {
      var m;
      if ((m = /^(\d+(?:[.,]\d+)?)(ms|s)$/.exec(tok))) {
        a.wait += U.parseNum(m[1]) * (m[2] === 's' ? 1000 : 1);
      } else if ((m = /^(.+)\^$/.exec(tok))) {
        a.press.push(m[1]);
      } else if ((m = /^(.+)=(-?\d+(?:[.,]\d+)?)$/.exec(tok))) {
        a.set[m[1]] = U.parseNum(m[2]);
      } else {
        throw new Error('Aufgabe ' + task.id + ': unbekannte Angabe „' + tok + '“ im Prüfablauf');
      }
    });
    // kurz halten: die Bedeutung der Namen steht in der Variablenliste der Aufgabe
    var parts = a.press.map(function (n) { return n + ' drücken'; });
    Object.keys(a.set).forEach(function (n) { parts.push(n + ' = ' + a.set[n]); });
    if (a.wait) parts.push(fmtS(a.wait) + ' warten');
    a.label = parts.join(', ');
    a.duration = Math.max(a.wait || T.ACTION_MS, a.press.length ? T.PRESS_MS : 0);
    return a;
  };

  /**
   * Zeitplan eines Prüfablaufs: Ereignisse {t, set, idx} und Aktionen
   * {start, end, label}. Wird von der Prüfung und beim Abspielen benutzt.
   */
  T.timeline = function (task, runIndex) {
    var run = task.runs[runIndex];
    var t = 0;
    var events = [];
    var actions = run[1].map(function (text, i) {
      var a = T.parseAction(task, text);
      var set = Object.assign({}, a.set);
      a.press.forEach(function (n) { set[n] = 1; });
      if (Object.keys(set).length) events.push({ t: t, set: set, idx: i });
      if (a.press.length) {
        var rel = {};
        a.press.forEach(function (n) { rel[n] = 0; });
        events.push({ t: t + T.PRESS_MS, set: rel, idx: i });
      }
      var item = { start: t, end: t + a.duration, label: a.label };
      t += a.duration;
      return item;
    });
    return { name: run[0], init: T.startValues(task), events: events, actions: actions, end: t };
  };

  /** Index der Aktion, die zum Zeitpunkt t läuft. */
  T.actionAt = function (tl, t) {
    for (var i = tl.actions.length - 1; i >= 0; i--) if (t >= tl.actions[i].start) return i;
    return 0;
  };

  /**
   * Seite mit einem Zeitplan durchlaufen. Ruft sample(sim, t) nach jedem
   * Ereignis und alle STEP_MS auf; liefert sample einen Wert, wird abgebrochen.
   */
  T.drive = function (page, tl, sample) {
    var sim = new S.Sim(page, tl.init);
    sim.recording = false;
    var k = 0;
    for (var guard = 0; guard < 100000; guard++) {
      var applied = false;
      while (k < tl.events.length && tl.events[k].t <= sim.time) {
        var set = tl.events[k].set;
        Object.keys(set).forEach(function (n) { sim.setInput(n, set[n]); });
        applied = true;
        k++;
      }
      if (applied) sim.tick(0);
      var stop = sample(sim, sim.time);
      if (stop || sim.error || sim.time >= tl.end) return sim;
      var next = Math.min(sim.time + T.STEP_MS, tl.end, k < tl.events.length ? tl.events[k].t : Infinity);
      sim.tick(next - sim.time);
    }
    return sim;
  };

  /** Verlauf aller Ausgänge eines Prüfablaufs: [[t, {Name: Wert}]]. */
  T.trace = function (task, page, runIndex) {
    var tl = T.timeline(task, runIndex);
    var outs = T.outputs(task);
    var res = [];
    T.drive(page, tl, function (sim, t) {
      var o = {};
      outs.forEach(function (v) { o[v.name] = +sim.value(v.name) || 0; });
      res.push([t, o]);
    });
    return res;
  };

  function sameValue(a, b) {
    return (+a || 0) === (+b || 0);
  }

  function describeValue(v) {
    return v === 1 ? 'an' : v === 0 ? 'aus' : String(v);
  }

  /** Einen Prüfablauf mit Lösung und Musterlösung vergleichen. */
  function compareRun(task, page, ref, runIndex) {
    var tl = T.timeline(task, runIndex);
    var outs = T.outputs(task);
    var refTrace = [];
    T.drive(ref, tl, function (sim, t) {
      var o = {};
      outs.forEach(function (v) { o[v.name] = +sim.value(v.name) || 0; });
      refTrace.push([t, o]);
    });
    var i = 0;
    var fail = null;
    var sim = T.drive(page, tl, function (sim, t) {
      while (i < refTrace.length - 1 && refTrace[i][0] < t) i++;
      var want = refTrace[i][1];
      var diffs = [];
      outs.forEach(function (v) {
        var got = +sim.value(v.name) || 0;
        if (!sameValue(got, want[v.name])) diffs.push({ name: v.name, want: want[v.name], got: got });
      });
      if (!diffs.length) return false;
      // alle Ausgänge nennen, die im ersten abweichenden Augenblick falsch sind
      fail = { time: t, name: diffs[0].name, want: diffs[0].want, got: diffs[0].got, diffs: diffs };
      return true;
    });
    var res = { name: tl.name, ok: !fail && !sim.error, actions: tl.actions.length };
    if (sim.error) {
      var ei = T.actionAt(tl, sim.time);
      res.fail = { time: sim.time, idx: ei, label: tl.actions[ei].label, loop: true };
      res.text = 'Bei „' + tl.actions[ei].label + '“ wird die Situation deines GRAFCET nicht stabil ' +
        '(Transitionen schalten ohne Ende im Kreis).';
    } else if (fail) {
      var ai = T.actionAt(tl, fail.time);
      var act = tl.actions[ai];
      var dt = fail.time - act.start;
      fail.idx = ai;
      fail.label = act.label;
      res.fail = fail;
      var when = ai === 0 && dt === 0 && fail.time === 0 ? 'Gleich zu Beginn (Grundstellung)'
        : 'Bei Aktion ' + (ai + 1) + ' „' + act.label + '“' + (dt > 0 ? ', ' + fmtS(dt) + ' danach' : '');
      res.text = when + ': ' + fail.diffs.map(function (d) {
        var soll = d.want === 0 ? 'soll aber aus sein' : d.want === 1 ? 'soll aber an sein' : 'soll aber ' + d.want + ' sein';
        return nameWithComment(task, d.name) + ' ist ' + describeValue(d.got) + ', ' + soll;
      }).join('; ') + '.';
    }
    return res;
  }

  // ------------------------------------------------------------ Prüfung

  /** Groß-/Kleinschreibung ignorierender Vergleich mit den Namen der Aufgabe. */
  function similarName(task, n) {
    var low = n.toLowerCase();
    return Object.keys(task.vars).filter(function (k) { return k.toLowerCase() === low; })[0] || null;
  }

  /**
   * Lösung prüfen.
   * @returns {{ok, problems:[{level, text, ids}], runs:[{name, ok, text, fail}], blocked}}
   */
  T.check = function (task, project) {
    var page = project.pages[0];
    var problems = [];
    function add(level, text, ids) { problems.push({ level: level, text: text, ids: ids || [] }); }

    // 1. Normale Prüfung
    var issues = V.page(page);
    var errs = issues.filter(function (i) { return i.level === 'error'; });
    if (errs.length) {
      add('error', 'Die Zeichnung hat noch ' + errs.length + (errs.length === 1 ? ' Fehler' : ' Fehler') +
        ' (siehe „Prüfung“ unten), z. B.: ' + errs[0].text, errs[0].ids);
    }

    // 2. Namen und Ausgänge
    var vars = S.variables(page);
    var assigned = {};
    vars.outputs.concat(vars.memories, vars.mixed).forEach(function (n) { assigned[n] = true; });
    T.outputs(task).forEach(function (v) {
      if (!assigned[v.name]) add('error', 'Der Ausgang ' + nameWithComment(task, v.name) + ' kommt in keiner Aktion vor.');
    });
    vars.inputs.forEach(function (n) {
      if (task.vars[n]) return;
      var sim = similarName(task, n);
      add('error', '„' + n + '“ gibt es in der Aufgabe nicht' +
        (sim ? ' – meintest du „' + sim + '“? Groß- und Kleinschreibung zählen.' : ' – Tippfehler? Die Variablen stehen in der Aufgabe.'));
    });
    Object.keys(assigned).forEach(function (n) {
      if (task.vars[n]) {
        if (INPUT_KINDS[varDef(task, n).kind]) add('error', n + ' ist in der Aufgabe ein Eingang und darf nicht als Aktion zugewiesen werden.');
        return;
      }
      var sim = similarName(task, n);
      if (sim) add('error', '„' + n + '“ gibt es in der Aufgabe nicht – meintest du „' + sim + '“? Groß- und Kleinschreibung zählen.');
      else add('info', '„' + n + '“ ist eine eigene Variable. Das ist erlaubt; verglichen werden nur die Ausgänge der Aufgabe.');
    });

    // 3. Strukturvorgaben (nur, wenn der Aufgabentext sie verlangt)
    (task.require || []).forEach(function (k) {
      var rq = T.REQUIRE[k];
      if (rq && !rq.test(page)) add('error', 'Die Aufgabe verlangt ' + rq.text + '. Das fehlt in deiner Lösung noch.');
    });

    // 4. Verhalten
    var blocked = errs.length > 0 || !page.steps.some(function (s) { return s.initial; });
    var runs = [];
    if (!blocked) {
      var ref = referencePage(task);
      runs = task.runs.map(function (r, i) { return compareRun(task, page, ref, i); });
    }
    var hardProblems = problems.filter(function (p) { return p.level === 'error'; }).length;
    return {
      ok: !blocked && !hardProblems && runs.every(function (r) { return r.ok; }),
      blocked: blocked,
      problems: problems,
      runs: runs
    };
  };

  // ------------------------------------------------------------ Bibliothek

  T.list = [];

  T.get = function (id) {
    for (var i = 0; i < T.list.length; i++) if (T.list[i].id === id) return T.list[i];
    return null;
  };
})(globalThis.GE = globalThis.GE || {});
