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
