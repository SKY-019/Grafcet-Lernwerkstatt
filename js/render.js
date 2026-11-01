/*
 * render.js – Zeichnet eine GRAFCET-Seite als SVG-Text.
 *
 * Die Funktion arbeitet ohne DOM und liefert reinen SVG-Quelltext; die
 * Farben kommen über CSS-Klassen (siehe css/app.css). Dadurch lässt sich
 * dieselbe Zeichnung später auch exportieren. Maße und Lage (Ausdehnung,
 * Rahmen, Rückführungen) stehen in geometry.js, damit auch die Prüfung sie nutzt.
 *
 * Darstellung (an DIN EN 60848 angelehnt, offene Punkte in docs/NORM-OFFEN.md):
 *   Schritt          Quadrat mit Name, Anfangsschritt mit Doppelrahmen
 *   Transition       kurzer dicker Querstrich, Bedingung rechts daneben
 *   Wirkverbindung   senkrechte Linien, Fluss von oben nach unten;
 *                    Rückführungen nach oben erhalten einen Pfeil
 *   ODER             einfache waagerechte Linie
 *   UND              waagerechte Doppellinie
 *   Sprung           Pfeil mit Angabe des Zielschritts, am Ziel Pfeil mit Herkunft
 *   Aktion           Rechteck rechts neben dem Schritt, mehrere nebeneinander
 *                    oder untereinander; bedingt: Bedingung darüber;
 *                    speichernd: Pfeil ↑ über (Aktivierung) bzw. ↓ unter dem
 *                    Kasten (Deaktivierung); bei Ereignis: Fähnchen mit Ereignis
 *   Kommentar        in Anführungszeichen links vom Schritt bzw. hinter der Bedingung
 *   Teil-GRAFCET     Rahmen um den Inhalt, Name (z. B. G1) oben links
 */
(function (GE) {
  'use strict';

  var R = (GE.render = {});
  var U = GE.util;
  var E = GE.expr;
  var M = GE.model;
  var G = GE.geometry;

  // Maße und Lage kommen aus geometry.js; unter R.* bleiben sie für die übrigen Module erreichbar
  var C = (R.C = G.C);
  var tw = G.tw;
  var parse = G.parse;
  var exprWidth = G.exprWidth;
  var commentWidth = G.commentWidth;
  var markTop = G.markTop;
  var markBottom = G.markBottom;
  var analyze = G.analyze;
  var backRoute = G.backRoute;
  ['stepHalf', 'actionLabel', 'actionWidth', 'actionBoxes', 'commentLines', 'commentText', 'frameBounds', 'frameLabel',
    'elementBox', 'fitRect', 'noteSize', 'extent', 'exprWidth', 'analyze', 'backBoxes', 'overhang', 'frameFitRect'].forEach(function (k) {
    R[k] = G[k];
  });

  var n = U.n;
  var esc = U.esc;

  // ------------------------------------------------------------ Kommentare und Sonderzeichen

  /** Mehrzeiliger Kommentar als SVG-Text, senkrecht um y zentriert. */
  function commentSvg(c, x, y, anchor, ownerId) {
    var l = R.commentLines(c);
    var lh = 17;
    var y0 = y - (l.length - 1) * lh / 2;
    return '<text class="comment"' + (ownerId ? ' data-cmt="' + esc(ownerId) + '"' : '') + (anchor === 'end' ? ' text-anchor="end"' : '') + '>' + l.map(function (t, i) {
      return '<tspan x="' + n(x) + '" y="' + n(y0 + i * lh) + '">' + esc(t) + '</tspan>';
    }).join('') + '</text>';
  }

  /**
   * Zusatzzeichen besonderer Schritte:
   *   Makroschritt      zwei waagerechte Linien oben und unten im Kasten
   *   Eingangsschritt   kurzer Strich über dem Kasten (Eintritt in die Expansion)
   *   Ausgangsschritt   kurzer Strich unter dem Kasten (Austritt)
   *   einschließender   Schrägstriche in den Ecken
   *   encInit           Stern rechts oben (wird mit dem einschließenden Schritt aktiv)
   */
  function stepKindSvg(st, h) {
    var x1 = st.x - h;
    var x2 = st.x + h;
    var y1 = st.y - C.H;
    var y2 = st.y + C.H;
    var s = '';
    if (st.kind === 'macro') {
      s += line(x1, y1 + 6, x2, y1 + 6, 'wire thin') + line(x1, y2 - 6, x2, y2 - 6, 'wire thin');
    } else if (st.kind === 'entry') {
      s += line(st.x, y1 - 16, st.x, y1, 'wire') + line(st.x - 8, y1 - 16, st.x + 8, y1 - 16, 'wire');
    } else if (st.kind === 'exit') {
      s += line(st.x, y2, st.x, y2 + 16, 'wire') + line(st.x - 8, y2 + 16, st.x + 8, y2 + 16, 'wire');
    } else if (st.kind === 'enclosing') {
      var k = 9;
      s += line(x1, y1 + k, x1 + k, y1, 'wire thin') + line(x2 - k, y1, x2, y1 + k, 'wire thin') +
        line(x1, y2 - k, x1 + k, y2, 'wire thin') + line(x2 - k, y2, x2, y2 - k, 'wire thin');
    }
    if (st.encInit) s += '<text class="enc-mark" x="' + n(x2 + 3) + '" y="' + n(y1 + 10) + '">*</text>';
    return s;
  }

  /** Fortschrittsbalken einer laufenden Zeitbedingung, z. B. „1,2 / 3 s“. */
  function timerBar(tm, x, y) {
    var w = 64;
    return '<g class="timer-bar"><rect class="tb-bg" x="' + n(x) + '" y="' + n(y) + '" width="' + w + '" height="6" rx="3"/>' +
      '<rect class="tb-fill' + (tm.ratio >= 1 ? ' done' : '') + '" x="' + n(x) + '" y="' + n(y) + '" width="' + n(w * U.clamp(tm.ratio, 0, 1)) + '" height="6" rx="3"/>' +
      '<text class="tb-text" x="' + n(x + w + 6) + '" y="' + n(y + 6) + '">' + esc(tm.text) + '</text></g>';
  }

  // ------------------------------------------------------- Bedingungstext

  /**
   * Bedingung als SVG. NICHT wird als Überstrich gezeichnet.
   * anchor: 'start' oder 'middle'; y ist die Grundlinie.
   * truth(name) (optional, Simulation): Variablen mit Wert 1 werden hervorgehoben.
   */
  R.exprSvg = function (text, x, y, anchor, extraCls, truth) {
    var cls = 'cond' + (extraCls ? ' ' + extraCls : '');
    if (!String(text || '').trim()) {
      return { svg: '<text class="' + cls + ' cond-missing" x="' + n(x) + '" y="' + n(y) + '" text-anchor="' + anchor + '">?</text>', width: tw('?') };
    }
    var r = parse(text);
    if (!r.ok) {
      return {
        svg: '<text class="' + cls + ' cond-bad" x="' + n(x) + '" y="' + n(y) + '" text-anchor="' + anchor + '">' + esc(text) + '</text>',
        width: tw(text)
      };
    }
    var runs = E.runs(r.ast);
    var widths = runs.map(function (run) { return tw(run.text); });
    var total = widths.reduce(function (a, b) { return a + b; }, 0);
    var x0 = anchor === 'middle' ? x - total / 2 : x;
    var xs = [];
    var cx = x0;
    var spans = runs.map(function (run, i) {
      xs.push(cx);
      var s = '<tspan x="' + n(cx) + '"' + (run.cls ? ' class="r-' + run.cls + (truth && run.cls === 'v' && truth(run.text) ? ' on' : '') + '"' : '') + '>' + esc(run.text) + '</tspan>';
      cx += widths[i];
      return s;
    }).join('');
    var svg = '<text class="' + cls + '" y="' + n(y) + '" xml:space="preserve">' + spans + '</text>';

    // Überstriche: für jede NICHT-Gruppe von erstem bis letztem Stück
    var groups = {};
    runs.forEach(function (run, i) {
      run.nots.forEach(function (id, k) {
        var g = groups[id] || (groups[id] = { first: i, last: i, depth: 0 });
        g.last = i;
        g.depth = Math.max(g.depth, run.nots.length - 1 - k);
      });
    });
    Object.keys(groups).forEach(function (id) {
      var g = groups[id];
      var x1 = xs[g.first] + 1;
      var x2 = xs[g.last] + widths[g.last] - 1;
      var ly = y - C.FS * 0.86 - 3 * g.depth;
      svg += '<line class="overbar" x1="' + n(x1) + '" y1="' + n(ly) + '" x2="' + n(x2) + '" y2="' + n(ly) + '"/>';
    });
    return { svg: svg, width: total };
  };

  // ------------------------------------------------------- Struktur

  function outPort(nd, target) {
    var e = nd.el;
    if (nd.kind === 'step') return nd.fout.length >= 2 ? { x: target.x, y: nd.orDiv } : { x: e.x, y: e.y + C.H };
    return nd.fout.length >= 2 ? { x: target.x, y: nd.andDiv + 4 } : { x: e.x, y: e.y };
  }

  function inPort(nd, source) {
    var e = nd.el;
    if (nd.kind === 'step') return nd.fin.length >= 2 ? { x: source.x, y: nd.orConv } : { x: e.x, y: e.y - C.H };
    return nd.fin.length >= 2 ? { x: source.x, y: nd.andConv - 4 } : { x: e.x, y: e.y };
  }

  /** Rechtwinkliger Linienzug von p nach q (erst senkrecht, dann waagerecht). */
  function elbow(p, q, dy) {
    if (Math.abs(p.x - q.x) < 0.5) return [p, q];
    var midY = q.y - p.y > 40 ? q.y - 20 : (p.y + q.y) / 2;
    // verschobenes waagerechtes Stück (an der Verbindung gespeichert)
    if (dy) midY = U.clamp(midY + dy, Math.min(p.y, q.y) + 4, Math.max(p.y, q.y) - 4);
    return [p, { x: p.x, y: midY }, { x: q.x, y: midY }, q];
  }

  function d(points) {
    return points.map(function (p, i) { return (i ? 'L' : 'M') + n(p.x) + ' ' + n(p.y); }).join(' ');
  }

  function line(x1, y1, x2, y2, cls) {
    return '<line class="' + (cls || 'wire') + '" x1="' + n(x1) + '" y1="' + n(y1) + '" x2="' + n(x2) + '" y2="' + n(y2) + '"/>';
  }

  function arrow(x, y, dir) {
    // Pfeilspitze mit Spitze in (x, y); dir: 'up', 'down' oder 'left'
    if (dir === 'left') {
      return '<path class="arrow" d="M' + n(x + 10) + ' ' + n(y - 5) + ' L' + n(x) + ' ' + n(y) + ' L' + n(x + 10) + ' ' + n(y + 5) + ' Z"/>';
    }
    var s = dir === 'up' ? 1 : -1;
    return '<path class="arrow" d="M' + n(x - 5) + ' ' + n(y + 10 * s) + ' L' + n(x) + ' ' + n(y) + ' L' + n(x + 5) + ' ' + n(y + 10 * s) + ' Z"/>';
  }

  /** Herkunft eines Sprungs für die Angabe am Zielschritt: Transitionsname oder Vorgängerschritt(e). */
  function jumpOrigin(page, info, l) {
    var src = info[l.from];
    if (!src) return '?';
    if (src.kind === 'step') return src.el.name;
    if (src.el.name) return src.el.name;
    var pre = M.inLinks(page, src.el.id)
      .map(function (x) { return info[x.from]; })
      .filter(function (x) { return x && x.kind === 'step'; })
      .map(function (x) { return x.el.name; });
    return pre.length ? pre.join('/') : '?';
  }

  // ------------------------------------------------------- Zeichnen

  /**
   * Zeichnet eine Seite.
   * opts.selected  {id:true}       ausgewählte Elemente
   * opts.issues    {id:'error'|'warning'}
   * opts.sim       Simulation: {active, enabled, fireable, actOn, truth(name)}
   * @returns {{svg:string, bounds:{x1,y1,x2,y2}}}
   */
  R.page = function (page, opts) {
    opts = opts || {};
    var sel = opts.selected || {};
    var iss = opts.issues || {};
    var sim = opts.sim || null;
    var info = analyze(page);
    var wires = [];
    var nodes = [];
    var b = { x1: Infinity, y1: Infinity, x2: -Infinity, y2: -Infinity };
    function grow(x1, y1, x2, y2) {
      b.x1 = Math.min(b.x1, x1); b.y1 = Math.min(b.y1, y1);
      b.x2 = Math.max(b.x2, x2); b.y2 = Math.max(b.y2, y2);
    }
    var ext = {};
    M.nodes(page).forEach(function (nd) {
      var e = R.extent(page, nd);
      ext[nd.id] = e;
      grow(nd.x - e.left, nd.y - e.top, nd.x + e.right, nd.y + e.bottom);
    });

    // --- Rahmen der Teil-GRAFCETs (zuunterst)
    var frames = [];
    var frameBounds = {};
    (page.frames || []).forEach(function (fr) {
      var fb = R.frameBounds(page, fr);
      frameBounds[fr.id] = fb;
      var label = R.frameLabel(page, fr);
      var lw = tw(label, 16, true) + 16;
      var forced = sim && sim.forced && sim.forced[fr.id];
      var cls = 'el frame frame-' + fr.kind + (sel[fr.id] ? ' sel' : '') + (iss[fr.id] ? ' iss-' + iss[fr.id] : '') +
        (fb.empty ? ' empty' : '') + (forced ? ' forced' : '');
      var kindText = { partial: 'Teil-GRAFCET', macro: 'Expansion des Makroschritts', enclosed: 'Inhalt des einschließenden Schritts' }[fr.kind] || 'Rahmen';
      frames.push('<g class="' + cls + '" data-id="' + esc(fr.id) + '">' +
        '<rect class="frame-box" x="' + n(fb.x1) + '" y="' + n(fb.y1) + '" width="' + n(fb.x2 - fb.x1) + '" height="' + n(fb.y2 - fb.y1) + '"/>' +
        '<rect class="frame-tab" x="' + n(fb.x1) + '" y="' + n(fb.y1) + '" width="' + n(lw) + '" height="26"/>' +
        '<text class="frame-name" x="' + n(fb.x1 + 8) + '" y="' + n(fb.y1 + 19) + '">' + esc(label) + '</text>' +
        (forced ? '<text class="frame-forced" x="' + n(fb.x1 + lw + 8) + '" y="' + n(fb.y1 + 18) + '">' + esc(forced) + '</text>' : '') +
        (sel[fr.id] && !sim ? '<rect class="frame-handle" data-handle="' + esc(fr.id) + '" x="' + n(fb.x2 - 7) + '" y="' + n(fb.y2 - 7) + '" width="14" height="14"><title>Ziehen ändert die Größe</title></rect>' : '') +
        '<title>' + esc(kindText + ' ' + label) + ' – am Namen ziehen verschiebt ihn samt Inhalt</title></g>');
      grow(fb.x1, fb.y1, fb.x2, fb.y2);
    });

    // --- Verzweigungs- und Zusammenführungslinien
    Object.keys(info).forEach(function (id) {
      var nd = info[id];
      var e = nd.el;
      var xs;
      if (nd.orDiv !== undefined) {
        xs = [e.x].concat(nd.fout.map(function (l) { return info[l.to].el.x; }));
        wires.push(line(e.x, e.y + C.H, e.x, nd.orDiv) + line(Math.min.apply(null, xs), nd.orDiv, Math.max.apply(null, xs), nd.orDiv, 'wire bar-or'));
      }
      if (nd.orConv !== undefined) {
        xs = [e.x].concat(nd.fin.map(function (l) { return info[l.from].el.x; }));
        wires.push(line(e.x, nd.orConv, e.x, e.y - C.H) + line(Math.min.apply(null, xs), nd.orConv, Math.max.apply(null, xs), nd.orConv, 'wire bar-or'));
      }
      if (nd.andDiv !== undefined) {
        xs = [e.x].concat(nd.fout.map(function (l) { return info[l.to].el.x; }));
        var a1 = Math.min.apply(null, xs) - 10;
        var a2 = Math.max.apply(null, xs) + 10;
        wires.push(line(e.x, e.y, e.x, nd.andDiv) + line(a1, nd.andDiv, a2, nd.andDiv, 'wire bar-and') + line(a1, nd.andDiv + 4, a2, nd.andDiv + 4, 'wire bar-and'));
      }
      if (nd.andConv !== undefined) {
        xs = [e.x].concat(nd.fin.map(function (l) { return info[l.from].el.x; }));
        var c1 = Math.min.apply(null, xs) - 10;
        var c2 = Math.max.apply(null, xs) + 10;
        wires.push(line(e.x, nd.andConv, e.x, e.y) + line(c1, nd.andConv, c2, nd.andConv, 'wire bar-and') + line(c1, nd.andConv - 4, c2, nd.andConv - 4, 'wire bar-and'));
      }
    });

    // --- Wirkverbindungen
    var backIndex = 0;
    page.links.forEach(function (l) {
      var a = info[l.from];
      var t = info[l.to];
      if (!a || !t) return;
      var cls = 'el link' + (l.jump ? ' jump' : '') + (sel[l.id] ? ' sel' : '') + (iss[l.id] ? ' iss-' + iss[l.id] : '');
      var pts;
      var extra = '';
      var title = '';

      if (l.jump) {
        // Quelle: Pfeil nach unten mit Angabe des Zielschritts
        var sy = a.kind === 'step' ? a.el.y + C.H : a.el.y;
        var tip = sy + C.JUMP_LEN;
        pts = [{ x: a.el.x, y: sy }, { x: a.el.x, y: tip - 2 }];
        extra += arrow(a.el.x, tip, 'down');
        var label = t.el.name != null ? t.el.name : '?';
        extra += '<text class="jump-label" x="' + n(a.el.x + 10) + '" y="' + n(tip + 2) + '">' + esc(label) + '</text>';
        grow(a.el.x - 8, sy, a.el.x + 14 + tw(label, C.FS, true), tip + 6);
        title = 'Sprung zu Schritt ' + label;
      } else if (a.fout.indexOf(l) >= 0) {
        pts = elbow(outPort(a, t.el), inPort(t, a.el), l.dy);
      } else {
        // Rückführung nach oben: links an der Zeichnung vorbei, mit Pfeil
        pts = backRoute(page, info, ext, l, backIndex++);
        var sideX = pts[2].x;
        var downY = pts[1].y;
        var entryY = pts[3].y;
        extra += arrow(sideX, (downY + entryY) / 2 - 5, 'up');
        grow(sideX - 8, entryY, pts[0].x, downY);
      }
      var path = d(pts);
      wires.push('<g class="' + cls + '" data-id="' + esc(l.id) + '">' + (title ? '<title>' + esc(title) + '</title>' : '') +
        '<path class="hit" d="' + path + '"/><path class="wire" d="' + path + '"/>' + extra + '</g>');
    });

    // --- Sprungziele: Pfeil in den Zielschritt mit Angabe der Herkunft
    page.steps.forEach(function (st) {
      var nd = info[st.id];
      if (!nd || !nd.jin.length) return;
      var origin = nd.jin.map(function (l) { return jumpOrigin(page, info, l); }).join(', ');
      var first = nd.jin[0];
      var anySel = nd.jin.some(function (l) { return sel[l.id]; });
      var top = st.y - C.H;
      var g = '<g class="el link jump jump-target' + (anySel ? ' sel' : '') + '" data-id="' + esc(first.id) + '">' +
        '<title>' + esc('Sprungziel – kommt von ' + origin) + '</title>';
      var p;
      if (!nd.fin.length && !nd.bin.length) {
        // von oben, wenn sonst nichts ankommt
        p = d([{ x: st.x, y: top - C.JUMP_LEN }, { x: st.x, y: top - 2 }]);
        g += '<path class="hit" d="' + p + '"/><path class="wire" d="' + p + '"/>' + arrow(st.x, top, 'down') +
          '<text class="jump-label" x="' + n(st.x + 10) + '" y="' + n(top - C.JUMP_LABEL_UP) + '">' + esc(origin) + '</text>';
        grow(st.x - 6, top - 40, st.x + 14 + tw(origin, C.FS, true), top);
      } else {
        // sonst waagerecht von rechts in die Verbindung über dem Schritt
        var y = top - C.JUMP_SIDE_Y;
        var x1 = st.x + C.JUMP_SIDE_LEN;
        p = d([{ x: x1, y: y }, { x: st.x + 2, y: y }]);
        g += '<path class="hit" d="' + p + '"/><path class="wire" d="' + p + '"/>' + arrow(st.x, y, 'left') +
          '<text class="jump-label" x="' + n(x1 + 5) + '" y="' + n(y + 5) + '">' + esc(origin) + '</text>';
        grow(st.x, y - 8, x1 + 10 + tw(origin, C.FS, true), y + 8);
      }
      wires.push(g + '</g>');
    });

    // --- Transitionen
    page.transitions.forEach(function (t) {
      var cls = 'el trans' + (sel[t.id] ? ' sel' : '') + (iss[t.id] ? ' iss-' + iss[t.id] : '') +
        (sim && sim.fireable[t.id] ? ' fireable' : sim && sim.enabled[t.id] ? ' enabled' : '');
      var s = '<g class="' + cls + '" data-id="' + esc(t.id) + '">';
      s += '<rect class="hit" x="' + n(t.x - C.TBAR - 6) + '" y="' + n(t.y - 12) + '" width="' + (2 * C.TBAR + 12) + '" height="24"/>';
      s += '<rect class="halo" x="' + n(t.x - C.TBAR - 4) + '" y="' + n(t.y - 7) + '" width="' + (2 * C.TBAR + 8) + '" height="14" rx="4"/>';
      s += line(t.x - C.TBAR, t.y, t.x + C.TBAR, t.y, 'tbar');
      if (t.name) s += '<text class="tname" x="' + n(t.x - C.TBAR - 8) + '" y="' + n(t.y + 5) + '" text-anchor="end">(' + esc(t.name) + ')</text>';
      var ce = R.exprSvg(t.cond, t.x + C.COND_X, t.y + 5, 'start', '', sim && sim.truth);
      s += ce.svg;
      if (sim && sim.timers && sim.timers[t.id]) s += timerBar(sim.timers[t.id], t.x + C.COND_X, t.y + 12);
      if (t.comment) {
        var tp = t.commentPos || 'right';
        var tdx = t.commentDx || 0;
        var tdy = t.commentDy || 0;
        if (tp === 'left') s += commentSvg(t.comment, t.x - C.TBAR - 10 - (t.name ? tw('(' + t.name + ')') + 8 : 0) + tdx, t.y + 5 + tdy, 'end', t.id);
        else if (tp === 'above') s += commentSvg(t.comment, t.x + C.COND_X + tdx, t.y - 16 + tdy, 'start', t.id);
        else if (tp === 'below') s += commentSvg(t.comment, t.x + C.COND_X + tdx, t.y + 24 + tdy, 'start', t.id);
        else s += commentSvg(t.comment, t.x + C.COND_X + ce.width + 14 + tdx, t.y + 5 + tdy, 'start', t.id);
      }
      s += '</g>';
      nodes.push(s);
    });

    // --- Schritte mit Aktionen
    page.steps.forEach(function (st) {
      var h = R.stepHalf(st);
      var active = sim && sim.active && sim.active[st.id];
      var cls = 'el step' + (st.initial ? ' initial' : '') + (sel[st.id] ? ' sel' : '') +
        (iss[st.id] ? ' iss-' + iss[st.id] : '') + (active ? ' active' : '');
      var s = '<g class="' + cls + '" data-id="' + esc(st.id) + '">';
      if (st.comment) s += '<title>' + esc(st.comment) + '</title>';
      s += '<rect class="box" x="' + n(st.x - h) + '" y="' + n(st.y - C.H) + '" width="' + n(2 * h) + '" height="' + C.STEP + '"/>';
      if (st.initial) s += '<rect class="box inner" x="' + n(st.x - h + 5) + '" y="' + n(st.y - C.H + 5) + '" width="' + n(2 * h - 10) + '" height="' + (C.STEP - 10) + '"/>';
      s += stepKindSvg(st, h);
      s += '<text class="sname" x="' + n(st.x) + '" y="' + n(st.y + 6) + '" text-anchor="middle">' + esc(st.name) + '</text>';
      if (active) s += '<circle class="token" cx="' + n(st.x) + '" cy="' + n(st.y + 16) + '" r="4"/>';
      if (st.comment) {
        var sp = st.commentPos || 'left';
        var sdx = st.commentDx || 0;
        var sdy = st.commentDy || 0;
        if (sp === 'right') s += commentSvg(st.comment, st.x + R.actionBoxes(st).right + 12 + sdx, st.y + 5 + sdy, 'start', st.id);
        else if (sp === 'above') s += commentSvg(st.comment, st.x + 8 + sdx, st.y - C.H - 12 + sdy, 'start', st.id);
        else if (sp === 'below') s += commentSvg(st.comment, st.x + 8 + sdx, st.y + C.H + 20 + sdy, 'start', st.id);
        else s += commentSvg(st.comment, st.x - h - 10 + sdx, st.y + 5 + sdy, 'end', st.id);
      }
      var ab = R.actionBoxes(st);
      if (ab.boxes.length) {
        s += line(st.x + h, st.y, st.x + ab.boxes[0].x, st.y);
        ab.boxes.forEach(function (bx) {
          var a = bx.a;
          var x = st.x + bx.x;
          var top = st.y + bx.y;
          var bottom = top + C.ACT_H;
          var cx = x + bx.w / 2;
          var mx = x + C.MARK_X;   // Markierungen links über bzw. unter dem Kasten
          s += '<g class="act act-' + a.type + (sim && sim.actOn[a.id] ? ' on' : '') + (sel[a.id] ? ' sel' : '') + '" data-action="' + esc(a.id) + '">';
          s += '<rect class="abox" x="' + n(x) + '" y="' + n(top) + '" width="' + n(bx.w) + '" height="' + C.ACT_H + '"/>';
          if (sim && sim.timers && sim.timers[a.id]) s += timerBar(sim.timers[a.id], x + 4, bottom + 4);
          if (a.type === 'forcing') {
            // Zwangssteuerung: Kasten mit Doppelrahmen
            s += '<rect class="abox inner" x="' + n(x + 4) + '" y="' + n(top + 4) + '" width="' + n(bx.w - 8) + '" height="' + (C.ACT_H - 8) + '"/>';
          }
          s += '<text class="alabel" x="' + n(cx) + '" y="' + n(top + C.ACT_H / 2 + 5) + '" text-anchor="middle">' + esc(R.actionLabel(a)) + '</text>';
          if (a.type === 'conditional') {
            // Zuweisungsbedingung über dem Kasten
            s += line(mx, top, mx, top - C.COND_LINE);
            s += R.exprSvg(a.cond, mx - 4, top - C.COND_LINE - 5, 'start', 'acond', sim && sim.truth).svg;
          } else if (a.type === 'event') {
            // Ereignis über dem Kasten, Strich mit Fähnchen
            var fy = top - C.FLAG_LINE;
            s += line(mx, top, mx, fy);
            s += '<path class="flag" d="M' + n(mx) + ' ' + n(fy) + ' L' + n(mx + 10) + ' ' + n(fy + 3.5) + ' L' + n(mx) + ' ' + n(fy + 7) + ' Z"/>';
            s += R.exprSvg(a.cond, mx - 4, fy - 5, 'start', 'acond', sim && sim.truth).svg;
          } else if (a.type === 'stored' && a.when === 'deactivation') {
            // speichernd bei Deaktivierung: Pfeil nach unten unter dem Kasten
            s += line(mx, bottom, mx, bottom + C.ARROW - 4, 'wire thin') + arrow(mx, bottom + C.ARROW, 'down');
          } else if (a.type === 'stored') {
            // speichernd bei Aktivierung: Pfeil nach oben über dem Kasten
            s += line(mx, top, mx, top - C.ARROW + 4, 'wire thin') + arrow(mx, top - C.ARROW, 'up');
          }
          s += '</g>';
        });
      }
      s += '</g>';
      nodes.push(s);
    });

    // --- Freie Kommentare
    (page.notes || []).forEach(function (nt) {
      var sz = R.noteSize(nt);
      var cls = 'el note' + (sel[nt.id] ? ' sel' : '') + (nt.text.trim() ? '' : ' empty');
      var s = '<g class="' + cls + '" data-id="' + esc(nt.id) + '">' +
        '<rect class="note-box" x="' + n(nt.x) + '" y="' + n(nt.y) + '" width="' + n(sz.w) + '" height="' + n(sz.h) + '" rx="3"/>' +
        '<text class="note-text">' + sz.lines.map(function (ln, i) {
          return '<tspan x="' + n(nt.x + 8) + '" y="' + n(nt.y + 20 + i * C.NOTE_LINE) + '">' + esc(ln || ' ') + '</tspan>';
        }).join('') + '</text></g>';
      nodes.push(s);
      grow(nt.x, nt.y, nt.x + sz.w, nt.y + sz.h);
    });

    if (b.x1 === Infinity) b = { x1: 0, y1: 0, x2: 0, y2: 0 };
    return {
      svg: '<g class="layer-frames">' + frames.join('') + '</g>' +
        '<g class="layer-wires">' + wires.join('') + '</g><g class="layer-nodes">' + nodes.join('') + '</g>',
      bounds: b,
      frames: frameBounds
    };
  };
})(globalThis.GE = globalThis.GE || {});
