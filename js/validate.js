/*
 * validate.js – Prüfungen beim Zeichnen.
 *
 * Liefert eine Liste von Meldungen:
 *   { level:'error'|'warning'|'info', text, ids:[Element-ids] }
 * Fehler (error) verhindern später die Simulation, Warnungen weisen auf
 * vermutlich unbeabsichtigte Strukturen hin, Hinweise (info) betreffen die
 * normgerechte Schreibweise.
 */
(function (GE) {
  'use strict';

  var V = (GE.validate = {});
  var M = GE.model;
  var E = GE.expr;

  /** Kurze, eindeutige Beschreibung einer Transition für Meldungen. */
  V.describeTransition = function (page, t) {
    var pre = M.inLinks(page, t.id)
      .map(function (l) { return M.node(page, l.from); })
      .filter(function (n) { return n && n.name != null; })
      .map(function (s) { return s.name; });
    var cond = (t.cond || '').trim();
    var label = t.name ? 'Transition ' + t.name : 'Die Transition';
    if (cond) label += ' „' + cond + '“';
    if (pre.length) label += ' nach Schritt ' + pre.join(', ');
    return label;
  };

  /**
   * Können beide Bedingungen bei derselben Belegung erfüllt sein? Liefert ein Beispiel
   * („B1 = 1, B2 = 0“) oder null. Nur rein logische Bedingungen mit höchstens 10 Variablen.
   */
  function bothTrue(c1, c2) {
    var r1 = E.parse(c1);
    var r2 = E.parse(c2);
    if (!r1.ok || !r2.ok) return null;
    var names = {};
    [r1.ast, r2.ast].forEach(function (ast) { E.walk(ast, function (nd) { if (nd.type === 'var') names[nd.name] = true; }); });
    var vars = Object.keys(names);
    if (vars.length > 10) return null;
    for (var m = 0; m < (1 << vars.length); m++) {
      var val = {};
      vars.forEach(function (v, k) { val[v] = (m >> k) & 1; });
      var a = E.evalStatic(r1.ast, val);
      var b = E.evalStatic(r2.ast, val);
      if (a === null || b === null) return null;
      if (a && b) return vars.map(function (v) { return v + ' = ' + val[v]; }).join(', ') || 'immer';
    }
    return null;
  }

  function stepLabel(s) {
    return 'Schritt ' + (s.name || '(ohne Namen)');
  }

  /** „Schritt 2 und 3“, „Schritt 2, 3 und 4“ */
  function stepNames(list) {
    var n = list.map(function (s) { return s.name || '(ohne Namen)'; });
    return 'Schritt ' + (n.length > 1 ? n.slice(0, -1).join(', ') + ' und ' + n[n.length - 1] : n[0]);
  }

  /**
   * Situationen je Ablauf ohne Bedingungen durchspielen (höchstens SITUATION_LIMIT, sonst ohne Meldung):
   * Transitionen mit mehreren Vorgängern, die nie freigegeben sind (Verklemmung), und Schritte, die
   * ein zweites Mal aktiviert würden, während sie noch aktiv sind (UND-Zweige nicht zusammengeführt).
   */
  V.SITUATION_LIMIT = 2000;
  function checkSituations(page, frames, add) {
    var stepById = {};
    page.steps.forEach(function (s) { stepById[s.id] = s; });
    var trans = page.transitions.map(function (t) {
      return {
        t: t,
        pre: M.inLinks(page, t.id).map(function (l) { return l.from; }).filter(function (id) { return stepById[id]; }),
        post: M.outLinks(page, t.id).map(function (l) { return l.to; }).filter(function (id) { return stepById[id]; })
      };
    }).filter(function (x) { return x.pre.length; });
    // Startsituationen aus Zwangssteuerungen: Teil-GRAFCET -> Listen von Schritten
    var forcedSets = [];
    page.steps.forEach(function (s) {
      s.actions.forEach(function (a) {
        if (a.type !== 'forcing' || a.forceMode === 'freeze') return;
        var fr = frames.filter(function (x) { return x.kind === 'partial' && x.name === (a.target || '').trim(); })[0];
        if (!fr) return;
        var members = M.frameMembers(page, fr.id, true).filter(function (el) { return stepById[el.id]; });
        var names = M.forceStepNames(a);
        forcedSets.push(members.filter(function (el) {
          return a.forceMode === 'init' ? el.initial : a.forceMode === 'steps' ? names.indexOf(el.name) >= 0 : false;
        }).map(function (el) { return el.id; }));
      });
    });

    M.components(page).forEach(function (comp) {
      var inComp = {};
      comp.forEach(function (id) { inComp[id] = true; });
      var steps = page.steps.filter(function (s) { return inComp[s.id]; });
      // Makro-, Eingangs-, Ausgangs- und einschließende Schritte (und deren Inhalt) vorerst auslassen
      if (steps.some(function (s) {
        return (s.kind && s.kind !== 'normal') || M.frameOf(page, s, ['macro', 'enclosed']);
      })) return;
      var ts = trans.filter(function (x) { return inComp[x.t.id]; });
      var byFirst = {};    // erster Vorgängerschritt -> Transitionen
      ts.forEach(function (x) { (byFirst[x.pre[0]] = byFirst[x.pre[0]] || []).push(x); });
      var starts = [steps.filter(function (s) { return s.initial; }).map(function (s) { return s.id; })];
      forcedSets.forEach(function (set) {
        if (set.length && set.every(function (id) { return inComp[id]; })) starts.push(set);
      });
      starts = starts.filter(function (x) { return x.length; });
      if (!starts.length) return;

      var seen = {};
      var queue = [];
      function push(set) {
        var key = set.slice().sort().join(' ');
        if (seen[key]) return;
        seen[key] = true;
        queue.push(set);
      }
      starts.forEach(push);
      var enabled = {};    // Transition-id -> irgendwann freigegeben
      var twice = {};      // Schritt-id -> Transition-id
      var count = 0;
      while (queue.length) {
        if (++count > V.SITUATION_LIMIT) return;
        var set = queue.shift();
        var on = {};
        set.forEach(function (id) { on[id] = true; });
        set.forEach(function (first) { (byFirst[first] || []).forEach(function (x) {
          if (!x.pre.every(function (id) { return on[id]; })) return;
          enabled[x.t.id] = true;
          var next = set.filter(function (id) { return x.pre.indexOf(id) < 0; });
          x.post.forEach(function (id) {
            if (on[id] && x.pre.indexOf(id) < 0) { if (!twice[id]) twice[id] = x.t.id; }
            else if (next.indexOf(id) < 0) next.push(id);
          });
          push(next);
        }); });
      }
      ts.forEach(function (x) {
        if (x.pre.length < 2 || enabled[x.t.id]) return;
        var pre = x.pre.map(function (id) { return stepById[id]; });
        add('warning', 'Die Transition nach ' + stepNames(pre) + ' kann nie schalten: ' + stepNames(pre) +
          ' sind nie gleichzeitig aktiv. Liegen sie in verschiedenen Zweigen einer ODER-Verzweigung? ' +
          'Dann gehört dort eine ODER-Zusammenführung hin (einfache Linie).', [x.t.id]);
      });
      steps.forEach(function (s) {
        if (!twice[s.id]) return;
        add('warning', stepLabel(s) + ' kann ein zweites Mal aktiviert werden, während er noch aktiv ist. ' +
          'Meist fehlt eine UND-Zusammenführung (Doppellinie) für die Zweige einer UND-Verzweigung.', [s.id, twice[s.id]]);
      });
    });
  }

  V.page = function (page) {
    var issues = [];
    function add(level, text, ids) { issues.push({ level: level, text: text, ids: ids || [] }); }

    var stepNames = {};
    page.steps.forEach(function (s) { stepNames[s.name] = (stepNames[s.name] || 0) + 1; });

    // --- Anfangsschritt
    var initials = page.steps.filter(function (s) { return s.initial; });
    if (page.steps.length && !initials.length) {
      add('error', 'Es gibt keinen Anfangsschritt. Wähle einen Schritt aus und setze „Anfangsschritt“ (Taste I).', []);
    }

    // --- Namen
    var reported = {};
    page.steps.forEach(function (s) {
      if (!String(s.name).trim()) {
        add('error', 'Ein Schritt hat keinen Namen. Jeder Schritt braucht eine Bezeichnung, z. B. eine Nummer.', [s.id]);
      } else if (stepNames[s.name] > 1 && !reported[s.name]) {
        reported[s.name] = true;
        var ids = page.steps.filter(function (x) { return x.name === s.name; }).map(function (x) { return x.id; });
        add('error', 'Der Schrittname „' + s.name + '“ kommt ' + ids.length + '-mal vor. Jeder Schritt braucht einen eigenen Namen.', ids);
      } else if (!E.isName(s.name) && !/^\d+$/.test(s.name)) {
        add('warning', stepLabel(s) + ': Der Name sollte nur aus Buchstaben, Ziffern und _ bestehen, damit X' + s.name + ' als Schrittvariable lesbar ist.', [s.id]);
      }
    });

    // --- Verbindungen
    page.links.forEach(function (l) {
      var a = M.find(page, l.from);
      var b = M.find(page, l.to);
      if (!a || !b) {
        add('error', 'Eine Verbindung zeigt auf ein gelöschtes Element.', [l.id]);
      } else if (a.kind === b.kind) {
        add('error', a.kind === 'step'
          ? 'Schritt ' + a.el.name + ' und Schritt ' + b.el.name + ' sind direkt verbunden. Zwischen zwei Schritten muss immer eine Transition stehen.'
          : 'Zwei Transitionen sind direkt verbunden. Zwischen zwei Transitionen muss immer ein Schritt stehen.', [l.id]);
      } else if (l.jump && a.kind !== 'transition') {
        add('error', 'Ein Sprung muss von einer Transition ausgehen.', [l.id]);
      }
    });

    // --- Makroschritte und einschließende Schritte
    page.steps.forEach(function (s) {
      if (s.kind === 'macro') {
        var mp = M.macroParts(page, s.id);
        if (!mp.frame) {
          add('error', 'Makroschritt ' + s.name + ' hat keine Expansion. Lege sie mit dem Werkzeug „Makroschritt“ an.', [s.id]);
        } else {
          if (mp.entries.length !== 1) add('error', 'Die Expansion von ' + s.name + ' braucht genau einen Eingangsschritt (hat ' + mp.entries.length + ').', [mp.frame.id]);
          if (mp.exits.length !== 1) add('error', 'Die Expansion von ' + s.name + ' braucht genau einen Ausgangsschritt (hat ' + mp.exits.length + ').', [mp.frame.id]);
        }
        if (s.initial) add('error', 'Makroschritt ' + s.name + ' kann kein Anfangsschritt sein.', [s.id]);
      }
      if (s.kind === 'enclosing') {
        if (!M.ownedFrame(page, s.id)) {
          add('error', 'Einschließender Schritt ' + s.name + ' hat keinen Rahmen für seinen Inhalt.', [s.id]);
        } else if (!M.enclosedInitSteps(page, s.id).length) {
          add('error', 'Im Inhalt von Schritt ' + s.name + ' ist kein Schritt markiert, der mit ihm aktiviert wird (*).', [M.ownedFrame(page, s.id).id]);
        }
      }
      if (s.kind === 'entry' || s.kind === 'exit') {
        var mf = M.frameOf(page, s, ['macro']);
        if (!mf) add('error', stepLabel(s) + ' ist ein ' + (s.kind === 'entry' ? 'Eingangs' : 'Ausgangs') + 'schritt, liegt aber in keiner Makro-Expansion.', [s.id]);
      }
      if (s.encInit && !M.frameOf(page, s, ['enclosed'])) {
        add('warning', stepLabel(s) + ' ist mit * markiert, liegt aber in keinem Rahmen eines einschließenden Schritts.', [s.id]);
      }
    });

    // --- Rahmen (Teil-GRAFCETs, Makro-Expansionen, eingeschlossene Inhalte)
    var frames = page.frames || [];
    var partialNames = {};
    frames.forEach(function (fr) {
      if (fr.kind === 'partial') partialNames[fr.name] = (partialNames[fr.name] || 0) + 1;
    });
    var reportedFrames = {};
    frames.forEach(function (fr) {
      if (fr.kind !== 'partial') return;
      var label = 'Teil-GRAFCET ' + (fr.name || '(ohne Namen)');
      if (!String(fr.name).trim()) {
        add('error', 'Ein Teil-GRAFCET hat keinen Namen. Üblich sind Namen wie G1 oder G_Sicherheit.', [fr.id]);
      } else if (partialNames[fr.name] > 1 && !reportedFrames[fr.name]) {
        reportedFrames[fr.name] = true;
        add('error', 'Der Name „' + fr.name + '“ wird für mehrere Teil-GRAFCETs verwendet.',
          frames.filter(function (x) { return x.kind === 'partial' && x.name === fr.name; }).map(function (x) { return x.id; }));
      } else if (!/^G/.test(fr.name)) {
        add('warning', label + ': Namen von Teil-GRAFCETs beginnen üblicherweise mit G (z. B. G1, G_Betrieb).', [fr.id]);
      }
      var steps = M.frameMembers(page, fr.id, true).filter(M.isStep);
      if (!steps.length) {
        add('warning', label + ' ist leer. Ziehe Schritte in den Rahmen oder lösche ihn.', [fr.id]);
      } else if (!steps.some(function (s) { return s.initial; })) {
        add('info', label + ' hat keinen Anfangsschritt. Er wird erst aktiv, wenn ihn eine Zwangssteuerung in eine Situation zwingt.', [fr.id]);
      }
    });

    // Rahmen dürfen sich nicht teilweise überlappen (ineinander liegen ist erlaubt)
    function overlap(a, b) {
      return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    }
    function inside(a, b) {
      return a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;
    }
    for (var fi = 0; fi < frames.length; fi++) {
      for (var fj = fi + 1; fj < frames.length; fj++) {
        var fa = frames[fi];
        var fb = frames[fj];
        if (overlap(fa, fb) && !inside(fa, fb) && !inside(fb, fa)) {
          add('error', 'Die Rahmen ' + GE.geometry.frameLabel(page, fa) + ' und ' +
            GE.geometry.frameLabel(page, fb) + ' überlappen sich. Verschiebe oder verkleinere einen der Rahmen.', [fa.id, fb.id]);
        }
      }
    }

    // Inhalt, der über den Rand seines Rahmens hinausragt: Die Zugehörigkeit ist dann nicht
    // mehr eindeutig zu sehen. Klick auf die Meldung passt den Rahmen an (issue.fit).
    if (GE.geometry && GE.geometry.overhang) {
      var over = GE.geometry.overhang(page);
      frames.forEach(function (fr) {
        var ids = over[fr.id];
        if (!ids) return;
        var what = ids.slice(0, 3).map(function (id) {
          var f = M.find(page, id);
          if (f.kind === 'step') return 'Schritt ' + f.el.name;
          if (f.kind === 'transition') return V.describeTransition(page, f.el);
          if (f.kind === 'link') return 'eine Rückführung';
          return 'ein Kommentar';
        });
        if (ids.length > 3) what.push('…');
        var label = fr.kind === 'partial' ? 'Teil-GRAFCET ' + fr.name : 'Rahmen ' + GE.geometry.frameLabel(page, fr);
        issues.push({
          level: 'warning',
          text: 'Im ' + label + ' ragt etwas über den Rahmen hinaus (' + what.join(', ') + '). Klicke hier, um den Rahmen an den Inhalt anzupassen.',
          ids: [fr.id].concat(ids),
          fit: fr.id
        });
      });
    }

    // Ein zusammenhängender Ablauf muss vollständig in genau einem Rahmen liegen
    if (frames.length) {
      M.components(page).forEach(function (comp) {
        if (comp.length < 2) return;
        var where = {};
        comp.forEach(function (id) {
          var fr = M.frameOf(page, M.node(page, id));
          where[fr ? fr.id : ''] = true;
        });
        var keys = Object.keys(where);
        if (keys.length < 2) return;
        var names = keys.map(function (k) {
          if (!k) return 'außerhalb';
          var fr = M.find(page, k).el;
          return GE.geometry.frameLabel(page, fr);
        });
        var first = comp.map(function (id) { return M.node(page, id); }).filter(function (n) { return n.actions; })[0];
        add('error', 'Der Ablauf' + (first ? ' mit Schritt ' + first.name : '') + ' liegt teilweise in verschiedenen Rahmen (' +
          names.join(', ') + '). Ein zusammenhängender Ablauf muss vollständig in einem Rahmen liegen – vergrößere den Rahmen ' +
          'oder verschiebe die Elemente.', comp);
      });
    }

    // --- Schritte ohne Nachfolger bzw. ohne Vorgänger: ein Schritt darf nicht
    //     „lose“ stehen (Nachfolger immer; Vorgänger bei Nicht-Anfangsschritten)
    //     Schritte, die eine Zwangssteuerung G…{5,6} aktiviert, brauchen keinen Vorgänger.
    var forcedBy = {};   // id des zwingenden Schritts -> gezwungene Schritte
    var forced = {};
    page.steps.forEach(function (s) {
      s.actions.forEach(function (a) {
        if (a.type !== 'forcing' || a.forceMode !== 'steps') return;
        var target = (a.target || '').trim();
        var fr = frames.filter(function (x) { return x.kind === 'partial' && x.name === target; })[0];
        if (!fr) return;
        var wanted = {};
        M.forceStepNames(a).forEach(function (nm) { wanted[nm] = true; });
        M.frameMembers(page, fr.id, true).forEach(function (el) {
          if (!el.actions || !wanted[el.name]) return;
          (forcedBy[s.id] = forcedBy[s.id] || []).push(el);
          forced[el.id] = true;
        });
      });
    });
    var noPred = {};
    page.steps.forEach(function (s) {
      if (!M.outLinks(page, s.id).length && s.kind !== 'exit') {
        add('error', stepLabel(s) + ' hat keine Folgetransition. Jeder Schritt muss über eine Transition wieder verlassen werden können. (Die Norm kennt auch Endschritte ohne Folgetransition; in der Ausbildung ist es meist ein Versehen.)', [s.id]);
      }
      if (!s.initial && s.kind !== 'entry' && !s.encInit && !forced[s.id] && !M.inLinks(page, s.id).length) {
        noPred[s.id] = true;
        add('error', stepLabel(s) + ' hat keine vorangehende Transition und kann deshalb nie aktiv werden.', [s.id]);
      }
    });

    // --- Transitionen
    page.transitions.forEach(function (t) {
      var desc = V.describeTransition(page, t);
      if (!M.inLinks(page, t.id).length) {
        add('error', desc + ' hat keinen vorangehenden Schritt. Verbinde einen Schritt mit ihr. (Die Norm kennt solche Quell- bzw. Senktransitionen; in der Ausbildung ist es meist ein Versehen.)', [t.id]);
      }
      if (!M.outLinks(page, t.id).length) {
        add('error', desc + ' führt zu keinem Schritt. Verbinde sie mit dem folgenden Schritt. (Die Norm kennt solche Quell- bzw. Senktransitionen; in der Ausbildung ist es meist ein Versehen.)', [t.id]);
      }
      checkCondition(t.cond, desc, [t.id], true, M.stepVarForTransition(page, t));
    });

    // --- ODER-Verzweigung: Bedingungen sollten sich ausschließen (Hinweis)
    page.steps.forEach(function (st) {
      var outs = M.outLinks(page, st.id).filter(function (l) { return !l.jump; })
        .map(function (l) { return M.node(page, l.to); }).filter(function (t) { return t && t.cond !== undefined; });
      if (outs.length < 2) return;
      for (var i = 0; i < outs.length; i++) {
        for (var j = i + 1; j < outs.length; j++) {
          var both = bothTrue(outs[i].cond, outs[j].cond);
          if (both) {
            add('info', 'ODER-Verzweigung nach ' + stepLabel(st) + ': „' + outs[i].cond + '“ und „' + outs[j].cond +
              '“ können gleichzeitig erfüllt sein (z. B. ' + both + '). Meist sollen sich die Bedingungen ausschließen.', [outs[i].id, outs[j].id]);
          }
        }
      }
    });

    // --- Erreichbarkeit vom Anfangsschritt
    if (initials.length) {
      // Fixpunkt: Eine Transition gilt als erreichbar, wenn alle ihre
      // Vorgängerschritte erreichbar sind; ihre Folgeschritte dann ebenfalls.
      var seen = {};
      initials.forEach(function (s) { seen[s.id] = true; });
      var changed = true;
      while (changed) {
        changed = false;
        // Makroschritt aktiviert seinen Eingangsschritt, einschließender Schritt die markierten Schritte,
        // eine Zwangssteuerung G…{5,6} die genannten Schritte
        page.steps.forEach(function (s) {
          if (!seen[s.id]) return;
          var next = s.kind === 'macro' ? M.macroParts(page, s.id).entries : s.kind === 'enclosing' ? M.enclosedInitSteps(page, s.id) : [];
          next = next.concat(forcedBy[s.id] || []);
          next.forEach(function (x) { if (!seen[x.id]) { seen[x.id] = true; changed = true; } });
        });
        page.transitions.forEach(function (t) {
          if (seen[t.id]) return;
          var ins = M.inLinks(page, t.id);
          if (ins.length && ins.every(function (x) { return seen[x.from]; })) {
            seen[t.id] = true;
            changed = true;
            M.outLinks(page, t.id).forEach(function (l) { seen[l.to] = true; });
          }
        });
      }
      page.steps.forEach(function (s) {
        if (!seen[s.id] && !noPred[s.id]) {
          add('warning', stepLabel(s) + ' ist vom Anfangsschritt aus nicht erreichbar und wird nie aktiv.', [s.id]);
        }
      });
    }

    checkSituations(page, frames, add);

    // --- Aktionen
    var usage = {}; // Variable -> {assign:[stepIds], store:[stepIds]}
    page.steps.forEach(function (s) {
      s.actions.forEach(function (a) {
        var where = stepLabel(s);
        if (a.type === 'forcing') {
          checkForcing(s, a, where);
          return;
        }
        var v = (a.var || '').trim();
        if (!v) {
          add('error', where + ': Eine Aktion hat keinen Variablennamen (z. B. M1 oder 1M1).', [s.id]);
        } else if (!E.isName(v)) {
          add('error', where + ': „' + v + '“ ist kein gültiger Variablenname. Erlaubt sind Buchstaben, Ziffern, _ und Punkt.', [s.id]);
        } else if (/^X/.test(v) && stepNames[v.slice(1)]) {
          add('error', where + ': „' + v + '“ ist eine Schrittvariable und kann nicht durch eine Aktion gesetzt werden.', [s.id]);
        }
        if (a.type === 'conditional') {
          if (!(a.cond || '').trim()) add('error', where + ': Die bedingte Aktion „' + v + '“ braucht eine Zuweisungsbedingung.', [s.id]);
          else checkCondition(a.cond, where + ', Bedingung der Aktion „' + v + '“', [s.id], false, 'X' + s.name);
        }
        if (a.type === 'event') {
          if (!(a.cond || '').trim()) {
            add('error', where + ': Die Aktion bei Ereignis „' + v + '“ braucht ein Ereignis, z. B. ↑B1.', [s.id]);
          } else {
            var r = checkCondition(a.cond, where + ', Ereignis der Aktion „' + v + '“', [s.id], false, 'X' + s.name);
            if (r && !E.info(r).edges) {
              add('warning', where + ': Das Ereignis „' + a.cond + '“ der Aktion „' + v + '“ enthält keine Flanke (↑ oder ↓). Ein Ereignis ist normalerweise eine Flanke.', [s.id]);
            }
          }
        }
        if (v) {
          var u = usage[v] || (usage[v] = { assign: [], store: [] });
          (a.type === 'stored' || a.type === 'event' ? u.store : u.assign).push(s);
        }
      });
    });
    Object.keys(usage).forEach(function (v) {
      var u = usage[v];
      if (u.assign.length && u.store.length) {
        add('warning', 'Die Variable „' + v + '“ wird kontinuierlich (Schritt ' + names(u.assign) + ') und speichernd (Schritt ' +
          names(u.store) + ') beeinflusst. Eine Variable sollte nur auf eine Art beeinflusst werden.',
        u.assign.concat(u.store).map(function (s) { return s.id; }));
      }
    });

    // --- Zwangssteuerungen auf denselben Teil-GRAFCET aus verschiedenen Teil-GRAFCETs bzw. in verschiedene Situationen
    var forcedTargets = {};
    page.steps.forEach(function (s) {
      s.actions.forEach(function (a) {
        if (a.type !== 'forcing' || !a.target) return;
        var from = M.partialOf(page, s);
        (forcedTargets[a.target] = forcedTargets[a.target] || []).push({ step: s, from: from ? from.name : '', label: M.forcingLabel(a) });
      });
    });
    Object.keys(forcedTargets).forEach(function (target) {
      var list = forcedTargets[target];
      var froms = {};
      var labels = {};
      list.forEach(function (x) { froms[x.from] = true; labels[x.label] = true; });
      if (list.length < 2 || (Object.keys(froms).length < 2 && Object.keys(labels).length < 2)) return;
      add('warning', target + ' wird von ' + list.map(function (x) { return stepLabel(x.step) + ' (' + x.label + ')'; }).join(' und ') +
        ' gezwungen – wirken beide gleichzeitig, gilt nur eine. Zwangssteuerungen sollten eine klare Rangfolge haben.',
      list.map(function (x) { return x.step.id; }));
    });

    // --- Zwangssteuerungen: gegenseitiges Zwingen
    var forceGraph = {};
    page.steps.forEach(function (s) {
      var from = M.partialOf(page, s);
      if (!from) return;
      s.actions.forEach(function (a) {
        if (a.type !== 'forcing' || !a.target) return;
        (forceGraph[from.name] = forceGraph[from.name] || {})[a.target] = true;
      });
    });
    var reportedCycle = false;
    Object.keys(forceGraph).forEach(function (start) {
      if (reportedCycle) return;
      var seen = {};
      var stack = Object.keys(forceGraph[start]);
      while (stack.length) {
        var cur = stack.pop();
        if (cur === start) {
          reportedCycle = true;
          add('warning', 'Teil-GRAFCETs zwingen sich gegenseitig (über ' + start + '). Die Zwangssteuerungen sollten eine klare Rangfolge haben: ' +
            'ein übergeordneter Teil-GRAFCET zwingt untergeordnete, nicht umgekehrt.', []);
          return;
        }
        if (seen[cur]) continue;
        seen[cur] = true;
        Object.keys(forceGraph[cur] || {}).forEach(function (x) { stack.push(x); });
      }
    });

    /** Prüft eine Zwangssteuerung G{…} an Schritt s. */
    function checkForcing(s, a, where) {
      var target = (a.target || '').trim();
      var label = M.forcingLabel(a);
      if (!target) {
        add('error', where + ': Bei der Zwangssteuerung fehlt der Teil-GRAFCET, der gezwungen werden soll.', [s.id]);
        return;
      }
      var fr = (page.frames || []).filter(function (x) { return x.kind === 'partial' && x.name === target; })[0];
      if (!fr) {
        add('error', where + ': Zwangssteuerung ' + label + ' – einen Teil-GRAFCET „' + target + '“ gibt es nicht.', [s.id]);
        return;
      }
      var own = M.partialOf(page, s);
      if (own === fr) {
        add('error', where + ': Zwangssteuerung ' + label + ' – ein Teil-GRAFCET kann sich nicht selbst zwingen.', [s.id]);
      }
      if (a.forceMode === 'steps') {
        var names = M.forceStepNames(a);
        if (!names.length) {
          add('error', where + ': Bei ' + label + ' sind keine Schritte angegeben. Für „alle Schritte inaktiv“ wähle {} (leer).', [s.id]);
        }
        var inside = {};
        M.frameMembers(page, fr.id, true).forEach(function (el) { if (M.isStep(el)) inside[el.name] = true; });
        names.forEach(function (nm) {
          if (!inside[nm]) {
            add('error', where + ': ' + label + ' – Schritt ' + nm + ' liegt nicht im Teil-GRAFCET ' + target + '.', [s.id]);
          }
        });
      }
    }

    function names(list) {
      var seen = {};
      return list.filter(function (s) { return !seen[s.name] && (seen[s.name] = true); })
        .map(function (s) { return s.name; }).join(', ');
    }

    /**
     * Prüft eine Bedingung; gibt bei Erfolg den Syntaxbaum zurück.
     * stepVar: Schrittvariable, auf die sich die Kurzform t>3s beziehen würde.
     */
    function checkCondition(text, desc, ids, isTransition, stepVar) {
      if (!(text || '').trim()) {
        if (isTransition) add('error', desc + ' hat keine Bedingung. Trage eine ein (z. B. B1) oder 1 für „immer erfüllt“.', ids);
        return null;
      }
      var r = E.parse(text);
      if (!r.ok) {
        add('error', desc + ': ' + r.error.message, ids);
        return null;
      }
      var info = E.info(r.ast);
      info.vars.forEach(function (n) {
        if (/^X./.test(n) && !stepNames[n.slice(1)] && isStepLike(n)) {
          add('warning', desc + ': ' + n + ' sieht aus wie eine Schrittvariable, aber einen Schritt „' + n.slice(1) + '“ gibt es nicht.', ids);
        }
      });
      if (info.legacy) {
        if (stepVar) {
          add('info', desc + ': Die Kurzform t>…s wird beim Bestätigen in die normgerechte Schreibweise umgewandelt: ' +
            E.normalize(text, stepVar) + '.', ids);
        } else {
          add('error', desc + ': Bei t>…s ist unklar, welcher Schritt gemeint ist (kein oder mehrere Vorgängerschritte). ' +
            'Schreibe die Zeit mit Schrittvariable, z. B. 3s/X2.', ids);
        }
      }
      return r.ast;
    }

    function isStepLike(n) {
      return /^X\d+$/.test(n);
    }

    return issues;
  };

  /** Zählt Meldungen je Stufe. */
  V.count = function (issues) {
    var c = { error: 0, warning: 0, info: 0 };
    issues.forEach(function (i) { c[i.level]++; });
    return c;
  };
})(globalThis.GE = globalThis.GE || {});
