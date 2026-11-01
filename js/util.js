/*
 * util.js – Hilfsfunktionen und gemeinsamer Namensraum.
 *
 * Alle Module hängen sich an das globale Objekt GE. Es werden bewusst keine
 * ES-Module verwendet, damit index.html auch per Doppelklick (file://) läuft.
 * Die Module ohne DOM-Zugriff (util, expr, model, geometry, validate, render, layout,
 * history, sim, plants, examples, tasks, tasklist; Liste in tests/files.json)
 * laufen zusätzlich in Node.js für die automatischen Tests.
 */
(function (GE) {
  'use strict';

  var U = (GE.util = {});

  /** Schriftfamilie für Zeichnung und Textmessung (muss zu app.css passen). */
  U.FONT = '"Segoe UI", "Helvetica Neue", Arial, sans-serif';

  /** Text für HTML/SVG maskieren. */
  U.esc = function (s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  };

  /** Tiefe Kopie für reine Datenobjekte (JSON-fähig). */
  U.clone = function (o) {
    return JSON.parse(JSON.stringify(o));
  };

  /** Auf Rasterweite runden. */
  U.snap = function (v, grid) {
    return Math.round(v / grid) * grid;
  };

  U.clamp = function (v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  };

  /** Zahl kompakt für SVG-Attribute formatieren. */
  U.n = function (v) {
    return Math.round(v * 100) / 100;
  };

  var measureCtx = null;

  /**
   * Breite eines Textes in Pixeln. Im Browser wird über ein Canvas gemessen,
   * in Node wird eine Näherung verwendet.
   */
  var widthCache = {};
  var widthCount = 0;

  U.textWidth = function (text, size, bold) {
    text = String(text == null ? '' : text);
    // Zwischenspeicher je (Text, Größe, fett); bei sehr vielen Einträgen neu beginnen
    var key = size + (bold ? 'b' : 'n') + '|' + text;
    if (widthCache.hasOwnProperty(key)) return widthCache[key];
    if (++widthCount > 4000) { widthCache = {}; widthCount = 1; }
    return (widthCache[key] = measure(text, size, bold));
  };

  function measure(text, size, bold) {
    if (typeof document !== 'undefined' && document.createElement) {
      if (!measureCtx) {
        var c = document.createElement('canvas');
        measureCtx = c.getContext ? c.getContext('2d') : null;
      }
      if (measureCtx) {
        measureCtx.font = (bold ? '600 ' : '') + size + 'px ' + U.FONT;
        return measureCtx.measureText(text).width;
      }
    }
    return text.length * size * (bold ? 0.6 : 0.56);
  }

  /** Natürliche Sortierung ("2" vor "10"). */
  /** Zahl aus Text mit Komma oder Punkt („1,5“, „2.5“); NaN bei Unsinn oder leerem Text. */
  U.parseNum = function (text) {
    var t = String(text == null ? '' : text).trim().replace('\u2212', '-');
    if (!/^-?\d+([.,]\d+)?$/.test(t)) return NaN;
    return parseFloat(t.replace(',', '.'));
  };

  U.naturalCompare = function (a, b) {
    return String(a).localeCompare(String(b), 'de', { numeric: true, sensitivity: 'base' });
  };
})(globalThis.GE = globalThis.GE || {});
