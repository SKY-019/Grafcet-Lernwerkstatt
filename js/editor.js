/*
 * editor.js – Zeichenfläche: Ansicht (Zoom, Verschieben), Werkzeuge,
 * Auswahl, Ziehen, Verbinden und Beschriften direkt in der Zeichnung.
 *
 * Der Zustand liegt in GE.app (app.js); dieses Modul liest ihn und ruft für
 * Änderungen app.change(...) auf, damit Rückgängig funktioniert.
 */
(function (GE) {
  'use strict';

  var Ed = (GE.editor = {});
  var M = GE.model;
  var R = GE.render;
  var U = GE.util;

  var app;
  var svg, viewport, content, overlay, pattern, gridDot;
  var drag = null;          // laufende Zeiger-Aktion
  var touches = {};         // aktive Touch-Zeiger (für Pinch-Zoom)
  var pinch = null;
  var spaceDown = false;
  var lastBounds = null;
  var lastWorld = { x: 0, y: 0 };
  var lastFrames = {};      // Begrenzung der Rahmen aus der letzten Zeichnung
  var lastPointer;          // pointerId des letzten pointerdown
  var longPress = null;     // Touch: lange drücken öffnet das Menü
  var lastTap = null;       // Touch: Doppeltippen = beschriften
  var doubleTap = null;
  var suppressMenuClick = false; // Loslassen nach langem Drücken löst keinen Menüpunkt aus

  var LONG_PRESS_MS = 550;      // Touch: so lange drücken = Menü
  var PALETTE_CLICK_MS = 60;    // Klick direkt nach dem Ziehen aus dem Menü nicht als Werkzeugwahl werten
  var MIN_K = 0.2;
  var MAX_K = 4;

  Ed.TOOL_HINTS = {
    select: 'Klicken: auswählen · Ziehen: verschieben · Ausgewähltes Element am unteren Rand (Kreis) ziehen: verbinden · Doppelklick: beschriften · Rechtsklick: Menü',
    initial: 'Klicke auf eine freie Stelle, um einen Anfangsschritt zu setzen.',
    step: 'Klicke auf eine freie Stelle, um einen Schritt zu setzen. Eine ausgewählte Transition ohne Nachfolger wird automatisch verbunden.',
    transition: 'Klicke auf eine freie Stelle, um eine Transition zu setzen. Ein ausgewählter Schritt ohne Nachfolger wird automatisch verbunden.',
    connect: 'Ziehe von einem Element zum nächsten – oder klicke nacheinander Quelle und Ziel.',
    jump: 'Klicke auf die Transition (oder den Schritt), von der der Sprung ausgeht, und dann auf den Zielschritt.',
    or: 'Klicke auf einen Schritt: ODER-Verzweigung anlegen bzw. weiteren Zweig ergänzen. Freie Stelle: neuer Block.',
    and: 'Klicke auf eine Transition oder einen Schritt: UND-Verzweigung anlegen bzw. weiteren Zweig ergänzen.',
    comment: 'Klick auf einen Schritt oder eine Transition: deren Kommentar bearbeiten. Klick auf eine freie Stelle: freier Kommentar.',
    'act-continuous': 'Klicke auf einen Schritt, um eine kontinuierliche Aktion anzuhängen.',
    'act-conditional': 'Klicke auf einen Schritt, um eine bedingte Aktion anzuhängen.',
    'act-stored-on': 'Klicke auf einen Schritt, um eine speichernde Aktion bei Aktivierung anzuhängen.',
    'act-stored-off': 'Klicke auf einen Schritt, um eine speichernde Aktion bei Deaktivierung anzuhängen.',
    'act-event': 'Klicke auf einen Schritt, um eine Aktion bei Ereignis anzuhängen.',
    'act-forcing': 'Klicke auf einen Schritt, um eine Zwangssteuerung (z. B. G2{INIT}) anzuhängen.',
    macro: 'Klick auf eine freie Stelle: neuer Makroschritt mit Expansion. Klick auf einen Schritt: in einen Makroschritt umwandeln.',
    enclosing: 'Klick auf eine freie Stelle: neuer einschließender Schritt mit Inhalt. Klick auf einen Schritt: umwandeln.',
    frame: 'Rahmen aufziehen (oder auf eine freie Stelle klicken): neuer Teil-GRAFCET. Alles, was im Rahmen liegt, gehört dazu. Klick auf einen Ablauf: ihn einrahmen.'
  };

  /** Werkzeuge im Abschnitt „Aktionen“: Art der neuen Aktion. */
  Ed.ACT_TOOLS = {
    'act-continuous': { type: 'continuous', label: 'kontinuierlich' },
    'act-conditional': { type: 'conditional', label: 'bedingt' },
    'act-stored-on': { type: 'stored', when: 'activation', label: 'speichernd bei Aktivierung' },
    'act-stored-off': { type: 'stored', when: 'deactivation', label: 'speichernd bei Deaktivierung' },
    'act-event': { type: 'event', label: 'bei Ereignis' },
    'act-forcing': { type: 'forcing', label: 'Zwangssteuerung' }
  };

  Ed.init = function (theApp) {
    app = theApp;
    svg = document.getElementById('canvas');
    viewport = document.getElementById('viewport');
    content = document.getElementById('content');
    overlay = document.getElementById('overlay');
    pattern = document.getElementById('gridDots');
    gridDot = document.getElementById('gridDot');
    Ed.initInline();

    svg.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    svg.addEventListener('wheel', onWheel, { passive: false });
    svg.addEventListener('dblclick', onDblClick);
    svg.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    // Menütaste: nicht zusätzlich das Browsermenü öffnen
    document.addEventListener('contextmenu', function (e) { if (Ed.isMenuOpen()) e.preventDefault(); });
    svg.addEventListener('pointerleave', function () { if (!drag) overlay.innerHTML = ''; });

    window.addEventListener('resize', function () { Ed.applyView(); });
    // Die Fläche wird nie gescrollt (Ansicht verschieben geht über app.view); der Browser
    // scrollt sie sonst beim Fokussieren eines Eingabefelds am Rand
    var wrap = svg.parentNode;
    wrap.addEventListener('scroll', function () {
      if (wrap.scrollLeft || wrap.scrollTop) { wrap.scrollLeft = 0; wrap.scrollTop = 0; }
    });
    Ed.applyView();
  };

  // ------------------------------------------------------------ Ansicht

  Ed.applyView = function () {
    var v = app.view;
    viewport.setAttribute('transform', 'translate(' + U.n(v.x) + ',' + U.n(v.y) + ') scale(' + U.n(v.k) + ')');
    var g = M.GRID * v.k;
    pattern.setAttribute('width', g);
    pattern.setAttribute('height', g);
    pattern.setAttribute('x', U.n(((v.x % g) + g) % g));
    pattern.setAttribute('y', U.n(((v.y % g) + g) % g));
    gridDot.setAttribute('r', U.clamp(1.1 * Math.sqrt(v.k), 0.6, 1.6));
    gridDot.style.display = g < 7 ? 'none' : '';
    var zl = document.getElementById('btnZoomReset');
    if (zl) zl.textContent = Math.round(v.k * 100) + ' %';
    if (Ed.positionInline) Ed.positionInline();
  };

  function svgRect() {
    return svg.getBoundingClientRect();
  }

  /** Bildschirm- in Zeichnungskoordinaten. */
  Ed.toWorld = function (clientX, clientY) {
    var r = svgRect();
    return { x: (clientX - r.left - app.view.x) / app.view.k, y: (clientY - r.top - app.view.y) / app.view.k };
  };

  function toScreen(x, y) {
    return { x: x * app.view.k + app.view.x, y: y * app.view.k + app.view.y };
  }

  /** Zoomt um factor, wobei der Punkt (sx, sy) in SVG-Pixeln fest bleibt. */
  Ed.zoomAt = function (factor, sx, sy) {
    var v = app.view;
    var k = U.clamp(v.k * factor, MIN_K, MAX_K);
    if (sx === undefined) {
      var r = svgRect();
      sx = r.width / 2;
      sy = r.height / 2;
    }
    v.x = sx - (sx - v.x) * (k / v.k);
    v.y = sy - (sy - v.y) * (k / v.k);
    v.k = k;
    Ed.applyView();
  };

  Ed.setZoom = function (k) {
    Ed.zoomAt(k / app.view.k);
  };

  /** Ganze Zeichnung in den sichtbaren Bereich einpassen. */
  Ed.fit = function () {
    var b = lastBounds;
    var r = svgRect();
    if (!b || !isFinite(b.x1) || b.x2 <= b.x1) {
      app.view.x = 40; app.view.y = 40; app.view.k = 1;
      Ed.applyView();
      return;
    }
    var pad = 50;
    var w = Math.max(10, r.width - 2 * pad);
    var h = Math.max(10, r.height - 2 * pad - 24);
    var k = U.clamp(Math.min(w / (b.x2 - b.x1), h / (b.y2 - b.y1)), MIN_K, 1.4);
    app.view.k = k;
    app.view.x = (r.width - (b.x2 - b.x1) * k) / 2 - b.x1 * k;
    app.view.y = pad - b.y1 * k;
    Ed.applyView();
  };

  /** Element in die Mitte holen, falls es nicht sichtbar ist. */
  Ed.reveal = function (id) {
    var nd = M.movable(app.page(), id);
    if (!nd) {
      var f = M.find(app.page(), id);
      if (!f) return;
      nd = M.node(app.page(), f.el.from);
      if (!nd) return;
    }
    var r = svgRect();
    var p = toScreen(nd.x, nd.y);
    if (p.x < 60 || p.y < 60 || p.x > r.width - 60 || p.y > r.height - 80) {
      app.view.x += r.width / 2 - p.x;
      app.view.y += r.height / 2 - p.y;
      Ed.applyView();
    }
  };

  // ------------------------------------------------------------ Zeichnen

  Ed.render = function () {
    var page = app.page();
    var simInfo = app.mode === 'sim' ? GE.simui.renderInfo() : null;
    var res = simInfo
      ? R.page(page, { selected: {}, issues: {}, sim: simInfo })
      : R.page(page, { selected: Object.assign({}, app.sel), issues: app.issueMap });
    content.innerHTML = res.svg + (simInfo ? '' : portsSvg());
    lastBounds = res.bounds;
    lastFrames = res.frames || {};
    renderFrameNav(page, simInfo);
    document.getElementById('emptyHint').hidden = page.steps.length + page.transitions.length > 0;
    if (drag && drag.type === 'connect' && drag.target) markTarget(drag.target);
  };

  /** Anschlusspunkt unten am Element (Start beim Verbinden per Ziehen). */
  function portPoint(id) {
    var f = M.find(app.page(), id);
    if (!f) return null;
    if (f.kind === 'step') return { x: f.el.x, y: f.el.y + R.C.H };
    if (f.kind === 'transition') return { x: f.el.x, y: f.el.y + 12 };
    return null;
  }

  /** Anschlusspunkt oben (Verbinden von unten nach oben: neuer Vorgänger). */
  function portTopPoint(id) {
    var f = M.find(app.page(), id);
    if (!f) return null;
    if (f.kind === 'step') return { x: f.el.x, y: f.el.y - R.C.H };
    if (f.kind === 'transition') return { x: f.el.x, y: f.el.y - 12 };
    return null;
  }

  function portsSvg() {
    if (app.tool !== 'select' && app.tool !== 'connect') return '';
    var ids = Object.keys(app.sel);
    if (ids.length > 6) return '';
    return ids.map(function (id) {
      var p = portPoint(id);
      var q = portTopPoint(id);
      if (!p) return '';
      return '<circle class="port" data-port="' + U.esc(id) + '" cx="' + U.n(p.x) + '" cy="' + U.n(p.y) + '" r="6">' +
        '<title>Ziehen: Nachfolger verbinden bzw. anlegen</title></circle>' +
        '<circle class="port top" data-port="' + U.esc(id) + '" data-top="1" cx="' + U.n(q.x) + '" cy="' + U.n(q.y) + '" r="6">' +
        '<title>Ziehen: Vorgänger verbinden bzw. anlegen</title></circle>';
    }).join('');
  }

  /** Navigationsleiste mit allen Teil-GRAFCETs (Sprung per Klick, Punkt = aktiv in der Simulation). */
  function renderFrameNav(page, simInfo) {
    var nav = document.getElementById('frameNav');
    var frames = page.frames || [];
    nav.hidden = !frames.length;
    if (!frames.length) { nav.innerHTML = ''; return; }
    nav.innerHTML = '<span class="frame-nav-title">Teil-GRAFCETs</span>' + frames.map(function (fr) {
      var active = simInfo && M.frameMembers(page, fr.id, true).some(function (el) { return simInfo.active[el.id]; });
      var label = R.frameLabel(page, fr);
      return '<button data-frame="' + U.esc(fr.id) + '" class="kind-' + U.esc(fr.kind) + (app.sel[fr.id] ? ' on' : '') + '" title="Zu ' + U.esc(label) + ' springen">' +
        (simInfo ? '<span class="dot' + (active ? ' on' : '') + '"></span>' : '') + U.esc(label) + '</button>';
    }).join('') + '<button data-frame="" title="Ganze Zeichnung zeigen">Alles</button>' + forcingOverview(page, simInfo);
  }

  /**
   * Übersicht „wer zwingt wen“: eine Zeile je Zwangssteuerung, z. B.
   * „G_Sicherheit ⟶ G1{INIT} (Schritt 11)“. In der Simulation sind wirksame
   * Zwangssteuerungen hervorgehoben.
   */
  function forcingOverview(page, simInfo) {
    var items = [];
    page.steps.forEach(function (s) {
      s.actions.forEach(function (a) {
        if (a.type !== 'forcing') return;
        var from = M.partialOf(page, s);
        var on = simInfo && simInfo.active[s.id];
        items.push('<span class="force-item' + (on ? ' on' : '') + '" title="Zwangssteuerung in Schritt ' + U.esc(s.name) + '">' +
          U.esc(from ? from.name : 'ohne Rahmen') + ' <b>⟶</b> ' + U.esc(M.forcingLabel(a)) +
          ' <span class="muted">(Schritt ' + U.esc(s.name) + ')</span></span>');
      });
    });
    if (!items.length) return '';
    return '<span class="frame-nav-sep"></span><span class="frame-nav-title">Zwang</span>' + items.join('');
  }

  /** Ansicht auf einen Bereich einpassen. */
  Ed.fitBounds = function (b) {
    var r = svgRect();
    var pad = 40;
    var k = U.clamp(Math.min((r.width - 2 * pad) / (b.x2 - b.x1), (r.height - 2 * pad - 24) / (b.y2 - b.y1)), MIN_K, 1.4);
    app.view.k = k;
    app.view.x = (r.width - (b.x2 - b.x1) * k) / 2 - b.x1 * k;
    app.view.y = pad - b.y1 * k;
    Ed.applyView();
  };

  /** Ansicht so verschieben, dass der Punkt (x, y) in der Mitte liegt. */
  Ed.centerOn = function (x, y) {
    var r = svgRect();
    app.view.x = r.width / 2 - x * app.view.k;
    app.view.y = r.height / 2 - y * app.view.k;
    Ed.applyView();
  };

  Ed.showFrame = function (fid) {
    var b = lastFrames[fid];
    if (b) Ed.fitBounds(b);
  };

  // ------------------------------------------------------------ Zeiger

  function portHit(target) {
    var el = target && target.closest ? target.closest('[data-port]') : null;
    return el ? el.getAttribute('data-port') : null;
  }

  function portIsTop(target) {
    var el = target && target.closest ? target.closest('[data-port]') : null;
    return !!(el && el.hasAttribute('data-top'));
  }

  /** Liegt der Punkt in der unteren Hälfte des (ausgewählten) Schrittkastens? */
  function inLowerHalf(id, world) {
    var f = M.find(app.page(), id);
    if (!f || f.kind !== 'step') return false;
    var s = f.el;
    return world.y > s.y + 2 && world.y <= s.y + R.C.H + 3 && Math.abs(world.x - s.x) <= R.stepHalf(s);
  }

  function hitId(target) {
    var el = target && target.closest ? target.closest('[data-id]') : null;
    return el ? el.getAttribute('data-id') : null;
  }

  function hitAction(target) {
    var el = target && target.closest ? target.closest('[data-action]') : null;
    return el ? el.getAttribute('data-action') : null;
  }

  function isNode(id) {
    return !!(id && M.node(app.page(), id));
  }

  function svgPoint(e) {
    var r = svgRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function onDown(e) {
    if (Ed.isInlineActive()) Ed.finishInline(true);
    // Eingabe im Eigenschaftsfeld abschließen (preventDefault verhindert sonst den Fokuswechsel)
    var ae = document.activeElement;
    if (ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)) ae.blur();
    if (e.pointerType === 'touch') {
      touches[e.pointerId] = svgPoint(e);
      var ids = Object.keys(touches);
      if (ids.length === 2) {
        // zweiter Finger: laufende Aktion abbrechen, Pinch starten
        clearLongPress();
        cancelDrag();
        var a = touches[ids[0]];
        var b = touches[ids[1]];
        pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
        return;
      }
    }
    var world = Ed.toWorld(e.clientX, e.clientY);
    var id = hitId(e.target);
    lastPointer = e.pointerId;
    clearLongPress();
    if (e.pointerType === 'touch' && app.mode !== 'sim' && Object.keys(touches).length === 1) {
      var lpTarget = hitAction(e.target) || id;
      var lpX = e.clientX;
      var lpY = e.clientY;
      longPress = { x: lpX, y: lpY, timer: setTimeout(function () {
        longPress = null;
        cancelDrag();
        suppressMenuClick = true;
        Ed.showMenu(lpX, lpY, lpTarget, world);
      }, LONG_PRESS_MS) };
      var now = Date.now();
      if (id && lastTap && lastTap.id === id && now - lastTap.t < 350) { doubleTap = e.target; lastTap = null; }
      else lastTap = id ? { id: id, t: now } : null;
    }

    // Ansicht verschieben: mittlere/rechte Taste, Leertaste, Finger auf freier Fläche;
    // in der Simulation ist die Zeichnung gesperrt, Ziehen verschiebt immer die Ansicht
    if (app.mode === 'sim' || e.button === 1 || e.button === 2 || spaceDown ||
        (e.pointerType === 'touch' && !id && !(app.multiSelect && app.tool === 'select') &&
         (app.tool === 'select' || app.tool === 'connect' || app.tool === 'jump'))) {
      e.preventDefault();
      drag = {
        type: 'pan', sx: e.clientX, sy: e.clientY, vx: app.view.x, vy: app.view.y, pid: e.pointerId,
        menu: e.button === 2 && app.mode !== 'sim', id: hitAction(e.target) || id, world: world
      };
      svg.classList.add('panning');
      return;
    }
    if (e.button !== 0) return;
    e.preventDefault();

    // Mehrfachauswahl: Umschalt gedrückt oder Schalter „Mehrfach“ (für Touch)
    var multi = e.shiftKey || !!app.multiSelect;
    switch (app.tool) {
      case 'select':
        var handle = e.target.closest ? e.target.closest('[data-handle]') : null;
        if (handle) {
          var hf = M.find(app.page(), handle.getAttribute('data-handle')).el;
          app.history.begin();
          drag = { type: 'resize', frame: hf, start: world, w: hf.w, h: hf.h, pid: e.pointerId };
          return;
        }
        var port = portHit(e.target);
        if (port) {
          startConnect(port, world, e, portIsTop(e.target));
          return;
        }
        if (id && app.sel[id] && !multi && inLowerHalf(id, world)) {
          startConnect(id, world, e);
          return;
        }
        var cmt = e.target.closest ? e.target.closest('[data-cmt]') : null;
        if (cmt && !multi) {
          // Kommentar eines Schritts/einer Transition verschieben
          var owner = M.node(app.page(), cmt.getAttribute('data-cmt'));
          app.select([owner.id]);
          drag = { type: 'cmt', el: owner, start: world, dx: owner.commentDx || 0, dy: owner.commentDy || 0, pid: e.pointerId, moved: false };
          return;
        }
        var aid = hitAction(e.target);
        if (aid && !multi) {
          app.select([aid]);
          drag = { type: 'action', id: aid, sx: e.clientX, sy: e.clientY, pid: e.pointerId, moved: false };
          return;
        }
        if (id && M.kindOf(app.page(), id) === 'link' && !multi) {
          app.select([id]);
          var lk = M.find(app.page(), id).el;
          drag = { type: 'link', link: lk, start: world, dx: lk.dx || 0, dy: lk.dy || 0, pid: e.pointerId, moved: false };
          return;
        }
        if (id) {
          if (multi || e.ctrlKey || e.metaKey) {
            app.toggleSelect(id);
            return;
          }
          if (!app.sel[id]) app.select([id]);
          else app.primary = id;
          startMove(world, e);
        } else {
          if (!multi) app.select([]);
          drag = { type: 'rubber', start: world, add: multi, pid: e.pointerId, moved: false };
        }
        return;

      case 'step':
      case 'initial':
      case 'transition':
        if (id) {
          app.select([id]);
          startMove(world, e);
        } else {
          place(app.tool, world);
        }
        return;

      case 'connect':
      case 'jump':
        if (!id && portHit(e.target)) id = portHit(e.target);
        if (isNode(id)) {
          if (app.pendingConnect && app.pendingConnect !== id) {
            finishConnect(app.pendingConnect, id);
            return;
          }
          app.select([id]);
          startConnect(id, world, e);
        } else {
          app.pendingConnect = null;
          app.select([]);
          app.updateHint();
        }
        return;

      case 'or':
        insertPattern('or', id, world);
        return;
      case 'and':
        insertPattern('and', id, world);
        return;

      case 'comment':
        if (id && M.kindOf(app.page(), id) === 'note') {
          app.select([id]);
          Ed.startInline(id);
        } else if (isNode(id)) {
          app.select([id]);
          Ed.startInline(id, 'comment');
        } else if (!id) {
          addNoteAt(world);
        }
        return;

      case 'frame':
        frameTool(id, world);
        return;

      case 'macro':
      case 'enclosing':
        structTool(app.tool, id, world);
        return;

      default:
        if (Ed.ACT_TOOLS[app.tool]) addActionTo(id, Ed.ACT_TOOLS[app.tool]);
    }
  }

  /** Werkzeug Teil-GRAFCET: neuer Rahmen mit Anfangsschritt oder Ablauf zusammenfassen. */
  function frameTool(id, world) {
    var page = app.page();
    var kind = id ? M.kindOf(page, id) : null;
    if (kind === 'frame') {
      app.select([id]);
      return;
    }
    if (kind === 'step' || kind === 'transition') {
      var el = M.node(page, id);
      var inFrame = M.partialOf(page, el);
      if (inFrame) {
        app.select([inFrame.id]);
        app.toast('Liegt bereits im Teil-GRAFCET ' + inFrame.name + '.');
        return;
      }
      app.select([id]);
      app.cmd.groupFrame();
      app.setTool('select');
      return;
    }
    if (kind) return;
    // Rahmen aufziehen (Loslassen ohne Ziehen: Standardgröße)
    drag = { type: 'frameRect', start: world, pid: lastPointer, moved: false };
  }

  /**
   * Werkzeuge Makroschritt / einschließender Schritt: Klick auf eine freie
   * Stelle legt einen neuen an, Klick auf einen normalen Schritt wandelt ihn um.
   */
  function structTool(tool, id, world) {
    var page = app.page();
    var kind = id ? M.kindOf(page, id) : null;
    var el = kind === 'step' ? M.node(page, id) : null;
    if (kind && (!el || el.kind !== 'normal')) {
      app.toast('Klicke auf eine freie Stelle oder auf einen normalen Schritt.', 'warn');
      return;
    }
    var res = app.change(function () {
      var x = U.snap(world.x, M.GRID);
      var y = U.snap(world.y, M.GRID);
      return tool === 'macro' ? M.createMacro(app.project, page, x, y, el && el.id) : M.createEnclosing(app.project, page, x, y, el && el.id);
    });
    app.select([res.step.id]);
    app.toast(tool === 'macro'
      ? 'Makroschritt ' + res.step.name + ' angelegt. Rechts daneben steht seine Expansion (Eingangs- und Ausgangsschritt).'
      : 'Einschließender Schritt ' + res.step.name + ' angelegt. Rechts daneben steht sein Inhalt; mit * markierte Schritte werden mit ihm aktiv.');
    app.setTool('select');
  }
  Ed.structTool = structTool;

  /** Neuen Teil-GRAFCET-Rahmen aus dem aufgezogenen Rechteck anlegen. */
  function createFrame(a, b, moved) {
    var g = M.GRID;
    var rect = moved && Math.abs(b.x - a.x) > 40 && Math.abs(b.y - a.y) > 40
      ? { x: U.snap(Math.min(a.x, b.x), g), y: U.snap(Math.min(a.y, b.y), g), w: U.snap(Math.abs(b.x - a.x), g), h: U.snap(Math.abs(b.y - a.y), g) }
      : { x: U.snap(a.x, g), y: U.snap(a.y, g), w: 320, h: 260 };
    var fr = app.change(function () { return M.addFrame(app.project, app.page(), null, rect); });
    app.select([fr.id]);
    app.toast('Teil-GRAFCET ' + fr.name + ' angelegt. Alles, was im Rahmen liegt, gehört dazu; Größe über den Anfasser unten rechts.');
    app.setTool('select');
  }

  /** Verbinden per Ziehen starten; reverse = vom oberen Anschluss (neuer Vorgänger). */
  function startConnect(from, world, e, reverse) {
    drag = { type: 'connect', from: from, start: world, sx: e.clientX, sy: e.clientY, pid: e.pointerId, moved: false, reverse: !!reverse };
  }

  /** Aktion der gewählten Art an einen Schritt hängen und das Variablenfeld öffnen. */
  function addActionTo(id, spec) {
    var page = app.page();
    if (!id || M.kindOf(page, id) !== 'step') {
      app.toast('Aktionen gehören zu einem Schritt – klicke auf einen Schritt.', 'warn');
      return;
    }
    var step = M.node(page, id);
    var aid = app.change(function () {
      var a = M.newAction(app.project, spec.type, '');
      if (spec.when) a.when = spec.when;
      if (spec.type === 'forcing') {
        // Vorschlag: der erste Teil-GRAFCET, in dem der Schritt nicht selbst liegt
        var own = M.partialOf(page, step);
        var other = (page.frames || []).filter(function (fr) { return fr.kind === 'partial' && fr !== own; })[0];
        a.target = other ? other.name : '';
        a.forceMode = 'init';
      }
      step.actions.push(a);
      return a.id;
    });
    app.select([id]);
    GE.panel.focusAction(aid);
  }
  Ed.addActionTo = addActionTo;

  /** Freien Kommentar an der Stelle setzen und gleich beschriften. */
  function addNoteAt(world) {
    var nid = app.change(function () {
      return M.addNote(app.project, app.page(), U.snap(world.x, M.GRID), U.snap(world.y, M.GRID), '').id;
    });
    app.select([nid]);
    Ed.startInline(nid);
  }
  Ed.addNoteAt = addNoteAt;

  function startMove(world, e) {
    var page = app.page();
    var orig = {};
    Object.keys(app.sel).forEach(function (sid) {
      var nd = M.movable(page, sid);
      if (nd) orig[sid] = { x: nd.x, y: nd.y };
      var ff = M.find(page, sid);
      if (ff && ff.kind === 'frame') {
        var fr = ff.el;
        orig[fr.id] = { x: fr.x, y: fr.y, frame: true };
        M.frameMembers(page, sid, true).forEach(function (el) { orig[el.id] = { x: el.x, y: el.y }; });
        (page.frames || []).forEach(function (o) {
          if (o !== fr && o.w * o.h < fr.w * fr.h && M.frameContains(fr, { x: o.x + o.w / 2, y: o.y + o.h / 2 })) {
            orig[o.id] = { x: o.x, y: o.y, frame: true };
          }
        });
      }
    });
    drag = { type: 'move', start: world, sx: e.clientX, sy: e.clientY, orig: orig, moved: false, pid: e.pointerId };
  }

  function onMove(e) {
    if (pdrag) { paletteMove(e); return; }
    if (longPress && Math.hypot(e.clientX - longPress.x, e.clientY - longPress.y) > 10) clearLongPress();
    if (e.pointerType === 'touch' && touches[e.pointerId]) {
      touches[e.pointerId] = svgPoint(e);
      if (pinch) {
        var ids = Object.keys(touches);
        if (ids.length < 2) return;
        var a = touches[ids[0]];
        var b = touches[ids[1]];
        var dist = Math.hypot(a.x - b.x, a.y - b.y);
        var mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        app.view.x += mid.x - pinch.mid.x;
        app.view.y += mid.y - pinch.mid.y;
        if (pinch.dist > 0) Ed.zoomAt(dist / pinch.dist, mid.x, mid.y);
        else Ed.applyView();
        pinch.dist = dist;
        pinch.mid = mid;
        return;
      }
    }
    var inside = e.target instanceof Node && svg.contains(e.target);
    var world = Ed.toWorld(e.clientX, e.clientY);
    lastWorld = world;
    if (inside || drag) {
      var pos = document.getElementById('statusPos');
      pos.textContent = 'x ' + Math.round(world.x) + '  y ' + Math.round(world.y);
    }
    if (!drag) {
      if (inside && app.mode !== 'sim') {
        var hid = hitId(e.target);
        drawGhost(world, hid);
        svg.classList.toggle('can-connect', app.tool === 'select' &&
          (!!portHit(e.target) || !!(hid && app.sel[hid] && inLowerHalf(hid, world))));
      }
      return;
    }
    if (drag.pid !== undefined && e.pointerId !== drag.pid) return;

    switch (drag.type) {
      case 'pan':
        app.view.x = drag.vx + (e.clientX - drag.sx);
        app.view.y = drag.vy + (e.clientY - drag.sy);
        Ed.applyView();
        break;

      case 'move':
        if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 4) return;
        if (!drag.moved) { drag.moved = true; app.history.begin(); }
        var dx = world.x - drag.start.x;
        var dy = world.y - drag.start.y;
        var page = app.page();
        Object.keys(drag.orig).forEach(function (id) {
          var nd = drag.orig[id].frame ? M.find(page, id).el : M.movable(page, id);
          if (!nd) return;
          nd.x = U.snap(drag.orig[id].x + dx, M.GRID);
          nd.y = U.snap(drag.orig[id].y + dy, M.GRID);
        });
        dragRefresh();
        break;

      case 'cmt':
        if (!drag.moved) { drag.moved = true; app.history.begin(); }
        drag.el.commentDx = Math.round((drag.dx + world.x - drag.start.x) / 5) * 5;
        drag.el.commentDy = Math.round((drag.dy + world.y - drag.start.y) / 5) * 5;
        dragRefresh();
        break;

      case 'link':
        if (!drag.moved) { drag.moved = true; app.history.begin(); }
        var lpg = app.page();
        var la = M.node(lpg, drag.link.from);
        var lb = M.node(lpg, drag.link.to);
        if (la && lb && lb.y <= la.y + 5) drag.link.dx = U.snap(drag.dx + world.x - drag.start.x, 10);   // Rückführung: senkrechtes Stück
        else drag.link.dy = U.snap(drag.dy + world.y - drag.start.y, 10);                                // waagerechtes Stück
        dragRefresh();
        break;

      case 'action':
        if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 5) return;
        drag.moved = true;
        var under = document.elementFromPoint(e.clientX, e.clientY);
        var sid = hitId(under);
        drag.target = sid && M.kindOf(app.page(), sid) === 'step' ? sid : null;
        drag.before = hitAction(under);
        markTarget(drag.target);
        break;

      case 'resize':
        drag.frame.w = Math.max(M.FRAME_MIN_W, U.snap(drag.w + world.x - drag.start.x, M.GRID));
        drag.frame.h = Math.max(M.FRAME_MIN_H, U.snap(drag.h + world.y - drag.start.y, M.GRID));
        dragRefresh();
        break;

      case 'frameRect':
        drag.moved = true;
        drag.end = world;
        overlay.innerHTML = '<rect class="rubber frame-draft" x="' + U.n(Math.min(drag.start.x, world.x)) + '" y="' + U.n(Math.min(drag.start.y, world.y)) +
          '" width="' + U.n(Math.abs(world.x - drag.start.x)) + '" height="' + U.n(Math.abs(world.y - drag.start.y)) + '"/>';
        break;

      case 'rubber':
        drag.moved = true;
        var x1 = Math.min(drag.start.x, world.x);
        var y1 = Math.min(drag.start.y, world.y);
        overlay.innerHTML = '<rect class="rubber" x="' + U.n(x1) + '" y="' + U.n(y1) + '" width="' +
          U.n(Math.abs(world.x - drag.start.x)) + '" height="' + U.n(Math.abs(world.y - drag.start.y)) + '"/>';
        drag.end = world;
        // schon beim Ziehen zeigen, was ausgewählt wird
        var pre = {};
        idsInRect(drag.start, world).forEach(function (id) { pre[id] = true; });
        var els = content.querySelectorAll('[data-id]');
        for (var pi = 0; pi < els.length; pi++) els[pi].classList.toggle('preselect', !!pre[els[pi].getAttribute('data-id')]);
        break;

      case 'connect':
        if (!drag.moved && drag.sx !== undefined && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 4) return;
        drag.moved = true;
        svg.classList.add('connecting');
        var sp = (drag.reverse ? portTopPoint(drag.from) : portPoint(drag.from)) || M.node(app.page(), drag.from);
        var tid = hitId(document.elementFromPoint(e.clientX, e.clientY));
        drag.target = isNode(tid) && tid !== drag.from ? tid : null;
        var ov = '<path class="preview-line" d="M' + U.n(sp.x) + ' ' + U.n(sp.y) + ' L' + U.n(world.x) + ' ' + U.n(world.y) + '"/>';
        if (!drag.target && !tid && app.tool !== 'jump') ov += extendGhost(drag.from, world);
        overlay.innerHTML = ov;
        markTarget(drag.target);
        break;
    }
  }

  function markTarget(id) {
    var old = content.querySelectorAll('.target');
    for (var i = 0; i < old.length; i++) old[i].classList.remove('target');
    if (!id) return;
    var el = content.querySelector('[data-id="' + CSS.escape(id) + '"]');
    if (el) el.classList.add('target');
  }

  function onUp(e) {
    if (pdrag) { paletteUp(e); return; }
    if (dragFrame) { cancelAnimationFrame(dragFrame); dragFrame = 0; }
    clearLongPress();
    if (suppressMenuClick) setTimeout(function () { suppressMenuClick = false; }, 0);
    if (doubleTap) {
      var dt = doubleTap;
      doubleTap = null;
      cancelDrag();
      onDblClick({ target: dt });
      return;
    }
    if (e.pointerType === 'touch') {
      delete touches[e.pointerId];
      if (pinch) {
        if (Object.keys(touches).length < 2) pinch = null;
        return;
      }
    }
    if (!drag || (drag.pid !== undefined && e.pointerId !== drag.pid)) return;
    var d0 = drag;
    drag = null;
    svg.classList.remove('panning');

    switch (d0.type) {
      case 'move':
        if (d0.moved) {
          app.history.commit();
          app.refresh();
        }
        break;

      case 'rubber':
        overlay.innerHTML = '';
        if (d0.moved && d0.end) selectInRect(d0.start, d0.end, d0.add);
        break;

      case 'resize':
      case 'cmt':
      case 'link':
        if (d0.type === 'resize' || d0.moved) {
          app.history.commit();
          app.refresh();
        }
        break;

      case 'action':
        markTarget(null);
        if (d0.moved && d0.target && d0.before !== d0.id) {
          app.change(function () { M.moveAction(app.page(), d0.id, d0.target, d0.before); });
          app.select([d0.id]);
        }
        break;

      case 'frameRect':
        overlay.innerHTML = '';
        createFrame(d0.start, d0.end || d0.start, d0.moved);
        break;

      case 'connect':
        overlay.innerHTML = '';
        svg.classList.remove('connecting');
        markTarget(null);
        var tid = d0.target || hitId(document.elementFromPoint(e.clientX, e.clientY));
        if (isNode(tid) && tid !== d0.from) {
          // vom oberen Anschluss: Verbindung führt vom Ziel zu diesem Element
          if (d0.reverse) finishConnect(tid, d0.from);
          else finishConnect(d0.from, tid);
        } else if (d0.moved && !tid && app.tool !== 'jump') {
          // ins Leere gezogen: passendes Element dort anlegen und verbinden
          extendTo(d0.from, Ed.toWorld(e.clientX, e.clientY), d0.reverse);
        } else if (app.tool !== 'select' && (!d0.moved || tid === d0.from)) {
          // Klick-Klick-Modus: Quelle merken
          app.pendingConnect = d0.from;
          app.updateHint();
        }
        break;

      case 'pan':
        if (d0.menu && Math.hypot(e.clientX - d0.sx, e.clientY - d0.sy) < 4) {
          Ed.showMenu(e.clientX, e.clientY, d0.id, d0.world);
        }
        break;
    }
  }

  /** Vorschau des Elements, das beim Loslassen im Leeren entsteht. */
  function extendGhost(from, world) {
    var kind = M.kindOf(app.page(), from);
    var src = M.node(app.page(), from);
    if (!src) return '';
    var x = U.snap(world.x, M.GRID);
    var y = U.snap(world.y, M.GRID);
    if (Math.abs(x - src.x) <= 2 * M.GRID) x = src.x;
    if (kind === 'step') {
      return '<g class="ghost"><line class="tbar" x1="' + (x - R.C.TBAR) + '" y1="' + y + '" x2="' + (x + R.C.TBAR) + '" y2="' + y + '"/></g>';
    }
    return '<g class="ghost"><rect class="box" x="' + (x - R.C.H) + '" y="' + (y - R.C.H) + '" width="' + R.C.STEP + '" height="' + R.C.STEP + '"/></g>';
  }

  function extendTo(from, world, reverse) {
    var nid = app.change(function () {
      var x = U.snap(world.x, M.GRID);
      var y = U.snap(world.y, M.GRID);
      return reverse ? M.extendFrom(app.project, app.page(), from, x, y) : M.extendTo(app.project, app.page(), from, x, y);
    });
    if (!nid) return;
    app.select([nid]);
    if (M.kindOf(app.page(), nid) === 'transition') Ed.startInline(nid);
  }

  var dragFrame = 0;
  /** Beim Ziehen höchstens einmal je Bild zeichnen, ohne Prüfung (die folgt beim Loslassen). */
  function dragRefresh() {
    if (dragFrame) return;
    dragFrame = requestAnimationFrame(function () {
      dragFrame = 0;
      app.refresh({ panel: false, validate: false });
    });
  }

  function clearLongPress() {
    if (longPress) clearTimeout(longPress.timer);
    longPress = null;
  }

  function cancelDrag() {
    if (drag && drag.type === 'move' && drag.moved) {
      app.history.commit();
      app.refresh();
    }
    drag = null;
    overlay.innerHTML = '';
    svg.classList.remove('panning');
    svg.classList.remove('connecting');
  }

  function selectInRect(a, b, add) {
    var ids = add ? Object.keys(app.sel) : [];
    idsInRect(a, b).forEach(function (id) { if (ids.indexOf(id) < 0) ids.push(id); });
    app.select(ids);
  }

  /** Elemente (und Verbindungen zwischen ihnen) innerhalb eines Rechtecks. */
  function idsInRect(a, b) {
    var x1 = Math.min(a.x, b.x);
    var x2 = Math.max(a.x, b.x);
    var y1 = Math.min(a.y, b.y);
    var y2 = Math.max(a.y, b.y);
    var page = app.page();
    var ids = [];
    M.nodes(page).forEach(function (nd) {
      if (nd.x >= x1 && nd.x <= x2 && nd.y >= y1 && nd.y <= y2 && ids.indexOf(nd.id) < 0) ids.push(nd.id);
    });
    (page.notes || []).forEach(function (nt) {
      var sz = R.noteSize(nt);
      var cx = nt.x + sz.w / 2;
      var cy = nt.y + sz.h / 2;
      if (cx >= x1 && cx <= x2 && cy >= y1 && cy <= y2 && ids.indexOf(nt.id) < 0) ids.push(nt.id);
    });
    var inSel = {};
    ids.forEach(function (id) { inSel[id] = true; });
    page.links.forEach(function (l) {
      if (inSel[l.from] && inSel[l.to] && !inSel[l.id]) ids.push(l.id);
    });
    return ids;
  }

  function onWheel(e) {
    e.preventDefault();
    var scale = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    if (e.ctrlKey || e.metaKey) {
      var p = svgPoint(e);
      Ed.zoomAt(Math.exp(-e.deltaY * scale * 0.0018), p.x, p.y);
      return;
    }
    var dx = e.deltaX * scale;
    var dy = e.deltaY * scale;
    if (e.shiftKey && !dx) { dx = dy; dy = 0; }
    app.view.x -= dx;
    app.view.y -= dy;
    Ed.applyView();
  }

  function onDblClick(e) {
    if (app.mode === 'sim') return;
    var id = hitId(e.target);
    if (!id) return;
    var aid = hitAction(e.target);
    if (aid) {
      app.select([id]);
      GE.panel.focusAction(aid);
      return;
    }
    if (isNode(id) || M.kindOf(app.page(), id) === 'note' || M.kindOf(app.page(), id) === 'frame') {
      app.select([id]);
      Ed.startInline(id);
    }
  }

  // ------------------------------------------------------------ Ziehen aus dem linken Menü

  var pdrag = null;          // laufendes Ziehen eines Werkzeugs auf die Fläche
  var suppressClick = false; // Klick nach dem Ziehen nicht als Werkzeugwahl werten

  /** pointerdown auf einem Werkzeug: Ziehen beginnt erst nach einigen Pixeln. */
  Ed.paletteDown = function (tool, e) {
    if (app.mode === 'sim') return;
    pdrag = { tool: tool, sx: e.clientX, sy: e.clientY, active: false, pid: e.pointerId };
  };

  Ed.consumePaletteClick = function () {
    var s = suppressClick;
    suppressClick = false;
    return s;
  };

  function overCanvas(e) {
    var r = svgRect();
    return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
  }

  /**
   * Vorschlag für eine Verbindung beim Ablegen: nächstgelegener Schritt ohne
   * Folgetransition (für eine Transition) bzw. Transition ohne Folgeschritt
   * (für einen Schritt) oberhalb der Ablagestelle.
   */
  function suggestSource(tool, world) {
    if (!GE.prefs.get('dragSuggest')) return null;
    var page = app.page();
    var list = tool === 'transition' ? page.steps : (tool === 'step' ? page.transitions : []);
    var best = null;
    var bestD = Infinity;
    list.forEach(function (c) {
      var dx = Math.abs(world.x - c.x);
      var dy = world.y - c.y;
      if (dx > 140 || dy < 30 || dy > 220) return;
      if (M.outLinks(page, c.id).some(function (l) { return !l.jump; })) return;
      var d = Math.hypot(dx, dy);
      if (d < bestD) { bestD = d; best = c; }
    });
    return best;
  }

  function paletteMove(e) {
    if (pdrag.pid !== undefined && e.pointerId !== pdrag.pid) return;
    if (!pdrag.active) {
      if (Math.hypot(e.clientX - pdrag.sx, e.clientY - pdrag.sy) < 6) return;
      pdrag.active = true;
      document.body.classList.add('palette-dragging');
    }
    markTarget(null);
    if (!overCanvas(e)) { overlay.innerHTML = ''; return; }
    var world = Ed.toWorld(e.clientX, e.clientY);
    var tool = pdrag.tool;
    var overId = hitId(document.elementFromPoint(e.clientX, e.clientY));
    if (tool === 'step' || tool === 'initial' || tool === 'transition') {
      var src = suggestSource(tool === 'initial' ? 'none' : tool, world);
      var p = placePos(tool, world, src);
      overlay.innerHTML = ghostSvg(tool, p);
    } else if (Ed.ACT_TOOLS[tool] || tool === 'macro' || tool === 'enclosing') {
      // Aktion bzw. Umwandlung: Zielschritt hervorheben
      overlay.innerHTML = '';
      if (overId && M.kindOf(app.page(), overId) === 'step') markTarget(overId);
      else overlay.innerHTML = tool === 'macro' || tool === 'enclosing' ? ghostSvg('step', placePos('step', world, null)) : '';
    } else {
      var g = U.snap(world.x, M.GRID);
      var h = U.snap(world.y, M.GRID);
      overlay.innerHTML = '<g class="ghost"><rect class="box" x="' + (g - 30) + '" y="' + (h - 20) + '" width="60" height="40" rx="4"/></g>';
    }
  }

  function paletteUp(e) {
    var d = pdrag;
    pdrag = null;
    document.body.classList.remove('palette-dragging');
    overlay.innerHTML = '';
    markTarget(null);
    if (!d.active) return;          // normaler Klick: Werkzeug wählen
    suppressClick = true;           // ggf. folgenden Klick auf den Knopf ignorieren …
    setTimeout(function () { suppressClick = false; }, PALETTE_CLICK_MS);   // … aber nur unmittelbar danach
    if (!overCanvas(e)) return;
    var world = Ed.toWorld(e.clientX, e.clientY);
    var overId = hitId(document.elementFromPoint(e.clientX, e.clientY));
    dropTool(d.tool, world, overId);
  }

  /** Abgelegtes Werkzeug ausführen, als wäre an der Stelle geklickt worden. */
  function dropTool(tool, world, overId) {
    switch (tool) {
      case 'step':
      case 'initial':
      case 'transition':
        place(tool, world, suggestSource(tool === 'initial' ? 'none' : tool, world));
        if (tool === 'initial') app.setTool('select');
        return;
      case 'comment':
        if (overId && M.node(app.page(), overId)) { app.select([overId]); Ed.startInline(overId, 'comment'); }
        else addNoteAt(world);
        return;
      case 'frame':
        createFrame(world, world, false);
        return;
      case 'or':
      case 'and':
        insertPattern(tool, overId && M.node(app.page(), overId) ? overId : null, world);
        return;
      case 'macro':
      case 'enclosing':
        structTool(tool, overId, world);
        return;
      default:
        if (Ed.ACT_TOOLS[tool]) addActionTo(overId, Ed.ACT_TOOLS[tool]);
        else app.setTool(tool);
    }
  }

  /** Halbtransparente Vorschau eines Schritts/einer Transition samt Verbindungsvorschlag. */
  function ghostSvg(tool, p) {
    var s = '';
    if (p.src) {
      var sy = p.src.cond !== undefined ? p.src.y : p.src.y + R.C.H;
      s += '<path class="preview-line" d="M' + p.src.x + ' ' + sy + ' L' + p.src.x + ' ' + ((sy + p.y) / 2) +
        ' L' + p.x + ' ' + ((sy + p.y) / 2) + ' L' + p.x + ' ' + (tool === 'transition' ? p.y : p.y - R.C.H) + '"/>';
    }
    if (tool === 'transition') {
      return s + '<g class="ghost"><line class="tbar" x1="' + (p.x - R.C.TBAR) + '" y1="' + p.y + '" x2="' + (p.x + R.C.TBAR) + '" y2="' + p.y + '"/></g>';
    }
    return s + '<g class="ghost"><rect class="box" x="' + (p.x - R.C.H) + '" y="' + (p.y - R.C.H) + '" width="' + R.C.STEP + '" height="' + R.C.STEP + '"/>' +
      (tool === 'initial' ? '<rect class="box inner" x="' + (p.x - R.C.H + 5) + '" y="' + (p.y - R.C.H + 5) + '" width="' + (R.C.STEP - 10) + '" height="' + (R.C.STEP - 10) + '"/>' : '') + '</g>';
  }

  // ------------------------------------------------------------ Platzieren

  /** Ausgewähltes Element, das mit einem neuen Element verbunden werden soll. */
  function autoSource(kind) {
    var ids = Object.keys(app.sel);
    if (ids.length !== 1) return null;
    var page = app.page();
    var f = M.find(page, ids[0]);
    if (!f || f.kind === 'link') return null;
    var wantKind = kind === 'transition' ? 'step' : 'transition';
    if (f.kind !== wantKind) return null;
    var outs = M.outLinks(page, f.el.id).filter(function (l) { return !l.jump; });
    return outs.length ? null : f.el;
  }

  function placePos(kind, world, srcOverride) {
    var x = U.snap(world.x, M.GRID);
    var y = U.snap(world.y, M.GRID);
    var src = srcOverride !== undefined ? srcOverride : autoSource(kind);
    if (src && Math.abs(x - src.x) <= 2 * M.GRID) x = src.x;
    return { x: x, y: y, src: src };
  }

  function place(tool, world, srcOverride) {
    var p = placePos(tool, world, srcOverride);
    var page = app.page();
    var newId = app.change(function () {
      var el;
      if (tool === 'transition') el = M.addTransition(app.project, page, p.x, p.y, '');
      else el = M.addStep(app.project, page, p.x, p.y, { initial: tool === 'initial' });
      if (p.src) M.addLink(app.project, page, p.src.id, el.id);
      return el.id;
    });
    overlay.innerHTML = '';
    app.select([newId]);
    if (tool === 'transition') Ed.startInline(newId);
    if (tool === 'initial') app.setTool('step');
  }

  function drawGhost(world, overId) {
    var t = app.tool;
    if ((t !== 'step' && t !== 'initial' && t !== 'transition') || overId) {
      overlay.innerHTML = '';
      return;
    }
    var p = placePos(t, world);
    var s = '';
    if (p.src) {
      var sy = p.src.cond !== undefined ? p.src.y : p.src.y + R.C.H;
      s += '<path class="preview-line" d="M' + p.src.x + ' ' + sy + ' L' + p.src.x + ' ' + ((sy + p.y) / 2) +
        ' L' + p.x + ' ' + ((sy + p.y) / 2) + ' L' + p.x + ' ' + (t === 'transition' ? p.y : p.y - R.C.H) + '"/>';
    }
    if (t === 'transition') {
      s += '<g class="ghost"><line class="tbar" x1="' + (p.x - R.C.TBAR) + '" y1="' + p.y + '" x2="' + (p.x + R.C.TBAR) + '" y2="' + p.y + '"/></g>';
    } else {
      s += '<g class="ghost"><rect class="box" x="' + (p.x - R.C.H) + '" y="' + (p.y - R.C.H) + '" width="' + R.C.STEP + '" height="' + R.C.STEP + '"/>' +
        (t === 'initial' ? '<rect class="box inner" x="' + (p.x - R.C.H + 5) + '" y="' + (p.y - R.C.H + 5) + '" width="' + (R.C.STEP - 10) + '" height="' + (R.C.STEP - 10) + '"/>' : '') + '</g>';
    }
    overlay.innerHTML = s;
  }

  function finishConnect(from, to) {
    var jump = app.tool === 'jump';
    var page = app.page();
    var res = app.change(function () {
      return M.connect(app.project, page, from, to, { jump: jump });
    });
    app.pendingConnect = null;
    if (!res.ok) {
      app.toast(res.message, 'warn');
      app.select([from]);
    } else {
      if (res.message) app.toast(res.message);
      app.select([to]);
    }
    app.updateHint();
  }

  function insertPattern(kind, id, world) {
    var page = app.page();
    var x = U.snap(world.x, M.GRID);
    var y = U.snap(world.y, M.GRID);
    var res = app.change(function () {
      if (kind === 'or') return id ? M.insertOr(app.project, page, { stepId: id }) : M.insertOr(app.project, page, { x: x, y: y });
      return id ? M.insertAnd(app.project, page, { nodeId: id }) : M.insertAnd(app.project, page, { x: x, y: y });
    });
    if (!res.ok) {
      app.toast(res.message, 'warn');
      return;
    }
    app.select(res.created.filter(function (cid) { return isNode(cid); }), res.select);
    app.toast(res.message || (kind === 'or'
      ? 'ODER-Verzweigung angelegt. Trage die Bedingungen der Transitionen ein.'
      : 'UND-Verzweigung angelegt. Die Zweige laufen gleichzeitig.'));
    app.setTool('select');
  }

  /**
   * Gemeinsame Hilfen für editor-inline.js, editor-menu.js und editor-keys.js
   * (nur innerhalb des Editors gedacht).
   */
  Ed._ = {
    svg: function () { return svg; },
    lastFrames: function () { return lastFrames; },
    menuClickSuppressed: function () { return suppressMenuClick; },
    toScreen: toScreen,
    svgRect: svgRect,
    place: place,
    autoSource: autoSource,
    finishConnect: finishConnect,
    insertPattern: insertPattern,
    addNoteAt: addNoteAt,
    frameTool: frameTool,
    createFrame: createFrame,
    structTool: structTool,
    addActionTo: addActionTo,
    isNode: isNode
  };

  Ed.setSpace = function (down) {
    spaceDown = down;
    svg.classList.toggle('space', down);
  };

  Ed.cancel = function () {
    cancelDrag();
    markTarget(null);
  };

  Ed.lastWorld = function () { return lastWorld; };
})(globalThis.GE = globalThis.GE || {});
