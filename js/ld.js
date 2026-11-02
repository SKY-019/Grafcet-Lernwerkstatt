/*
 * ld.js – Darstellung der SPS-Netzwerke (plc.js) als Kontaktplan (KOP), ohne DOM.
 *
 * Links die Stromschiene, UND = Kontakte in Reihe, ODER = parallele Zweige,
 * NICHT einer Variablen = Öffner, Flanke einer Variablen = Kontakt P bzw. N,
 * Zeiten und Flanken zusammengesetzter Ausdrücke = Bausteine in der Strombahn,
 * Vergleiche = Vergleichskontakt. Rechts Spule ( ), Setzspule (S) oder
 * Rücksetzspule (R). Ein SR-Netzwerk wird als zwei Strombahnen gezeichnet:
 * erst Rücksetzen, dann Setzen – die spätere gewinnt (setzdominant).
 * Mit opts.value wird der Stromfluss grün eingefärbt (Live-Ansicht).
 */
(function (GE) {
  'use strict';

  var L = (GE.ladder = {});
  var U = GE.util;
  var esc = U.esc;

  var CW = 66;        // Breite einer Kontaktzelle
  var TOP = 18;       // Platz für die Beschriftung über dem Kontakt
  var BOT = 14;       // Platz unter der Strombahn
  var BOXW = 70;      // Breite eines Bausteins
  var GAPV = 8;       // Abstand paralleler Zweige
  var COIL = 70;      // Breite der Spule samt Beschriftung
  var FS = 12;

  function n(x) { return U.n(x); }
  function tw(s) { return U.textWidth(s, FS); }

  var CMP_SYM = { '>': '>', '<': '<', '>=': '>=', '<=': '<=', '=': '==', '<>': '<>' };

  function seg(x1, x2, y, on) {
    return x2 > x1 ? '<path class="w' + (on ? ' on' : '') + '" d="M' + n(x1) + ' ' + n(y) + 'H' + n(x2) + '"/>' : '';
  }

  /** Kontakt: kind 'no' (Schließer), 'nc' (Öffner), 'p'/'n' (Flanke). */
  function contact(label, kind, node, neg) {
    var w = Math.max(CW, tw(label) + 12);
    return {
      w: w, y: TOP + 10, h: TOP + 10 + BOT,
      draw: function (x, y0, ctx, pin) {
        var y = y0 + TOP + 10;
        var cx = x + w / 2;
        var v = ctx.value && node ? ctx.value(node) : 0;
        var closed = neg ? !v : !!v;
        var pout = pin && closed;
        var on = ctx.value ? ' on' : '';
        var s = seg(x, cx - 8, y, ctx.value && pin) + seg(cx + 8, x + w, y, ctx.value && pout);
        s += '<path class="ct' + (ctx.value && closed ? on : '') + '" d="M' + n(cx - 8) + ' ' + n(y - 9) + 'V' + n(y + 9) +
          'M' + n(cx + 8) + ' ' + n(y - 9) + 'V' + n(y + 9) + (kind === 'nc' ? 'M' + n(cx - 11) + ' ' + n(y + 9) + 'L' + n(cx + 11) + ' ' + n(y - 9) : '') + '"/>';
        if (kind === 'p' || kind === 'n') s += '<text class="ck" x="' + n(cx) + '" y="' + n(y + 4) + '" text-anchor="middle">' + kind.toUpperCase() + '</text>';
        s += '<text class="lbl' + (ctx.value && v ? ' on' : '') + '" x="' + n(cx) + '" y="' + n(y0 + TOP + 1) + '" text-anchor="middle">' + esc(label) + '</text>';
        return { svg: s, p: pout };
      }
    };
  }

  /** Durchgehende Leitung (immer wahr). */
  function wireEl() {
    return { w: 24, y: TOP + 10, h: TOP + 10 + BOT, draw: function (x, y0, ctx, pin) { return { svg: seg(x, x + 24, y0 + TOP + 10, ctx.value && pin), p: pin }; } };
  }

  /** Baustein in der Strombahn (Eingang = Strombahn), z. B. TON, R_TRIG, NOT. */
  function box(title, inst, node, extra) {
    var hasInst = !!inst;
    var top = (hasInst ? 16 : 4);
    var rows = extra ? 2 : 1;
    var bh = 22 + rows * 18;
    var w = BOXW + 20;
    var y = top + 30;
    return {
      w: w, y: y, h: top + bh + 8,
      draw: function (x, y0, ctx, pin) {
        var q = ctx.value ? (node ? !!ctx.value(node) : !pin) : false;
        var bx = x + 10;
        var s = seg(x, bx, y0 + y, ctx.value && pin) + seg(bx + BOXW, x + w, y0 + y, q);
        s += '<rect class="box" x="' + n(bx) + '" y="' + n(y0 + top) + '" width="' + BOXW + '" height="' + bh + '"/>' +
          '<text class="bt" x="' + n(bx + BOXW / 2) + '" y="' + n(y0 + top + 14) + '" text-anchor="middle">' + esc(title) + '</text>';
        if (hasInst) s += '<text class="inst" x="' + n(bx + BOXW / 2) + '" y="' + n(y0 + top - 4) + '" text-anchor="middle">' + esc(inst) + '</text>';
        s += '<text class="pin" x="' + n(bx + 3) + '" y="' + n(y0 + y + 4) + '">' + (title === 'NOT' ? '' : title.slice(-4) === 'TRIG' ? 'CLK' : 'IN') + '</text>';
        if (title !== 'NOT') s += '<text class="pin" x="' + n(bx + BOXW - 3) + '" y="' + n(y0 + y + 4) + '" text-anchor="end">Q</text>';
        if (extra) {
          s += '<text class="pin" x="' + n(bx + 3) + '" y="' + n(y0 + y + 22) + '">PT</text>' +
            '<text class="lbl" x="' + n(bx - 3) + '" y="' + n(y0 + y + 22) + '" text-anchor="end">' + esc(extra) + '</text>';
        }
        return { svg: s, p: q };
      }
    };
  }

  /** Vergleichskontakt: Operator im Kasten, Operanden darüber und darunter (wie im TIA Portal). */
  function compare(node) {
    var a = opText(node.l);
    var b = opText(node.r);
    var w = Math.max(CW, tw(a) + 12, tw(b) + 12);
    var y = TOP + 12;
    return {
      w: w, y: y, h: y + 12 + 16,
      draw: function (x, y0, ctx, pin) {
        var cx = x + w / 2;
        var v = ctx.value ? !!ctx.value(node) : false;
        var pout = pin && v;
        var s = seg(x, cx - 14, y0 + y, ctx.value && pin) + seg(cx + 14, x + w, y0 + y, ctx.value && pout);
        s += '<rect class="box' + (ctx.value && v ? ' on' : '') + '" x="' + n(cx - 14) + '" y="' + n(y0 + y - 11) + '" width="28" height="22"/>' +
          '<text class="bt" x="' + n(cx) + '" y="' + n(y0 + y + 4) + '" text-anchor="middle">' + esc(CMP_SYM[node.cmp] || node.cmp) + '</text>' +
          '<text class="lbl" x="' + n(cx) + '" y="' + n(y0 + y - 15) + '" text-anchor="middle">' + esc(a) + '</text>' +
          '<text class="lbl" x="' + n(cx) + '" y="' + n(y0 + y + 25) + '" text-anchor="middle">' + esc(b) + '</text>';
        return { svg: s, p: pout };
      }
    };
  }
  function opText(x) { return x.op === 'var' ? x.name : x.op === 'num' ? String(x.value) : '?'; }

  function series(items) {
    var y = Math.max.apply(null, items.map(function (e) { return e.y; }));
    var below = Math.max.apply(null, items.map(function (e) { return e.h - e.y; }));
    var w = items.reduce(function (s, e) { return s + e.w; }, 0);
    return {
      w: w, y: y, h: y + below,
      draw: function (x, y0, ctx, pin) {
        var s = '';
        var p = pin;
        items.forEach(function (e) {
          var r = e.draw(x, y0 + y - e.y, ctx, p);
          s += r.svg;
          p = r.p;
          x += e.w;
        });
        return { svg: s, p: p };
      }
    };
  }

  function parallel(items) {
    var w = Math.max.apply(null, items.map(function (e) { return e.w; })) + 20;
    var tops = [];
    var h = 0;
    items.forEach(function (e, i) { tops.push(h); h += e.h + (i < items.length - 1 ? GAPV : 0); });
    var y = items[0].y;
    return {
      w: w, y: y, h: h,
      draw: function (x, y0, ctx, pin) {
        var s = '';
        var any = false;
        var lastY = y0 + tops[items.length - 1] + items[items.length - 1].y;
        var outs = [];
        items.forEach(function (e, i) {
          var ey = y0 + tops[i] + e.y;
          var r = e.draw(x + 10, y0 + tops[i], ctx, pin);
          s += seg(x, x + 10, ey, ctx.value && pin) + r.svg + seg(x + 10 + e.w, x + w - 10, ey, ctx.value && r.p) + seg(x + w - 10, x + w, ey, ctx.value && r.p);
          outs.push(r.p);
          if (r.p) any = true;
        });
        var cls = function (on) { return 'w' + (ctx.value && on ? ' on' : ''); };
        s += '<path class="' + cls(pin) + '" d="M' + n(x) + ' ' + n(y0 + y) + 'V' + n(lastY) + '"/>';
        s += '<path class="' + cls(any) + '" d="M' + n(x + w - 10) + ' ' + n(y0 + y) + 'V' + n(lastY) + '"/>';
        return { svg: s, p: any };
      }
    };
  }

  /** Layout eines Logikbaums als Strombahn. */
  function layout(node) {
    if (!node) return wireEl();
    switch (node.op) {
      case 'var': return contact(node.name, 'no', node, false);
      case 'const': return node.value ? wireEl() : contact('FALSE', 'no', null, false);
      case 'num': return contact(String(node.value), 'no', null, false);
      case 'not':
        if (node.a.op === 'var') return contact(node.a.name, 'nc', node.a, true);
        return series([layout(node.a), box('NOT', '', null, null)]);
      case 'and': return series(node.items.map(layout));
      case 'or': return parallel(node.items.map(layout));
      case 'cmp': return compare(node);
      case 'fb':
        if ((node.fb === 'R_TRIG' || node.fb === 'F_TRIG') && node.a.op === 'var') {
          var c = contact(node.a.name, node.fb === 'R_TRIG' ? 'p' : 'n', node, false);
          c.inst = node.name;
          return c;
        }
        var timer = node.fb === 'TON' || node.fb === 'TOF';
        return series([layout(node.a), box(node.fb, node.name, node, timer ? GE.plc.timeLiteral(node.pt) : null)]);
    }
    return contact('?', 'no', null, false);
  }
  L.layout = layout;

  /** Spule bzw. Baustein am Ende einer Strombahn. */
  function coil(kind, target) {
    var w = Math.max(COIL, tw(target) + 16);
    return {
      w: w, y: TOP + 10, h: TOP + 10 + BOT,
      draw: function (x, y0, ctx, pin, on) {
        var y = y0 + TOP + 10;
        var cx = x + w / 2;
        var s = seg(x, cx - 9, y, ctx.value && pin);
        s += '<path class="ct' + (ctx.value && pin ? ' on' : '') + '" d="M' + n(cx - 5) + ' ' + n(y - 9) + 'A9 11 0 0 0 ' + n(cx - 5) + ' ' + n(y + 9) +
          'M' + n(cx + 5) + ' ' + n(y - 9) + 'A9 11 0 0 1 ' + n(cx + 5) + ' ' + n(y + 9) + '"/>';
        if (kind) s += '<text class="ck" x="' + n(cx) + '" y="' + n(y + 4) + '" text-anchor="middle">' + kind + '</text>';
        s += '<text class="tgt' + (on ? ' on' : '') + '" x="' + n(cx) + '" y="' + n(y0 + TOP + 1) + '" text-anchor="middle">' + esc(target) + '</text>';
        return { svg: s, p: pin };
      }
    };
  }

  function moveBox(nw) {
    var title = nw.value === 'inc' ? 'ADD' : nw.value === 'dec' ? 'SUB' : 'MOVE';
    var lines = title === 'MOVE' ? ['IN: ' + nw.value, 'OUT: ' + nw.target] : ['IN1: ' + nw.target, 'IN2: 1', 'OUT: ' + nw.target];
    var w = 96;
    var bh = 20 + lines.length * 15;
    return {
      w: w + 10, y: TOP + 10, h: TOP + bh + 4,
      draw: function (x, y0, ctx, pin) {
        var bx = x + 10;
        var s = seg(x, bx, y0 + TOP + 10, ctx.value && pin) +
          '<rect class="box" x="' + n(bx) + '" y="' + n(y0 + 4) + '" width="' + w + '" height="' + bh + '"/>' +
          '<text class="bt" x="' + n(bx + w / 2) + '" y="' + n(y0 + 17) + '" text-anchor="middle">' + title + '</text>' +
          '<text class="pin" x="' + n(bx + 3) + '" y="' + n(y0 + TOP + 14) + '">EN</text>';
        lines.forEach(function (t, i) {
          s += '<text class="pin" x="' + n(bx + w - 4) + '" y="' + n(y0 + TOP + 14 + (i + 1) * 15) + '" text-anchor="end">' + esc(t) + '</text>';
        });
        return { svg: s, p: pin };
      }
    };
  }

  /** Eine Strombahn: Schiene links, Bedingung, Spule. */
  function rung(cond, end, ctx, y0, onTarget) {
    var l = layout(cond);
    var h = Math.max(l.h, end.h);
    var y = Math.max(l.y, end.y);
    var x0 = 14;
    var r = l.draw(x0, y0 + y - l.y, ctx, true);
    var e = end.draw(x0 + l.w + 10, y0 + y - end.y, ctx, r.p, onTarget);
    var s = r.svg + seg(x0 + l.w, x0 + l.w + 10, y0 + y, ctx.value && r.p) + e.svg;
    return { svg: s, w: x0 + l.w + 10 + end.w + 10, h: h };
  }

  /** Ein Netzwerk als SVG-Text. */
  L.network = function (nw, opts) {
    opts = opts || {};
    var ctx = { value: opts.value || null };
    var onT = opts.variable ? !!opts.variable(nw.target) : false;
    var rungs = [];
    if (nw.kind === 'sr') {
      if (!GE.plc.isEmpty(nw.reset)) rungs.push([nw.reset, coil('R', nw.target)]);
      if (!GE.plc.isEmpty(nw.set)) rungs.push([nw.set, coil('S', nw.target)]);
    } else if (nw.kind === 'move') {
      rungs.push([nw.en, moveBox(nw)]);
    } else {
      rungs.push([nw.expr, coil('', nw.target)]);
    }
    var y = 6;
    var w = 0;
    var body = '';
    rungs.forEach(function (rg) {
      var r = rung(rg[0], rg[1], ctx, y, onT);
      body += r.svg;
      w = Math.max(w, r.w);
      y += r.h + 10;
    });
    var h = y;
    body = '<path class="rail" d="M6 2V' + n(h - 4) + '"/>' + body;
    return '<svg class="fbd ld" xmlns="http://www.w3.org/2000/svg" width="' + n(w + 6) + '" height="' + n(h) + '" viewBox="0 0 ' + n(w + 6) + ' ' + n(h) + '" ' +
      'font-family=\'' + U.FONT.replace(/'/g, '') + '\' font-size="' + FS + '">' + body + '</svg>';
  };

  /** Alle Netzwerke als HTML. */
  L.render = function (prog, opts) {
    return prog.networks.map(function (nw) {
      return '<section class="fbd-net" data-no="' + nw.no + '" data-group="' + esc(nw.group) + '"' + (nw.el ? ' data-el="' + esc(nw.el) + '"' : '') + '>' +
        '<h3><span class="fbd-no">Netzwerk ' + nw.no + '</span> ' + esc(nw.title) +
        (nw.el && !(opts && opts.noLinks) ? ' <button class="linkish fbd-goto" data-goto="' + esc(nw.el) + '" title="Im GRAFCET zeigen">im GRAFCET zeigen</button>' : '') + '</h3>' +
        (nw.comment ? '<p class="fbd-cmt">' + esc(nw.comment) + '</p>' : '') +
        (nw.kind === 'sr' && !GE.plc.isEmpty(nw.reset) && !GE.plc.isEmpty(nw.set) ? '<p class="fbd-cmt">Erst rücksetzen, dann setzen: Setzen gewinnt (wie SR).</p>' : '') +
        '<div class="fbd-scroll">' + L.network(nw, opts) + '</div></section>';
    }).join('');
  };
})(globalThis.GE = globalThis.GE || {});
