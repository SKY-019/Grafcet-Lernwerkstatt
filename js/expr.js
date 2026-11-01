/*
 * expr.js – Parser für Transitionsbedingungen und Aktionsbedingungen.
 *
 * Schreibweise (ASCII-Eingabe, Anzeige in Klammern):
 *   B1 * B2      UND        (B1 · B2)
 *   B1 + B2      ODER       (B1 + B2)
 *   /B1          NICHT      (B1 mit Überstrich)
 *   ↑B1, RE(B1)  steigende Flanke
 *   ↓B1, FE(B1)  fallende Flanke
 *   5s/X3        Zeitverzögerung: wahr, wenn X3 seit 5 s wahr ist
 *   5s/X3/2s     mit zusätzlicher Abfallverzögerung
 *   t/X3/5s      ältere Schreibweise, wird beim Bestätigen in 5s/X3 umgewandelt
 *   t>3s         Kurzform aus dem Prototyp, wird in 3s/X<Vorgängerschritt> umgewandelt
 *   C1 >= 5      Vergleich (für Zähler), gezeichnet in eckigen Klammern [C1 ≥ 5]
 *   1, =1        immer wahr
 *   X3           Schrittvariable (aktiv, wenn Schritt 3 aktiv ist)
 *
 * Der Parser erzeugt einen Syntaxbaum (AST). Es wird kein JavaScript-Code
 * aus Benutzertext erzeugt (kein eval / new Function).
 */
(function (GE) {
  'use strict';

  var E = (GE.expr = {});
  var U = GE.util;

  var WORD_CHAR = /[0-9A-Za-zÄÖÜäöüß_.]/;
  var DUR_RE = /^(\d+(?:[.,]\d+)?)(ms|s|min|h)$/;
  var NUM_RE = /^\d+(?:[.,]\d+)?$/;
  var UNIT_MS = { ms: 1, s: 1000, min: 60000, h: 3600000 };

  var OPS = {
    '*': 'and', '·': 'and', '&': 'and', '∧': 'and',
    '+': 'or', '∨': 'or',
    '/': 'not', '!': 'not', '¬': 'not',
    '(': '(', ')': ')', '[': '[', ']': ']',
    '↑': 'up', '↓': 'down',
    '>': '>', '<': '<', '=': '=', '≥': '>=', '≤': '<=', '≠': '<>'
  };
  var CMP = { '>': 1, '<': 1, '>=': 1, '<=': 1, '=': 1, '<>': 1 };
  var CMP_SYM = { '>': '>', '<': '<', '>=': '≥', '<=': '≤', '=': '=', '<>': '≠' };

  function err(message, pos) {
    var e = new Error(message);
    e.pos = pos;
    e.isParseError = true;
    return e;
  }

  /** Zerlegt den Text in Tokens. */
  function lex(src) {
    var toks = [];
    var i = 0;
    var n = src.length;
    while (i < n) {
      var c = src[i];
      if (/\s/.test(c)) { i++; continue; }
      if (WORD_CHAR.test(c)) {
        var j = i;
        while (j < n && (WORD_CHAR.test(src[j]) ||
          (src[j] === ',' && /\d/.test(src[j - 1]) && /\d/.test(src[j + 1] || '')))) j++;
        var w = src.slice(i, j);
        var m = DUR_RE.exec(w);
        if (m) toks.push({ k: 'dur', v: U.parseNum(m[1]) * UNIT_MS[m[2]], text: w, pos: i });
        else if (NUM_RE.test(w)) toks.push({ k: 'num', v: U.parseNum(w), text: w, pos: i });
        else toks.push({ k: 'id', v: w, text: w, pos: i });
        i = j;
        continue;
      }
      var two = src.substr(i, 2);
      if (two === '>=' || two === '<=' || two === '<>' || two === '!=') {
        toks.push({ k: 'op', v: two === '!=' ? '<>' : two, text: two, pos: i });
        i += 2;
        continue;
      }
      if (OPS[c]) {
        toks.push({ k: 'op', v: OPS[c], text: c, pos: i });
        i++;
        continue;
      }
      // Vorzeichen vor einer Zahl in einem Vergleich, z. B. [C1 >= -1] (Zähler können negativ werden)
      if ((c === '-' || c === '\u2212') && /\d/.test(src[i + 1] || '')) {
        var last = toks[toks.length - 1];
        if (last && last.k === 'op' && CMP[last.v]) {
          var k = i + 1;
          while (k < n && (/\d/.test(src[k]) || (src[k] === ',' || src[k] === '.') && /\d/.test(src[k + 1] || ''))) k++;
          var digits = src.slice(i + 1, k);
          toks.push({ k: 'num', v: -U.parseNum(digits), text: '-' + digits, pos: i });
          i = k;
          continue;
        }
      }
      throw err('Das Zeichen „' + c + '“ ist hier nicht erlaubt.', i);
    }
    // Zahl, Leerzeichen und Zeiteinheit vor „/“ gehören zusammen: „5 s/X3“ wie „5s/X3“
    for (var q = 0; q + 2 < toks.length; q++) {
      var a = toks[q];
      var u = toks[q + 1];
      if (a.k === 'num' && a.v >= 0 && u.k === 'id' && UNIT_MS[u.v] && isOp(toks[q + 2], 'not')) {
        toks.splice(q, 2, { k: 'dur', v: a.v * UNIT_MS[u.v], text: a.text + u.v, pos: a.pos });
      }
    }
    return toks;
  }

  function isOp(t, v) { return t && t.k === 'op' && t.v === v; }

  /** Beschreibung eines Tokens für Fehlermeldungen. */
  function show(t) { return '„' + t.text + '“'; }

  function Parser(toks) {
    this.toks = toks;
    this.i = 0;
  }
  Parser.prototype.peek = function (o) { return this.toks[this.i + (o || 0)]; };
  Parser.prototype.next = function () { return this.toks[this.i++]; };

  var MAX_DEPTH = 100;
  /** Klammertiefe begrenzen (sonst läuft die Rekursion über). */
  Parser.prototype.enter = function (t) {
    this.depth = (this.depth || 0) + 1;
    if (this.depth > MAX_DEPTH) throw err('Zu viele verschachtelte Klammern.', t.pos);
  };

  Parser.prototype.parseOr = function () {
    var items = [this.parseAnd()];
    while (isOp(this.peek(), 'or')) { this.next(); items.push(this.parseAnd()); }
    return items.length > 1 ? { type: 'or', items: items } : items[0];
  };

  Parser.prototype.parseAnd = function () {
    var items = [this.parseUnary()];
    while (isOp(this.peek(), 'and')) { this.next(); items.push(this.parseUnary()); }
    return items.length > 1 ? { type: 'and', items: items } : items[0];
  };

  Parser.prototype.parseUnary = function () {
    var t = this.peek();
    if (isOp(t, 'not')) { this.next(); return { type: 'not', a: this.parseUnary() }; }
    if (isOp(t, 'up') || isOp(t, 'down')) {
      this.next();
      return { type: 'edge', dir: t.v, a: this.parseUnary() };
    }
    return this.parseCompare();
  };

  Parser.prototype.parseCompare = function () {
    var left = this.parsePrimary();
    var t = this.peek();
    if (t && t.k === 'op' && CMP[t.v]) {
      this.next();
      var r = this.next();
      if (!r || (r.k !== 'num' && r.k !== 'dur' && r.k !== 'id')) {
        throw err('Nach ' + show(t) + ' fehlt ein Vergleichswert (Zahl, Zeit oder Variable).', r ? r.pos : t.pos + 1);
      }
      if (left.type === 'var' && left.name === 't' && r.k === 'dur') {
        // Kurzform aus dem Prototyp: t>3s
        return { type: 'tsince', op: t.v, ms: r.v, text: r.text };
      }
      if (r.k === 'dur') throw err('Eine Zeit wie ' + show(r) + ' kann nur mit t verglichen werden (z. B. t>3s) – besser: 3s/X2.', r.pos);
      if (left.type !== 'var' && left.type !== 'num') {
        throw err('Links von ' + show(t) + ' muss eine Variable oder Zahl stehen.', t.pos);
      }
      var right = r.k === 'num' ? { type: 'num', value: r.v, text: r.text } : { type: 'var', name: r.v };
      return { type: 'cmp', op: t.v, l: left, r: right };
    }
    if (left.type === 'num') {
      if (left.value === 0 || left.value === 1) return { type: 'const', value: left.value === 1 };
      throw err('Die Zahl „' + left.text + '“ allein ist keine Bedingung. Erlaubt sind 0 und 1 oder ein Vergleich wie C1 >= ' + left.text + '.', left.pos);
    }
    return left;
  };

  Parser.prototype.parsePrimary = function () {
    var prev = this.toks[this.i - 1];
    var t = this.next();
    if (!t) {
      if (prev) throw err('Die Bedingung ist unvollständig: nach ' + show(prev) + ' fehlt noch etwas.', prev.pos + prev.text.length);
      throw err('Die Bedingung ist leer.', 0);
    }
    if (isOp(t, '(')) {
      this.enter(t);
      var inner = this.parseOr();
      this.depth--;
      var c = this.next();
      if (!isOp(c, ')')) {
        if (c) throw err('Hier fehlt ein Operator (* für UND, + für ODER) oder die Klammer „)“.', c.pos);
        throw err('Die Klammer „(“ an Stelle ' + (t.pos + 1) + ' wird nicht geschlossen.', t.pos);
      }
      return inner;
    }
    if (isOp(t, '[')) {
      // eckige Klammern (üblich um Vergleiche) wirken wie runde Klammern
      this.enter(t);
      var inner2 = this.parseOr();
      this.depth--;
      var c2 = this.next();
      if (!isOp(c2, ']')) {
        if (c2) throw err('Hier fehlt ein Operator oder die Klammer „]“.', c2.pos);
        throw err('Die Klammer „[“ an Stelle ' + (t.pos + 1) + ' wird nicht geschlossen.', t.pos);
      }
      return inner2;
    }
    if (t.k === 'id') {
      if ((t.v === 'RE' || t.v === 'FE') && isOp(this.peek(), '(')) {
        this.next();
        var a = this.parseOr();
        if (!isOp(this.next(), ')')) throw err('Nach ' + t.v + '( fehlt die schließende Klammer.', t.pos);
        return { type: 'edge', dir: t.v === 'RE' ? 'up' : 'down', a: a };
      }
      if (t.v === 't' && isOp(this.peek(), 'not')) {
        // Schreibweise t/X3/5s
        this.next();
        var v = this.next();
        if (!v || v.k !== 'id') throw err('Nach „t/“ muss eine Variable folgen, z. B. t/X3/5s.', t.pos);
        if (!isOp(this.next(), 'not')) throw err('Nach „t/' + v.text + '“ fehlt „/“ und die Zeit, z. B. t/' + v.text + '/5s.', v.pos);
        var d = this.next();
        if (!d || d.k !== 'dur') throw err('Nach „t/' + v.text + '/“ muss eine Zeit stehen, z. B. 5s oder 500ms.', v.pos);
        return { type: 'timer', style: 't', t1: d.v, t1Text: d.text, v: v.v, t2: 0, t2Text: '' };
      }
      if (t.v === 't') {
        // „t“ ist für Zeiten reserviert (t>3s, t/X3/5s)
        var nx = this.peek();
        if (!(nx && nx.k === 'op' && CMP[nx.v] && this.peek(1) && this.peek(1).k === 'dur')) {
          throw err('„t“ ist für Zeiten reserviert – bitte einen anderen Namen wählen (Zeit als 5s/X3).', t.pos);
        }
      }
      return { type: 'var', name: t.v };
    }
    if (t.k === 'dur') {
      if (!isOp(this.peek(), 'not')) {
        throw err('Die Zeitangabe ' + show(t) + ' braucht eine Variable, z. B. ' + t.text + '/X3.', t.pos);
      }
      this.next();
      var vv = this.next();
      if (!vv || vv.k !== 'id') throw err('Nach „' + t.text + '/“ muss eine Variable folgen, z. B. ' + t.text + '/X3.', t.pos);
      var node = { type: 'timer', style: 'pre', t1: t.v, t1Text: t.text, v: vv.v, t2: 0, t2Text: '' };
      if (isOp(this.peek(), 'not') && this.peek(1) && this.peek(1).k === 'dur') {
        this.next();
        var d2 = this.next();
        node.t2 = d2.v;
        node.t2Text = d2.text;
      }
      return node;
    }
    if (t.k === 'num') return { type: 'num', value: t.v, text: t.text, pos: t.pos };
    // Operator an falscher Stelle
    if (isOp(t, ')') || isOp(t, ']')) throw err('Vor „' + t.text + '“ fehlt ein Operand.', t.pos);
    if (isOp(t, 'and') || isOp(t, 'or')) throw err('Vor ' + show(t) + ' fehlt ein Operand.', t.pos);
    throw err(show(t) + ' steht an einer unerwarteten Stelle.', t.pos);
  };

  /**
   * Bedingung parsen.
   * @returns {{ok:true, ast:Object}|{ok:false, error:{message:string, pos:number}}}
   */
  E.parse = function (text) {
    var src = String(text == null ? '' : text);
    try {
      var toks = lex(src);
      if (!toks.length) throw err('Die Bedingung ist leer.', 0);
      // "=1" bzw. "=0" als Ganzes (Schreibweise für "immer erfüllt")
      if (toks.length === 2 && isOp(toks[0], '=') && toks[1].k === 'num' && (toks[1].v === 0 || toks[1].v === 1)) {
        return { ok: true, ast: { type: 'const', value: toks[1].v === 1 } };
      }
      var p = new Parser(toks);
      var ast = p.parseOr();
      var rest = p.peek();
      if (rest) {
        var before = toks[p.i - 1];
        if (isOp(rest, ')') || isOp(rest, ']')) throw err('Zu viele schließende Klammern „' + rest.text + '“.', rest.pos);
        if (rest.k !== 'op' || isOp(rest, '(') || isOp(rest, '[') || isOp(rest, 'not') || isOp(rest, 'up') || isOp(rest, 'down')) {
          throw err('Zwischen ' + show(before) + ' und ' + show(rest) + ' fehlt ein Operator (* für UND, + für ODER).', rest.pos);
        }
        throw err(show(rest) + ' steht an einer unerwarteten Stelle.', rest.pos);
      }
      return { ok: true, ast: ast };
    } catch (e) {
      if (!e.isParseError) throw e;
      return { ok: false, error: { message: e.message, pos: e.pos } };
    }
  };

  /** Ist der Text ein gültiger Variablenname (z. B. B1, 1S2, M_Start)? */
  E.isName = function (s) {
    s = String(s || '');
    return /^[0-9A-Za-zÄÖÜäöüß_.]+$/.test(s) && !DUR_RE.test(s) && !NUM_RE.test(s) && s !== 't';
  };

  /**
   * Variablen in einer Bedingung umbenennen (über den Syntaxbaum, auch in Zeitgebern
   * wie 5s/X3 und in Flanken). map = { alterName: neuerName }. Liefert den neuen Text;
   * ist die Bedingung nicht lesbar oder betrifft sie nichts, bleibt der Text unverändert.
   */
  E.renameVars = function (text, map) {
    var r = E.parse(text);
    if (!r.ok) return text;
    var changed = false;
    E.walk(r.ast, function (nd) {
      if (nd.type === 'var' && map.hasOwnProperty(nd.name)) { nd.name = map[nd.name]; changed = true; }
      if (nd.type === 'timer' && map.hasOwnProperty(nd.v)) { nd.v = map[nd.v]; changed = true; }
    });
    return changed ? E.format(r.ast) : text;
  };

  /**
   * Bedingung mit festen Werten auswerten (values: { Name: 0|1 }). Nur für rein logische
   * Bedingungen (UND, ODER, NICHT, Variablen, Konstanten); bei Flanken, Zeiten und
   * Vergleichen null.
   */
  E.evalStatic = function (ast, values) {
    switch (ast.type) {
      case 'const': return ast.value;
      case 'var': return !!values[ast.name];
      case 'not': var a = E.evalStatic(ast.a, values); return a === null ? null : !a;
      case 'and':
      case 'or':
        var res = ast.type === 'and';
        for (var i = 0; i < ast.items.length; i++) {
          var v = E.evalStatic(ast.items[i], values);
          if (v === null) return null;
          res = ast.type === 'and' ? res && v : res || v;
        }
        return res;
      default: return null;
    }
  };

  /** Durchläuft den Baum und ruft fn(node) für jeden Knoten auf. */
  E.walk = function (ast, fn) {
    if (!ast) return;
    fn(ast);
    if (ast.items) ast.items.forEach(function (x) { E.walk(x, fn); });
    if (ast.a) E.walk(ast.a, fn);
    if (ast.l) E.walk(ast.l, fn);
    if (ast.r) E.walk(ast.r, fn);
  };

  /**
   * Sammelt Informationen über eine Bedingung:
   * vars  – alle Variablennamen (inkl. Schrittvariablen und Zeitgeber-Operanden)
   * edges – enthält Flanken
   * timers – Liste der Zeitgeber-Knoten
   * legacy – enthält die Kurzform t>3s
   */
  E.info = function (ast) {
    var res = { vars: [], edges: false, timers: [], legacy: false };
    var seen = {};
    function add(n) { if (!seen[n]) { seen[n] = true; res.vars.push(n); } }
    E.walk(ast, function (n) {
      if (n.type === 'var') add(n.name);
      else if (n.type === 'timer') { add(n.v); res.timers.push(n); }
      else if (n.type === 'edge') res.edges = true;
      else if (n.type === 'tsince') res.legacy = true;
    });
    return res;
  };

  function fmtNum(v) { return String(v).replace('.', ','); }

  /** Zeitbedingung immer in der Schreibweise nach IEC 60848: t1/Variable[/t2]. */
  function timerText(n) {
    return n.t1Text + '/' + n.v + (n.t2Text ? '/' + n.t2Text : '');
  }

  /** Kanonische ASCII-Schreibweise (zum Speichern und für Meldungen). */
  E.format = function (ast) {
    function f(n, prec) {
      switch (n.type) {
        case 'const': return n.value ? '1' : '0';
        case 'var': return n.name;
        case 'num': return fmtNum(n.value);
        case 'not': return '/' + f(n.a, 3);
        case 'edge': return (n.dir === 'up' ? '↑' : '↓') + f(n.a, 3);
        case 'timer': return timerText(n);
        case 'tsince': return 't' + n.op + n.text;
        case 'cmp': return '[' + f(n.l, 3) + ' ' + n.op + ' ' + f(n.r, 3) + ']';
        case 'and':
        case 'or':
          var own = n.type === 'and' ? 2 : 1;
          var s = n.items.map(function (x) { return f(x, own); }).join(n.type === 'and' ? ' * ' : ' + ');
          return prec > own ? '(' + s + ')' : s;
      }
      return '';
    }
    return f(ast, 0);
  };

  /**
   * Zerlegt den Baum in Darstellungs-Stücke für die Zeichnung.
   * Jedes Stück: {text, nots:[ids], cls}. NICHT wird nicht als Zeichen
   * ausgegeben, sondern als Überstrich über allen Stücken mit derselben id.
   */
  E.runs = function (ast) {
    var out = [];
    var counter = 0;
    function push(text, nots, cls) { out.push({ text: text, nots: nots, cls: cls || '' }); }
    function emit(n, prec, nots) {
      switch (n.type) {
        case 'const': push(n.value ? '1' : '0', nots); break;
        case 'var': push(n.name, nots, 'v'); break;
        case 'num': push(fmtNum(n.value), nots); break;
        case 'not': emit(n.a, 0, nots.concat([++counter])); break;
        case 'edge':
          push(n.dir === 'up' ? '↑' : '↓', nots, 'e');
          emit(n.a, 3, nots);
          break;
        case 'timer': push(timerText(n), nots, 'tm'); break;
        case 'tsince': push('t ' + CMP_SYM[n.op] + ' ' + n.text, nots, 'tm'); break;
        case 'cmp':
          push('[', nots);
          emit(n.l, 3, nots);
          push(' ' + CMP_SYM[n.op] + ' ', nots, 'o');
          emit(n.r, 3, nots);
          push(']', nots);
          break;
        case 'and':
        case 'or':
          var own = n.type === 'and' ? 2 : 1;
          var wrap = prec > own;
          if (wrap) push('(', nots);
          n.items.forEach(function (x, i) {
            if (i) push(n.type === 'and' ? ' · ' : ' + ', nots, 'o');
            emit(x, own, nots);
          });
          if (wrap) push(')', nots);
          break;
      }
    }
    if (ast.type === 'const') push('= ' + (ast.value ? '1' : '0'), []);
    else emit(ast, 0, []);
    return out;
  };

  /**
   * Bringt eine Bedingung in die einheitliche Schreibweise (beim Bestätigen
   * einer Eingabe): Abstände um Operatoren, Zeiten als 5s/X3, Vergleiche in
   * eckigen Klammern. Die Kurzform t>3s wird in 3s/X<Schritt> umgewandelt,
   * wenn stepVar bekannt ist (genau ein Vorgängerschritt bzw. der Schritt
   * einer Aktion); t<3s wird zu /3s/X<Schritt>.
   * Nicht lesbare Texte bleiben unverändert.
   * @returns {string}
   */
  E.normalize = function (text, stepVar) {
    var src = String(text == null ? '' : text).trim();
    var r = E.parse(src);
    if (!r.ok) return src;
    function conv(n) {
      if (!n) return n;
      if (n.type === 'tsince' && stepVar) {
        var tm = { type: 'timer', style: 'pre', t1: n.ms, t1Text: n.text, v: stepVar, t2: 0, t2Text: '' };
        if (n.op === '>' || n.op === '>=') return tm;
        if (n.op === '<' || n.op === '<=') return { type: 'not', a: tm };
        return n;
      }
      if (n.items) n.items = n.items.map(conv);
      if (n.a) n.a = conv(n.a);
      return n;
    }
    return E.format(conv(r.ast));
  };
})(globalThis.GE = globalThis.GE || {});
