/*
 * editor-menu.js – Rechtsklick-Menü (auch per Tastatur und langem Drücken).
 * Teil des Editors (GE.editor); gemeinsame Hilfen kommen aus editor.js über GE.editor._.
 */
(function (GE) {
  'use strict';

  var Ed = GE.editor;
  var I = Ed._;
  var M = GE.model;
  var R = GE.render;
  var U = GE.util;
  var svgRect = I.svgRect;
  var toScreen = I.toScreen;
  var frameTool = I.frameTool;
  var structTool = I.structTool;
  var addActionTo = I.addActionTo;
  var addNoteAt = I.addNoteAt;
  var place = I.place;
  var insertPattern = I.insertPattern;

  var menuEl = null;

  function closeMenu() {
    if (!menuEl) return;
    menuEl.remove();
    menuEl = null;
    document.removeEventListener('pointerdown', outsideMenu, true);
  }
  Ed.closeMenu = closeMenu;
  Ed.isMenuOpen = function () { return !!menuEl; };

  function outsideMenu(e) {
    if (menuEl && menuEl.contains(e.target)) return;
    closeMenu();
  }

  /** Rechtsklick-Menü an der Bildschirmposition (cx, cy). */
  function showMenu(cx, cy, id, world) {
    closeMenu();
    if (Ed.isInlineActive()) Ed.finishInline(true);
    var page = GE.app.page();
    var f = id ? M.find(page, id) : null;
    if (f && !GE.app.sel[id]) GE.app.select([id]);
    var items = menuItems(f, world);
    menuEl = document.createElement('div');
    menuEl.className = 'menu ctx-menu';
    menuEl.setAttribute('role', 'menu');
    menuEl.innerHTML = items.map(function (it, i) {
      if (it.sep) return '<div class="sep"></div>';
      if (it.head) return '<div class="menu-head">' + U.esc(it.head) + '</div>';
      return '<button class="menu-item" role="menuitem" data-i="' + i + '"' + (it.disabled ? ' disabled' : '') + '><span>' +
        U.esc(it.label) + '</span>' + (it.key ? '<kbd>' + U.esc(it.key) + '</kbd>' : '') + '</button>';
    }).join('');
    document.body.appendChild(menuEl);
    var r = menuEl.getBoundingClientRect();
    menuEl.style.left = Math.max(4, Math.min(cx, window.innerWidth - r.width - 6)) + 'px';
    menuEl.style.top = Math.max(4, Math.min(cy, window.innerHeight - r.height - 6)) + 'px';
    menuEl.addEventListener('click', function (e) {
      if (I.menuClickSuppressed()) return;
      var b = e.target.closest('[data-i]');
      if (!b || b.disabled) return;
      var it = items[+b.getAttribute('data-i')];
      closeMenu();
      it.run();
    });
    document.addEventListener('pointerdown', outsideMenu, true);
    var first = menuEl.querySelector('button:not(:disabled)');
    if (first) first.focus();
  }
  Ed.showMenu = showMenu;

  /** Pfeiltasten im offenen Menü; liefert true, wenn die Taste verarbeitet wurde. */
  Ed.menuKey = function (key) {
    if (!menuEl || !/^(ArrowDown|ArrowUp|Home|End)$/.test(key)) return false;
    var btns = Array.prototype.slice.call(menuEl.querySelectorAll('button:not(:disabled)'));
    if (!btns.length) return true;
    var i = btns.indexOf(document.activeElement);
    if (key === 'Home') i = 0;
    else if (key === 'End') i = btns.length - 1;
    else if (i < 0) i = key === 'ArrowDown' ? 0 : btns.length - 1;
    else i = (i + (key === 'ArrowDown' ? 1 : btns.length - 1)) % btns.length;
    btns[i].focus();
    return true;
  };

  /** Menü per Tastatur (Umschalt+F10, Menütaste): für die Auswahl, sonst für die Mitte der Ansicht. */
  Ed.keyboardMenu = function () {
    var page = GE.app.page();
    var r = svgRect();
    var id = GE.app.primary && GE.app.sel[GE.app.primary] ? GE.app.primary : Object.keys(GE.app.sel)[0];
    var f = id ? M.find(page, id) : null;
    var at = null;
    if (f) at = M.movable(page, id) || f.step || (f.el.from && M.node(page, f.el.from)) || (f.el.w ? f.el : null);
    if (!at) {
      id = null;
      at = Ed.toWorld(r.left + r.width / 2, r.top + r.height / 2);
    }
    var p = toScreen(at.x, at.y);
    showMenu(r.left + p.x, r.top + p.y, id, { x: at.x, y: at.y });
  };

  function menuItems(f, world) {
    var c = GE.app.cmd;
    var page = GE.app.page();
    var SEP = { sep: true };
    var ids = Object.keys(GE.app.sel);
    var tools = Ed.ACT_TOOLS;

    if (f && ids.length > 1 && GE.app.sel[f.el.id]) {
      return [
        { head: ids.length + ' Elemente' },
        { label: 'Senkrecht ausrichten', run: c.alignV },
        { label: 'Waagerecht ausrichten', run: c.alignH },
        { label: 'Als Teil-GRAFCET zusammenfassen', run: c.groupFrame },
        SEP,
        { label: 'Kopieren', key: 'Strg+C', run: c.copy },
        { label: 'Duplizieren', key: 'Strg+D', run: c.duplicate },
        { label: 'Löschen', key: 'Entf', run: c.del }
      ];
    }
    if (!f) {
      return [
        { head: 'Hier einfügen' },
        { label: 'Schritt', key: 'S', run: function () { place('step', world); } },
        { label: 'Anfangsschritt', key: 'A', run: function () { place('initial', world); } },
        { label: 'Transition', key: 'T', run: function () { place('transition', world); } },
        { label: 'Kommentar', key: 'K', run: function () { addNoteAt(world); } },
        { label: 'Teil-GRAFCET', key: 'G', run: function () { frameTool(null, world); } },
        { label: 'ODER-Verzweigung', run: function () { insertPattern('or', null, world); } },
        { label: 'UND-Verzweigung', run: function () { insertPattern('and', null, world); } },
        SEP,
        { label: 'Einfügen', key: 'Strg+V', disabled: !GE.app.clipboard, run: function () { c.pasteAt(world); } },
        { label: 'Alles auswählen', key: 'Strg+A', run: c.selectAll },
        SEP,
        { label: 'Automatisch anordnen', key: 'L', run: c.layout },
        { label: 'Ansicht einpassen', key: 'F', run: c.fit }
      ];
    }
    var el = f.el;
    if (f.kind === 'action') {
      var list = f.step.actions;
      var idx = list.indexOf(el);
      return [
        { head: 'Aktion ' + R.actionLabel(el) },
        { label: 'Bearbeiten', key: 'Enter', run: function () { GE.app.select([f.step.id]); GE.panel.focusAction(el.id); } },
        { label: 'Nach links', disabled: idx <= 0, run: function () { c.nudge(-1, 0); } },
        { label: 'Nach rechts', disabled: idx >= list.length - 1, run: function () { c.nudge(1, 0); } },
        SEP,
        { label: 'Löschen', key: 'Entf', run: c.del }
      ];
    }
    if (f.kind === 'frame') {
      return [
        { head: 'Teil-GRAFCET ' + el.name },
        { label: 'Umbenennen', key: 'Enter', run: function () { Ed.startInline(el.id); } },
        { label: 'Anzeigen', run: function () { Ed.showFrame(el.id); } },
        { label: 'An Inhalt anpassen', run: c.fitFrame },
        SEP,
        { label: 'Rahmen entfernen (Inhalt bleibt)', key: 'Entf', run: c.del }
      ];
    }
    var inPartial = f.kind !== 'note' && M.partialOf(page, el);
    var frameItem = inPartial
      ? { label: 'Teil-GRAFCET ' + inPartial.name + ' anzeigen', run: function () { GE.app.select([inPartial.id]); Ed.showFrame(inPartial.id); } }
      : { label: 'Zum Teil-GRAFCET machen', run: c.groupFrame };
    var common = [
      frameItem,
      SEP,
      { label: 'Kopieren', key: 'Strg+C', run: c.copy },
      { label: 'Duplizieren', key: 'Strg+D', run: c.duplicate },
      { label: 'Löschen', key: 'Entf', run: c.del }
    ];
    if (f.kind === 'step') {
      var actions = Object.keys(tools).map(function (k) {
        return { label: '+ ' + tools[k].label, run: function () { addActionTo(el.id, tools[k]); } };
      });
      return [
        { head: 'Schritt ' + el.name },
        { label: 'Name ändern', key: 'Enter', run: function () { Ed.startInline(el.id); } },
        { label: el.comment ? 'Kommentar bearbeiten' : 'Kommentar hinzufügen', run: function () { Ed.startInline(el.id, 'comment'); } },
        { label: el.initial ? 'Kein Anfangsschritt mehr' : 'Zum Anfangsschritt machen', key: 'I', run: c.toggleInitial },
        el.kind === 'normal'
          ? { label: 'In Makroschritt umwandeln', run: function () { structTool('macro', el.id, el); } }
          : M.ownedFrame(page, el.id) ? { label: (el.kind === 'macro' ? 'Expansion' : 'Inhalt') + ' anzeigen', run: function () { Ed.showFrame(M.ownedFrame(page, el.id).id); } } : SEP,
        el.kind === 'normal' ? { label: 'In einschließenden Schritt umwandeln', run: function () { structTool('enclosing', el.id, el); } } : SEP,
        M.frameOf(page, el, ['enclosed'])
          ? { label: el.encInit ? 'Nicht mehr mit einschließendem Schritt aktivieren' : 'Mit einschließendem Schritt aktivieren (*)', run: function () { GE.app.change(function () { el.encInit = !el.encInit; }); } }
          : SEP,
        { head: 'Aktion hinzufügen' }
      ].concat(actions, [
        {
          label: el.actionsLayout === 'column' ? 'Aktionen nebeneinander' : 'Aktionen untereinander',
          disabled: el.actions.length < 2,
          run: function () {
            GE.app.change(function () { el.actionsLayout = el.actionsLayout === 'column' ? 'row' : 'column'; });
          }
        },
        SEP,
        { label: 'Folgeschritt anhängen', key: 'N', run: c.append },
        { label: 'Verbinden mit …', run: function () { startPending(el.id, 'connect'); } }
      ], common);
    }
    if (f.kind === 'transition') {
      return [
        { head: 'Transition' + (el.name ? ' ' + el.name : '') },
        { label: 'Bedingung bearbeiten', key: 'Enter', run: function () { Ed.startInline(el.id); } },
        { label: el.comment ? 'Kommentar bearbeiten' : 'Kommentar hinzufügen', run: function () { Ed.startInline(el.id, 'comment'); } },
        SEP,
        { label: 'Folgeschritt anhängen', key: 'N', run: c.append },
        { label: 'Verbinden mit …', run: function () { startPending(el.id, 'connect'); } },
        { label: 'Sprung zu …', run: function () { startPending(el.id, 'jump'); } }
      ].concat(common);
    }
    if (f.kind === 'note') {
      return [
        { head: 'Kommentar' },
        { label: 'Text bearbeiten', key: 'Enter', run: function () { Ed.startInline(el.id); } }
      ].concat(common);
    }
    // Wirkverbindung
    var canJump = M.kindOf(page, el.from) === 'transition' && M.kindOf(page, el.to) === 'step';
    return [
      { head: 'Wirkverbindung' },
      {
        label: el.jump ? 'Als Linie darstellen' : 'Als Sprung darstellen',
        disabled: !canJump,
        run: function () { GE.app.change(function () { el.jump = !el.jump; }); }
      },
      SEP,
      { label: 'Löschen', key: 'Entf', run: c.del }
    ];
  }

  /** Klick-Klick-Verbinden ab einem Element starten (aus dem Menü). */
  function startPending(id, tool) {
    GE.app.setTool(tool);
    GE.app.pendingConnect = id;
    GE.app.select([id]);
    GE.app.updateHint();
  }
})(globalThis.GE = globalThis.GE || {});
