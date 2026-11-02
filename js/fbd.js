/*
 * fbd.js – Darstellung der SPS-Netzwerke (plc.js) als Funktionsplan (FUP), ohne DOM.
 *
 * Jedes Netzwerk wird als eigenes SVG gezeichnet: links die Eingänge, in der
 * Mitte die Verknüpfungen (& = UND, ≥1 = ODER, Negation als Kreis am Eingang),
 * rechts der Ausgangsbaustein (SR, Zuweisung, ADD/SUB/MOVE). Zeiten (TON/TOF)
 * und Flanken (R_TRIG/F_TRIG) erscheinen als Bausteine mit Instanznamen darüber.
 * Mit opts.value (Wert je Knoten) und opts.variable (Wert je Variable) werden
 * Leitungen mit dem Wert 1 eingefärbt (Live-Ansicht in der Simulation).
 */
(function (GE) {
  'use strict';

  var F = (GE.fbd = {});
  var U = GE.util;

  var ROW = 26;       // Höhe einer Eingangszeile
  var GAP = 24;       // Leitung zwischen zwei Bausteinen
  var BW = 46;        // Breite eines Verknüpfungsbausteins
  var FBW = 64;       // Breite eines Funktionsbausteins (TON, SR …)
  var TITLE = 18;     // Kopfzeile im Baustein (&, ≥1, TON …)
  var INST = 16;      // Platz für den Instanznamen über dem Baustein
  var FS = 13;        // Schriftgröße
  var NEG = 4;        // Radius des Negationskreises
  var PAD = 12;       // Rand um das Netzwerk

  var esc = U.esc;
  function n(x) { return U.n(x); }
  function tw(s, size) { return U.textWidth(s, size || FS); }

  var CMP_NAME = { '>': 'GT', '<': 'LT', '>=': 'GE', '<=': 'LE', '=': 'EQ', '<>': 'NE' };

  /** Negationen abstreifen: liefert den Knoten und ob eine Negation übrig bleibt. */
  function unneg(node) {
    var neg = false;
    while (node && node.op === 'not') { neg = !neg; node = node.a; }
    return { node: node, neg: neg };
  }

  function wire(ctx, node, x1, y, x2) {
    var on = ctx.value && node ? ctx.value(node) : 0;
    return '<path class="w' + (on ? ' on' : '') + '" d="M' + n(x1) + ' ' + n(y) + 'H' + n(x2) + '"/>';
  }

  /** Blatt: Variable, Konstante, Zahl, Zeitwert. */
  function leaf(label, node) {
    var w = tw(label) + 10;
    return {
      w: w, h: ROW, out: ROW / 2,
      draw: function (xr, y0, ctx) {
        var on = ctx.value && node && node.op === 'var' ? ctx.value(node) : 0;
        return '<text class="lbl' + (on ? ' on' : '') + '" x="' + n(xr - 5) + '" y="' + n(y0 + ROW / 2 + 4.5) + '" text-anchor="end">' + esc(label) + '</text>';
      }
    };
  }

  /**
   * Baustein mit Eingängen.
   * @param {Object} o title, inst (Instanzname), width, pins [{name, node, neg, label}], outName, outAtFirst
   */
  function block(o) {
    var head = o.inst ? INST : 0;
    var slots = o.pins.map(function (p) {
      var l = p.layout || (p.node ? layout(p.node) : null);
      return { p: p, l: l, h: Math.max(ROW, l ? l.h : ROW) };
    });
    var bw = o.width || BW;
    var top = head + TITLE;
    var y = top;
    slots.forEach(function (s) { s.top = y; s.pinY = y + (s.l ? s.l.out : ROW / 2); y += s.h; });
    var h = y + 4;
    var childW = Math.max.apply(null, slots.map(function (s) { return s.l ? s.l.w : 0; }).concat([0]));
    var out = o.outAtFirst && slots.length ? slots[0].pinY : (head + (slots.length ? (slots[0].pinY + slots[slots.length - 1].pinY) / 2 - head : TITLE));
    return {
      w: childW + (childW ? GAP : 0) + bw, h: h, out: out,
      draw: function (xr, y0, ctx) {
        var bx = xr - bw;
        var s = '<rect class="box" x="' + n(bx) + '" y="' + n(y0 + head) + '" width="' + bw + '" height="' + n(h - head - 2) + '"/>' +
          '<text class="bt" x="' + n(bx + bw / 2) + '" y="' + n(y0 + head + 13) + '" text-anchor="middle">' + esc(o.title) + '</text>';
        if (o.inst) s += '<text class="inst" x="' + n(bx + bw / 2) + '" y="' + n(y0 + head - 4) + '" text-anchor="middle">' + esc(o.inst) + '</text>';
        slots.forEach(function (sl) {
          var py = y0 + sl.pinY;
          var end = bx - (sl.p.neg ? 2 * NEG : 0);
          if (sl.l) {
            s += sl.l.draw(bx - GAP, y0 + sl.top, ctx);
            s += wire(ctx, sl.p.node, bx - GAP, py, end);
          } else {
            s += '<path class="w open" d="M' + n(bx - 10) + ' ' + n(py) + 'H' + n(end) + '"/>';
          }
          if (sl.p.neg) s += '<circle class="neg" cx="' + n(bx - NEG) + '" cy="' + n(py) + '" r="' + NEG + '"/>';
          if (sl.p.name) s += '<text class="pin" x="' + n(bx + 4) + '" y="' + n(py + 4) + '">' + esc(sl.p.name) + '</text>';
        });
        if (o.outName) s += '<text class="pin" x="' + n(xr - 4) + '" y="' + n(y0 + out + 4) + '" text-anchor="end">' + esc(o.outName) + '</text>';
        return s;
      }
    };
  }

  function pinsOf(items, names) {
    return items.map(function (x, i) {
      var u = unneg(x);
      return { node: u.node, neg: u.neg, name: names ? names[i] : '' };
    });
  }

  /** Layout eines Logikbaums (Ausgang rechts). */
  function layout(node) {
    var u = unneg(node);
    if (u.neg) {
      // Negation ohne Baustein dahinter (nur am Netzwerkausgang): als NOT-Baustein
      return block({ title: 'NOT', pins: [{ node: u.node, neg: false }], width: BW });
    }
    switch (node.op) {
      case 'var': return leaf(node.name, node);
      case 'const': return leaf(node.value ? 'TRUE' : 'FALSE', null);
      case 'num': return leaf(String(node.value), null);
      case 'and': return block({ title: '&', pins: pinsOf(node.items) });
      case 'or': return block({ title: '≥1', pins: pinsOf(node.items) });
      case 'cmp': return block({ title: CMP_NAME[node.cmp] || node.cmp, pins: pinsOf([node.l, node.r], ['IN1', 'IN2']), width: FBW, outAtFirst: true });
      case 'fb':
        var timer = node.fb === 'TON' || node.fb === 'TOF';
        var pins = pinsOf([node.a], [timer ? 'IN' : 'CLK']);
        if (timer) pins.push({ node: null, neg: false, name: 'PT', layout: leaf(GE.plc.timeLiteral(node.pt), null) });
        return block({ title: node.fb, inst: node.name, pins: pins, width: FBW + (node.fb.length > 3 ? 10 : 0), outName: 'Q', outAtFirst: true });
    }
    return leaf('?', null);
  }
  F.layout = layout;

  /** Ausgangsbaustein eines Netzwerks. */
  function outBlock(nw) {
    if (nw.kind === 'sr') {
      var pins = [];
      var s = unneg(nw.set || { op: 'const', value: false });
      var r = unneg(nw.reset || { op: 'const', value: false });
      pins.push({ node: GE.plc.isEmpty(nw.set) ? null : s.node, neg: s.neg, name: 'S1' });
      pins.push({ node: GE.plc.isEmpty(nw.reset) ? null : r.node, neg: r.neg, name: 'R' });
      return block({ title: 'SR', inst: nw.target, pins: pins, width: FBW, outName: 'Q1', outAtFirst: true });
    }
    if (nw.kind === 'move') {
      var en = unneg(nw.en);
      if (nw.value === 'inc' || nw.value === 'dec') {
        return block({
          title: nw.value === 'inc' ? 'ADD' : 'SUB', width: FBW, outName: 'OUT', outAtFirst: false,
          pins: [{ node: en.node, neg: en.neg, name: 'EN' }, { node: { op: 'var', name: nw.target }, name: 'IN1' },
            { node: { op: 'num', value: 1 }, name: 'IN2' }]
        });
      }
      return block({
        title: 'MOVE', width: FBW, outName: 'OUT',
        pins: [{ node: en.node, neg: en.neg, name: 'EN' }, { node: { op: 'num', value: +nw.value }, name: 'IN' }]
      });
    }
    return layout(nw.expr);
  }

  /** Ein Netzwerk als SVG-Text. */
  F.network = function (nw, opts) {
    opts = opts || {};
    var ctx = { value: opts.value || null };
    var l = outBlock(nw);
    var tail = 34;
    var label = nw.target;
    var w = PAD + l.w + tail + tw(label, FS) + 8 + PAD;
    var h = Math.max(l.h, ROW) + 2 * PAD;
    var xr = PAD + l.w;
    var y = PAD + l.out;
    var on = opts.variable ? opts.variable(nw.target) : 0;
    var body = l.draw(xr, PAD, ctx);
    body += '<path class="w' + (on ? ' on' : '') + '" d="M' + n(xr) + ' ' + n(y) + 'H' + n(xr + tail) + '"/>';
    body += '<text class="tgt' + (on ? ' on' : '') + '" x="' + n(xr + tail + 4) + '" y="' + n(y + 4.5) + '">' + esc(label) + '</text>';
    return '<svg class="fbd" xmlns="http://www.w3.org/2000/svg" width="' + n(w) + '" height="' + n(h) + '" viewBox="0 0 ' + n(w) + ' ' + n(h) + '" ' +
      'font-family=\'' + U.FONT.replace(/'/g, '') + '\' font-size="' + FS + '">' + body + '</svg>';
  };

  /** Alle Netzwerke als HTML (Überschrift, Kommentar, Bild). */
  F.render = function (prog, opts) {
    return prog.networks.map(function (nw) {
      return '<section class="fbd-net" data-no="' + nw.no + '" data-group="' + esc(nw.group) + '"' + (nw.el ? ' data-el="' + esc(nw.el) + '"' : '') + '>' +
        '<h3><span class="fbd-no">Netzwerk ' + nw.no + '</span> ' + esc(nw.title) +
        (nw.el && !(opts && opts.noLinks) ? ' <button class="linkish fbd-goto" data-goto="' + esc(nw.el) + '" title="Im GRAFCET zeigen">im GRAFCET zeigen</button>' : '') + '</h3>' +
        (nw.comment ? '<p class="fbd-cmt">' + esc(nw.comment) + '</p>' : '') +
        '<div class="fbd-scroll">' + F.network(nw, opts) + '</div></section>';
    }).join('');
  };
})(globalThis.GE = globalThis.GE || {});
