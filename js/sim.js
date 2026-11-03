/*
 * sim.js – Simulationskern für GRAFCET (ohne DOM, in Node testbar).
 *
 * Ablauf eines Zyklus (tick):
 *   1. Zeit weiterzählen, Eingänge sind vorher gesetzt worden.
 *   2. Aktionen bei Ereignis der aktiven Schritte auswerten.
 *   3. Evolution: Alle schaltbaren Transitionen schalten gleichzeitig
 *      (Regel 4). Zuerst werden die Vorgängerschritte deaktiviert, dann die
 *      Folgeschritte aktiviert (Regel 3). Ein Schritt, der gleichzeitig
 *      deaktiviert und aktiviert wird, bleibt aktiv (Regel 5).
 *      Speichernde Aktionen wirken sofort: erst die bei Deaktivierung, dann
 *      die bei Aktivierung.
 *   4. Solange danach weitere Transitionen schaltbar sind, wird ohne
 *      Zeitfortschritt weitergeschaltet (instabile Situation). Flanken von
 *      Eingängen gelten dabei nur im ersten Durchlauf.
 *   5. Erst in der stabilen Situation werden die kontinuierlichen und
 *      bedingten Aktionen zugewiesen (Ausgänge).
 *
 * Zwangssteuerungen (G2{5,6}, G2{INIT}, G2{*}, G2{}) haben Vorrang: Solange
 * der zwingende Schritt aktiv ist, wird der gezwungene Teil-GRAFCET in die
 * angegebene Situation gesetzt und entwickelt sich nicht selbst weiter.
 * Sie werden vor jedem Evolutionsschritt angewendet, wiederholt, bis sich
 * nichts mehr ändert (ein gezwungener Teil-GRAFCET kann selbst zwingen).
 *
 * Flanken (↑B1) vergleichen den aktuellen Wert mit dem Wert vor dem
 * jeweiligen Evolutionsschritt bzw. in der letzten stabilen Situation.
 * Zeiten (5s/X3, 5s/B1/2s) werden aus dem Zeitpunkt der letzten Änderung
 * der Variablen berechnet.
 */
(function (GE) {
  'use strict';

  var S = (GE.sim = {});
  var M = GE.model;
  var E = GE.expr;

  /** Höchstzahl an Evolutionsschritten ohne Zeitfortschritt (Endlosschleifen-Schutz). */
  S.LIMIT = 500;
  /** Höchstzahl gespeicherter Punkte im Zeitverlauf je Signal. */
  S.TRACE_MAX = 4000;

  function truthy(v) {
    return !!v;
  }

  /**
   * Variablen einer Seite nach Art:
   *   inputs   – kommen nur in Bedingungen vor (Eingänge)
   *   outputs  – werden kontinuierlich/bedingt zugewiesen (Ausgänge)
   *   memories – werden speichernd beeinflusst (Merker, auch Zähler)
   *   counters – werden gezählt (:= +1 / −1)
   *   numeric  – werden in Vergleichen benutzt (Zahlenwerte)
   *   steps    – Schrittvariablen X…
   */
  S.variables = function (page) {
    var stepVars = {};
    page.steps.forEach(function (s) { stepVars['X' + s.name] = s.id; });
    var assigned = {};
    var stored = {};
    var counters = {};
    var numeric = {};
    var used = {};
    page.steps.forEach(function (s) {
      s.actions.forEach(function (a) {
        if (!a.var || a.type === 'forcing') return;
        if (a.type === 'continuous' || a.type === 'conditional') assigned[a.var] = true;
        else {
          stored[a.var] = true;
          if (a.value === 'inc' || a.value === 'dec') counters[a.var] = true;
        }
      });
    });
    function scan(text) {
      var r = E.parse(text);
      if (!r.ok) return;
      E.walk(r.ast, function (n) {
        if (n.type === 'var') used[n.name] = true;
        if (n.type === 'timer') used[n.v] = true;
        if (n.type === 'cmp') {
          if (n.l.type === 'var') numeric[n.l.name] = true;
          if (n.r.type === 'var') numeric[n.r.name] = true;
        }
      });
    }
    page.transitions.forEach(function (t) { scan(t.cond); });
    page.steps.forEach(function (s) { s.actions.forEach(function (a) { if (a.cond) scan(a.cond); }); });
    var sort = function (o) { return Object.keys(o).sort(GE.util.naturalCompare); };
    var inputs = sort(used).filter(function (n) { return !stepVars[n] && !assigned[n] && !stored[n]; });
    return {
      inputs: inputs,
      outputs: sort(assigned).filter(function (n) { return !stored[n]; }),
      memories: sort(stored),
      mixed: sort(assigned).filter(function (n) { return stored[n]; }),
      counters: sort(counters),
      numeric: sort(numeric),
      steps: page.steps.map(function (s) { return 'X' + s.name; })
    };
  };

  // ------------------------------------------------------------ Simulator

  /**
   * @param {Object} page     GRAFCET-Seite
   * @param {Object} [inputs] Startwerte der Eingänge (z. B. Sensoren einer Anlage)
   */
  function Sim(page, inputs, opts) {
    this.page = page;
    this.recording = true;
    this.compile();
    this.reset(inputs, opts);
  }
  S.Sim = Sim;

  /** Bedingungen einmal parsen und Struktur vorbereiten. */
  Sim.prototype.compile = function () {
    var page = this.page;
    var self = this;
    this.stepIdByVar = {};
    this.stepById = {};
    page.steps.forEach(function (s) {
      self.stepIdByVar['X' + s.name] = s.id;
      self.stepById[s.id] = s;
    });
    var isStep = function (id) { return !!self.stepById[id]; };
    this.trans = page.transitions.map(function (t) {
      var r = E.parse(t.cond);
      return {
        t: t,
        pre: M.inLinks(page, t.id).map(function (l) { return l.from; }).filter(isStep),
        post: M.outLinks(page, t.id).map(function (l) { return l.to; }).filter(isStep),
        ast: r.ok ? r.ast : null
      };
    });
    this.acts = {};
    page.steps.forEach(function (s) {
      self.acts[s.id] = s.actions.filter(function (a) { return a.var; }).map(function (a) {
        var r = a.cond ? E.parse(a.cond) : null;
        return { a: a, ast: r && r.ok ? r.ast : null };
      });
    });
    this.vars = S.variables(page);

    // Teil-GRAFCETs und Zwangssteuerungen
    var partials = (page.frames || []).filter(function (fr) { return fr.kind === 'partial'; });
    this.frameById = {};
    this.frameSteps = {};     // Rahmen-id -> Schritt-ids (alles im Rahmen, auch eingebettet)
    partials.forEach(function (fr) {
      self.frameById[fr.id] = fr;
      self.frameSteps[fr.id] = page.steps.filter(function (s) { return M.frameContains(fr, M.anchorPoint(s)); }).map(function (s) { return s.id; });
    });
    // Transition -> Teil-GRAFCETs, in denen sie liegt (für die Sperre bei Zwang)
    this.transFrames = {};
    this.trans.forEach(function (tr) {
      self.transFrames[tr.t.id] = partials.filter(function (fr) { return M.frameContains(fr, tr.t); }).map(function (fr) { return fr.id; });
    });
    this.forcings = {};       // Schritt-id -> [{a, frame, mode, steps, label}]
    page.steps.forEach(function (s) {
      s.actions.forEach(function (a) {
        if (a.type !== 'forcing') return;
        var fr = partials.filter(function (x) { return x.name === a.target; })[0];
        if (!fr) return;
        var names = M.forceStepNames(a);
        var steps = self.frameSteps[fr.id].filter(function (id) { return names.indexOf(self.stepById[id].name) >= 0; });
        (self.forcings[s.id] = self.forcings[s.id] || []).push({ a: a, frame: fr.id, mode: a.forceMode, steps: steps, label: M.forcingLabel(a) });
      });
    });
    this.forced = {};

    // Makroschritte und einschließende Schritte
    this.macroEntry = {};
    this.macroExit = {};
    this.innerSteps = {};    // Schritt-id -> alle Schritte in seinem Rahmen (werden mit ihm deaktiviert)
    this.encInit = {};
    page.steps.forEach(function (s) {
      if (s.kind === 'macro') {
        var mp = M.macroParts(page, s.id);
        if (mp.entries[0]) self.macroEntry[s.id] = mp.entries[0].id;
        if (mp.exits[0]) self.macroExit[s.id] = mp.exits[0].id;
      }
      if (s.kind === 'enclosing') self.encInit[s.id] = M.enclosedInitSteps(page, s.id).map(function (x) { return x.id; });
      var own = M.ownedFrame(page, s.id);
      if (own) self.innerSteps[s.id] = M.frameMembers(page, own.id, true).filter(function (x) { return x.actions; }).map(function (x) { return x.id; });
    });
  };

  /**
   * Zwangssteuerungen der aktiven Schritte anwenden. Liefert true, wenn sich
   * dabei die Situation geändert hat. Gezwungene Teil-GRAFCETs stehen in this.forced.
   */
  Sim.prototype.applyForcing = function () {
    var self = this;
    var any = false;
    var forced = {};
    for (var round = 0; round < 20; round++) {
      var changed = false;
      forced = {};
      this.page.steps.forEach(function (s) {
        if (!self.active[s.id] || !self.forcings[s.id]) return;
        self.forcings[s.id].forEach(function (fo) {
          forced[fo.frame] = fo.label;
          self.actOn[fo.a.id] = true;
          if (fo.mode === 'freeze') return;   // Situation bleibt, wie sie ist
          var want = {};
          if (fo.mode === 'init') {
            self.frameSteps[fo.frame].forEach(function (id) { if (self.stepById[id].initial) want[id] = true; });
          } else if (fo.mode === 'steps') {
            fo.steps.forEach(function (id) { want[id] = true; });
          }
          // erst deaktivieren, dann aktivieren (wie bei der Evolution)
          self.frameSteps[fo.frame].forEach(function (id) {
            if (self.active[id] && !want[id]) { self.deactivate(id); changed = true; }
          });
          self.frameSteps[fo.frame].forEach(function (id) {
            if (!self.active[id] && want[id]) { self.activate(id); changed = true; }
          });
        });
      });
      if (!changed) break;
      any = true;
    }
    this.forced = forced;
    return any;
  };

  /**
   * Anfangssituation herstellen. opts.lazy: Ist die Anfangssituation instabil, wird
   * noch nicht weitergeschaltet – so lässt sie sich mit „Einzelschritt“ ansehen
   * (sonst liefe z. B. eine Endlosschleife schon beim Zurücksetzen ab).
   */
  Sim.prototype.reset = function (inputs, opts) {
    var self = this;
    this.time = 0;
    this.val = {};
    this.stored = {};
    this.assigned = {};
    this.active = {};
    this.tracks = {};
    this.actOn = {};
    this.firings = 0;
    this.log = [];
    this.error = null;
    this.stable = true;
    this.trace = {};
    this.traceStart = 0;
    Object.keys(inputs || {}).forEach(function (n) { self.val[n] = inputs[n]; });
    this.prev = this.snapshot();
    this.page.steps.forEach(function (s) {
      if (s.initial) self.activate(s.id);
    });
    this.prev = this.snapshot();
    if (opts && opts.lazy) {
      this.applyForcing();
      if (this.fireable().length) {
        this.stable = false;
        this.record();
        return;
      }
    }
    this.settle();
  };

  // ------------------------------------------------------------ Werte

  /** Momentaufnahme für Flanken- und Zeitauswertung. */
  Sim.prototype.snapshot = function () {
    var tr = {};
    var self = this;
    Object.keys(this.tracks).forEach(function (k) {
      tr[k] = { since: self.tracks[k].since, lastHigh: self.tracks[k].lastHigh };
    });
    return { val: Object.assign({}, this.val), active: Object.assign({}, this.active), tracks: tr, time: this.time };
  };

  /** Wert einer Variablen in einem Zustand (aktuell oder Momentaufnahme). */
  Sim.prototype.get = function (st, name) {
    var sid = this.stepIdByVar[name];
    if (sid) return st.active[sid] ? 1 : 0;
    return st.val[name] || 0;
  };

  Sim.prototype.value = function (name) {
    return this.get(this, name);
  };

  /** Zeitpunkt der letzten Änderung merken (für Zeitbedingungen). */
  Sim.prototype.track = function (name, oldV, newV) {
    var tr = this.tracks[name] || (this.tracks[name] = { since: 0, lastHigh: 0 });
    if (truthy(oldV) === truthy(newV)) return;
    if (truthy(oldV)) tr.lastHigh = this.time - tr.since;
    tr.since = this.time;
  };

  Sim.prototype.setVal = function (name, v) {
    var old = this.val[name] || 0;
    if (old === v) return;
    this.val[name] = v;
    this.track(name, old, v);
  };

  /** Eingang setzen (Schalter, Taster, Sensor einer Anlage). */
  Sim.prototype.setInput = function (name, v) {
    this.setVal(name, typeof v === 'boolean' ? (v ? 1 : 0) : v);
  };

  /** Ausgang einer Zeitbedingung t1/v/t2. */
  Sim.prototype.timerOut = function (st, n) {
    var on = truthy(this.get(st, n.v));
    var tr = st.tracks[n.v] || { since: 0, lastHigh: 0 };
    if (on) return st.time - tr.since >= n.t1;
    return n.t2 > 0 && tr.lastHigh >= n.t1 && st.time - tr.since < n.t2;
  };

  /** Bedingung auswerten; prevSt ist der Vergleichszustand für Flanken. */
  Sim.prototype.evaluate = function (n, st, prevSt) {
    var self = this;
    switch (n.type) {
      case 'const': return n.value ? 1 : 0;
      case 'num': return n.value;
      case 'var': return this.get(st, n.name);
      case 'not': return truthy(this.evaluate(n.a, st, prevSt)) ? 0 : 1;
      case 'and': return n.items.every(function (x) { return truthy(self.evaluate(x, st, prevSt)); }) ? 1 : 0;
      case 'or': return n.items.some(function (x) { return truthy(self.evaluate(x, st, prevSt)); }) ? 1 : 0;
      case 'edge':
        if (!prevSt) return 0;
        var now = truthy(this.evaluate(n.a, st, null));
        var before = truthy(this.evaluate(n.a, prevSt, null));
        return (n.dir === 'up' ? now && !before : !now && before) ? 1 : 0;
      case 'timer': return this.timerOut(st, n) ? 1 : 0;
      case 'tsince': return 0; // mehrdeutige Kurzform: nie erfüllt (Prüfung meldet einen Fehler)
      case 'cmp':
        var a = +this.evaluate(n.l, st, prevSt);
        var b = +this.evaluate(n.r, st, prevSt);
        switch (n.op) {
          case '>': return a > b ? 1 : 0;
          case '<': return a < b ? 1 : 0;
          case '>=': return a >= b ? 1 : 0;
          case '<=': return a <= b ? 1 : 0;
          case '=': return a === b ? 1 : 0;
          case '<>': return a !== b ? 1 : 0;
        }
    }
    return 0;
  };

  Sim.prototype.test = function (ast) {
    return !!ast && truthy(this.evaluate(ast, this, this.prev));
  };

  // ------------------------------------------------------------ Transitionen

  /** Transitionen, deren Vorgängerschritte alle aktiv sind. */
  Sim.prototype.enabled = function () {
    var self = this;
    return this.trans.filter(function (tr) {
      // Nach einem Makroschritt erst freigegeben, wenn sein Ausgangsschritt aktiv ist
      return tr.pre.length && tr.pre.every(function (id) {
        return self.active[id] && (!self.macroExit[id] || self.active[self.macroExit[id]]);
      });
    });
  };

  /** Freigegeben und Bedingung erfüllt. */
  Sim.prototype.fireable = function () {
    var self = this;
    return this.enabled().filter(function (tr) {
      // gezwungene Teil-GRAFCETs entwickeln sich nicht selbst
      var blocked = (self.transFrames[tr.t.id] || []).some(function (fid) { return self.forced[fid]; });
      return !blocked && self.test(tr.ast);
    });
  };

  // ------------------------------------------------------------ Aktionen

  Sim.prototype.applyStored = function (a) {
    var cur = this.stored[a.var] || 0;
    var v;
    if (a.value === 'inc') v = cur + 1;
    else if (a.value === 'dec') v = cur - 1;
    else v = a.value === '1' ? 1 : 0;
    this.stored[a.var] = v;
    this.setVal(a.var, this.assigned[a.var] ? 1 : v);
  };

  Sim.prototype.activate = function (id) {
    if (this.active[id]) return;
    var s = this.stepById[id];
    this.active[id] = true;
    this.track('X' + s.name, 0, 1);
    var self = this;
    this.acts[id].forEach(function (x) {
      if (x.a.type === 'stored' && x.a.when !== 'deactivation') self.applyStored(x.a);
    });
    // Makroschritt: Eingangsschritt der Expansion aktivieren; einschließender Schritt: markierte Schritte
    if (this.macroEntry[id]) this.activate(this.macroEntry[id]);
    (this.encInit[id] || []).forEach(function (sid) { self.activate(sid); });
  };

  Sim.prototype.deactivate = function (id) {
    if (!this.active[id]) return;
    var s = this.stepById[id];
    delete this.active[id];
    this.track('X' + s.name, 1, 0);
    var self = this;
    this.acts[id].forEach(function (x) {
      if (x.a.type === 'stored' && x.a.when === 'deactivation') self.applyStored(x.a);
    });
    // Expansion bzw. eingeschlossener Inhalt wird mit deaktiviert
    (this.innerSteps[id] || []).forEach(function (sid) { self.deactivate(sid); });
  };

  /** Aktionen bei Ereignis der aktiven Schritte (einmal je Zyklus). */
  Sim.prototype.runEvents = function () {
    var self = this;
    this.page.steps.forEach(function (s) {
      if (!self.active[s.id]) return;
      self.acts[s.id].forEach(function (x) {
        if (x.a.type === 'event' && self.test(x.ast)) self.applyStored(x.a);
      });
    });
  };

  /** Kontinuierliche und bedingte Aktionen zuweisen (nur in stabiler Situation). */
  Sim.prototype.computeOutputs = function () {
    var self = this;
    var asg = {};
    this.vars.outputs.concat(this.vars.mixed).forEach(function (n) { asg[n] = 0; });
    this.actOn = {};
    // wirksame Zwangssteuerungen anzeigen
    this.page.steps.forEach(function (s) {
      if (self.active[s.id] && self.forcings[s.id]) self.forcings[s.id].forEach(function (fo) { self.actOn[fo.a.id] = true; });
    });
    this.page.steps.forEach(function (s) {
      if (!self.active[s.id]) return;
      self.acts[s.id].forEach(function (x) {
        var a = x.a;
        if (a.type !== 'continuous' && a.type !== 'conditional') return;
        if (a.type === 'continuous' || self.test(x.ast)) {
          asg[a.var] = 1;
          self.actOn[a.id] = true;
        }
      });
    });
    this.assigned = asg;
    Object.keys(asg).forEach(function (n) {
      self.setVal(n, asg[n] ? 1 : (self.stored[n] || 0));
    });
  };

  // ------------------------------------------------------------ Evolution

  /**
   * Ein Evolutionsschritt: alle schaltbaren Transitionen gleichzeitig.
   * @returns {Array|null} geschaltete Transitionen
   */
  Sim.prototype.evolveOnce = function () {
    var fire = this.fireable();
    if (!fire.length) return null;
    var before = this.snapshot();
    var deact = {};
    var act = {};
    fire.forEach(function (tr) {
      tr.pre.forEach(function (id) { deact[id] = true; });
      tr.post.forEach(function (id) { act[id] = true; });
    });
    var self = this;
    // Reihenfolge der Wirkung: erst deaktivieren, dann aktivieren
    this.page.steps.forEach(function (s) {
      if (deact[s.id] && !act[s.id]) self.deactivate(s.id);
    });
    this.page.steps.forEach(function (s) {
      if (act[s.id]) self.activate(s.id);   // bereits aktive Schritte bleiben aktiv (Regel 5)
    });
    this.prev = before;
    this.firings++;
    this.log.push({
      time: this.time,
      fired: fire.map(function (tr) {
        return {
          id: tr.t.id,
          name: tr.t.name,
          cond: tr.t.cond,
          from: tr.pre.map(function (id) { return self.stepById[id].name; }),
          to: tr.post.map(function (id) { return self.stepById[id].name; })
        };
      })
    });
    if (this.log.length > 200) this.log.shift();
    return fire;
  };

  /**
   * Bis zur stabilen Situation weiterschalten. Durchlaufschritte (in dieser Auswertung
   * aktiviert und gleich wieder verlassen) stehen danach als transient im letzten
   * Protokolleintrag – ihre kontinuierlichen Aktionen wurden nicht ausgeführt.
   */
  Sim.prototype.settle = function () {
    var logStart = this.log.length;
    var guard = 0;
    for (;;) {
      this.applyForcing();
      while (this.evolveOnce()) {
        this.applyForcing();
        if (++guard > S.LIMIT) return this.fail();
      }
      this.computeOutputs();
      if (!this.fireable().length) break;   // Ausgänge können neue Transitionen freigeben
      if (++guard > S.LIMIT) return this.fail();
    }
    this.stable = true;
    this.markTransient(logStart);
    this.prev = this.snapshot();
    this.record();
  };

  /** Durchlaufschritte seit Protokolleintrag logStart am letzten Eintrag vermerken. */
  Sim.prototype.markTransient = function (logStart) {
    if (this.log.length <= logStart) return;
    var self = this;
    var seen = {};
    var names = [];
    this.log.slice(logStart).forEach(function (e) {
      e.fired.forEach(function (f) {
        f.to.forEach(function (nm) {
          if (seen[nm]) return;
          seen[nm] = true;
          var st = M.stepByName(self.page, nm);
          if (st && !self.active[st.id]) names.push(nm);
        });
      });
    });
    if (names.length) this.log[this.log.length - 1].transient = names;
  };

  Sim.prototype.fail = function () {
    this.error = 'Die Situation wird nicht stabil: Transitionen schalten ohne Ende im Kreis ' +
      '(z. B. eine Schleife, deren Bedingungen alle erfüllt sind). Die Simulation wurde angehalten.';
    this.stable = false;
    this.record();
  };

  /** Zeit um dt Millisekunden weiterlaufen lassen und auswerten. */
  Sim.prototype.tick = function (dt) {
    if (this.error) return;
    dt = isFinite(dt) && dt > 0 ? +dt : 0;   // nie rückwärts
    if (!this.stable && dt) {
      // eine instabile Situation (nach Einzelschritt oder Zurücksetzen) zuerst ohne Zeitfortschritt auflösen
      this.settle();
      if (this.error) return;
    }
    this.time += dt || 0;
    this.runEvents();
    this.settle();
  };

  /**
   * Einzelschritt: genau ein Evolutionsschritt ohne Zeitfortschritt.
   * @returns {Array|null} geschaltete Transitionen oder null
   */
  Sim.prototype.stepOnce = function () {
    if (this.error) return null;
    if (this.stable) this.runEvents();
    this.applyForcing();
    var fired = this.evolveOnce();
    this.applyForcing();
    if (!this.fireable().length) {
      this.computeOutputs();
      if (!this.fireable().length) {
        this.stable = true;
        this.prev = this.snapshot();
      } else {
        this.stable = false;
      }
    } else {
      this.stable = false;
    }
    this.record();
    return fired;
  };

  // ------------------------------------------------------------ Aufzeichnung

  /** Alle Signale für den Zeitverlauf (Eingänge, Ausgänge, Merker, Schritte). */
  Sim.prototype.signals = function () {
    var v = this.vars;
    return { inputs: v.inputs, outputs: v.outputs.concat(v.memories), steps: v.steps };
  };

  Sim.prototype.record = function () {
    if (!this.recording) return;
    var self = this;
    var sig = this.signals();
    sig.inputs.concat(sig.outputs, sig.steps).forEach(function (n) {
      var v = self.value(n);
      var list = self.trace[n] || (self.trace[n] = []);
      var last = list[list.length - 1];
      if (last && last[1] === v) return;
      if (last && last[0] === self.time) list.pop();   // Wechsel im selben Augenblick zusammenfassen
      var prev = list[list.length - 1];
      if (prev && prev[1] === v) return;
      list.push([self.time, v]);
      if (list.length > S.TRACE_MAX) list.splice(0, list.length - S.TRACE_MAX);
    });
  };

  Sim.prototype.clearTrace = function () {
    this.trace = {};
    this.traceStart = this.time;
    this.record();
  };

  /**
   * Kennung dessen, was die Zeichnung in der Simulation zeigt (aktive Schritte, Freigaben,
   * Werte, Fortschritt der Zeitbalken in 1/50-Schritten). Ändert sie sich, wird neu gezeichnet.
   */
  S.displaySignature = function (sim, info) {
    info = info || sim.renderInfo();
    return Object.keys(info.active).join() + '|' + Object.keys(info.enabled).join() + '|' + Object.keys(info.fireable).join() + '|' +
      Object.keys(info.actOn).join() + '|' + sim.vars.inputs.concat(sim.vars.outputs, sim.vars.memories).map(function (n) {
        return sim.value(n) ? 1 : 0;
      }).join('') + '|' + Object.keys(info.timers).map(function (id) {
        return id + ':' + Math.floor(Math.min(1, info.timers[id].ratio) * 50);
      }).join();
  };

  Sim.prototype.renderInfo = function () {
    var self = this;
    var enabled = {};
    var fireable = {};
    this.enabled().forEach(function (tr) {
      enabled[tr.t.id] = true;
      if (self.test(tr.ast)) fireable[tr.t.id] = true;
    });
    // Laufende Zeitbedingungen (für Balken in der Zeichnung)
    var timers = {};
    function fmt(ms) { return (ms / 1000).toFixed(1).replace('.', ','); }
    function progress(ast) {
      if (!ast) return null;
      var res = null;
      E.walk(ast, function (nd) {
        if (res || nd.type !== 'timer' || nd.t1 <= 0) return;
        if (!self.value(nd.v)) return;
        var tr = self.tracks[nd.v] || { since: 0 };
        var el = self.time - tr.since;
        res = { ratio: el / nd.t1, text: fmt(Math.min(el, nd.t1)) + ' / ' + fmt(nd.t1) + ' s' };
      });
      return res;
    }
    this.enabled().forEach(function (tr) {
      var pr = progress(tr.ast);
      if (pr) timers[tr.t.id] = pr;
    });
    this.page.steps.forEach(function (s) {
      if (!self.active[s.id]) return;
      self.acts[s.id].forEach(function (x) {
        if (x.a.type !== 'conditional') return;
        var pr = progress(x.ast);
        if (pr) timers[x.a.id] = pr;
      });
    });
    return {
      timers: timers,
      active: this.active,
      forced: this.forced,
      enabled: enabled,
      fireable: fireable,
      actOn: this.actOn,
      truth: function (name) { return truthy(self.value(name)); }
    };
  };
})(globalThis.GE = globalThis.GE || {});
