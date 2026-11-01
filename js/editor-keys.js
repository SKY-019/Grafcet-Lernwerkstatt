/*
 * editor-keys.js – Zeichnung ohne Maus bedienen (Nachbar wählen, Werkzeug + Enter).
 * Teil des Editors (GE.editor); gemeinsame Hilfen kommen aus editor.js über GE.editor._.
 */
(function (GE) {
  'use strict';

  var Ed = GE.editor;
  var I = Ed._;
  var M = GE.model;
  var U = GE.util;
  var svgRect = I.svgRect;
  var isNode = I.isNode;
  var frameTool = I.frameTool;
  var structTool = I.structTool;
  var createFrame = I.createFrame;
  var addActionTo = I.addActionTo;
  var addNoteAt = I.addNoteAt;
  var autoSource = I.autoSource;
  var place = I.place;
  var finishConnect = I.finishConnect;
  var insertPattern = I.insertPattern;

  function centerWorld() {
    var r = svgRect();
    var w = Ed.toWorld(r.left + r.width / 2, r.top + r.height / 2);
    return { x: U.snap(w.x, M.GRID), y: U.snap(w.y, M.GRID) };
  }

  /**
   * Strg/Alt + Pfeiltaste: das nächste Schritt- oder Transitionssymbol in dieser
   * Richtung auswählen; ohne Auswahl den Anfangsschritt. Ein laufendes
   * Verbinden (Quelle gewählt) bleibt erhalten.
   */
  Ed.selectNeighbor = function (dx, dy) {
    var page = GE.app.page();
    var nodes = M.nodes(page);
    if (!nodes.length) return;
    var curId = GE.app.primary && M.node(page, GE.app.primary) ? GE.app.primary : GE.app.selectedNodeIds()[0];
    var target = null;
    if (!curId) {
      target = page.steps.filter(function (s) { return s.initial; })[0] || nodes[0];
    } else {
      var c = M.node(page, curId);
      var best = Infinity;
      nodes.forEach(function (n) {
        if (n.id === curId) return;
        var along = (n.x - c.x) * dx + (n.y - c.y) * dy;
        var across = Math.abs((n.x - c.x) * dy - (n.y - c.y) * dx);
        if (along <= 0 || across > 2 * along) return;   // grob in Pfeilrichtung
        var score = along + 2 * across;
        if (score < best) { best = score; target = n; }
      });
    }
    if (!target) return;
    var pending = GE.app.pendingConnect;
    GE.app.select([target.id]);
    if (pending) { GE.app.pendingConnect = pending; GE.app.updateHint(); }
    Ed.reveal(target.id);
  };

  /** Liegt bei (x, y) schon ein Element? Dann um einen Zweigabstand nach rechts. */
  function freeSpot(x, y) {
    var nodes = M.nodes(GE.app.page());
    for (var i = 0; i < 20; i++) {
      var hit = nodes.some(function (n) { return Math.abs(n.x - x) < M.BRANCH && Math.abs(n.y - y) < M.PITCH; });
      if (!hit) break;
      x += 2 * M.BRANCH;
    }
    return { x: x, y: y };
  }

  /**
   * Enter bei gewähltem Werkzeug: Werkzeug ohne Mausklick auf die Auswahl anwenden.
   * Schritt/Transition: unter das ausgewählte Element (verbunden, wenn passend);
   * Verbinden/Sprung: erst Quelle, dann Ziel (mit Strg+Pfeiltasten wählen).
   */
  Ed.applyToolByKey = function () {
    if (GE.app.mode === 'sim') return;
    var page = GE.app.page();
    var tool = GE.app.tool;
    var id = GE.app.primary && GE.app.sel[GE.app.primary] ? GE.app.primary : Object.keys(GE.app.sel)[0] || null;
    var kind = id ? M.kindOf(page, id) : null;
    var el = id ? M.movable(page, id) : null;
    var node = isNode(id) ? M.node(page, id) : null;
    switch (tool) {
      case 'step':
      case 'initial':
      case 'transition':
        if (!node) return place(tool, centerWorld());
        var fits = (node.cond !== undefined) !== (tool === 'transition');
        var spot = freeSpot(node.x, node.y + (fits ? M.PITCH : 2 * M.PITCH));
        return place(tool, spot, fits && autoSource(tool === 'initial' ? 'step' : tool) ? undefined : null);
      case 'connect':
      case 'jump':
        if (!node) return GE.app.toast('Erst ein Element auswählen (Strg+Pfeiltasten), dann Enter.', 'warn');
        if (!GE.app.pendingConnect) {
          GE.app.pendingConnect = id;
          GE.app.updateHint();
          GE.app.toast('Quelle gewählt – Ziel mit Strg+Pfeiltasten wählen, dann Enter.');
        } else if (GE.app.pendingConnect !== id) {
          finishConnect(GE.app.pendingConnect, id);
        }
        return;
      case 'or':
      case 'and':
        return insertPattern(tool, node ? id : null, node ? { x: node.x, y: node.y + 2 * M.PITCH } : centerWorld());
      case 'comment':
        if (kind === 'note') return Ed.startInline(id);
        if (node) return Ed.startInline(id, 'comment');
        return addNoteAt(centerWorld());
      case 'frame':
        if (node || kind === 'frame') return frameTool(id, el || centerWorld());
        var c = centerWorld();
        return createFrame(c, c, false);
      case 'macro':
      case 'enclosing':
        return structTool(tool, kind === 'step' ? id : null, node || centerWorld());
      default:
        if (Ed.ACT_TOOLS[tool]) addActionTo(kind === 'step' ? id : null, Ed.ACT_TOOLS[tool]);
    }
  };
})(globalThis.GE = globalThis.GE || {});
