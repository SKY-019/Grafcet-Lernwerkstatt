/*
 * plants.js – Virtuelle Anlagen für die Simulation (ohne DOM).
 *
 * Jede Anlage beschreibt ihre Signale aus Sicht des GRAFCET:
 *   dir 'out' – Ausgang des GRAFCET, den die Anlage liest (Ventil, Motor …)
 *   dir 'in'  – Eingang des GRAFCET, den die Anlage setzt (Sensor)
 * Die Signale werden über eine Zuordnung mit Variablennamen verbunden;
 * vorgegeben sind übliche Namen (z. B. Y1, B1).
 *
 * Schnittstelle einer Anlage:
 *   create(options)              -> Zustand
 *   update(state, dt, out)       out(signalId) liefert den Ausgangswert
 *   sensors(state)               -> { signalId: 0|1 }
 *   draw(state, out, names)      -> SVG-Inhalt (viewBox 0 0 300 210)
 *   actions                      Knöpfe für Bedienhandlungen an der Anlage
 */
(function (GE) {
  'use strict';

  var P = (GE.plants = {});
  var U = GE.util;
  var esc = U.esc;
  var n = U.n;

  function lamp(x, y, on, label, anchor) {
    return '<circle class="pl-lamp' + (on ? ' on' : '') + '" cx="' + n(x) + '" cy="' + n(y) + '" r="6"/>' +
      (label ? '<text class="pl-text" x="' + n(anchor === 'end' ? x - 10 : x + 10) + '" y="' + n(y + 4) + '"' +
        (anchor === 'end' ? ' text-anchor="end"' : '') + '>' + esc(label) + '</text>' : '');
  }

  function valve(x, y, open, label) {
    // Ventilsymbol (zwei Dreiecke), gefüllt wenn offen
    return '<path class="pl-valve' + (open ? ' on' : '') + '" d="M' + (x - 9) + ' ' + (y - 6) + ' L' + (x + 9) + ' ' + (y + 6) +
      ' L' + (x + 9) + ' ' + (y - 6) + ' L' + (x - 9) + ' ' + (y + 6) + ' Z"/>' +
      '<text class="pl-text" x="' + x + '" y="' + (y - 11) + '" text-anchor="middle">' + esc(label) + '</text>';
  }

  // ------------------------------------------------------------ Tank

  var tank = {
    id: 'tank',
    title: 'Tank mit Füllstand',
    description: 'Zulaufventil füllt, Ablaufventil leert den Tank. Zwei Füllstandssensoren melden „unten“ und „oben“.',
    signals: [
      { id: 'fill', dir: 'out', name: 'Y1', label: 'Zulaufventil' },
      { id: 'drain', dir: 'out', name: 'Y2', label: 'Ablaufventil' },
      { id: 'mix', dir: 'out', name: 'M1', label: 'Rührwerk' },
      { id: 'low', dir: 'in', name: 'B1', label: 'Füllstand unten (ab 10 %)' },
      { id: 'high', dir: 'in', name: 'B2', label: 'Füllstand oben (ab 90 %)' }
    ],
    FILL_RATE: 12,   // Prozent je Sekunde
    DRAIN_RATE: 10,
    create: function () {
      return { level: 0, angle: 0 };
    },
    update: function (st, dt, out) {
      var s = dt / 1000;
      if (out('fill')) st.level += tank.FILL_RATE * s;
      if (out('drain')) st.level -= tank.DRAIN_RATE * s;
      st.level = U.clamp(st.level, 0, 100);
      if (out('mix')) st.angle = (st.angle + 360 * s) % 360;
    },
    sensors: function (st) {
      return { low: st.level >= 10 ? 1 : 0, high: st.level >= 90 ? 1 : 0 };
    },
    actions: [
      { label: 'Tank leeren', run: function (st) { st.level = 0; } },
      { label: 'Tank füllen', run: function (st) { st.level = 100; } }
    ],
    draw: function (st, out, names) {
      var sen = tank.sensors(st);
      var top = 40;
      var bottom = 180;
      var h = bottom - top;
      var ly = bottom - st.level / 100 * h;
      var s = '';
      // Zulauf
      s += '<path class="pl-pipe" d="M10 22 H120 V' + top + '"/>' + valve(60, 22, out('fill'), names.fill);
      if (out('fill')) s += '<path class="pl-stream" d="M120 ' + top + ' V' + n(ly) + '"/>';
      // Behälter
      s += '<rect class="pl-liquid" x="91" y="' + n(ly) + '" width="118" height="' + n(bottom - ly) + '"/>';
      s += '<rect class="pl-body" x="90" y="' + top + '" width="120" height="' + h + '"/>';
      // Ablauf
      s += '<path class="pl-pipe" d="M150 ' + bottom + ' V198 H290"/>' + valve(220, 198, out('drain'), names.drain);
      // Rührwerk
      var a = st.angle * Math.PI / 180;
      var dx = Math.cos(a) * 22;
      var dy = Math.sin(a) * 6;
      s += '<path class="pl-shaft" d="M150 30 V150"/>';
      s += '<path class="pl-blade' + (out('mix') ? ' on' : '') + '" d="M' + n(150 - dx) + ' ' + n(150 - dy) + ' L' + n(150 + dx) + ' ' + n(150 + dy) + '"/>';
      s += '<rect class="pl-motor' + (out('mix') ? ' on' : '') + '" x="138" y="18" width="24" height="14" rx="2"/>' +
        '<text class="pl-text" x="168" y="29">' + esc(names.mix) + '</text>';
      // Sensoren
      s += lamp(222, bottom - 0.9 * h, sen.high, names.high + ' oben');
      s += lamp(222, bottom - 0.1 * h, sen.low, names.low + ' unten');
      s += '<text class="pl-value" x="20" y="120">' + Math.round(st.level) + ' %</text>';
      return s;
    }
  };

  // ------------------------------------------------------------ Zylinder

  function cylDraw(x0, y, pos, sOut, sIn, b1, b2, label, names, k, bistable) {
    var bodyX = 70;
    var bodyW = 120;
    var px = bodyX + 6 + pos * (bodyW - 20);
    var s = '<text class="pl-title" x="' + x0 + '" y="' + (y - 22) + '">' + label + '</text>';
    // Ventilspulen
    s += '<rect class="pl-coil' + (sOut ? ' on' : '') + '" x="' + x0 + '" y="' + (y - 14) + '" width="40" height="13" rx="2"/>' +
      '<text class="pl-small" x="' + (x0 + 20) + '" y="' + (y - 4) + '" text-anchor="middle">' + esc(names[k + 'out']) + '</text>';
    if (bistable) {
      s += '<rect class="pl-coil' + (sIn ? ' on' : '') + '" x="' + x0 + '" y="' + (y + 2) + '" width="40" height="13" rx="2"/>' +
        '<text class="pl-small" x="' + (x0 + 20) + '" y="' + (y + 12) + '" text-anchor="middle">' + esc(names[k + 'in']) + '</text>';
    } else {
      s += '<text class="pl-small" x="' + (x0 + 20) + '" y="' + (y + 12) + '" text-anchor="middle">Feder</text>';
    }
    s += '<rect class="pl-body" x="' + bodyX + '" y="' + (y - 16) + '" width="' + bodyW + '" height="32"/>';
    s += '<rect class="pl-piston" x="' + n(px) + '" y="' + (y - 14) + '" width="8" height="28"/>';
    s += '<rect class="pl-rod" x="' + n(px + 8) + '" y="' + (y - 4) + '" width="' + (bodyW + 4) + '" height="8"/>';
    s += '<rect class="pl-piston" x="' + n(px + bodyW + 12) + '" y="' + (y - 10) + '" width="6" height="20"/>';
    s += lamp(bodyX + 10, y + 28, b1, names[k + 'b1'], 'start');
    s += lamp(bodyX + bodyW - 10, y + 28, b2, names[k + 'b2'], 'end');
    return s;
  }

  var cylinder = {
    id: 'cylinder',
    title: 'Zwei Zylinder mit Endlagen',
    description: 'Zwei doppeltwirkende Zylinder 1A1 und 2A1 mit Endlagensensoren. Ventile wahlweise monostabil (Feder) oder bistabil (Impuls).',
    signals: [
      { id: 'c1out', dir: 'out', name: '1M1', label: 'Zylinder 1A1 ausfahren' },
      { id: 'c1in', dir: 'out', name: '1M2', label: 'Zylinder 1A1 einfahren (bistabil)' },
      { id: 'c1b1', dir: 'in', name: '1B1', label: 'Zylinder 1A1 eingefahren' },
      { id: 'c1b2', dir: 'in', name: '1B2', label: 'Zylinder 1A1 ausgefahren' },
      { id: 'c2out', dir: 'out', name: '2M1', label: 'Zylinder 2A1 ausfahren' },
      { id: 'c2in', dir: 'out', name: '2M2', label: 'Zylinder 2A1 einfahren (bistabil)' },
      { id: 'c2b1', dir: 'in', name: '2B1', label: 'Zylinder 2A1 eingefahren' },
      { id: 'c2b2', dir: 'in', name: '2B2', label: 'Zylinder 2A1 ausgefahren' }
    ],
    options: [
      { id: 'valve', label: 'Ventile', values: [['bi', 'bistabil (Impulsventil)'], ['mono', 'monostabil (Federrückstellung)']] }
    ],
    STROKE_MS: 1200,   // Zeit für einen vollen Hub
    create: function (opts) {
      return { valve: (opts && opts.valve) || 'bi', p1: 0, p2: 0, v1: 0, v2: 0 };
    },
    update: function (st, dt, out) {
      var step = dt / cylinder.STROKE_MS;
      [['c1', 'p1', 'v1'], ['c2', 'p2', 'v2']].forEach(function (c) {
        var o = out(c[0] + 'out');
        var i = out(c[0] + 'in');
        if (st.valve === 'mono') st[c[2]] = o ? 1 : 0;
        else if (o && !i) st[c[2]] = 1;
        else if (i && !o) st[c[2]] = 0;   // beide Spulen: Ventil bleibt, wie es ist
        var target = st[c[2]];
        var p = st[c[1]];
        if (p < target) st[c[1]] = Math.min(target, p + step);
        else if (p > target) st[c[1]] = Math.max(target, p - step);
      });
    },
    sensors: function (st) {
      return {
        c1b1: st.p1 <= 0.02 ? 1 : 0, c1b2: st.p1 >= 0.98 ? 1 : 0,
        c2b1: st.p2 <= 0.02 ? 1 : 0, c2b2: st.p2 >= 0.98 ? 1 : 0
      };
    },
    actions: [],
    draw: function (st, out, names) {
      var sen = cylinder.sensors(st);
      var bi = st.valve !== 'mono';
      return cylDraw(14, 62, st.p1, out('c1out'), out('c1in'), sen.c1b1, sen.c1b2, 'Zylinder 1A1', names, 'c1', bi) +
        cylDraw(14, 160, st.p2, out('c2out'), out('c2in'), sen.c2b1, sen.c2b2, 'Zylinder 2A1', names, 'c2', bi);
    }
  };

  // ------------------------------------------------------------ Förderband

  var conveyor = {
    id: 'conveyor',
    title: 'Förderband',
    description: 'Teile werden am Anfang aufgelegt und laufen bis zum Anschlag am Ende. Der Auswerfer schiebt ein Teil am Ende in die Ablage. ' +
      'Hält das Band an, bleiben Teile liegen, wo sie sind; „Vorderstes Teil entnehmen“ nimmt sie von Hand herunter.',
    signals: [
      { id: 'motor', dir: 'out', name: 'M1', label: 'Bandmotor' },
      { id: 'eject', dir: 'out', name: 'Y1', label: 'Auswerfer am Bandende' },
      { id: 'start', dir: 'in', name: 'B1', label: 'Lichtschranke Bandanfang' },
      { id: 'end', dir: 'in', name: 'B2', label: 'Lichtschranke Bandende' }
    ],
    SPEED: 25,       // Prozent der Bandlänge je Sekunde
    GAP: 14,         // Mindestabstand zwischen Teilen
    EJECT_MS: 400,   // Dauer des Auswerfens
    create: function () {
      return { parts: [], phase: 0, done: 0, eject: 0 };
    },
    update: function (st, dt, out) {
      var s = dt / 1000;
      if (out('motor')) {
        st.phase = (st.phase + conveyor.SPEED * s) % 10;
        // von vorne nach hinten bewegen, Teile stauen sich am Anschlag
        st.parts.sort(function (a, b) { return b.x - a.x; });
        var limit = 100;
        st.parts.forEach(function (p) {
          p.x = Math.min(p.x + conveyor.SPEED * s, limit);
          limit = p.x - conveyor.GAP;
        });
      }
      var atEnd = st.parts.filter(function (p) { return p.x >= 95; })[0];
      if (out('eject') && atEnd) {
        st.eject += dt;
        if (st.eject >= conveyor.EJECT_MS) {
          st.parts.splice(st.parts.indexOf(atEnd), 1);
          st.done++;
          st.eject = 0;
        }
      } else {
        st.eject = 0;
      }
    },
    sensors: function (st) {
      return {
        start: st.parts.some(function (p) { return p.x <= 12; }) ? 1 : 0,
        end: st.parts.some(function (p) { return p.x >= 95; }) ? 1 : 0
      };
    },
    actions: [
      {
        label: 'Teil auflegen',
        run: function (st) {
          if (st.parts.some(function (p) { return p.x < conveyor.GAP; })) return 'Am Bandanfang liegt schon ein Teil.';
          st.parts.push({ x: 0 });
        }
      },
      {
        // vorderstes Teil (am Ende oder liegen geblieben, wenn das Band vorher angehalten hat)
        label: 'Vorderstes Teil entnehmen',
        run: function (st) {
          if (!st.parts.length) return 'Auf dem Band liegt kein Teil.';
          var front = st.parts.reduce(function (a, b) { return b.x > a.x ? b : a; });
          st.parts.splice(st.parts.indexOf(front), 1);
        }
      }
    ],
    draw: function (st, out, names) {
      var sen = conveyor.sensors(st);
      var x0 = 30;
      var len = 220;
      var s = '';
      s += '<rect class="pl-belt" x="20" y="120" width="250" height="18" rx="9"/>';
      for (var i = 0; i < 25; i++) {
        var dx = 24 + ((i * 10 + st.phase) % 250);
        if (dx < 262) s += '<path class="pl-beltmark" d="M' + n(dx) + ' 121 v16"/>';
      }
      s += '<circle class="pl-roller" cx="29" cy="129" r="7"/><circle class="pl-roller' + (out('motor') ? ' on' : '') + '" cx="261" cy="129" r="7"/>';
      s += '<text class="pl-text" x="262" y="160" text-anchor="middle">' + esc(names.motor) + '</text>';
      s += '<rect class="pl-body" x="274" y="92" width="6" height="28"/>';   // Anschlag
      st.parts.forEach(function (p) {
        s += '<rect class="pl-part" x="' + n(x0 + p.x / 100 * len - 11) + '" y="96" width="22" height="22" rx="2"/>';
      });
      // Lichtschranken
      [[42, sen.start, names.start], [254, sen.end, names.end]].forEach(function (b) {
        s += '<rect class="pl-coil" x="' + (b[0] - 5) + '" y="58" width="10" height="10"/>' +
          '<path class="pl-beam' + (b[1] ? ' on' : '') + '" d="M' + b[0] + ' 68 V116"/>' +
          lamp(b[0], 44, b[1], b[2], b[0] > 150 ? 'end' : 'start');
      });
      // Auswerfer und Ablage
      var push = out('eject') ? 12 : 0;
      s += '<rect class="pl-piston' + (out('eject') ? ' on' : '') + '" x="' + (200 + push) + '" y="80" width="10" height="10"/>' +
        '<text class="pl-small" x="190" y="78" text-anchor="end">' + esc(names.eject) + '</text>';
      s += '<rect class="pl-body" x="200" y="172" width="80" height="30"/>' +
        '<text class="pl-text" x="240" y="192" text-anchor="middle">Ablage: ' + st.done + '</text>';
      return s;
    }
  };

  P.list = [tank, cylinder, conveyor];

  P.get = function (id) {
    for (var i = 0; i < P.list.length; i++) if (P.list[i].id === id) return P.list[i];
    return null;
  };

  /** Variablenname zu einem Signal (Zuordnung aus dem Projekt oder Vorgabe). */
  P.names = function (plant, map) {
    var res = {};
    plant.signals.forEach(function (sg) {
      res[sg.id] = (map && map[sg.id]) || sg.name;
    });
    return res;
  };

  /**
   * Verbindet Anlage und Simulator: Ausgänge lesen, Anlage bewegen,
   * Sensoren als Eingänge setzen.
   */
  P.step = function (plant, state, names, sim, dt) {
    var out = function (id) { return sim.value(names[id]) ? 1 : 0; };
    plant.update(state, dt, out);
    P.applySensors(plant, state, names, sim);
  };

  P.applySensors = function (plant, state, names, sim) {
    var sen = plant.sensors(state);
    Object.keys(sen).forEach(function (id) { sim.setInput(names[id], sen[id]); });
  };

  /** Sensorwerte als Eingangsbelegung (für den Start der Simulation). */
  P.sensorInputs = function (plant, state, names) {
    var sen = plant.sensors(state);
    var res = {};
    Object.keys(sen).forEach(function (id) { res[names[id]] = sen[id]; });
    return res;
  };
})(globalThis.GE = globalThis.GE || {});
