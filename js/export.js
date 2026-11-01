/*
 * export.js – Zeichnung als SVG oder PNG speichern, drucken (PDF über den
 * Druckdialog) und den Zeitverlauf als Bild speichern.
 *
 * Exportiert wird immer hell (weißer Hintergrund, dunkle Linien), egal welche
 * Darstellung gerade eingestellt ist. Die Farben werden dazu aus der hellen
 * Darstellung übernommen und fest in die Datei geschrieben.
 */
(function (GE) {
  'use strict';

  var X = (GE.exporter = {});
  var M = GE.model;
  var R = GE.render;
  var U = GE.util;
  var app;

  var PROPS = ['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-linecap', 'opacity', 'fill-opacity',
    'font-family', 'font-size', 'font-weight', 'font-style', 'text-decoration', 'display', 'visibility'];
  var PAD = 24;

  /** Bereich: ausgewählter Rahmen (Teil-GRAFCET) oder die ganze Zeichnung. */
  function selectedFrame() {
    var page = app.page();
    return Object.keys(app.sel).map(function (id) { return M.find(page, id); })
      .filter(function (f) { return f && f.kind === 'frame'; })
      .map(function (f) { return f.el; })[0] || null;
  }

  /** Feste Farben und Schriften der hellen Darstellung in die Elemente schreiben. */
  function inlineStyles(root) {
    var html = document.documentElement;
    var old = html.getAttribute('data-theme');
    html.setAttribute('data-theme', 'light');
    var els = [root].concat(Array.prototype.slice.call(root.querySelectorAll('*')));
    var styles = els.map(function (el) {
      var cs = getComputedStyle(el);
      return PROPS.map(function (p) { return p + ':' + cs.getPropertyValue(p); }).join(';');
    });
    if (old === null) html.removeAttribute('data-theme');
    else html.setAttribute('data-theme', old);
    els.forEach(function (el, i) {
      el.setAttribute('style', styles[i]);
      el.removeAttribute('class');
    });
  }

  /** SVG-Text der Zeichnung; frame = nur dieser Rahmen. */
  function drawingSvg(frame) {
    var page = app.page();
    var res = R.page(page, { selected: {}, issues: {} });
    var b = frame ? { x1: frame.x, y1: frame.y, x2: frame.x + frame.w, y2: frame.y + frame.h } : res.bounds;
    var x = b.x1 - PAD;
    var y = b.y1 - PAD;
    var w = Math.max(40, b.x2 - b.x1 + 2 * PAD);
    var h = Math.max(40, b.y2 - b.y1 + 2 * PAD);
    var holder = document.createElement('div');
    holder.style.cssText = 'position:fixed;left:-20000px;top:0;width:10px;height:10px;overflow:hidden';
    holder.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" id="canvas-export">' + res.svg + '</svg>';
    document.body.appendChild(holder);
    var svg = holder.firstChild;
    // nur Unsichtbares für die Bedienung (Trefferflächen) entfernen
    Array.prototype.forEach.call(svg.querySelectorAll('.hit, .frame-handle, title'), function (n) { n.remove(); });
    inlineStyles(svg);
    holder.remove();
    svg.removeAttribute('id');
    svg.setAttribute('viewBox', [x, y, w, h].map(U.n).join(' '));
    svg.setAttribute('width', Math.round(w));
    svg.setAttribute('height', Math.round(h));
    svg.setAttribute('font-family', 'Segoe UI, Helvetica Neue, Arial, sans-serif');
    var bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    bg.setAttribute('x', x); bg.setAttribute('y', y); bg.setAttribute('width', w); bg.setAttribute('height', h);
    bg.setAttribute('fill', '#ffffff');
    svg.insertBefore(bg, svg.firstChild);
    return { text: '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(svg), w: w, h: h };
  }

  /** SVG-Text des Zeitverlaufs (aus der Simulation). */
  function timingSvg() {
    var src = document.getElementById('timingSvg');
    if (!src || !src.childNodes.length) return null;
    var svg = src.cloneNode(true);
    var holder = document.createElement('div');
    holder.style.cssText = 'position:fixed;left:-20000px;top:0';
    holder.className = 'timing-body';
    holder.appendChild(svg);
    document.body.appendChild(holder);
    inlineStyles(svg);
    holder.remove();
    var w = +src.getAttribute('width') || src.clientWidth;
    var h = +src.getAttribute('height') || src.clientHeight;
    svg.removeAttribute('id');
    svg.setAttribute('width', w);
    svg.setAttribute('height', h);
    if (!svg.getAttribute('viewBox')) svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
    var bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    bg.setAttribute('width', '100%'); bg.setAttribute('height', '100%'); bg.setAttribute('fill', '#ffffff');
    svg.insertBefore(bg, svg.firstChild);
    return { text: '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(svg), w: w, h: h };
  }

  /** SVG in ein PNG umrechnen (doppelte Auflösung). */
  var PNG_MAX_SIDE = 8000;
  var PNG_MAX_AREA = 32e6;

  function toPng(img, done) {
    // doppelte Auflösung, aber innerhalb der Grenzen des Browsers für Leinwände
    var scale = Math.min(2, PNG_MAX_SIDE / img.w, PNG_MAX_SIDE / img.h, Math.sqrt(PNG_MAX_AREA / (img.w * img.h)));
    var image = new Image();
    image.onload = function () {
      var c = document.createElement('canvas');
      c.width = Math.ceil(img.w * scale);
      c.height = Math.ceil(img.h * scale);
      var ctx = c.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(image, 0, 0, c.width, c.height);
      try {
        c.toBlob(function (blob) {
          if (!blob) return app.toast('Zu groß für PNG – bitte als SVG speichern.', 'warn');
          done(blob);
        }, 'image/png');
      } catch (e) {
        app.toast('PNG ist in diesem Browser nicht möglich – bitte als SVG speichern.', 'warn');
      }
    };
    image.onerror = function () { app.toast('Das Bild konnte nicht erzeugt werden.', 'error'); };
    image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(img.text);
  }

  function baseName(frame) {
    var name = M.fileName(app.project.title).replace(/\.grafcet\.json$/, '');
    return frame ? name + ' - ' + (frame.name || 'Rahmen') : name;
  }

  X.svg = function () {
    var fr = selectedFrame();
    GE.files.download(baseName(fr) + '.svg', new Blob([drawingSvg(fr).text], { type: 'image/svg+xml' }));
    app.toast('Als SVG gespeichert' + (fr ? ' (nur ' + fr.name + ')' : ''));
  };

  X.png = function () {
    var fr = selectedFrame();
    toPng(drawingSvg(fr), function (blob) {
      GE.files.download(baseName(fr) + '.png', blob);
      app.toast('Als PNG gespeichert' + (fr ? ' (nur ' + fr.name + ')' : ''));
    });
  };

  X.timingPng = function () {
    var img = timingSvg();
    if (!img) return app.toast('Der Zeitverlauf ist noch leer – erst simulieren.', 'warn');
    toPng(img, function (blob) {
      GE.files.download(baseName(null) + ' - Zeitverlauf.png', blob);
      app.toast('Zeitverlauf als PNG gespeichert');
    });
  };

  /** Druckansicht: Titel, Datum und Zeichnung; „Als PDF speichern“ im Druckdialog. */
  X.print = function () {
    var fr = selectedFrame();
    var area = document.getElementById('printArea');
    var now = new Date();
    area.innerHTML = '<h1>' + U.esc(app.project.title || 'GRAFCET') + (fr ? ' – ' + U.esc(fr.name) : '') + '</h1>' +
      '<p>' + now.toLocaleDateString('de-DE') + ' · GRAFCET Lernwerkstatt</p>' +
      drawingSvg(fr).text.replace(/^<\?xml[^>]*>\s*/, '');
    var svg = area.querySelector('svg');
    svg.removeAttribute('width');
    svg.removeAttribute('height');
    window.print();
  };

  /** Menü am Knopf „Export“. */
  X.menu = function (btn) {
    var old = document.getElementById('exportMenu');
    if (old) { old.remove(); return; }
    var fr = selectedFrame();
    var items = [
      ['svg', 'Als SVG-Bild speichern'],
      ['png', 'Als PNG-Bild speichern'],
      ['print', 'Drucken / als PDF speichern (Strg+P)'],
      ['timingPng', 'Zeitverlauf als PNG speichern']
    ];
    var menu = document.createElement('div');
    menu.id = 'exportMenu';
    menu.className = 'menu';
    menu.setAttribute('role', 'menu');
    menu.innerHTML = '<div class="menu-head">' + (fr ? 'Nur Teil-GRAFCET ' + U.esc(fr.name) + ' (ausgewählt)' : 'Ganze Zeichnung – für einen Teil-GRAFCET erst den Rahmen auswählen') + '</div>' +
      items.map(function (it) { return '<button role="menuitem" data-x="' + it[0] + '">' + it[1] + '</button>'; }).join('');
    var r = btn.getBoundingClientRect();
    menu.style.left = Math.max(4, Math.min(r.left, window.innerWidth - 330)) + 'px';
    menu.style.top = r.bottom + 4 + 'px';
    document.body.appendChild(menu);
    menu.querySelector('button').focus();
    menu.addEventListener('click', function (e) {
      var b = e.target.closest('[data-x]');
      if (!b) return;
      menu.remove();
      X[b.getAttribute('data-x')]();
    });
    menu.addEventListener('keydown', function (e) {
      var bs = Array.prototype.slice.call(menu.querySelectorAll('button'));
      var i = bs.indexOf(document.activeElement);
      if (e.key === 'Escape') { menu.remove(); btn.focus(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); bs[(i + 1) % bs.length].focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); bs[(i - 1 + bs.length) % bs.length].focus(); }
      e.stopPropagation();
    });
    setTimeout(function () {
      document.addEventListener('pointerdown', function close(e) {
        if (!menu.contains(e.target) && e.target !== btn) menu.remove();
        document.removeEventListener('pointerdown', close);
      });
    });
  };

  X.init = function (theApp) {
    app = theApp;
    window.addEventListener('afterprint', function () { document.getElementById('printArea').innerHTML = ''; });
  };
})(globalThis.GE = globalThis.GE || {});
