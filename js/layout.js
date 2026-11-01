/*
 * layout.js – Raster, Ausrichten und automatisches Layout.
 *
 * Das Auto-Layout ordnet die Elemente in Ebenen an (Schritte und
 * Transitionen abwechselnd) und setzt jede Ebene so, dass Elemente möglichst
 * unter ihren Vorgängern stehen, ohne sich zu überlappen:
 *   1. Rückführungen (Zyklen) per Tiefensuche erkennen und ausklammern
 *   2. Ebene = längster Weg vom Anfang (Zusammenführungen unter allen Zweigen)
 *   3. Mehrere Durchläufe: Wunschposition = Mittel der Nachbarn, danach
 *      Überlappungen mit minimaler Verschiebung auflösen (isotone Regression)
 */
(function (GE) {
  'use strict';

  var L = (GE.layout = {});
  var M = GE.model;
  var R = GE.render;
  var U = GE.util;

  var MARGIN_X = 140;  // linker Rand (Platz für Rückführungen)
  var MARGIN_Y = 80;   // oberer Rand (Mitte der ersten Ebene)
  var SPACING = 36;    // Mindestabstand zwischen Elementen einer Ebene

  /** Alle Knoten auf das Raster setzen. */
  L.snapAll = function (page) {
    M.nodes(page).forEach(function (nd) {
      nd.x = U.snap(nd.x, M.GRID);
      nd.y = U.snap(nd.y, M.GRID);
    });
  };

  /** Ausgewählte Knoten auf eine senkrechte Linie (x des Bezugselements). */
  L.alignVertical = function (page, ids, refId) {
    var list = ids.map(function (id) { return M.node(page, id); }).filter(Boolean);
    if (list.length < 2) return false;
    var ref = (refId && M.node(page, refId)) || list[0];
    list.forEach(function (nd) { nd.x = ref.x; });
    return true;
  };

  /** Ausgewählte Knoten auf eine waagerechte Linie (y des Bezugselements). */
  L.alignHorizontal = function (page, ids, refId) {
    var list = ids.map(function (id) { return M.node(page, id); }).filter(Boolean);
    if (list.length < 2) return false;
    var ref = (refId && M.node(page, refId)) || list[0];
    list.forEach(function (nd) { nd.y = ref.y; });
    return true;
  };

  /**
   * Isotone Regression: Positionen in fester Reihenfolge, so nah wie möglich
   * an den Wunschpositionen, mit Mindestabständen gaps[i] zwischen i und i+1.
   */
  function placeRow(desired, gaps) {
    var off = [0];
    for (var i = 0; i < gaps.length; i++) off.push(off[i] + gaps[i]);
    var blocks = [];
    desired.forEach(function (d, k) {
      blocks.push({ sum: d - off[k], cnt: 1 });
      while (blocks.length > 1) {
        var a = blocks[blocks.length - 2];
        var b = blocks[blocks.length - 1];
        if (a.sum / a.cnt <= b.sum / b.cnt) break;
        a.sum += b.sum;
        a.cnt += b.cnt;
        blocks.pop();
      }
    });
    var res = [];
    blocks.forEach(function (bl) {
      for (var j = 0; j < bl.cnt; j++) res.push(bl.sum / bl.cnt);
    });
    return res.map(function (v, k) { return v + off[k]; });
  }
  L._placeRow = placeRow;

  /**
   * Automatisches Layout der ganzen Seite. Jeder Rahmen (Teil-GRAFCET,
   * Makro-Expansion, eingeschlossener Inhalt) wird für sich angeordnet und
   * danach auf seinen Inhalt angepasst. Eingebettete Rahmen stehen rechts
   * neben dem Inhalt ihres Rahmens; Rahmen der obersten Ebene stehen
   * nebeneinander (Elemente ohne Rahmen zuerst). Freie Kommentare wandern mit.
   */
  L.auto = function (page) {
    var frames = page.frames || [];
    if (!frames.length) return layoutGroup(page);
    // Zugehörigkeit vor dem Verschieben festhalten
    var own = { '': [] };
    var notesOf = { '': [] };
    var children = { '': [] };
    frames.forEach(function (fr) { own[fr.id] = []; notesOf[fr.id] = []; children[fr.id] = []; });
    M.nodes(page).forEach(function (n) {
      var fr = M.frameOf(page, n);
      own[fr ? fr.id : ''].push(n);
    });
    (page.notes || []).forEach(function (nt) {
      var fr = M.frameOf(page, nt);
      notesOf[fr ? fr.id : ''].push(nt);
    });
    frames.forEach(function (fr) {
      var p = M.parentFrame(page, fr);
      children[p ? p.id : ''].push(fr);
    });
    Object.keys(children).forEach(function (k) {
      children[k].sort(function (a, b) { return a.x - b.x || a.y - b.y; });
    });

    function shift(list, dx, dy) {
      list.forEach(function (n) { n.x += dx; n.y += dy; });
    }

    /** Ordnet Inhalt von fid ab (ox, oy) an, liefert das umschließende Rechteck. */
    function place(fid, ox, oy) {
      var nodes = own[fid];
      var notes = notesOf[fid];
      var box = null;
      if (nodes.length) {
        var ids = {};
        nodes.forEach(function (n) { ids[n.id] = true; });
        var sub = {
          steps: nodes.filter(function (n) { return n.actions; }),
          transitions: nodes.filter(function (n) { return !n.actions; }),
          links: page.links.filter(function (l) { return ids[l.from] && ids[l.to]; })
        };
        var before = nodes.map(function (n) { return { x: n.x, y: n.y }; });
        layoutGroup(sub);
        var mdx = 0;
        var mdy = 0;
        nodes.forEach(function (n, i) { mdx += n.x - before[i].x; mdy += n.y - before[i].y; });
        notes.forEach(function (nt) { nt.x = U.snap(nt.x + mdx / nodes.length, M.GRID); nt.y = U.snap(nt.y + mdy / nodes.length, M.GRID); });
        box = bounds(page, nodes);
        var dx = U.snap(ox - box.x1, M.GRID);
        var dy = U.snap(oy - box.y1, M.GRID);
        shift(nodes.concat(notes), dx, dy);
        box = bounds(page, nodes.concat(notes));
      } else if (notes.length) {
        box = bounds(page, notes);
        shift(notes, ox - box.x1, oy - box.y1);
        box = bounds(page, notes);
      }
      var cx = box ? box.x2 + 60 : ox;
      var rects = box ? [box] : [];
      children[fid].forEach(function (ch) {
        var r = placeFrame(ch, cx, oy);
        rects.push({ x1: r.x, y1: r.y, x2: r.x + r.w, y2: r.y + r.h });
        cx = r.x + r.w + 40;
      });
      if (!rects.length) return null;
      return {
        x1: Math.min.apply(null, rects.map(function (r) { return r.x1; })),
        y1: Math.min.apply(null, rects.map(function (r) { return r.y1; })),
        x2: Math.max.apply(null, rects.map(function (r) { return r.x2; })),
        y2: Math.max.apply(null, rects.map(function (r) { return r.y2; }))
      };
    }

    /** Rahmen samt Inhalt an (ox, oy) setzen und auf den Inhalt anpassen. */
    function placeFrame(fr, ox, oy) {
      var inner = place(fr.id, ox + R.C.FRAME_PAD + R.C.FRAME_LEFT, oy + R.C.FRAME_PAD + R.C.FRAME_HEAD);
      if (!inner) {
        fr.x = U.snap(ox, M.GRID);
        fr.y = U.snap(oy, M.GRID);
        return fr;
      }
      fr.x = U.snap(inner.x1 - R.C.FRAME_PAD, M.GRID);
      fr.y = U.snap(inner.y1 - R.C.FRAME_PAD - R.C.FRAME_HEAD, M.GRID);
      fr.w = Math.ceil((inner.x2 + R.C.FRAME_PAD - fr.x) / M.GRID) * M.GRID;
      fr.h = Math.ceil((inner.y2 + R.C.FRAME_PAD - fr.y) / M.GRID) * M.GRID;
      return fr;
    }

    place('', MARGIN_X, MARGIN_Y);
  };

  /** Rechteck um Elemente (Schritte/Transitionen mit Aktionen und Text, Kommentare). */
  function bounds(page, els) {
    var b = { x1: Infinity, y1: Infinity, x2: -Infinity, y2: -Infinity };
    els.forEach(function (el) {
      var r = R.elementBox(page, el);
      b.x1 = Math.min(b.x1, r.x1); b.y1 = Math.min(b.y1, r.y1);
      b.x2 = Math.max(b.x2, r.x2); b.y2 = Math.max(b.y2, r.y2);
    });
    return b;
  }

  /** Layout einer Gruppe (ganze Seite oder ein Teil-GRAFCET). */
  function layoutGroup(page) {
    var nodes = M.nodes(page);
    if (!nodes.length) return;
    var byId = {};
    var isStep = {};
    nodes.forEach(function (nd) { byId[nd.id] = nd; });
    page.steps.forEach(function (s) { isStep[s.id] = true; });

    var out = {};
    nodes.forEach(function (nd) { out[nd.id] = []; });
    page.links.forEach(function (l) {
      if (byId[l.from] && byId[l.to]) out[l.from].push(l.to);
    });
    Object.keys(out).forEach(function (id) {
      out[id].sort(function (a, b) { return byId[a].x - byId[b].x; });
    });

    // 1. Rückführungen erkennen (Tiefensuche ab den Anfangsschritten)
    var state = {};
    var back = {};
    function dfs(u) {
      state[u] = 1;
      out[u].forEach(function (v) {
        if (state[v] === 1) back[u + '>' + v] = true;
        else if (!state[v]) dfs(v);
      });
      state[u] = 2;
    }
    nodes.slice().sort(function (a, b) {
      return (b.initial ? 1 : 0) - (a.initial ? 1 : 0) || a.y - b.y || a.x - b.x;
    }).forEach(function (nd) { if (!state[nd.id]) dfs(nd.id); });

    var fout = {};
    var fin = {};
    nodes.forEach(function (nd) { fout[nd.id] = []; fin[nd.id] = []; });
    Object.keys(out).forEach(function (u) {
      out[u].forEach(function (v) {
        if (back[u + '>' + v]) return;
        fout[u].push(v);
        fin[v].push(u);
      });
    });

    // 2. Ebenen nach längstem Weg; Schritte auf geraden, Transitionen auf ungeraden Ebenen
    var rank = {};
    var indeg = {};
    var queue = [];
    nodes.forEach(function (nd) {
      indeg[nd.id] = fin[nd.id].length;
      if (!indeg[nd.id]) { rank[nd.id] = isStep[nd.id] ? 0 : 1; queue.push(nd.id); }
    });
    while (queue.length) {
      var u = queue.shift();
      fout[u].forEach(function (v) {
        var r = rank[u] + 1;
        if ((r % 2 === 0) !== !!isStep[v]) r++;
        rank[v] = Math.max(rank[v] == null ? -1 : rank[v], r);
        if (--indeg[v] === 0) queue.push(v);
      });
    }
    var layers = [];
    nodes.forEach(function (nd) {
      var r = rank[nd.id] == null ? 0 : rank[nd.id];
      (layers[r] = layers[r] || []).push(nd);
    });
    for (var i = 0; i < layers.length; i++) layers[i] = layers[i] || [];

    // 3. Waagerechte Positionen
    var ext = {};
    nodes.forEach(function (nd) { ext[nd.id] = R.extent(page, nd); });
    var x = {};
    nodes.forEach(function (nd) { x[nd.id] = nd.x; });

    function sweepLayer(layer, neighbours) {
      if (!layer.length) return;
      var items = layer.map(function (nd, k) {
        var nb = neighbours[nd.id];
        var want = nb.length
          ? nb.reduce(function (s, id) { return s + x[id]; }, 0) / nb.length
          : x[nd.id];
        return { nd: nd, want: want, prev: x[nd.id], k: k };
      });
      items.sort(function (a, b) { return a.want - b.want || a.prev - b.prev || a.k - b.k; });
      var gaps = [];
      for (var j = 0; j + 1 < items.length; j++) {
        gaps.push(ext[items[j].nd.id].right + ext[items[j + 1].nd.id].left + SPACING);
      }
      var pos = placeRow(items.map(function (it) { return it.want; }), gaps);
      items.forEach(function (it, j) { x[it.nd.id] = pos[j]; });
      layer.splice.apply(layer, [0, layer.length].concat(items.map(function (it) { return it.nd; })));
    }

    for (var pass = 0; pass < 6; pass++) {
      var down = pass % 2 === 0;
      if (down) for (var a = 0; a < layers.length; a++) sweepLayer(layers[a], fin);
      else for (var c = layers.length - 1; c >= 0; c--) sweepLayer(layers[c], fout);
    }
    // letzter Durchlauf von oben, damit Ketten exakt untereinander stehen
    for (var e = 0; e < layers.length; e++) sweepLayer(layers[e], fin);

    // 4. Senkrechte Positionen: mindestens PITCH, mehr bei hohen Aktionen
    //    (Bedingungen, Pfeile, Aktionen untereinander)
    var yOf = [];
    var y = MARGIN_Y;
    function maxExt(layer, key) {
      return layer.reduce(function (m, nd) { return Math.max(m, ext[nd.id][key]); }, 0);
    }
    layers.forEach(function (layer, r) {
      if (r > 0) {
        var need = maxExt(layers[r - 1], 'bottom') + maxExt(layer, 'top') + 12;
        y += Math.max(M.PITCH, Math.ceil(need / M.GRID) * M.GRID);
      }
      yOf[r] = y;
    });

    var minLeft = Infinity;
    nodes.forEach(function (nd) { minLeft = Math.min(minLeft, x[nd.id] - ext[nd.id].left); });
    var shift = MARGIN_X - minLeft;
    layers.forEach(function (layer, r) {
      layer.forEach(function (nd) {
        nd.x = U.snap(x[nd.id] + shift, M.GRID);
        nd.y = yOf[r];
      });
    });
  }
})(globalThis.GE = globalThis.GE || {});
