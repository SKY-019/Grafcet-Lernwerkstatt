/*
 * plc.js – Übersetzung eines GRAFCET in SPS-Logik (ohne DOM, in Node testbar).
 *
 * Ergebnis ist ein Programm aus Netzwerken, das als FUP (fbd.js) oder als
 * Strukturierter Text (P.toST) ausgegeben und mit P.Runner zyklisch wie eine
 * SPS ausgeführt werden kann. Bezeichnungen nach IEC 61131-3.
 *
 * Zwei Übersetzungsarten:
 *   'trans'  Transitionsmerker (Standard): Zuerst werden alle Transitionen
 *            berechnet (T1 := X1 AND B1), danach die Schritte gesetzt und
 *            rückgesetzt (SR, setzdominant: ein Schritt, der gleichzeitig
 *            verlassen und wieder aktiviert wird, bleibt aktiv – Regel 5).
 *   'chain'  Klassische Schrittkette: Setzen = Vorgängerschritt UND Bedingung,
 *            Rücksetzen = Folgeschritt.
 *
 * Reihenfolge der Netzwerke in einem Zyklus:
 *   Zwangssteuerung wirksam (F_G2) → Transitionen (nur 'trans') → Schritte →
 *   speichernde Aktionen und Aktionen bei Ereignis → Ausgänge → Init := FALSE.
 *
 * Eine SPS schaltet pro Zyklus nur einmal weiter; instabile Situationen werden
 * nicht in einem Zyklus durchlaufen (siehe P.hints und NORM-OFFEN).
 *
 * Logikbaum (Knoten):
 *   {op:'var', name, ref?}  {op:'const', value}  {op:'num', value}  {op:'not', a}
 *   {op:'and'|'or', items}  {op:'cmp', cmp, l, r}
 *   {op:'fb', fb:'TON'|'TOF'|'R_TRIG'|'F_TRIG', name, a, pt, src}   Ausgang .Q
 *   Ein zweites Mal benutzter Baustein erscheint als {op:'var', name:'TON_1.Q', ref:<fb-Knoten>}.
 * Netzwerke:
 *   {kind:'assign', target, expr}            target := expr
 *   {kind:'sr', target, set, reset}          SR (setzdominant)
 *   {kind:'move', target, en, value}         bei en: target := 0/1/+1/−1 (Zähler)
 *   jeweils mit group, title, comment und el (id des Schritts bzw. der Transition im GRAFCET, falls eindeutig)
 */
(function (GE) {
  'use strict';

  var P = (GE.plc = {});
  var M = GE.model;
  var E = GE.expr;
  var S = GE.sim;

  P.METHODS = { trans: 'Transitionsmerker', chain: 'Klassische Schrittkette' };

  var KEYWORDS = ('AND OR XOR NOT MOD TRUE FALSE IF THEN ELSE ELSIF END_IF CASE OF FOR TO BY DO WHILE REPEAT UNTIL ' +
    'RETURN EXIT VAR END_VAR PROGRAM END_PROGRAM TON TOF TP R_TRIG F_TRIG SR RS CTU CTD BOOL INT TIME ' +
    'STEP END_STEP INITIAL_STEP TRANSITION END_TRANSITION ACTION END_ACTION FROM N P P0 P1 SD DS SL').split(' ');

  /** IEC-taugliche Bezeichnung: Umlaute ersetzen, Sonderzeichen zu _, keine Ziffer am Anfang. */
  P.ident = function (name) {
    var s = String(name == null ? '' : name)
      .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/Ä/g, 'Ae').replace(/Ö/g, 'Oe').replace(/Ü/g, 'Ue')
      .replace(/ß/g, 'ss').replace(/[^A-Za-z0-9_]/g, '_').replace(/_+/g, '_');
    if (!s) s = '_';
    if (/^[0-9]/.test(s)) s = '_' + s;
    if (KEYWORDS.indexOf(s.toUpperCase()) >= 0) s += '_';
    return s;
  };

  // ------------------------------------------------------------ Bausteine für den Logikbaum

  function v(name) { return { op: 'var', name: name }; }
  var FALSE = { op: 'const', value: false };
  function not(a) { return a.op === 'not' ? a.a : { op: 'not', a: a }; }
  function and(items) {
    var out = [];
    items.forEach(function (x) {
      if (!x) return;
      if (x.op === 'and') out.push.apply(out, x.items); else out.push(x);
    });
    return out.length === 1 ? out[0] : { op: 'and', items: out };
  }
  function or(items) {
    var out = [];
    items.forEach(function (x) {
      if (!x) return;
      if (x.op === 'or') out.push.apply(out, x.items); else out.push(x);
    });
    if (!out.length) return null;
    return out.length === 1 ? out[0] : { op: 'or', items: out };
  }
  P.isEmpty = function (n) { return !n || (n.op === 'const' && !n.value); };

  /** Alle Knoten eines Baums (Eltern vor Kindern). */
  P.walk = function (n, fn) {
    if (!n) return;
    fn(n);
    if (n.items) n.items.forEach(function (x) { P.walk(x, fn); });
    if (n.a) P.walk(n.a, fn);
    if (n.l) P.walk(n.l, fn);
    if (n.r) P.walk(n.r, fn);
  };

  // ------------------------------------------------------------ Übersetzung

  /**
   * @param {Object} page    GRAFCET-Seite
   * @param {Object} [opts]  method: 'trans'|'chain', project (für Kommentare der Variablen)
   */
  P.translate = function (page, opts) {
    opts = opts || {};
    var method = opts.method === 'chain' ? 'chain' : 'trans';
    var project = opts.project || null;
    var vars = S.variables(page);
    var notes = [];
    var names = {};        // GRAFCET-Name -> PLC-Name
    var used = {};         // vergebene PLC-Namen

    function claim(id) {
      var base = id;
      var k = 1;
      while (used[id]) id = base + '_' + (++k);
      used[id] = true;
      return id;
    }
    var stepById = {};
    page.steps.forEach(function (s) { stepById[s.id] = s; });
    // Schrittmerker zuerst (X1, XM1 …), dann die Variablen des GRAFCET
    page.steps.forEach(function (s) { names['X' + s.name] = claim(P.ident('X' + s.name)); });
    var userVars = vars.inputs.concat(vars.outputs, vars.memories);
    userVars.forEach(function (n) { if (!names[n]) names[n] = claim(P.ident(n)); });
    // eigene Merker: bei Konflikt mit Variablen des GRAFCET T_1 statt T1, Init_ statt Init
    var tPrefix = userVars.some(function (n) { return /^T_?\d+$/i.test(names[n]); }) ? 'T_' : 'T';
    var initName = claim(used.Init ? 'Init_' : 'Init');

    function plcVar(name) {
      if (!names[name]) names[name] = claim(P.ident(name));
      return names[name];
    }
    function X(id) { return v(names['X' + stepById[id].name]); }

    // Bausteine (Zeiten, Flanken); gleiche Ausdrücke teilen sich eine Instanz
    var fbs = [];
    var fbByKey = {};
    var counter = { TON: 0, TOF: 0, R_TRIG: 0, F_TRIG: 0 };
    var PREFIX = { TON: 'TON_', TOF: 'TOF_', R_TRIG: 'RT_', F_TRIG: 'FT_' };
    function fb(kind, key, a, extra, fixedName) {
      if (fbByKey[key]) return { op: 'var', name: fbByKey[key].name + '.Q', ref: fbByKey[key] };
      var n = Object.assign({ op: 'fb', fb: kind, name: claim(fixedName || PREFIX[kind] + (++counter[kind])), a: a }, extra || {});
      fbByKey[key] = n;
      fbs.push(n);
      return n;
    }
    function stepEdge(id, dir) {
      var nm = names['X' + stepById[id].name];
      var src = { type: 'edge', dir: dir, a: { type: 'var', name: 'X' + stepById[id].name } };
      return fb(dir === 'up' ? 'R_TRIG' : 'F_TRIG', 'step:' + dir + ':' + id, v(nm), { src: src }, (dir === 'up' ? 'RT_' : 'FT_') + nm);
    }

    /** Bedingung (Syntaxbaum aus expr.js) in den Logikbaum umsetzen. */
    function conv(ast, where) {
      switch (ast.type) {
        case 'const': return { op: 'const', value: !!ast.value };
        case 'num': return { op: 'num', value: ast.value };
        case 'var': return v(plcVar(ast.name));
        case 'not': return not(conv(ast.a, where));
        case 'and': return and(ast.items.map(function (x) { return conv(x, where); }));
        case 'or': return or(ast.items.map(function (x) { return conv(x, where); }));
        case 'cmp': return { op: 'cmp', cmp: ast.op, l: conv(ast.l, where), r: conv(ast.r, where) };
        case 'edge':
          return fb(ast.dir === 'up' ? 'R_TRIG' : 'F_TRIG', 'edge:' + ast.dir + ':' + E.format(ast.a), conv(ast.a, where), { src: ast });
        case 'timer':
          var on = fb('TON', 'ton:' + ast.v + ':' + ast.t1, v(plcVar(ast.v)),
            { pt: ast.t1, src: { type: 'timer', t1: ast.t1, v: ast.v, t2: 0 } });
          if (!(ast.t2 > 0)) return on;
          return fb('TOF', 'tof:' + ast.v + ':' + ast.t1 + ':' + ast.t2, on, { pt: ast.t2, src: ast });
        case 'tsince':
          notes.push(where + ': Die Kurzform „t…“ ist mehrdeutig und wird als FALSE übersetzt.');
          return FALSE;
      }
      return FALSE;
    }
    function condOf(text, where) {
      var r = E.parse(text);
      if (!r.ok) {
        notes.push(where + ': Die Bedingung ist fehlerhaft und wird als FALSE übersetzt.');
        return FALSE;
      }
      return conv(r.ast, where);
    }

    // ---- Struktur (wie in sim.js)
    var trans = page.transitions.map(function (t) {
      return {
        t: t,
        pre: M.inLinks(page, t.id).map(function (l) { return l.from; }).filter(function (id) { return stepById[id]; }),
        post: M.outLinks(page, t.id).map(function (l) { return l.to; }).filter(function (id) { return stepById[id]; })
      };
    });
    // Namen der Transitionsmerker: T1, T2 … in Lesereihenfolge (wie M.numberTransitions)
    trans.slice().sort(function (a, b) { return a.t.y - b.t.y || a.t.x - b.t.x; }).forEach(function (tr, i) {
      var m = /^\(?T?(\d+)\)?$/.exec(tr.t.name || '');
      tr.label = 'T' + (m ? m[1] : i + 1);
      tr.cond = tr.t.cond || '';
    });
    trans.forEach(function (tr) {
      tr.name = claim(tPrefix + tr.label.slice(1));
      var r = E.parse(tr.cond);
      tr.ast = r.ok ? r.ast : null;
    });
    var partials = (page.frames || []).filter(function (fr) { return fr.kind === 'partial'; });
    var frameSteps = {};
    partials.forEach(function (fr) {
      frameSteps[fr.id] = page.steps.filter(function (s) { return M.frameContains(fr, M.anchorPoint(s)); }).map(function (s) { return s.id; });
    });
    var macroExit = {};
    var macroEntry = {};      // Eingangsschritt -> Makroschritt
    var encInitOf = {};       // Schritt -> einschließender Schritt, der ihn aktiviert
    var ownerOf = {};         // Schritt -> Makro-/einschließender Schritt (innerster)
    page.steps.forEach(function (s) {
      if (s.kind === 'macro') {
        var mp = M.macroParts(page, s.id);
        if (mp.exits[0]) macroExit[s.id] = mp.exits[0].id;
        if (mp.entries[0]) macroEntry[mp.entries[0].id] = s.id;
      }
      if (s.kind === 'enclosing') M.enclosedInitSteps(page, s.id).forEach(function (x) { encInitOf[x.id] = s.id; });
      var fr = M.frameOf(page, s, ['macro', 'enclosed']);
      if (fr && fr.owner && stepById[fr.owner] && fr.owner !== s.id) ownerOf[s.id] = fr.owner;
    });
    function depth(id) { var d = 0; while (ownerOf[id] && d < 50) { id = ownerOf[id]; d++; } return d; }

    // Zwangssteuerungen: Teil-GRAFCET -> zwingende Schritte
    var forcing = {};   // Rahmen-id -> [{step, mode, names}]
    page.steps.forEach(function (s) {
      s.actions.forEach(function (a) {
        if (a.type !== 'forcing') return;
        var fr = partials.filter(function (x) { return x.name === a.target; })[0];
        if (!fr) { notes.push('Schritt ' + s.name + ': Zwangssteuerung ' + M.forcingLabel(a) + ' – Teil-GRAFCET nicht gefunden, nicht übersetzt.'); return; }
        (forcing[fr.id] = forcing[fr.id] || []).push({ step: s.id, mode: a.forceMode, names: M.forceStepNames(a), a: a });
      });
    });
    var forceName = {};
    partials.forEach(function (fr) { if (forcing[fr.id]) forceName[fr.id] = claim('F_' + P.ident(fr.name)); });

    var networks = [];
    function net(n) { networks.push(n); return n; }

    // ---- 1. Zwangssteuerung wirksam
    partials.forEach(function (fr) {
      if (!forcing[fr.id]) return;
      net({
        kind: 'assign', group: 'force', target: forceName[fr.id],
        expr: or(forcing[fr.id].map(function (f) { return X(f.step); })),
        title: 'Zwangssteuerung von ' + fr.name + ' wirksam',
        comment: forcing[fr.id].map(function (f) { return 'Schritt ' + stepById[f.step].name + ': ' + M.forcingLabel(f.a); }).join(', ')
      });
    });

    /** Freigabe UND Bedingung einer Transition (ohne Merker). */
    function fires(tr) {
      var parts = [];
      tr.pre.forEach(function (id) {
        parts.push(X(id));
        if (macroExit[id]) parts.push(X(macroExit[id]));   // nach einem Makroschritt erst, wenn sein Ausgangsschritt aktiv ist
      });
      parts.push(tr.ast ? conv(tr.ast, 'Transition ' + tr.label) : condOf(tr.cond, 'Transition ' + tr.label));
      partials.forEach(function (fr) {
        if (forceName[fr.id] && M.frameContains(fr, tr.t)) parts.push(not(v(forceName[fr.id])));
      });
      return and(parts);
    }
    function stepList(ids) { return ids.map(function (id) { return stepById[id].name; }).join(', ') || '–'; }

    // ---- 2. Transitionen
    if (method === 'trans') {
      trans.forEach(function (tr) {
        if (!tr.pre.length) notes.push('Transition ' + tr.label + ' hat keinen Vorgängerschritt und schaltet nie.');
        net({
          kind: 'assign', group: 'trans', target: tr.name, expr: tr.pre.length ? fires(tr) : FALSE,
          title: 'Transition ' + tr.label + ' (Schritt ' + stepList(tr.pre) + ' → ' + stepList(tr.post) + ')', el: tr.t.id,
          comment: tr.t.comment || '', cond: tr.cond
        });
      });
    }

    // ---- 3. Schritte (äußere vor inneren, sonst in der Reihenfolge der Seite)
    var order = page.steps.slice().sort(function (a, b) { return depth(a.id) - depth(b.id); });
    order.forEach(function (s) {
      var set = [];
      var reset = [];
      trans.forEach(function (tr) {
        var into = tr.post.indexOf(s.id) >= 0;
        var from = tr.pre.indexOf(s.id) >= 0;
        if (method === 'trans') {
          if (into) set.push(v(tr.name));
          if (from && !into) reset.push(v(tr.name));
        } else {
          if (into && tr.pre.length) set.push(fires(tr));
          if (from && !into) reset.push(tr.post.length ? and(tr.post.map(X)) : fires(tr));
        }
      });
      if (s.initial) set.push(v(initName)); else reset.push(v(initName));
      partials.forEach(function (fr) {
        if (!forcing[fr.id] || frameSteps[fr.id].indexOf(s.id) < 0) return;
        forcing[fr.id].forEach(function (f) {
          if (f.mode === 'freeze') return;
          var want = f.mode === 'steps' ? f.names.indexOf(s.name) >= 0 : f.mode === 'init' ? !!s.initial : false;
          (want ? set : reset).push(X(f.step));
        });
      });
      if (macroEntry[s.id]) set.push(stepEdge(macroEntry[s.id], 'up'));
      if (encInitOf[s.id]) set.push(stepEdge(encInitOf[s.id], 'up'));
      if (ownerOf[s.id]) reset.push(not(X(ownerOf[s.id])));
      var kind = s.kind === 'macro' ? 'Makroschritt ' : s.kind === 'enclosing' ? 'Einschließender Schritt ' : s.initial ? 'Anfangsschritt ' : 'Schritt ';
      net({
        kind: 'sr', group: 'step', target: names['X' + s.name], set: or(set), reset: or(reset),
        title: kind + s.name, comment: s.comment || '', stepId: s.id, el: s.id
      });
    });

    // ---- 4. Speichernde Aktionen und Aktionen bei Ereignis
    var storedVars = {};
    page.steps.forEach(function (s) {
      s.actions.forEach(function (a) {
        if (!a.var || (a.type !== 'stored' && a.type !== 'event')) return;
        var trig = a.type === 'event'
          ? and([X(s.id), a.cond ? condOf(a.cond, 'Aktion ' + a.var + ' in Schritt ' + s.name) : FALSE])
          : stepEdge(s.id, a.when === 'deactivation' ? 'down' : 'up');
        (storedVars[a.var] = storedVars[a.var] || []).push({ s: s, a: a, trig: trig });
      });
    });
    var mixed = {};
    vars.mixed.forEach(function (n) { mixed[n] = claim(P.ident(n) + '_S'); });
    function whenText(x) {
      return x.a.type === 'event' ? 'Schritt ' + x.s.name + ' bei ' + x.a.cond
        : (x.a.when === 'deactivation' ? 'Verlassen von Schritt ' : 'Aktivieren von Schritt ') + x.s.name;
    }
    Object.keys(storedVars).sort(GE.util.naturalCompare).forEach(function (n) {
      var list = storedVars[n];
      var target = mixed[n] || plcVar(n);
      var isCounter = vars.counters.indexOf(n) >= 0;
      if (isCounter) {
        list.forEach(function (x) {
          net({
            kind: 'move', group: 'stored', target: target, en: x.trig, value: x.a.value,
            title: n + (x.a.value === 'inc' ? ' := ' + n + ' + 1' : x.a.value === 'dec' ? ' := ' + n + ' − 1' : ' := ' + x.a.value) + ' (' + whenText(x) + ')',
            comment: ''
          });
        });
        return;
      }
      net({
        kind: 'sr', group: 'stored', target: target,
        set: or(list.filter(function (x) { return x.a.value === '1'; }).map(function (x) { return x.trig; })),
        reset: or(list.filter(function (x) { return x.a.value !== '1'; }).map(function (x) { return x.trig; })),
        title: 'Speichernd: ' + n + (mixed[n] ? ' (gespeicherter Teil ' + target + ')' : ''),
        comment: list.map(function (x) { return n + ' := ' + x.a.value + ' bei ' + whenText(x); }).join('; ')
      });
    });

    // ---- 5. Ausgänge (kontinuierliche und bedingte Aktionen)
    vars.outputs.concat(vars.mixed).forEach(function (n) {
      var terms = [];
      var who = [];
      page.steps.forEach(function (s) {
        s.actions.forEach(function (a) {
          if (a.var !== n) return;
          if (a.type === 'continuous') { terms.push(X(s.id)); who.push('Schritt ' + s.name); }
          if (a.type === 'conditional') {
            terms.push(and([X(s.id), a.cond ? condOf(a.cond, 'Aktion ' + n + ' in Schritt ' + s.name) : FALSE]));
            who.push('Schritt ' + s.name + ' bei ' + (a.cond || '?'));
          }
        });
      });
      if (mixed[n]) { terms.push(v(mixed[n])); who.push('gespeichert'); }
      net({ kind: 'assign', group: 'out', target: plcVar(n), expr: or(terms) || FALSE, title: 'Ausgang ' + n, comment: who.join(', ') });
    });

    // ---- 6. Erstzyklus beenden
    net({ kind: 'assign', group: 'init', target: initName, expr: FALSE, title: 'Erstzyklus beenden', comment: '' });

    networks.forEach(function (n, i) { n.no = i + 1; });

    // ---- Variablenliste
    var comments = {};
    ((project && project.variables) || []).forEach(function (x) { comments[x.name] = x.comment || ''; });
    var numeric = {};
    vars.numeric.concat(vars.counters).forEach(function (n) { numeric[n] = true; });
    function decl(n, art) {
      return { grafcet: n, name: names[n], type: numeric[n] ? 'INT' : 'BOOL', art: art, comment: comments[n] || '' };
    }
    var decls = [];
    vars.inputs.forEach(function (n) { decls.push(decl(n, 'input')); });
    vars.outputs.concat(vars.mixed).forEach(function (n) { decls.push(decl(n, 'output')); });
    vars.memories.filter(function (n) { return vars.mixed.indexOf(n) < 0; }).forEach(function (n) { decls.push(decl(n, 'memory')); });
    vars.mixed.forEach(function (n) { decls.push({ grafcet: n, name: mixed[n], type: 'BOOL', art: 'memory', comment: 'gespeicherter Teil von ' + n }); });
    page.steps.forEach(function (s) { decls.push({ grafcet: 'X' + s.name, name: names['X' + s.name], type: 'BOOL', art: 'step', comment: 'Schritt ' + s.name + (s.comment ? ' – ' + s.comment : '') }); });
    if (method === 'trans') {
      trans.forEach(function (tr) { decls.push({ grafcet: tr.label, name: tr.name, type: 'BOOL', art: 'trans', comment: 'Transition ' + tr.label + ': ' + tr.cond }); });
    }
    partials.forEach(function (fr) { if (forceName[fr.id]) decls.push({ grafcet: '', name: forceName[fr.id], type: 'BOOL', art: 'force', comment: 'Zwangssteuerung von ' + fr.name + ' wirksam' }); });
    decls.push({ grafcet: '', name: initName, type: 'BOOL', art: 'init', init: 'TRUE', comment: 'Erstzyklus' });
    fbs.forEach(function (f) { decls.push({ grafcet: '', name: f.name, type: f.fb, art: 'fb', comment: fbComment(f) }); });

    // Bedingungen der Transitionen einzeln (für die Ablaufsprache)
    var sfcTrans = trans.map(function (tr) {
      return { label: tr.label, pre: tr.pre, post: tr.post, t: tr.t, cond: tr.ast ? conv(tr.ast, 'Transition ' + tr.label) : FALSE };
    });

    return {
      method: method, title: (project && project.title) || page.name || 'GRAFCET', networks: networks, decls: decls,
      names: names, initName: initName, fbs: fbs, notes: notes, sfcTrans: sfcTrans
    };
  };

  function fbComment(f) {
    if (f.fb === 'TON') return 'Einschaltverzögerung ' + P.timeLiteral(f.pt);
    if (f.fb === 'TOF') return 'Ausschaltverzögerung ' + P.timeLiteral(f.pt);
    return f.fb === 'R_TRIG' ? 'steigende Flanke' : 'fallende Flanke';
  }

  /** Zeitangabe in IEC-Schreibweise, z. B. T#5s, T#1500ms. */
  P.timeLiteral = function (ms) {
    ms = Math.round(+ms || 0);
    return ms % 1000 === 0 ? 'T#' + ms / 1000 + 's' : 'T#' + ms + 'ms';
  };

  /** Hinweise unter der Übersetzung. */
  P.hints = function (prog) {
    var h = [
      'Eine SPS schaltet pro Zyklus nur einmal weiter. Instabile Situationen (mehrere Transitionen hintereinander ' +
      'ohne Zeitfortschritt) werden nicht in einem Augenblick durchlaufen, sondern über mehrere Zyklen; ' +
      'die Aktionen der Durchlaufschritte können dabei für einen Zyklus wirken.',
      'Bezeichnungen nach IEC 61131-3: SR ist setzdominant (Eingang S1), RS rücksetzdominant (Eingang R1). ' +
      'Im TIA Portal von Siemens ist es umgekehrt (dort ist SR rücksetzdominant), Strukturierter Text heißt dort SCL. ' +
      'Variablen mit einer Ziffer am Anfang (z. B. 1M1) stehen hier als _1M1, im TIA Portal in Anführungszeichen ("1M1").',
      'Init ist nur im ersten Zyklus TRUE (Erstzyklus-Merker) und setzt die Anfangsschritte.'
    ];
    if (prog.method === 'chain') {
      h.push('Klassische Schrittkette: Ein Schritt wird erst zurückgesetzt, wenn sein Folgeschritt aktiv ist. ' +
        'Für einen Zyklus sind deshalb zwei Schritte aktiv, und bei bereits erfüllten Bedingungen können ' +
        'mehrere Schritte in einem Zyklus gesetzt werden. Die Transitionsmerker-Methode vermeidet das.');
    }
    if (prog.fbs.some(function (f) { return f.fb === 'TOF'; })) {
      h.push('Zeit mit Abfallverzögerung (z. B. 1s/B1/2s) als TON mit nachgeschaltetem TOF. Sonderfall: Wird die Variable ' +
        'während der Abfallzeit kurz wieder 1, bleibt der Ausgang hier 1; die Simulation schaltet ihn sofort ab (siehe NORM-OFFEN).');
    }
    return h.concat(prog.notes.filter(function (x, i, a) { return a.indexOf(x) === i; }));
  };

  // ------------------------------------------------------------ Strukturierter Text

  var CMP_ST = { '>': '>', '<': '<', '>=': '>=', '<=': '<=', '=': '=', '<>': '<>' };

  /** Ausdruck in ST (Vorrang: NOT vor Vergleich vor AND vor OR). */
  P.stExpr = function (n, prec) {
    prec = prec || 0;
    var s;
    var p;
    switch (n.op) {
      case 'var': return n.name;
      case 'const': return n.value ? 'TRUE' : 'FALSE';
      case 'num': return String(n.value);
      case 'fb': return n.name + '.Q';
      case 'not': s = 'NOT ' + P.stExpr(n.a, 5); p = 5; break;
      case 'cmp': s = P.stExpr(n.l, 4) + ' ' + CMP_ST[n.cmp] + ' ' + P.stExpr(n.r, 4); p = 3; break;
      case 'and': s = n.items.map(function (x) { return P.stExpr(x, 2); }).join(' AND '); p = 2; break;
      case 'or': s = n.items.map(function (x) { return P.stExpr(x, 1); }).join(' OR '); p = 1; break;
      default: return '?';
    }
    return p < prec || (p === prec && (n.op === 'not' || n.op === 'cmp')) ? '(' + s + ')' : s;
  };

  function cmt(text) { return '(* ' + String(text).replace(/\(\*|\*\)/g, '').replace(/\s+/g, ' ').trim() + ' *)'; }

  /** Aufrufe der Bausteine in einem Ausdruck (innere zuerst). */
  function fbCalls(n, out) {
    if (!n) return out;
    if (n.items) n.items.forEach(function (x) { fbCalls(x, out); });
    if (n.l) fbCalls(n.l, out);
    if (n.r) fbCalls(n.r, out);
    if (n.op === 'not') fbCalls(n.a, out);
    if (n.op === 'fb') {
      fbCalls(n.a, out);
      var arg = n.fb === 'TON' || n.fb === 'TOF'
        ? 'IN := ' + P.stExpr(n.a) + ', PT := ' + P.timeLiteral(n.pt)
        : 'CLK := ' + P.stExpr(n.a);
      out.push(n.name + '(' + arg + ');');
    }
    return out;
  }

  P.netExprs = function (nw) {
    return nw.kind === 'sr' ? [nw.set, nw.reset] : nw.kind === 'move' ? [nw.en] : [nw.expr];
  };

  P.toST = function (prog) {
    var L = [];
    L.push(cmt('GRAFCET „' + prog.title + '“ – übersetzt mit ' + P.METHODS[prog.method] + ', IEC 61131-3 (Siemens TIA: SCL)'));
    L.push(cmt('Erzeugt mit der GRAFCET Lernwerkstatt. Nur zum Üben, keine geprüfte Steuerung (NOT-HALT!).'));
    L.push('PROGRAM Grafcet');
    var groups = [['VAR_INPUT', 'input'], ['VAR_OUTPUT', 'output'], ['VAR', null]];
    groups.forEach(function (g) {
      var list = prog.decls.filter(function (d) { return g[1] ? d.art === g[1] : d.art !== 'input' && d.art !== 'output'; });
      if (!list.length) return;
      L.push(g[0]);
      var w = Math.max.apply(null, list.map(function (d) { return d.name.length; }));
      list.forEach(function (d) {
        var line = '  ' + d.name + new Array(w - d.name.length + 2).join(' ') + ': ' + d.type + (d.init ? ' := ' + d.init : '') + ';';
        var c = (d.grafcet && d.grafcet !== d.name ? d.grafcet + (d.comment ? ' – ' : '') : '') + d.comment;
        L.push(c ? line + ' ' + cmt(c) : line);
      });
      L.push('END_VAR');
    });
    L.push('');
    L.push(P.stBody(prog));
    L.push('END_PROGRAM');
    return L.join('\n');
  };

  /** Anweisungsteil des ST-Programms (ohne Deklaration), Netzwerk für Netzwerk. */
  P.stBody = function (prog) {
    var L = [];
    prog.networks.forEach(function (nw) {
      L.push(cmt('Netzwerk ' + nw.no + ': ' + nw.title + (nw.comment ? ' – ' + nw.comment : '')));
      var calls = [];
      P.netExprs(nw).forEach(function (e) { fbCalls(e, calls); });
      calls.forEach(function (c) { L.push(c); });
      if (nw.kind === 'assign') L.push(nw.target + ' := ' + P.stExpr(nw.expr) + ';');
      else if (nw.kind === 'sr') {
        // erst rücksetzen, dann setzen: Setzen gewinnt (setzdominant wie SR)
        if (!P.isEmpty(nw.reset)) L.push('IF ' + P.stExpr(nw.reset) + ' THEN ' + nw.target + ' := FALSE; END_IF;');
        if (!P.isEmpty(nw.set)) L.push('IF ' + P.stExpr(nw.set) + ' THEN ' + nw.target + ' := TRUE; END_IF;');
      } else if (nw.kind === 'move') {
        var val = nw.value === 'inc' ? nw.target + ' + 1' : nw.value === 'dec' ? nw.target + ' - 1' : nw.value;
        L.push('IF ' + P.stExpr(nw.en) + ' THEN ' + nw.target + ' := ' + val + '; END_IF;');
      }
      L.push('');
    });
    return L.join('\n');
  };

  // ------------------------------------------------------------ PLCopen XML (Austausch, z. B. Import in CODESYS)

  function xml(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /**
   * Programm als PLCopen XML (TC6, Version 2.0): ein POU „Grafcet“ vom Typ program mit
   * Deklaration und ST-Rumpf. Lässt sich z. B. in CODESYS über „PLCopenXML importieren“ einlesen.
   */
  P.toPLCopen = function (prog, now) {
    var date = (now || new Date()).toISOString().replace(/\.\d+Z$/, '');
    var ELEM = { BOOL: '<BOOL/>', INT: '<INT/>' };
    function vars(tag, list) {
      if (!list.length) return '';
      return '        <' + tag + '>\n' + list.map(function (d) {
        var type = ELEM[d.type] || '<derived name="' + xml(d.type) + '"/>';
        var c = (d.grafcet && d.grafcet !== d.name ? d.grafcet + (d.comment ? ' – ' : '') : '') + d.comment;
        return '          <variable name="' + xml(d.name) + '">\n' +
          '            <type>' + type + '</type>\n' +
          (d.init ? '            <initialValue><simpleValue value="' + xml(d.init) + '"/></initialValue>\n' : '') +
          (c ? '            <documentation><xhtml xmlns="http://www.w3.org/1999/xhtml">' + xml(c) + '</xhtml></documentation>\n' : '') +
          '          </variable>';
      }).join('\n') + '\n        </' + tag + '>\n';
    }
    var d = prog.decls;
    var ins = d.filter(function (x) { return x.art === 'input'; });
    var outs = d.filter(function (x) { return x.art === 'output'; });
    var locs = d.filter(function (x) { return x.art !== 'input' && x.art !== 'output'; });
    return '<?xml version="1.0" encoding="utf-8"?>\n' +
      '<project xmlns="http://www.plcopen.org/xml/tc6_0200">\n' +
      '  <fileHeader companyName="GRAFCET Lernwerkstatt" productName="GRAFCET Lernwerkstatt" productVersion="1" creationDateTime="' + date + '"/>\n' +
      '  <contentHeader name="' + xml(prog.title) + '" modificationDateTime="' + date + '">\n' +
      '    <coordinateInfo><fbd><scaling x="1" y="1"/></fbd><ld><scaling x="1" y="1"/></ld><sfc><scaling x="1" y="1"/></sfc></coordinateInfo>\n' +
      '  </contentHeader>\n' +
      '  <types>\n    <dataTypes/>\n    <pous>\n' +
      '      <pou name="Grafcet" pouType="program">\n        <interface>\n' +
      vars('inputVars', ins) + vars('outputVars', outs) + vars('localVars', locs) +
      '        </interface>\n' +
      '        <body>\n          <ST><xhtml xmlns="http://www.w3.org/1999/xhtml">' + xml(P.stBody(prog)) + '</xhtml></ST>\n        </body>\n' +
      '        <documentation><xhtml xmlns="http://www.w3.org/1999/xhtml">' +
      xml('Aus dem GRAFCET „' + prog.title + '“ übersetzt (' + P.METHODS[prog.method] + '). Nur zum Üben, keine geprüfte Steuerung.') +
      '</xhtml></documentation>\n' +
      '      </pou>\n    </pous>\n  </types>\n' +
      '  <instances><configurations/></instances>\n</project>\n';
  };

  // ------------------------------------------------------------ Selbsttest: Fragen zum SPS-Programm

  /**
   * Erzeugt eine Übungsfrage zum Programm (Auswahl aus vier Antworten).
   * @param {Function} rnd  Zufallszahl 0..1 (für Tests feststellbar)
   * @returns {{q, options, answer, explain}|null}
   */
  P.quiz = function (prog, rnd) {
    rnd = rnd || Math.random;
    function pick(a) { return a[Math.floor(rnd() * a.length)]; }
    function shuffle(a) {
      a = a.slice();
      for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(rnd() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
      return a;
    }
    function names(n) {
      var out = [];
      P.walk(n, function (x) { if (x.op === 'var' && out.indexOf(x.name) < 0) out.push(x.name); });
      return out;
    }
    var steps = prog.networks.filter(function (n) { return n.group === 'step'; });
    var trans = prog.networks.filter(function (n) { return n.group === 'trans'; });
    var outs = prog.networks.filter(function (n) { return n.group === 'out' && n.expr && n.expr.op !== 'const'; });
    var kinds = [];
    if (steps.length > 2) kinds.push('set', 'reset');
    if (trans.length > 2) kinds.push('trans');
    if (outs.length > 1 && steps.length > 2) kinds.push('out');
    kinds.push('dominant', 'init');
    var stepNames = steps.map(function (n) { return n.target; });
    function make(q, right, wrong, explain) {
      wrong = shuffle(wrong.filter(function (w) { return w !== right; }).filter(function (w, i, a) { return a.indexOf(w) === i; })).slice(0, 3);
      if (wrong.length < 2) return null;
      var options = shuffle([right].concat(wrong));
      return { q: q, options: options, answer: options.indexOf(right), explain: explain };
    }
    for (var tries = 0; tries < 20; tries++) {
      var k = pick(kinds);
      var r = null;
      if (k === 'set' || k === 'reset') {
        var nw = pick(steps);
        var part = k === 'set' ? nw.set : nw.reset;
        if (P.isEmpty(part)) continue;
        var right = P.stExpr(part);
        var wrong = steps.filter(function (x) { return x !== nw; }).map(function (x) { return k === 'set' ? x.set : x.reset; })
          .filter(function (x) { return !P.isEmpty(x); }).map(function (x) { return P.stExpr(x); });
        r = make((k === 'set' ? 'Womit wird der Schrittmerker ' : 'Womit wird der Schrittmerker ') + nw.target + (k === 'set' ? ' gesetzt (Eingang S1)?' : ' rückgesetzt (Eingang R)?'),
          right, wrong, nw.target + (k === 'set' ? ' wird gesetzt bei ' : ' wird rückgesetzt bei ') + right + ' (Netzwerk ' + nw.no + ').');
      } else if (k === 'trans') {
        var t = pick(trans);
        var setBy = steps.filter(function (x) { return names(x.set).indexOf(t.target) >= 0; }).map(function (x) { return x.target; });
        if (!setBy.length) continue;
        var ans = setBy.join(', ');
        r = make('Welcher Schrittmerker wird gesetzt, wenn ' + t.target + ' = 1 ist?', ans,
          stepNames.filter(function (x) { return setBy.indexOf(x) < 0; }),
          t.target + ' steht am Setzeingang von ' + ans + '; ' + t.title + '.');
      } else if (k === 'out') {
        var o = pick(outs);
        var inExpr = names(o.expr).filter(function (x) { return stepNames.indexOf(x) >= 0; });
        if (!inExpr.length) continue;
        var s = pick(inExpr);
        r = make('Welcher Ausgang wird (mindestens) über den Schrittmerker ' + s + ' angesteuert?', o.target,
          outs.filter(function (x) { return names(x.expr).indexOf(s) < 0; }).map(function (x) { return x.target; }),
          o.target + ' := ' + P.stExpr(o.expr) + ' (Netzwerk ' + o.no + ').');
      } else if (k === 'dominant') {
        r = make('Ein Schrittmerker wird im selben Zyklus gesetzt und rückgesetzt. Was gilt beim SR-Baustein nach IEC 61131-3?',
          'Setzen gewinnt (setzdominant)', ['Rücksetzen gewinnt (rücksetzdominant)', 'Der alte Wert bleibt', 'Der Wert wechselt bei jedem Zyklus'],
          'SR ist setzdominant (Eingang S1); deshalb bleibt ein Schritt aktiv, der verlassen und gleich wieder aktiviert wird – wie im GRAFCET (Regel 5). Achtung: Bei Siemens heißt dieser Baustein RS.');
      } else if (k === 'init') {
        r = make('Wozu dient der Merker ' + prog.initName + '?', 'Er ist nur im ersten Zyklus 1 und setzt die Anfangsschritte',
          ['Er ist immer 1, solange die SPS läuft', 'Er startet die Zeiten', 'Er setzt alle Ausgänge zurück, wenn ein Fehler auftritt'],
          prog.initName + ' wird mit TRUE vorbelegt und im letzten Netzwerk auf FALSE gesetzt.');
      }
      if (r) return r;
    }
    return null;
  };

  // ------------------------------------------------------------ Ablaufsprache (AS, textuelle Form)

  P.QUALIFIERS = {
    N: 'nicht speichernd – wirkt, solange der Schritt aktiv ist',
    S: 'setzen (speichernd) – wirkt, bis es mit R zurückgesetzt wird',
    R: 'rücksetzen – beendet ein mit S gesetztes Aktionsbestimmungszeichen',
    D: 'zeitverzögert – wirkt erst nach der Zeit, solange der Schritt aktiv ist',
    P1: 'Impuls beim Aktivieren des Schritts (einmal)',
    P0: 'Impuls beim Deaktivieren des Schritts (einmal)'
  };

  /**
   * GRAFCET als Ablaufsprache (AS, engl. SFC; bei Siemens GRAPH) in textueller Form nach IEC 61131-3.
   * @returns {{text, rows, notes}} rows: Aktionen je Schritt mit Bestimmungszeichen
   */
  P.toSFC = function (page, prog) {
    var stepById = {};
    page.steps.forEach(function (s) { stepById[s.id] = s; });
    var stepVar = {};   // PLC-Schrittmerker (X3) -> Schritt
    page.steps.forEach(function (s) { stepVar[prog.names['X' + s.name]] = s; });
    function sname(s) { return 'Schritt' + P.ident(s.name).replace(/^_/, ''); }
    var notes = [];
    var rows = [];

    /** Bedingung in AS: Schrittmerker als Schritt.X, Zeit seit Aktivierung als Schritt.T. */
    function sfcNode(nd) {
      if (!nd) return nd;
      var f = nd.op === 'fb' ? nd : nd.ref;
      if (f && f.fb === 'TON' && f.a && f.a.op === 'var' && stepVar[f.a.name]) {
        return { op: 'var', name: '(' + sname(stepVar[f.a.name]) + '.T >= ' + P.timeLiteral(f.pt) + ')' };
      }
      if (nd.op === 'var' && stepVar[nd.name]) return { op: 'var', name: sname(stepVar[nd.name]) + '.X' };
      if (nd.op === 'fb') return { op: 'var', name: nd.name + '.Q' };
      var c = Object.assign({}, nd);
      if (nd.items) c.items = nd.items.map(sfcNode);
      if (nd.a) c.a = sfcNode(nd.a);
      if (nd.l) c.l = sfcNode(nd.l);
      if (nd.r) c.r = sfcNode(nd.r);
      return c;
    }
    function expr(nd) { return P.stExpr(sfcNode(nd)); }
    function condTree(text) {
      var r = E.parse(text || '');
      if (!r.ok) return null;
      // eigene Übersetzung nur für die Anzeige: Variablen über die Namen des Programms
      function c(a) {
        switch (a.type) {
          case 'const': return { op: 'const', value: !!a.value };
          case 'num': return { op: 'num', value: a.value };
          case 'var': return { op: 'var', name: prog.names[a.name] || P.ident(a.name) };
          case 'not': return { op: 'not', a: c(a.a) };
          case 'and': return { op: 'and', items: a.items.map(c) };
          case 'or': return { op: 'or', items: a.items.map(c) };
          case 'cmp': return { op: 'cmp', cmp: a.op, l: c(a.l), r: c(a.r) };
          case 'edge': return { op: 'var', name: (a.dir === 'up' ? 'R_TRIG' : 'F_TRIG') + '(' + E.format(a.a) + ').Q' };
          case 'timer':
            var st = M.stepByName(page, String(a.v).replace(/^X/, ''));
            if (st && /^X/.test(a.v) && !(a.t2 > 0)) return { op: 'var', name: '(' + sname(st) + '.T >= ' + P.timeLiteral(a.t1) + ')' };
            return { op: 'var', name: 'TON(' + a.v + ', ' + P.timeLiteral(a.t1) + ').Q' };
        }
        return { op: 'const', value: false };
      }
      return c(r.ast);
    }

    // Variablen mit bedingten Aktionen: außerhalb der Ablaufkette zuweisen (sonst behielten sie ihren letzten Wert)
    // Ausnahme: einzige Zuweisung ist „Zeit seit Aktivierung des eigenen Schritts“ -> Bestimmungszeichen D
    function ownDelay(s, a) {
      var r = E.parse(a.cond || '');
      return r.ok && r.ast.type === 'timer' && r.ast.v === 'X' + s.name && !(r.ast.t2 > 0) ? r.ast.t1 : 0;
    }
    var outside = {};
    var assigns = {};
    page.steps.forEach(function (s) {
      s.actions.forEach(function (a) {
        if (!a.var || (a.type !== 'continuous' && a.type !== 'conditional')) return;
        (assigns[a.var] = assigns[a.var] || []).push({ s: s, a: a });
      });
    });
    Object.keys(assigns).forEach(function (n) {
      var l = assigns[n];
      var cond = l.some(function (x) { return x.a.type === 'conditional'; });
      outside[n] = cond && !(l.length === 1 && ownDelay(l[0].s, l[0].a));
    });

    var actions = [];   // ACTION-Blöcke
    var L = [];
    L.push('(* Ablaufsprache (AS) nach IEC 61131-3, textuelle Form – bei Siemens GRAPH *)');
    L.push('(* GRAFCET „' + String(prog.title).replace(/\(\*|\*\)/g, '') + '“. AS ist eine SPS-Sprache: Sie ähnelt dem GRAFCET, folgt aber eigenen Regeln. *)');
    L.push('');

    var partials = (page.frames || []).filter(function (fr) { return fr.kind === 'partial'; });
    var groups = partials.map(function (fr) {
      return { title: 'Teil-GRAFCET ' + fr.name + ' (in AS: eigene Ablaufkette)', steps: page.steps.filter(function (s) { return M.partialOf(page, s) === fr; }) };
    });
    var rest = page.steps.filter(function (s) { return !M.partialOf(page, s); });
    if (rest.length) groups.unshift({ title: partials.length ? 'Ablaufkette außerhalb der Teil-GRAFCETs' : '', steps: rest });

    groups.forEach(function (g) {
      if (!g.steps.length) return;
      if (g.title) { L.push('(* ---- ' + g.title + ' *)'); L.push(''); }
      g.steps.forEach(function (s) {
        var assoc = [];
        s.actions.forEach(function (a, i) {
          var v = a.var ? (prog.names[a.var] || P.ident(a.var)) : '';
          var an = 'A_' + sname(s).replace('Schritt', 'S') + '_' + (i + 1);
          function row(q, what) { rows.push({ step: s.name, action: what, q: q, text: P.QUALIFIERS[q] || q }); }
          if (a.type === 'forcing') {
            assoc.push('  (* ' + M.forcingLabel(a) + ': Zwangssteuerung gibt es in AS nicht *)');
            notes.push('Schritt ' + s.name + ': Die Zwangssteuerung ' + M.forcingLabel(a) + ' hat in AS kein Gegenstück. ' +
              'Üblich ist ein Merker, der die gezwungene Kette sperrt bzw. initialisiert (siehe FUP/KOP/ST).');
            return;
          }
          if (!a.var) return;
          if (a.type === 'continuous') {
            if (outside[a.var]) { assoc.push('  (* ' + v + ': zugewiesen im Ausgangsteil unten *)'); return; }
            assoc.push('  ' + v + '(N);'); row('N', v);
          } else if (a.type === 'conditional') {
            if (!outside[a.var]) {
              var d = ownDelay(s, a);
              assoc.push('  ' + v + '(D, ' + P.timeLiteral(d) + ');'); row('D', v + ' nach ' + P.timeLiteral(d));
            } else {
              assoc.push('  (* ' + v + ' bei ' + a.cond + ': zugewiesen im Ausgangsteil unten *)');
            }
          } else if (a.type === 'stored' || a.type === 'event') {
            var val = a.value === 'inc' ? v + ' := ' + v + ' + 1;' : a.value === 'dec' ? v + ' := ' + v + ' - 1;' : v + ' := ' + (a.value === '1' ? 'TRUE' : 'FALSE') + ';';
            if (a.type === 'stored' && (a.value === '1' || a.value === '0') && a.when !== 'deactivation') {
              var q = a.value === '1' ? 'S' : 'R';
              assoc.push('  ' + v + '(' + q + ');'); row(q, v);
            } else if (a.type === 'stored') {
              var q2 = a.when === 'deactivation' ? 'P0' : 'P1';
              actions.push('ACTION ' + an + ':\n  ' + val + '\nEND_ACTION');
              assoc.push('  ' + an + '(' + q2 + ');  (* ' + val + ' *)'); row(q2, val);
            } else {
              var ct = condTree(a.cond);
              actions.push('ACTION ' + an + ':\n  IF ' + (ct ? P.stExpr(ct) : 'FALSE') + ' THEN ' + val + ' END_IF;\nEND_ACTION');
              assoc.push('  ' + an + '(N);  (* bei ' + a.cond + ': ' + val + ' *)'); row('N', 'bei ' + a.cond + ': ' + val);
            }
          }
        });
        if (s.kind === 'macro') notes.push('Makroschritt ' + s.name + ': In AS gibt es keine Makroschritte; die Expansion wird als eigene Schritte zwischen den Transitionen eingefügt.');
        if (s.kind === 'enclosing') notes.push('Einschließender Schritt ' + s.name + ': In AS nicht vorhanden; den Inhalt als eigene Kette mit Freigabe über ' + sname(s) + '.X umsetzen.');
        L.push((s.initial ? 'INITIAL_STEP ' : 'STEP ') + sname(s) + ':' + (s.comment ? '  (* ' + s.comment.replace(/\(\*|\*\)/g, '') + ' *)' : ''));
        assoc.forEach(function (x) { L.push(x); });
        L.push('END_STEP');
        L.push('');
      });
      prog.sfcTrans.forEach(function (tr) {
        if (!tr.pre.length || !g.steps.some(function (s) { return tr.pre.indexOf(s.id) >= 0; })) return;
        var list = function (ids) {
          var a = ids.map(function (id) { return sname(stepById[id]); });
          return a.length === 1 ? a[0] : '(' + a.join(', ') + ')';
        };
        if (!tr.post.length) { notes.push('Transition ' + tr.label + ' hat keinen Folgeschritt; in AS nicht möglich.'); return; }
        L.push('TRANSITION ' + tr.label + ' FROM ' + list(tr.pre) + ' TO ' + list(tr.post) + ' := ' + expr(tr.cond) + ';' +
          (tr.t.comment ? '  (* ' + tr.t.comment.replace(/\(\*|\*\)/g, '') + ' *)' : ''));
        L.push('END_TRANSITION');
      });
      L.push('');
    });

    var outVars = Object.keys(outside).filter(function (n) { return outside[n]; }).sort(GE.util.naturalCompare);
    if (outVars.length) {
      L.push('(* ---- Ausgangsteil (ST, außerhalb der Ablaufkette): bedingte Aktionen *)');
      outVars.forEach(function (n) {
        var terms = [];
        page.steps.forEach(function (s) {
          s.actions.forEach(function (a) {
            if (a.var !== n) return;
            if (a.type === 'continuous') terms.push({ op: 'var', name: sname(s) + '.X' });
            if (a.type === 'conditional') {
              var ct = condTree(a.cond);
              terms.push(ct ? { op: 'and', items: [{ op: 'var', name: sname(s) + '.X' }, ct] } : { op: 'const', value: false });
            }
          });
        });
        L.push((prog.names[n] || P.ident(n)) + ' := ' + P.stExpr(terms.length === 1 ? terms[0] : { op: 'or', items: terms }) + ';');
        rows.push({ step: '–', action: n, q: 'ST', text: 'bedingte Aktion, im Ausgangsteil zugewiesen' });
      });
      L.push('');
    }
    if (actions.length) {
      L.push('(* ---- Aktionen *)');
      actions.forEach(function (a) { L.push(a); L.push(''); });
    }
    if (prog.fbs.some(function (f) { return f.fb !== 'TON' || !(f.a && f.a.op === 'var' && stepVar[f.a.name]); })) {
      notes.push('Flanken und Zeiten, die sich nicht auf einen Schritt beziehen, stehen hier als Baustein-Ausgänge (z. B. R_TRIG(...).Q). ' +
        'In einem echten Programm werden die Bausteine in einem eigenen Netzwerk aufgerufen.');
    }
    return { text: L.join('\n'), rows: rows, notes: notes.filter(function (x, i, a) { return a.indexOf(x) === i; }) };
  };

  /** Unterschiede zwischen GRAFCET (Norm DIN EN 60848) und Ablaufsprache AS (SPS-Sprache). */
  P.SFC_DIFF = [
    'GRAFCET ist eine Beschreibungssprache für das Verhalten (DIN EN 60848), AS ist eine Programmiersprache für die SPS (IEC 61131-3).',
    'GRAFCET: Aktionen in Kästen (kontinuierlich, bedingt, speichernd, bei Ereignis). AS: Aktionen mit Bestimmungszeichen N, S, R, D, P1, P0 …',
    'Zeiten: GRAFCET schreibt 5s/X3, AS fragt die Schrittzeit ab (Schritt3.T >= T#5s).',
    'Zwangssteuerung, Makroschritte und einschließende Schritte gibt es in AS nicht.',
    'AS schaltet pro Zyklus; mehrere Transitionen nacheinander ohne Zeitfortschritt (instabile Situation) gibt es dort nicht.'
  ];

  // ------------------------------------------------------------ Ausführung wie eine SPS

  /**
   * Zyklische Ausführung des Programms (für Tests und zum Vergleich mit der Simulation).
   * cycle(dt): Zeit um dt ms weiter, dann alle Netzwerke einmal der Reihe nach.
   */
  function Runner(prog) {
    this.prog = prog;
    this.reset();
  }
  P.Runner = Runner;

  Runner.prototype.reset = function () {
    this.time = 0;
    this.vals = {};
    this.fb = {};
    this.vals[this.prog.initName] = 1;
  };

  /** Wert über den GRAFCET-Namen (B1, X3, 1M1) oder den PLC-Namen. */
  Runner.prototype.get = function (name) {
    var n = this.prog.names[name] || name;
    return this.vals[n] || 0;
  };

  Runner.prototype.set = function (name, value) {
    var n = this.prog.names[name] || P.ident(name);
    this.vals[n] = typeof value === 'boolean' ? (value ? 1 : 0) : value;
  };

  Runner.prototype.eval = function (n) {
    var self = this;
    var r;
    switch (n.op) {
      case 'var': return this.vals[n.name] || 0;
      case 'const': return n.value ? 1 : 0;
      case 'num': return n.value;
      case 'not': return this.eval(n.a) ? 0 : 1;
      case 'and':   // alle Teile auswerten (Bausteine müssen in jedem Zyklus aufgerufen werden)
        r = 1;
        n.items.forEach(function (x) { if (!self.eval(x)) r = 0; });
        return r;
      case 'or':
        r = 0;
        n.items.forEach(function (x) { if (self.eval(x)) r = 1; });
        return r;
      case 'cmp':
        var a = +this.eval(n.l);
        var b = +this.eval(n.r);
        return ({ '>': a > b, '<': a < b, '>=': a >= b, '<=': a <= b, '=': a === b, '<>': a !== b })[n.cmp] ? 1 : 0;
      case 'fb':
        var input = this.eval(n.a) ? 1 : 0;
        var st = this.fb[n.name] || (this.fb[n.name] = { m: 0, start: null, was: 0, off: null });
        var q = 0;
        if (n.fb === 'R_TRIG') { q = input && !st.m ? 1 : 0; st.m = input; }
        else if (n.fb === 'F_TRIG') { q = !input && st.m ? 1 : 0; st.m = input; }
        else if (n.fb === 'TON') {
          if (input) { if (st.start === null) st.start = this.time; q = this.time - st.start >= n.pt ? 1 : 0; } else st.start = null;
        } else if (n.fb === 'TOF') {
          if (input) { st.was = 1; st.off = null; q = 1; }
          else if (st.was) {
            if (st.off === null) st.off = this.time;
            q = this.time - st.off < n.pt ? 1 : 0;
            if (!q) st.was = 0;
          }
        }
        this.vals[n.name + '.Q'] = q;
        return q;
    }
    return 0;
  };

  Runner.prototype.cycle = function (dt) {
    var self = this;
    this.time += isFinite(dt) && dt > 0 ? dt : 0;
    this.prog.networks.forEach(function (nw) {
      var t = nw.target;
      if (nw.kind === 'assign') self.vals[t] = self.eval(nw.expr) ? 1 : 0;
      else if (nw.kind === 'sr') {
        var s = nw.set ? self.eval(nw.set) : 0;
        var r = nw.reset ? self.eval(nw.reset) : 0;
        self.vals[t] = s || (self.vals[t] && !r) ? 1 : 0;
      } else if (nw.kind === 'move') {
        if (self.eval(nw.en)) {
          var cur = +self.vals[t] || 0;
          self.vals[t] = nw.value === 'inc' ? cur + 1 : nw.value === 'dec' ? cur - 1 : +nw.value;
        }
      }
    });
  };

  /** Namen der aktiven Schritte (GRAFCET-Namen). */
  Runner.prototype.activeSteps = function (page) {
    var self = this;
    return page.steps.filter(function (s) { return self.get('X' + s.name); }).map(function (s) { return s.name; });
  };

  // ------------------------------------------------------------ Live-Werte aus der Simulation

  /**
   * Werte der Knoten aus dem Zustand der Simulation (für die Live-Ansicht des FUP):
   * Schritte, Ein- und Ausgänge kommen aus der Simulation, Merker und Zwischenwerte
   * werden aus den Netzwerken berechnet. Liefert value(node) und target(networkIndex).
   */
  P.liveValues = function (prog, sim) {
    var back = {};
    Object.keys(prog.names).forEach(function (g) { back[prog.names[g]] = g; });
    var byTarget = {};
    prog.networks.forEach(function (nw) { if (nw.kind === 'assign') byTarget[nw.target] = nw; });
    var memo = {};
    var busy = {};
    function varVal(name) {
      if (memo.hasOwnProperty(name)) return memo[name];
      var r = 0;
      if (back[name] !== undefined) r = sim.value(back[name]);
      else if (byTarget[name] && !busy[name] && name !== prog.initName) {
        busy[name] = true;
        r = value(byTarget[name].expr) ? 1 : 0;
        busy[name] = false;
      } else if (/\.Q$/.test(name)) {
        var f = prog.fbs.filter(function (x) { return x.name + '.Q' === name; })[0];
        r = f ? value(f) : 0;
      } else if (name.slice(-2) === '_S') r = sim.stored[back[name.slice(0, -2)]] ? 1 : 0;
      return (memo[name] = r);
    }
    function value(n) {
      if (!n) return 0;
      switch (n.op) {
        case 'var': return varVal(n.name);
        case 'const': return n.value ? 1 : 0;
        case 'num': return n.value;
        case 'not': return value(n.a) ? 0 : 1;
        case 'and': return n.items.every(function (x) { return value(x); }) ? 1 : 0;
        case 'or': return n.items.some(function (x) { return value(x); }) ? 1 : 0;
        case 'cmp':
          var a = +value(n.l);
          var b = +value(n.r);
          return ({ '>': a > b, '<': a < b, '>=': a >= b, '<=': a <= b, '=': a === b, '<>': a !== b })[n.cmp] ? 1 : 0;
        case 'fb': return n.src ? (sim.evaluate(n.src, sim, sim.prev) ? 1 : 0) : 0;
      }
      return 0;
    }
    return { value: value, variable: varVal };
  };
})(globalThis.GE = globalThis.GE || {});
