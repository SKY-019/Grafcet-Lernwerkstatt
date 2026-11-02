/*
 * ui.js – Eigener Rückfrage-Dialog (statt window.confirm) und
 * Umschalter für die Darstellung (wie System / hell / dunkel).
 */
(function (GE) {
  'use strict';

  var UI = (GE.ui = {});
  var U = GE.util;

  var queue = Promise.resolve();   // Rückfragen nacheinander, nie zwei zugleich

  /**
   * Rückfrage im eigenen Dialog.
   * opts: { title, text, buttons: [{ label, value, kind: 'primary'|'danger' }] }
   * Liefert ein Promise mit dem value des gewählten Knopfs; Esc bzw. Schließen ergibt null.
   */
  UI.ask = function (opts) {
    var p = queue.then(function () { return open(opts); });
    queue = p.then(null, function () {});
    return p;
  };

  function open(opts) {
    return new Promise(function (resolve) {
      var dlg = document.getElementById('askDialog');
      var row = document.getElementById('askButtons');
      var buttons = opts.buttons || [{ label: 'Abbrechen', value: null }, { label: 'OK', value: true, kind: 'primary' }];
      document.getElementById('askTitle').textContent = opts.title || 'Rückfrage';
      document.getElementById('askText').textContent = opts.text || '';
      row.innerHTML = buttons.map(function (b, i) {
        return '<button type="button" data-i="' + i + '"' + (b.kind ? ' class="' + b.kind + '"' : '') + '>' + U.esc(b.label) + '</button>';
      }).join('');
      var result = null;
      function onClick(e) {
        var b = e.target.closest('[data-i]');
        if (!b) return;
        result = buttons[+b.getAttribute('data-i')].value;
        dlg.close();
      }
      function onClose() {
        row.removeEventListener('click', onClick);
        dlg.removeEventListener('close', onClose);
        resolve(result);
      }
      row.addEventListener('click', onClick);
      dlg.addEventListener('close', onClose);
      dlg.showModal();
      var def = row.querySelector('.primary') || row.querySelector('button');
      if (def) def.focus();
    });
  }

  /** Ja/Nein-Rückfrage; liefert ein Promise mit true, wenn bestätigt. */
  UI.confirm = function (text, okLabel, title) {
    return UI.ask({
      title: title,
      text: text,
      buttons: [{ label: 'Abbrechen', value: false }, { label: okLabel || 'OK', value: true, kind: 'primary' }]
    }).then(function (v) { return v === true; });
  };

  // ------------------------------------------------------------ Verstellbare Breiten

  /**
   * Griffe an der Werkzeugleiste (rechter Rand) und an der Seitenleiste (linker Rand).
   * Ziehen ändert die Breite, Doppelklick stellt die Standardbreite wieder her,
   * Pfeiltasten verstellen in Schritten. Die Breiten werden als Vorliebe gemerkt.
   */
  UI.initResizers = function () {
    var ws = document.querySelector('.workspace');
    var specs = [
      { host: document.querySelector('.sidepanel'), cls: 'res-side', pref: 'sideW', varName: '--side-w', min: 240, max: 0.6, sign: -1, label: 'Breite der Seitenleiste' },
      { host: document.getElementById('palette'), cls: 'res-pal', pref: 'palW', varName: '--pal-w', min: 96, max: 0.3, sign: 1, label: 'Breite der Werkzeugleiste' }
    ];
    function apply(sp, w) {
      if (w) ws.style.setProperty(sp.varName, Math.round(w) + 'px');
      else ws.style.removeProperty(sp.varName);
    }
    function clamp(sp, w) { return U.clamp(w, sp.min, Math.max(sp.min, window.innerWidth * sp.max)); }
    function done() { window.dispatchEvent(new Event('resize')); }
    specs.forEach(function (sp) {
      if (!sp.host) return;
      var saved = GE.prefs.get(sp.pref);
      if (saved) apply(sp, clamp(sp, saved));
      var h = document.createElement('div');
      h.className = 'resizer ' + sp.cls;
      h.tabIndex = 0;
      h.setAttribute('role', 'separator');
      h.setAttribute('aria-orientation', 'vertical');
      h.setAttribute('aria-label', sp.label + ' (Pfeiltasten; Doppelklick oder Pos1 = Standard)');
      h.title = 'Ziehen ändert die Breite · Doppelklick = Standardbreite';
      sp.host.appendChild(h);
      h.addEventListener('pointerdown', function (e) {
        if (e.button !== 0) return;
        e.preventDefault();
        var startX = e.clientX;
        var startW = sp.host.getBoundingClientRect().width;
        try { h.setPointerCapture(e.pointerId); } catch (err) { /* ohne Erfassung geht es auch */ }
        h.classList.add('drag');
        function move(ev) { apply(sp, clamp(sp, startW + sp.sign * (ev.clientX - startX))); }
        function up() {
          h.removeEventListener('pointermove', move);
          h.removeEventListener('pointerup', up);
          h.classList.remove('drag');
          GE.prefs.set(sp.pref, Math.round(sp.host.getBoundingClientRect().width));
          done();
        }
        h.addEventListener('pointermove', move);
        h.addEventListener('pointerup', up);
      });
      h.addEventListener('dblclick', function () { apply(sp, 0); GE.prefs.set(sp.pref, 0); done(); });
      h.addEventListener('keydown', function (e) {
        var step = e.shiftKey ? 48 : 16;
        var w = sp.host.getBoundingClientRect().width;
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          w += (e.key === 'ArrowRight' ? 1 : -1) * sp.sign * step;
          apply(sp, clamp(sp, w));
          GE.prefs.set(sp.pref, Math.round(clamp(sp, w)));
        } else if (e.key === 'Home') {
          apply(sp, 0);
          GE.prefs.set(sp.pref, 0);
        } else return;
        e.preventDefault();
        e.stopPropagation();
        done();
      });
    });
  };

  // ------------------------------------------------------------ Darstellung

  var THEMES = ['system', 'light', 'dark'];
  var THEME_LABELS = { system: 'wie System', light: 'hell', dark: 'dunkel' };

  UI.applyTheme = function () {
    var t = GE.prefs.get('theme');
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
    else document.documentElement.removeAttribute('data-theme');
    var sel = document.getElementById('themeSelect');
    if (sel) sel.value = t;
  };

  UI.setTheme = function (t) {
    GE.prefs.set('theme', THEMES.indexOf(t) >= 0 ? t : 'system');
    UI.applyTheme();
  };

  /** Nächste Darstellung (wie System → hell → dunkel); liefert ihre Bezeichnung. */
  UI.cycleTheme = function () {
    var t = THEMES[(THEMES.indexOf(GE.prefs.get('theme')) + 1) % THEMES.length];
    UI.setTheme(t);
    return THEME_LABELS[t];
  };
})(globalThis.GE = globalThis.GE || {});
