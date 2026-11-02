/*
 * simui.js – Bedienung der Simulation: Start/Pause/Einzelschritt,
 * Eingänge (Schalter/Taster), Ausgänge, Variablentabelle, Anlage,
 * Protokoll und Zeitverlaufsdiagramm.
 */
(function (GE) {
  'use strict';

  var SU = (GE.simui = {});
  var M = GE.model;
  var S = GE.sim;
  var P = GE.plants;
  var U = GE.util;
  var esc = U.esc;

  var SPEEDS = [0.25, 0.5, 1, 2, 4, 8];
  var TICK_MS = 50;          // Echtzeit zwischen zwei Simulationsschritten
  var MAX_STEP = 100;        // größter Zeitschritt der Simulation (ms)

  var app;
  var panel;
  var sim = null;
  var timer = null;
  var running = false;
  var speedIdx = 2;
  var plant = null;
  var plantState = null;
  var plantNames = null;
  var plantDriven = {};      // Eingänge, die von der Anlage gesetzt werden
  var held = {};             // gedrückt gehaltene Taster
  var script = null;         // abgespielter Prüfablauf einer Aufgabe (siehe playScript)
  var lastSig = '';
  var lastTiming = 0;
  var lastLogCount = -1;
  var groups = { inputs: true, outputs: true, steps: true };

  SU.init = function (theApp) {
    app = theApp;
    panel = document.getElementById('simPanel');
    panel.addEventListener('click', onClick);
    panel.addEventListener('change', onChange);
    panel.addEventListener('input', onInput);
    panel.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointerup', releaseHeld);
    window.addEventListener('pointercancel', releaseHeld);
    window.addEventListener('blur', releaseHeld);

    document.getElementById('trRec').addEventListener('change', function (e) {
      if (sim) sim.recording = e.target.checked;
    });
    document.getElementById('trWindow').addEventListener('change', function () { drawTiming(true); });
    document.getElementById('trClear').addEventListener('click', function () {
      if (sim) sim.clearTrace();
      drawTiming(true);
    });
    var cbs = document.querySelectorAll('#timing [data-group]');
    for (var i = 0; i < cbs.length; i++) {
      cbs[i].addEventListener('change', function (e) {
        groups[e.target.getAttribute('data-group')] = e.target.checked;
        drawTiming(true);
      });
    }
    window.addEventListener('resize', function () { if (sim) drawTiming(true); });

    // Zeitverlauf ein-/ausklappen und Höhe ziehen (Vorlieben werden gemerkt)
    document.getElementById('trToggle').addEventListener('click', function () {
      GE.prefs.set('timingOpen', !GE.prefs.get('timingOpen'));
      SU.applyTimingPrefs();
    });
    var handle = document.getElementById('trResize');
    handle.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      var timing = document.getElementById('timing');
      var startY = e.clientY;
      var startH = timing.getBoundingClientRect().height;
      try { handle.setPointerCapture(e.pointerId); } catch (err) { /* ohne Erfassung geht es auch */ }
      function move(ev) {
        var h = Math.round(U.clamp(startH - (ev.clientY - startY), 90, window.innerHeight * 0.75));
        timing.style.height = h + 'px';
      }
      function up() {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        GE.prefs.set('timingHeight', Math.round(timing.getBoundingClientRect().height));
        if (!GE.prefs.get('timingOpen')) GE.prefs.set('timingOpen', true);
        SU.applyTimingPrefs();
      }
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
    });
  };

  /** Zeitverlauf nach den gespeicherten Vorlieben ein-/ausklappen und Höhe setzen. */
  SU.applyTimingPrefs = function () {
    var timing = document.getElementById('timing');
    var open = GE.prefs.get('timingOpen');
    timing.classList.toggle('collapsed', !open);
    timing.style.maxHeight = 'none';
    timing.style.height = open ? U.clamp(GE.prefs.get('timingHeight'), 90, window.innerHeight * 0.75) + 'px' : 'auto';
    document.getElementById('trToggle').setAttribute('aria-expanded', open ? 'true' : 'false');
    if (sim) drawTiming(true);
  };

  SU.isActive = function () { return !!sim; };

  /** Interner Zustand (für Tests und Fehlersuche). */
  SU.debug = function () {
    return { sim: sim, plant: plant, plantState: plantState, plantNames: plantNames, running: running };
  };

  /** Zustand für die Markierung in der Zeichnung. */
  SU.renderInfo = function () {
    return sim ? sim.renderInfo() : null;
  };

  // ------------------------------------------------------------ Start/Ende

  /** Simulation für die aktuelle Seite aufbauen (beim Umschalten oder Laden). */
  SU.enter = function () {
    stop();
    script = null;
    setupPlant();
    sim = new S.Sim(app.page(), startValues(), { lazy: true });
    sim.recording = document.getElementById('trRec').checked;
    held = {};
    lastSig = '';
    lastLogCount = -1;
    buildPanel();
    GE.plcui.simEnter();
    document.getElementById('timing').hidden = false;
    SU.applyTimingPrefs();
    timer = setInterval(loop, TICK_MS);
    update(true);
  };

  SU.leave = function () {
    stop();
    clearInterval(timer);
    timer = null;
    sim = null;
    script = null;
    document.getElementById('timing').hidden = true;
    panel.innerHTML = '';
    GE.plcui.simLeave();
  };

  function stop() {
    running = false;
  }

  function setupPlant() {
    var cfg = app.project.plant;
    plant = cfg && cfg.id ? P.get(cfg.id) : null;
    plantState = plant ? plant.create(cfg.options || {}) : null;
    plantNames = plant ? P.names(plant, cfg.map) : null;
    plantDriven = {};
    if (plant) {
      plant.signals.forEach(function (sg) {
        if (sg.dir === 'in') plantDriven[plantNames[sg.id]] = sg.label;
      });
    }
  }

  /**
   * Werte der Eingänge in der Grundstellung: Sensoren der Anlage und die
   * Startwerte aus der Variablentabelle (z. B. NOT-HALT-Öffner = 1).
   */
  function startValues() {
    var res = plant ? P.sensorInputs(plant, plantState, plantNames) : {};
    S.variables(app.page()).inputs.forEach(function (n) {
      var meta = M.varMeta(app.project, n);
      if (!(n in res) && meta.initial !== undefined && meta.initial !== '') res[n] = +meta.initial || 0;
    });
    return res;
  }

  function resetSim() {
    setupPlant();
    held = {};
    script = null;
    sim.reset(startValues(), { lazy: true });
    lastLogCount = -1;
    update(true);
  }

  // ------------------------------------------------------------ Takt

  function loop() {
    if (!sim) return;
    if (running && script) {
      runScript(TICK_MS * SPEEDS[speedIdx]);
    } else if (running) {
      var total = TICK_MS * SPEEDS[speedIdx];
      while (total > 0 && !sim.error) {
        var d = Math.min(MAX_STEP, total);
        if (plant) P.step(plant, plantState, plantNames, sim, d);
        sim.tick(d);
        total -= d;
      }
      if (sim.error) running = false;
    }
    update(false);
  }

  /** Eingabe verarbeiten: läuft die Simulation, sofort auswerten (ohne Zeitfortschritt). */
  function afterInput() {
    if (running) sim.tick(0);
    update(false);
  }

  function setInput(name, v) {
    if (script) endScript('Prüfablauf beendet, weil du selbst einen Eingang bedient hast.');
    sim.setInput(name, v);
    afterInput();
  }

  // ------------------------------------------------------------ Prüfablauf abspielen

  /**
   * Prüfablauf einer Aufgabe abspielen: Grundstellung herstellen, Eingänge
   * nach dem Zeitplan setzen und dort anhalten, wo die Lösung abweicht.
   * opts: { timeline (tasks.timeline), failTime (ms oder null), failText }
   * Die Zeitschritte treffen die Zeitpunkte des Plans genau, damit der Ablauf
   * derselbe ist wie bei der Prüfung. Eine Anlage steht so lange still.
   */
  SU.playScript = function (opts) {
    if (!sim) return;
    running = false;
    held = {};
    sim.reset(opts.timeline.init);
    script = { tl: opts.timeline, k: 0, failTime: opts.failTime, failText: opts.failText || '', state: 'run' };
    scriptDue();
    if (!scriptStop()) running = true;
    lastLogCount = -1;
    update(true);
  };

  function scriptDue() {
    var evs = script.tl.events;
    var any = false;
    while (script.k < evs.length && evs[script.k].t <= sim.time) {
      var set = evs[script.k].set;
      Object.keys(set).forEach(function (n) { sim.setInput(n, set[n]); });
      script.k++;
      any = true;
    }
    if (any) sim.tick(0);
  }

  /** Anhalten an der Abweichung bzw. am Ende; liefert true, wenn angehalten wurde. */
  function scriptStop() {
    if (script.failTime != null && sim.time >= script.failTime) {
      script.failTime = null;   // beim Weiterlaufen nicht noch einmal anhalten
      script.state = 'fail';
      running = false;
      return true;
    }
    if (sim.time >= script.tl.end || sim.error) {
      script.state = 'end';
      running = false;
      return true;
    }
    return false;
  }

  function runScript(budget) {
    while (budget > 0 && running && !sim.error) {
      var evs = script.tl.events;
      var next = Math.min(sim.time + MAX_STEP, script.tl.end,
        script.k < evs.length ? evs[script.k].t : Infinity,
        script.failTime != null ? script.failTime : Infinity);
      var d = Math.min(budget, next - sim.time);
      sim.tick(d);
      budget -= d;
      scriptDue();
      if (scriptStop()) break;
    }
  }

  function endScript(text) {
    script = null;
    running = false;
    if (text) app.toast(text);
  }

  function scriptHtml() {
    if (!script) return '';
    var tl = script.tl;
    var ai = GE.tasks.actionAt(tl, sim.time);
    var s = '<div class="sim-script"><b>Prüfablauf „' + esc(tl.name) + '“</b><br>';
    if (script.state === 'fail') {
      s += '<b>Hier weicht dein GRAFCET ab</b> (bei ' + fmtTime(sim.time) + '): ' + esc(script.failText) +
        '<br><span class="muted">„Start“ spielt den Ablauf weiter ab.</span>';
    } else if (script.state === 'end') {
      s += 'Der Prüfablauf ist zu Ende.';
    } else {
      s += 'Aktion ' + (ai + 1) + ' von ' + tl.actions.length + ': ' + esc(tl.actions[ai].label);
    }
    return s + '<div class="btn-row"><button data-script="end">Prüfablauf beenden</button></div></div>';
  }

  function releaseHeld() {
    if (!sim) return;
    var names = Object.keys(held);
    if (!names.length) return;
    held = {};
    names.forEach(function (n) { sim.setInput(n, 0); });
    afterInput();
  }

  // ------------------------------------------------------------ Bedienung

  function onPointerDown(e) {
    var b = e.target.closest('[data-in]');
    if (!b || !sim) return;
    var name = b.getAttribute('data-in');
    if (plantDriven[name]) {
      app.toast('„' + name + '“ wird von der Anlage gesetzt (' + plantDriven[name] + ').', 'warn');
      return;
    }
    if (M.varMeta(app.project, name).mode !== 'button') return;   // Schalter: über click
    e.preventDefault();
    if (running) {
      held[name] = true;
      setInput(name, 1);
    } else {
      // In der Pause rasten Taster ein, damit man einzeln weiterschalten kann
      setInput(name, sim.value(name) ? 0 : 1);
    }
  }

  function onClick(e) {
    if (!sim) return;
    var b = e.target.closest('button');
    if (!b) return;
    if (b.hasAttribute('data-in')) {
      var name = b.getAttribute('data-in');
      if (plantDriven[name]) return;
      var mode = M.varMeta(app.project, name).mode;
      // Taster mit der Maus laufen über pointerdown; Tastatur (detail 0) schaltet um
      if (mode === 'switch' || e.detail === 0) setInput(name, sim.value(name) ? 0 : 1);
      return;
    }
    if (b.hasAttribute('data-simview')) {
      GE.plcui.setSimView(b.getAttribute('data-simview'));
      update(true);
      return;
    }
    if (b.hasAttribute('data-script')) {
      endScript('');
      update(true);
      return;
    }
    if (b.hasAttribute('data-pact')) {
      plant.actions[+b.getAttribute('data-pact')].run(plantState);
      P.applySensors(plant, plantState, plantNames, sim);
      afterInput();
      return;
    }
    switch (b.id) {
      case 'simPlay': SU.togglePlay(); break;
      case 'simStep': SU.step(); break;
      case 'simReset': SU.reset(); break;
    }
  }

  function onInput(e) {
    var t = e.target;
    if (t.id === 'simSpeed') {
      speedIdx = +t.value;
      document.getElementById('simSpeedOut').textContent = fmtSpeed();
      update(false);
    } else if (t.hasAttribute('data-num')) {
      var v = U.parseNum(t.value);
      setInput(t.getAttribute('data-num'), isFinite(v) ? v : 0);
    }
  }

  function onChange(e) {
    var t = e.target;
    if (t.hasAttribute('data-initial')) {
      var vname = t.getAttribute('data-initial');
      var iv = String(t.value).trim();
      var num = iv === '' ? '' : U.parseNum(iv);
      var binary = sim.vars.numeric.indexOf(vname) < 0;   // Schalter/Taster kennen nur 0 und 1
      if (num !== '' && (isNaN(num) || (binary && num !== 0 && num !== 1))) {
        app.toast(binary ? 'Startwert von ' + vname + ': nur 0 oder 1.' : 'Startwert von ' + vname + ': bitte eine Zahl (z. B. 1,5).', 'warn');
        return;
      }
      app.history.run(function () { M.setVarMeta(app.project, vname, { initial: num }); });
      app.toast('Startwert gespeichert – wirkt beim nächsten Zurücksetzen.');
      return;
    }
    if (t.hasAttribute('data-comment')) {
      app.history.run(function () { M.setVarMeta(app.project, t.getAttribute('data-comment'), { comment: t.value.trim() }); });
      app.updateToolbar();
      buildIo();
    } else if (t.hasAttribute('data-mode')) {
      app.history.run(function () { M.setVarMeta(app.project, t.getAttribute('data-mode'), { mode: t.value }); });
      buildIo();
    } else if (t.id === 'plantSelect') {
      app.history.run(function () {
        app.project.plant = t.value ? { id: t.value, map: {}, options: {} } : null;
      });
      running = false;
      SU.enter();
    } else if (t.hasAttribute('data-map')) {
      app.history.run(function () { app.project.plant.map[t.getAttribute('data-map')] = t.value; });
      running = false;
      SU.enter();
    } else if (t.hasAttribute('data-opt')) {
      app.history.run(function () { app.project.plant.options[t.getAttribute('data-opt')] = t.value; });
      running = false;
      SU.enter();
    }
  }

  SU.togglePlay = function () {
    if (!sim) return;
    if (sim.error) return app.toast('Erst zurücksetzen: die Simulation wurde wegen einer Endlosschleife angehalten.', 'warn');
    if (script && script.state === 'end') endScript('');   // danach frei weitersimulieren
    running = !running;
    if (!running) releaseHeld();
    update(true);
  };

  SU.step = function () {
    if (!sim) return;
    running = false;
    var fired = sim.stepOnce();
    if (sim.error) app.toast('Die Simulation ist wegen einer Endlosschleife angehalten. Mit „Zurücksetzen“ beginnt sie neu.', 'warn');
    else if (!fired) app.toast('Keine Transition schaltbar. Ändere einen Eingang oder lass die Zeit laufen (Start).');
    update(true);
  };

  SU.reset = function () {
    if (!sim) return;
    running = false;
    resetSim();
    app.toast('Simulation zurückgesetzt');
  };

  function fmtSpeed() {
    var s = SPEEDS[speedIdx];
    return (s < 1 ? String(s).replace('.', ',') : s) + '×';
  }

  function fmtTime(ms) {
    return (ms / 1000).toFixed(1).replace('.', ',') + ' s';
  }

  // ------------------------------------------------------------ Panel aufbauen

  function buildPanel() {
    var opts = '<option value="">keine Anlage</option>' + P.list.map(function (p) {
      return '<option value="' + p.id + '"' + (plant && plant.id === p.id ? ' selected' : '') + '>' + esc(p.title) + '</option>';
    }).join('');
    panel.innerHTML =
      '<div class="sim-controls">' +
      '<button id="simPlay" class="primary" title="Start/Pause (P)"></button>' +
      '<button id="simStep" title="Genau einen Evolutionsschritt ausführen (E)">Einzelschritt</button>' +
      '<button id="simReset" title="Anfangssituation herstellen (R)">Zurücksetzen</button>' +
      '</div>' +
      '<label class="speed">Geschwindigkeit <input type="range" id="simSpeed" min="0" max="' + (SPEEDS.length - 1) +
      '" step="1" value="' + speedIdx + '"> <output id="simSpeedOut">' + fmtSpeed() + '</output></label>' +
      '<div class="sim-status" id="simStatus"></div>' +
      '<span class="sr-only" id="simSay" aria-live="polite"></span>' +
      '<div class="seg sim-view" role="group" aria-label="Ansicht"><button data-simview="grafcet" title="GRAFCET-Zeichnung">GRAFCET</button>' +
      '<button data-simview="fbd" title="SPS-Programm als FUP mit den aktuellen Signalen">FUP live</button>' +
      '<button data-simview="ld" title="SPS-Programm als KOP mit Stromfluss">KOP live</button></div>' +
      '<div class="sim-legend" aria-label="Legende"><span><i class="lg-active"></i>aktiver Schritt</span>' +
      '<span><i class="lg-enabled"></i>Transition freigegeben</span><span><i class="lg-fireable"></i>schaltbar</span></div>' +
      '<div id="simMsg"></div>' +
      '<h3>Eingänge</h3><div class="io-list" id="simInputs"></div>' +
      '<h3>Ausgänge und Merker</h3><div class="io-list" id="simOutputs"></div>' +
      '<h3>Anlage</h3>' +
      '<select id="plantSelect" class="full" aria-label="Virtuelle Anlage">' + opts + '</select>' +
      '<div id="plantBox"></div>' +
      '<details class="sim-sec" open><summary>Variablentabelle</summary><div id="varTable"></div></details>' +
      '<details class="sim-sec"><summary>Protokoll der Schaltvorgänge</summary><ol class="sim-log" id="simLog"></ol></details>';
    buildIo();
    buildPlant();
  }

  /** Eingänge, Ausgänge und Variablentabelle (Struktur; Werte über update). */
  function buildIo() {
    if (!sim) return;
    var v = sim.vars;
    var proj = app.project;
    var ins = v.inputs.map(function (n) {
      var meta = M.varMeta(proj, n);
      if (v.numeric.indexOf(n) >= 0 && !plantDriven[n]) {
        return '<label class="io in num"><b>' + esc(n) + '</b><input type="number" data-num="' + esc(n) + '" value="' + (sim.value(n) || 0) + '">' +
          (meta.comment ? '<span class="io-comment">' + esc(meta.comment) + '</span>' : '') + '</label>';
      }
      var kind = plantDriven[n] ? 'Anlage' : meta.mode === 'button' ? 'Taster' : 'Schalter';
      return '<button class="io in' + (plantDriven[n] ? ' plant' : '') + '" data-in="' + esc(n) + '" data-v="' + esc(n) + '" title="' +
        esc(plantDriven[n] ? 'Wird von der Anlage gesetzt: ' + plantDriven[n] : kind + ' – anklicken') + '">' +
        '<span class="lamp"></span><b>' + esc(n) + '</b><span class="io-kind">' + kind + '</span>' +
        (meta.comment || plantDriven[n] ? '<span class="io-comment">' + esc(meta.comment || plantDriven[n]) + '</span>' : '') + '</button>';
    }).join('');
    document.getElementById('simInputs').innerHTML = ins || '<p class="muted">Keine Eingänge in den Bedingungen.</p>';

    var outs = v.outputs.concat(v.memories).map(function (n) {
      var meta = M.varMeta(proj, n);
      var kind = v.counters.indexOf(n) >= 0 ? 'Zähler' : v.memories.indexOf(n) >= 0 ? 'gespeichert' : 'Ausgang';
      return '<div class="io out" data-v="' + esc(n) + '"><span class="lamp"></span><b>' + esc(n) + '</b>' +
        '<span class="io-kind">' + kind + '</span>' + (v.counters.indexOf(n) >= 0 || v.numeric.indexOf(n) >= 0 ? '<span class="io-val"></span>' : '') +
        (meta.comment ? '<span class="io-comment">' + esc(meta.comment) + '</span>' : '') + '</div>';
    }).join('');
    document.getElementById('simOutputs').innerHTML = outs || '<p class="muted">Keine Aktionen vorhanden.</p>';

    var rows = [];
    v.inputs.forEach(function (n) {
      var meta = M.varMeta(proj, n);
      var art = plantDriven[n] ? 'Eingang (Anlage)' : v.numeric.indexOf(n) >= 0 ? 'Eingang (Zahl)'
        : '<select data-mode="' + esc(n) + '" aria-label="Art des Eingangs ' + esc(n) + '">' +
          '<option value="switch"' + (meta.mode !== 'button' ? ' selected' : '') + '>Schalter</option>' +
          '<option value="button"' + (meta.mode === 'button' ? ' selected' : '') + '>Taster</option></select>';
      rows.push(varRow(n, art, meta));
    });
    v.outputs.forEach(function (n) { rows.push(varRow(n, 'Ausgang', M.varMeta(proj, n))); });
    v.memories.forEach(function (n) {
      rows.push(varRow(n, v.counters.indexOf(n) >= 0 ? 'Zähler' : 'Merker (gespeichert)', M.varMeta(proj, n)));
    });
    document.getElementById('varTable').innerHTML = rows.length
      ? '<table class="vartable"><thead><tr><th>Name</th><th>Art</th><th>Wert</th><th title="Wert in der Grundstellung (beim Start und Zurücksetzen)">Start</th><th>Kommentar</th></tr></thead><tbody>' +
        rows.join('') + '</tbody></table>'
      : '<p class="muted">Noch keine Variablen.</p>';
    lastSig = '';
    update(true);
  }

  function varRow(n, art, meta) {
    var isInput = sim.vars.inputs.indexOf(n) >= 0 && !plantDriven[n];
    var start = isInput
      ? '<input class="start" type="number" step="1" data-initial="' + esc(n) + '" value="' + esc(meta.initial === undefined ? '' : meta.initial) + '" placeholder="0" aria-label="Startwert ' + esc(n) + '">'
      : '';
    return '<tr><td><b>' + esc(n) + '</b></td><td>' + art + '</td><td class="num" data-val="' + esc(n) + '"></td><td>' + start + '</td>' +
      '<td><input data-comment="' + esc(n) + '" value="' + esc(meta.comment || '') + '" placeholder="Bedeutung" aria-label="Kommentar zu ' + esc(n) + '"></td></tr>';
  }

  function buildPlant() {
    var box = document.getElementById('plantBox');
    if (!plant) {
      box.innerHTML = '<p class="muted">Ohne Anlage setzt du alle Eingänge selbst. Mit einer Anlage reagieren Sensoren auf die Ausgänge.</p>';
      return;
    }
    var cfg = app.project.plant;
    var vars = sim.vars;
    var s = '<p class="muted">' + esc(plant.description) + '</p>';
    (plant.options || []).forEach(function (o) {
      var cur = (cfg.options && cfg.options[o.id]) || o.values[0][0];
      s += '<label class="field"><span>' + esc(o.label) + '</span><select data-opt="' + o.id + '">' + o.values.map(function (v) {
        return '<option value="' + v[0] + '"' + (v[0] === cur ? ' selected' : '') + '>' + esc(v[1]) + '</option>';
      }).join('') + '</select></label>';
    });
    s += '<svg class="plant-svg" id="plantSvg" viewBox="0 0 300 210" role="img" aria-label="' + esc(plant.title) + '"></svg>';
    if (plant.actions.length) {
      s += '<div class="btn-row">' + plant.actions.map(function (a, i) {
        return '<button data-pact="' + i + '">' + esc(a.label) + '</button>';
      }).join('') + '</div>';
    }
    // Zuordnung Anlage <-> GRAFCET-Variablen
    var choices = { in: vars.inputs, out: vars.outputs.concat(vars.memories) };
    s += '<details class="sim-sec"><summary>Signalzuordnung</summary><table class="vartable"><tbody>' +
      plant.signals.map(function (sg) {
        var cur = plantNames[sg.id];
        var list = choices[sg.dir].slice();
        if (list.indexOf(cur) < 0) list.unshift(cur);
        return '<tr><td>' + esc(sg.label) + '<br><span class="muted">' + (sg.dir === 'in' ? 'Sensor → Eingang' : 'Ausgang → Anlage') + '</span></td>' +
          '<td><select data-map="' + sg.id + '">' + list.map(function (n) {
            var used = choices[sg.dir].indexOf(n) >= 0;
            return '<option value="' + esc(n) + '"' + (n === cur ? ' selected' : '') + '>' + esc(n) + (used ? '' : ' (nicht im GRAFCET)') + '</option>';
          }).join('') + '</select></td></tr>';
      }).join('') + '</tbody></table></details>';
    box.innerHTML = s;
  }

  // ------------------------------------------------------------ Anzeige aktualisieren

  function update(force) {
    if (!sim) return;
    // Zeichnung nur neu, wenn sich etwas Sichtbares geändert hat
    var info = sim.renderInfo();
    var sig = S.displaySignature(sim, info);
    if (force || sig !== lastSig) {
      lastSig = sig;
      GE.editor.render();
      GE.plcui.live(sim);
    }

    var play = document.getElementById('simPlay');
    if (!play) return;
    play.textContent = running ? '❚❚ Pause' : '▶ Start';
    play.classList.toggle('primary', !running);

    var state = sim.error ? 'angehalten' : sim.stable ? 'stabil' : 'instabil – Einzelschritt';
    // Screenreader: nur Zustandswechsel ansagen, nicht jede Zeitänderung
    var say = document.getElementById('simSay');
    var sayText = 'Simulation ' + (running ? 'läuft' : 'pausiert') + ', Situation ' + state;
    if (say && say.textContent !== sayText) say.textContent = sayText;
    document.getElementById('simStatus').innerHTML =
      '<span><b>' + fmtTime(sim.time) + '</b></span>' +
      '<span>' + (running ? 'läuft' : 'Pause') + ' · ' + fmtSpeed() + '</span>' +
      '<span title="' + state + '">Situation: <b class="' + (sim.stable && !sim.error ? 'ok' : 'warn') + '">' + state + '</b></span>' +
      '<span>' + sim.firings + ' Schaltvorgänge</span>';

    var msg = scriptHtml();
    if (sim.error) msg += '<div class="msg error">' + esc(sim.error) + ' Mit „Zurücksetzen“ beginnt sie neu.</div>';
    var errs = app.issues.filter(function (i) { return i.level === 'error'; }).length;
    if (errs) {
      msg += '<div class="msg warn">Die Zeichnung enthält ' + errs + ' Fehler (siehe Zeichnen → Prüfung). ' +
        'Die Simulation läuft trotzdem; fehlerhafte Bedingungen gelten als nicht erfüllt.</div>';
    }
    var box = document.getElementById('simMsg');
    if (box.innerHTML !== msg) box.innerHTML = msg;

    // Werte
    var els = panel.querySelectorAll('[data-v]');
    for (var i = 0; i < els.length; i++) {
      var n = els[i].getAttribute('data-v');
      var v = sim.value(n);
      els[i].classList.toggle('on', !!v);
      if (els[i].hasAttribute('data-in')) els[i].setAttribute('aria-pressed', v ? 'true' : 'false');
      var vEl = els[i].querySelector('.io-val');
      if (vEl) vEl.textContent = String(v);
    }
    var cells = panel.querySelectorAll('[data-val]');
    for (var j = 0; j < cells.length; j++) cells[j].textContent = String(sim.value(cells[j].getAttribute('data-val')));
    var nums = panel.querySelectorAll('[data-num]');
    for (var k = 0; k < nums.length; k++) {
      if (document.activeElement !== nums[k]) nums[k].value = sim.value(nums[k].getAttribute('data-num'));
    }

    // Anlage
    var psvg = document.getElementById('plantSvg');
    if (psvg && plant) {
      psvg.innerHTML = plant.draw(plantState, function (id) { return sim.value(plantNames[id]) ? 1 : 0; }, plantNames);
    }

    // Protokoll
    if (sim.log.length !== lastLogCount || force) {
      lastLogCount = sim.log.length;
      var log = document.getElementById('simLog');
      log.innerHTML = sim.log.slice(-40).reverse().map(function (e) {
        return '<li><span class="muted">' + fmtTime(e.time) + '</span> ' + e.fired.map(function (f) {
          return (f.name ? esc(f.name) + ' ' : '') + '„' + esc(f.cond || '?') + '“: ' + esc(f.from.join(', ')) + ' → ' + esc(f.to.join(', '));
        }).join('; ') + (e.transient ? '<br><span class="muted">' + e.transient.map(function (nm) {
          return 'Schritt ' + esc(nm) + ' nur durchlaufen – kontinuierliche Aktionen nicht ausgeführt';
        }).join('; ') + '</span>' : '') + '</li>';
      }).join('') || '<li class="muted">Noch keine Transition geschaltet.</li>';
    }

    var now = Date.now();
    if (force || now - lastTiming > 120) {
      lastTiming = now;
      drawTiming(force);
    }
  }

  // ------------------------------------------------------------ Zeitverlauf

  var ROW_H = 22;
  var LABEL_W = 70;

  function niceStep(span, px) {
    var steps = [100, 200, 500, 1000, 2000, 5000, 10000, 15000, 30000, 60000, 120000, 300000];
    var per = span / Math.max(1, px / 70);
    for (var i = 0; i < steps.length; i++) if (steps[i] >= per) return steps[i];
    return steps[steps.length - 1];
  }

  function drawTiming() {
    var svg = document.getElementById('timingSvg');
    var body = document.getElementById('timingBody');
    if (!sim || !svg || document.getElementById('timing').hidden) return;
    var sigs = sim.signals();
    var names = [];
    var numeric = {};
    sim.vars.counters.concat(sim.vars.numeric).forEach(function (n) { numeric[n] = true; });
    if (groups.inputs) names = names.concat(sigs.inputs);
    if (groups.outputs) names = names.concat(sigs.outputs);
    if (groups.steps) names = names.concat(sigs.steps);
    var W = Math.max(320, body.clientWidth - 2);
    var H = names.length * ROW_H + 26;
    var win = +document.getElementById('trWindow').value;
    var tEnd;
    var tStart;
    if (win) {
      tEnd = Math.max(sim.time, sim.traceStart + win);
      tStart = tEnd - win;
    } else {
      tStart = sim.traceStart;
      tEnd = Math.max(sim.time, tStart + 1000);
    }
    var plotW = W - LABEL_W - 12;
    var xOf = function (t) { return LABEL_W + (t - tStart) / (tEnd - tStart) * plotW; };
    var s = '';
    names.forEach(function (n, i) {
      var y0 = i * ROW_H;
      var hi = y0 + 4;
      var lo = y0 + ROW_H - 4;
      if (i % 2) s += '<rect class="tr-band" x="0" y="' + y0 + '" width="' + W + '" height="' + ROW_H + '"/>';
      s += '<text class="tr-label" x="6" y="' + (y0 + 15) + '">' + esc(n) + '</text>';
      var pts = sim.trace[n] || [];
      var cur = 0;
      var k = 0;
      while (k < pts.length && pts[k][0] <= tStart) { cur = pts[k][1]; k++; }
      var tNow = Math.min(sim.time, tEnd);
      var segs = [];   // [von, bis, wert]
      var from = Math.max(tStart, sim.traceStart);
      for (; k < pts.length && pts[k][0] <= tNow; k++) {
        segs.push([from, pts[k][0], cur]);
        from = pts[k][0];
        cur = pts[k][1];
      }
      segs.push([from, tNow, cur]);
      if (numeric[n]) {
        segs.forEach(function (g) {
          s += '<rect class="tr-num" x="' + U.n(xOf(g[0])) + '" y="' + hi + '" width="' + U.n(Math.max(0, xOf(g[1]) - xOf(g[0]))) + '" height="' + (lo - hi) + '"/>';
          if (xOf(g[1]) - xOf(g[0]) > 14) s += '<text class="tr-val" x="' + U.n(xOf(g[0]) + 4) + '" y="' + (y0 + 15) + '">' + g[2] + '</text>';
        });
      } else {
        var d = '';
        segs.forEach(function (g, gi) {
          var y = g[2] ? hi : lo;
          d += (gi ? 'V' + y : 'M' + U.n(xOf(g[0])) + ' ' + y) + ' H' + U.n(xOf(g[1]));
          if (g[2]) s += '<rect class="tr-hi" x="' + U.n(xOf(g[0])) + '" y="' + hi + '" width="' + U.n(Math.max(0, xOf(g[1]) - xOf(g[0]))) + '" height="' + (lo - hi) + '"/>';
        });
        s += '<path class="tr-line" d="' + d + '"/>';
      }
    });
    // Zeitachse
    var axisY = names.length * ROW_H + 4;
    var step = niceStep(tEnd - tStart, plotW);
    s += '<path class="tr-axis" d="M' + LABEL_W + ' ' + axisY + ' H' + (LABEL_W + plotW) + '"/>';
    for (var t = Math.ceil(tStart / step) * step; t <= tEnd; t += step) {
      var x = xOf(t);
      s += '<path class="tr-grid" d="M' + U.n(x) + ' 0 V' + axisY + '"/>' +
        '<text class="tr-tick" x="' + U.n(x) + '" y="' + (axisY + 15) + '" text-anchor="middle">' + (t / 1000).toString().replace('.', ',') + ' s</text>';
    }
    if (sim.time >= tStart && sim.time <= tEnd) {
      s += '<path class="tr-now" d="M' + U.n(xOf(sim.time)) + ' 0 V' + axisY + '"/>';
    }
    if (!names.length) s = '<text class="tr-label" x="10" y="18">Keine Signale ausgewählt.</text>';
    svg.setAttribute('width', W);
    svg.setAttribute('height', Math.max(H, 30));
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + Math.max(H, 30));
    svg.innerHTML = s;
  }
})(globalThis.GE = globalThis.GE || {});
