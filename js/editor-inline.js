/*
 * editor-inline.js – Beschriften direkt in der Zeichnung (Name, Bedingung, Kommentar).
 * Teil des Editors (GE.editor); gemeinsame Hilfen kommen aus editor.js über GE.editor._.
 */
(function (GE) {
  'use strict';

  var Ed = GE.editor;
  var I = Ed._;
  var M = GE.model;
  var R = GE.render;
  var U = GE.util;
  var toScreen = I.toScreen;

  var inline = null;        // laufende Beschriftung
  var inlineBox, inlineInput, inlineMsg, inlineText;

  /** Eingabefelder auf der Fläche einrichten (aus Ed.init). */
  Ed.initInline = function () {
    inlineBox = document.getElementById('inlineBox');
    inlineInput = document.getElementById('inlineEdit');
    inlineMsg = document.getElementById('inlineMsg');
    inlineText = document.getElementById('inlineText');
    // Kommentare: Textbereich ohne Hinweisfenster; Enter = neue Zeile, Strg+Enter/Klick daneben = fertig, Esc = abbrechen
    inlineText.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.preventDefault(); Ed.finishInline(false); }
      else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); Ed.finishInline(true); }
      e.stopPropagation();
    });
    inlineText.addEventListener('input', fitInlineText);
    inlineText.addEventListener('blur', function () { Ed.finishInline(true); });
    inlineInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); Ed.finishInline(true); }
      else if (e.key === 'Escape') { e.preventDefault(); Ed.finishInline(false); }
      e.stopPropagation();
    });
    inlineInput.addEventListener('input', updateInlineMsg);
    inlineInput.addEventListener('blur', function () { Ed.finishInline(true); });
  };

  var INLINE_FIELDS = { step: 'name', transition: 'cond', note: 'text', frame: 'name' };
  var INLINE_HINTS = {
    name: 'Name',
    cond: 'Bedingung, z. B. B1 * /B2',
    comment: 'Kommentar (leer = entfernen)',
    text: 'Kommentartext'
  };

  /**
   * Direkt in der Zeichnung beschriften. Ohne field: Name (Schritt),
   * Bedingung (Transition) bzw. Text (freier Kommentar); field 'comment'
   * bearbeitet den Kommentar eines Schritts oder einer Transition.
   */
  Ed.startInline = function (id, field) {
    var f = M.find(GE.app.page(), id);
    if (!f || f.kind === 'link') return;
    field = field || INLINE_FIELDS[f.kind];
    inline = { id: id, kind: f.kind, field: field, area: field === 'comment' || field === 'text' };
    if (inline.area) {
      // Kommentare: mehrzeiliger Textbereich genau an der Stelle des Kommentars
      inlineText.value = String(f.el[field] || '');
      inlineText.placeholder = INLINE_HINTS[field] || '';
      inlineText.hidden = false;
      positionInline();
      fitInlineText();
      inlineText.focus();
      inlineText.select();
      return;
    }
    inlineInput.value = String(f.el[field] || '');
    inlineInput.placeholder = INLINE_HINTS[field] || '';
    inlineBox.hidden = false;
    positionInline();
    updateInlineMsg();
    inlineInput.focus();
    inlineInput.select();
  };

  /** Höhe des Textbereichs an die Zeilenzahl anpassen. */
  function fitInlineText() {
    var lines = inlineText.value.split('\n').length;
    inlineText.rows = Math.max(2, lines + 1);
  }

  function positionInline() {
    var k = GE.app.view.k;
    var box = inline.area ? inlineText : inlineBox;
    var p;
    var w;
    var left;
    var top;
    if (inline.kind === 'frame') {
      var fb = I.lastFrames()[inline.id];
      if (!fb) return;
      p = toScreen(fb.x1, fb.y1);
      left = p.x;
      top = p.y - 2;
      w = 160;
    } else {
      var el = M.movable(GE.app.page(), inline.id);
      if (!el) return;
      if (inline.kind === 'note') {
        p = toScreen(el.x, el.y);
        w = Math.max(260, R.noteSize(el).w * k + 30);
        left = p.x;
        top = p.y;
      } else if (inline.field === 'comment' && inline.kind === 'step') {
        // links vom Schritt, dort steht der Kommentar
        w = 240;
        p = toScreen(el.x - R.stepHalf(el) - 8, el.y);
        left = p.x - w;
        top = p.y - 20;
      } else if (inline.field === 'comment') {
        // hinter der Bedingung der Transition
        w = 240;
        p = toScreen(el.x + R.C.COND_X + R.exprWidth(el.cond || '?') + 10, el.y);
        left = p.x;
        top = p.y - 20;
      } else if (inline.kind === 'step') {
        w = 90;
        p = toScreen(el.x, el.y);
        left = p.x - 45;
        top = p.y - 17;
      } else {
        w = Math.max(240, 260 * Math.min(k, 1.2));
        p = toScreen(el.x + R.C.COND_X - 6, el.y);
        left = p.x;
        top = p.y - 17;
      }
    }
    // innerhalb der sichtbaren Zeichenfläche halten (sonst verdeckt das Werkzeugmenü den Text
    // oder der Browser verschiebt die ganze Fläche, um das Feld zu zeigen)
    var wrap = I.svg().parentNode;
    var W = wrap.clientWidth;
    var H = wrap.clientHeight;
    w = Math.min(w, W - 8);
    left = U.clamp(left, 4, W - w - 4);
    top = U.clamp(top, 4, Math.max(4, H - (box.offsetHeight || 60) - 4));
    box.style.left = U.n(left) + 'px';
    box.style.top = U.n(top) + 'px';
    box.style.width = U.n(w) + 'px';
  }

  function updateInlineMsg() {
    if (!inline) { inlineMsg.textContent = ''; return; }
    if (inline.field === 'comment' || inline.field === 'text') {
      inlineMsg.className = 'inline-msg';
      inlineMsg.textContent = inline.multi
        ? 'Mehrzeiliger Text: weitere Zeilen rechts unter Eigenschaften bearbeiten'
        : 'Enter übernimmt · Esc bricht ab' + (inline.field === 'text' ? ' · mehrere Zeilen: rechts unter Eigenschaften' : '');
      return;
    }
    if (inline.field !== 'cond') { inlineMsg.textContent = ''; return; }
    var v = inlineInput.value.trim();
    if (!v) {
      inlineMsg.className = 'inline-msg';
      inlineMsg.textContent = 'Enter übernimmt · Esc bricht ab';
      return;
    }
    var r = GE.expr.parse(v);
    inlineMsg.className = 'inline-msg ' + (r.ok ? 'good' : 'bad');
    inlineMsg.textContent = r.ok ? '✓ gültig' : r.error.message;
  }

  Ed.finishInline = function (commit) {
    if (!inline) return;
    var cur = inline;
    inline = null;
    // Fokus ausdrücklich abgeben, sonst landen weitere Tasten im versteckten Feld
    if (document.activeElement === inlineInput) inlineInput.blur();
    if (document.activeElement === inlineText) inlineText.blur();
    inlineBox.hidden = true;
    inlineText.hidden = true;
    var page = GE.app.page();
    var f = M.find(page, cur.id);
    if (!f) return;
    // Kommentare behalten Zeilenumbrüche und Leerzeilen, nur Leerraum am Ende fällt weg
    var v = cur.area ? inlineText.value.replace(/\s+$/, '') : inlineInput.value.trim();
    // Ein freier Kommentar ohne Text wird entfernt (z. B. Abbruch direkt nach dem Anlegen)
    var empty = commit ? !v.trim() : !String(f.el.text || '').trim();
    if (cur.kind === 'note' && empty) {
      GE.app.change(function () { M.remove(page, [cur.id]); });
      GE.app.select([]);
      return;
    }
    if (!commit) return;
    // Bedingung in die einheitliche Schreibweise bringen (5s/X3, Abstände, [Vergleich])
    if (cur.field === 'cond') v = GE.expr.normalize(v, M.stepVarForTransition(page, f.el));
    if (f.el[cur.field] === v) return;
    var old = f.el[cur.field];
    GE.app.change(function () { f.el[cur.field] = v; });
    // Schritt bzw. Teil-GRAFCET umbenannt: Bezüge mitändern (Rückfrage)
    if (cur.field === 'name' && (f.kind === 'step' || (f.kind === 'frame' && f.el.kind === 'partial'))) {
      GE.app.offerRenameRefs(f.kind === 'step' ? 'step' : 'frame', old, v);
    }
  };

  Ed.isInlineActive = function () { return !!inline; };

  /** Lage des Eingabefelds nach Zoom/Verschieben anpassen. */
  Ed.positionInline = function () { if (inline) positionInline(); };
})(globalThis.GE = globalThis.GE || {});
