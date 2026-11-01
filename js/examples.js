/*
 * examples.js – Mitgelieferte Beispiele (frei erfunden).
 *
 * Jedes Beispiel ist vollständig beschriftet: Kommentare an Schritten und
 * Transitionen, Bedeutung aller Variablen und ein freier Kommentar mit der
 * Aufgabenbeschreibung. Die Beispiele werden aus einer knappen Beschreibung
 * aufgebaut und danach automatisch angeordnet.
 */
(function (GE) {
  'use strict';

  var M = GE.model;
  var X = (GE.examples = {});

  /**
   * Baut ein Projekt aus einer Beschreibung.
   * steps: { key: [name, initial, [aktionen], kommentar] }
   *   Aktion: ['continuous', var] | ['conditional', var, cond]
   *           | ['stored', var, value, when] | ['event', var, value, cond]
   * trans: { key: [cond, kommentar] }
   * links: [[von, nach, sprung?]]  (Schlüssel aus steps/trans)
   * extra: { plant: {id, options}, vars: { Name: [Kommentar, 'button'|'switch', Startwert] },
   *          note: 'Aufgabenbeschreibung', layout: { key: 'column' },
   *          frames: [[Name, Schrittschlüssel], …]  Teil-GRAFCET um den Ablauf dieses Schritts }
   *   Zwangssteuerung als Aktion: ['forcing', Teil-GRAFCET, 'init'|'steps'|'freeze'|'empty', 'Schritte']
   */
  function build(title, steps, trans, links, extra) {
    extra = extra || {};
    var p = M.createProject(title);
    var pg = p.pages[0];
    var ids = {};
    var i = 0;
    Object.keys(steps).forEach(function (k) {
      var d = steps[k];
      var s = M.addStep(p, pg, 100 + 40 * i, 100 + 120 * i++, { name: d[0], initial: !!d[1] });
      (d[2] || []).forEach(function (a) {
        var act = M.newAction(p, a[0], a[1]);
        if (a[0] === 'conditional') act.cond = a[2];
        if (a[0] === 'stored') { act.value = a[2]; act.when = a[3] || 'activation'; }
        if (a[0] === 'event') { act.value = a[2]; act.cond = a[3]; }
        if (a[0] === 'forcing') { act.target = a[1]; act.var = ''; act.forceMode = a[2]; act.forceSteps = a[3] || ''; }
        s.actions.push(act);
      });
      s.comment = d[3] || '';
      if (extra.layout && extra.layout[k]) s.actionsLayout = extra.layout[k];
      ids[k] = s.id;
    });
    Object.keys(trans).forEach(function (k) {
      var t = M.addTransition(p, pg, 0, 0, trans[k][0]);
      t.comment = trans[k][1] || '';
      ids[k] = t.id;
    });
    links.forEach(function (l) {
      var r = M.addLink(p, pg, ids[l[0]], ids[l[1]], { jump: !!l[2] });
      if (r.error) throw new Error('Beispiel fehlerhaft: ' + r.error);
    });
    // Startpositionen der Transitionen zwischen ihren Schritten (für die Reihenfolge im Layout)
    pg.transitions.forEach(function (t) {
      var pre = M.inLinks(pg, t.id).map(function (l) { return M.node(pg, l.from); });
      if (pre.length) {
        t.x = pre.reduce(function (s, n) { return s + n.x; }, 0) / pre.length;
        t.y = Math.max.apply(null, pre.map(function (n) { return n.y; })) + 60;
      }
    });
    GE.layout.auto(pg);
    if (extra.frames) {
      // Teil-GRAFCETs um die Abläufe legen und alles noch einmal anordnen
      extra.frames.forEach(function (fd) {
        var els = M.component(pg, ids[fd[1]]).map(function (id) { return M.node(pg, id); });
        M.addFrame(p, pg, fd[0], GE.render.fitRect(pg, els));
      });
      GE.layout.auto(pg);
    }
    if (extra.plant) p.plant = { id: extra.plant.id, map: {}, options: extra.plant.options || {} };
    Object.keys(extra.vars || {}).forEach(function (n) {
      var v = extra.vars[n];
      var meta = { comment: v[0], mode: v[1] || M.varMeta(p, n).mode };
      if (v[2] !== undefined) meta.initial = v[2];
      M.setVarMeta(p, n, meta);
    });
    if (extra.note) {
      // Aufgabenbeschreibung rechts neben die Zeichnung
      var b = GE.render.page(pg, {}).bounds;
      M.addNote(p, pg, GE.util.snap(b.x2 + 60, M.GRID), GE.util.snap(b.y1, M.GRID), extra.note);
    }
    return p;
  }
  X.build = build;   // auch für die Musterlösungen der Übungsaufgaben (tasks.js)

  X.list = [
    {
      id: 'mischer',
      title: 'Farbmischer – ODER-Verzweigung, Zeit, speichernde Aktion',
      build: function () {
        return build('Beispiel Farbmischer',
          {
            s1: ['1', true, [], 'Grundstellung'],
            s2: ['2', false, [['continuous', 'Y1']], 'Grundfarbe einfüllen'],
            s3: ['3', false, [['continuous', 'Y2'], ['stored', 'Dosiert', '1']], 'Farbe A zudosieren'],
            s4: ['4', false, [['continuous', 'Y3'], ['stored', 'Dosiert', '1']], 'Farbe B zudosieren'],
            s5: ['5', false, [['continuous', 'M2']], 'Rühren'],
            s6: ['6', false, [['conditional', 'Y4', 'B2'], ['stored', 'Dosiert', '0']], 'Abfüllen']
          },
          {
            t1: ['↑S1', 'Start gedrückt'],
            t2: ['B12 * B10 * /B11', 'eingefüllt, Wahl Farbe A'],
            t3: ['B12 * /B10 * B11', 'eingefüllt, Wahl Farbe B'],
            t4: ['/B3', 'Dosierbehälter A leer'],
            t5: ['/B4', 'Dosierbehälter B leer'],
            t6: ['3s/X5', '3 s gerührt'],
            t7: ['/B2', 'Mischbehälter leer']
          },
          [['s1', 't1'], ['t1', 's2'], ['s2', 't2'], ['s2', 't3'], ['t2', 's3'], ['t3', 's4'],
            ['s3', 't4'], ['s4', 't5'], ['t4', 's5'], ['t5', 's5'], ['s5', 't6'], ['t6', 's6'],
            ['s6', 't7'], ['t7', 's1']],
          {
            note: 'Farbmischer\n' +
              'Nach dem Start läuft Grundfarbe ein (Y1), bis B12 meldet, dass sie\n' +
              'eingefüllt ist. Der Wahlschalter entscheidet, ob Farbe A (Y2) oder\n' +
              'Farbe B (Y3) zudosiert wird (ODER-Verzweigung, die Bedingungen\n' +
              'schließen sich aus). Danach wird 3 s gerührt und abgefüllt, solange\n' +
              'noch Farbe im Behälter ist (bedingte Aktion Y4).\n' +
              'Der Merker „Dosiert“ merkt sich, dass eine Farbe zudosiert wurde.\n' +
              'Bedienung: Beim Einfüllen erst B2 (Behälter nicht leer), dann B12\n' +
              'auf 1 setzen. Zum Abfüllen B2 auf 0 setzen, danach B12 wieder auf 0.\n' +
              'Grundstellung (beim Start gesetzt): B10 = 1 (Farbe A gewählt),\n' +
              'B3 = 1 und B4 = 1 (Dosierbehälter gefüllt).',
            vars: {
              S1: ['Start-Taster', 'button'],
              B10: ['Wahlschalter Farbe A', 'switch', 1],
              B11: ['Wahlschalter Farbe B'],
              B12: ['Grundfarbe eingefüllt'],
              B3: ['Dosierbehälter A nicht leer', 'switch', 1],
              B4: ['Dosierbehälter B nicht leer', 'switch', 1],
              B2: ['Mischbehälter nicht leer'],
              Y1: ['Ventil Grundfarbe'],
              Y2: ['Ventil Farbe A'],
              Y3: ['Ventil Farbe B'],
              Y4: ['Abfüllventil'],
              M2: ['Rührwerk'],
              Dosiert: ['Merker: Farbe zudosiert']
            }
          }
        );
      }
    },
    {
      id: 'bohren',
      title: 'Bohrstation – UND-Verzweigung, Flanke, Zähler, Sprung',
      build: function () {
        return build('Beispiel Bohrstation',
          {
            s1: ['1', true, [], 'Grundstellung'],
            s2: ['2', false, [['stored', '1M1', '1']], 'Werkstück spannen'],
            s3: ['3', false, [['continuous', '2M1'], ['continuous', 'M3']], 'Bohren'],
            s4: ['4', false, [['continuous', '2M2']], 'Bohrer zurück'],
            s5: ['5', false, [['continuous', 'M4'], ['conditional', 'P1', '/B5'], ['event', 'C1', 'inc', '↑2B2']],
              'Absaugen, Bohrungen zählen'],
            s6: ['6', false, [['stored', '1M1', '0']], 'Werkstück lösen']
          },
          {
            t1: ['↑S1 * B0', 'Start und Werkstück eingelegt'],
            t2: ['1B2', 'gespannt'],
            t3: ['2B2', 'Bohrtiefe erreicht'],
            t4: ['2B1', 'Bohrer oben'],
            t5: ['/1B2', 'gelöst']
          },
          [['s1', 't1'], ['t1', 's2'], ['s2', 't2'], ['t2', 's3'], ['t2', 's5'],
            ['s3', 't3'], ['t3', 's4'], ['s4', 't4'], ['s5', 't4'], ['t4', 's6'],
            ['s6', 't5'], ['t5', 's1', true]],
          {
            layout: { s5: 'column' },
            note: 'Bohrstation\n' +
              'Das Werkstück wird gespannt (1M1 := 1, speichernd).\n' +
              'Dann laufen zwei Zweige gleichzeitig (UND-Verzweigung):\n' +
              'links bohren und Bohrer zurückfahren, rechts absaugen.\n' +
              'Jede erreichte Bohrtiefe (↑2B2) zählt C1 um 1 hoch.\n' +
              'P1 warnt, solange das Kühlmittel fehlt (/B5).\n' +
              'Erst wenn beide Zweige fertig sind, wird gelöst;\n' +
              'der Sprung führt zurück zu Schritt 1.\n' +
              'Grundstellung (beim Start gesetzt): B0 = 1, 2B1 = 1, B5 = 1.',
            vars: {
              S1: ['Start-Taster', 'button'],
              B0: ['Werkstück eingelegt', 'switch', 1],
              '1B2': ['Spannzylinder gespannt'],
              '2B1': ['Bohrer oben', 'switch', 1],
              '2B2': ['Bohrer unten (Bohrtiefe)'],
              B5: ['Kühlmittel vorhanden', 'switch', 1],
              '1M1': ['Spannzylinder (speichernd)'],
              '2M1': ['Bohrer abwärts'],
              '2M2': ['Bohrer aufwärts'],
              M3: ['Bohrmotor'],
              M4: ['Absaugung'],
              P1: ['Warnleuchte Kühlmittel'],
              C1: ['Zähler Bohrungen']
            }
          }
        );
      }
    },
    {
      id: 'tank',
      title: 'Tank füllen, rühren, entleeren – mit Anlage „Tank“',
      build: function () {
        return build('Beispiel Tank',
          {
            s1: ['1', true, [], 'Grundstellung, Tank leer'],
            s2: ['2', false, [['continuous', 'Y1']], 'Füllen'],
            s3: ['3', false, [['continuous', 'M1']], 'Rühren'],
            s4: ['4', false, [['continuous', 'Y2'], ['continuous', 'M1']], 'Entleeren, weiter rühren']
          },
          {
            t1: ['↑S1 * /B1', 'Start gedrückt und Tank leer'],
            t2: ['B2', 'Tank voll'],
            t3: ['5s/X3', '5 s gerührt'],
            t4: ['/B1', 'Tank leer']
          },
          [['s1', 't1'], ['t1', 's2'], ['s2', 't2'], ['t2', 's3'], ['s3', 't3'], ['t3', 's4'], ['s4', 't4'], ['t4', 's1']],
          {
            plant: { id: 'tank' },
            note: 'Tank (mit virtueller Anlage)\n' +
              'Simulieren → Start → Taster S1 drücken.\n' +
              'Der Tank füllt sich bis zum oberen Sensor B2,\n' +
              'wird 5 s gerührt und danach entleert,\n' +
              'bis der untere Sensor B1 frei ist.',
            vars: {
              S1: ['Start-Taster', 'button'],
              B1: ['Füllstand unten erreicht'],
              B2: ['Füllstand oben erreicht'],
              Y1: ['Zulaufventil'],
              Y2: ['Ablaufventil'],
              M1: ['Rührwerk']
            }
          }
        );
      }
    },
    {
      id: 'zylinder',
      title: 'Zylinderfolge A+ B+ B− A− – mit Anlage „Zylinder“',
      build: function () {
        return build('Beispiel Zylinderfolge',
          {
            s1: ['1', true, [], 'Grundstellung (beide eingefahren)'],
            s2: ['2', false, [['continuous', '1M1']], '1A1 ausfahren (A+)'],
            s3: ['3', false, [['continuous', '2M1']], '2A1 ausfahren (B+)'],
            s4: ['4', false, [['continuous', '2M2']], '2A1 einfahren (B−)'],
            s5: ['5', false, [['continuous', '1M2']], '1A1 einfahren (A−)']
          },
          {
            t1: ['↑S1 * 1B1 * 2B1', 'Start in Grundstellung'],
            t2: ['1B2', '1A1 ausgefahren'],
            t3: ['2B2', '2A1 ausgefahren'],
            t4: ['2B1', '2A1 eingefahren'],
            t5: ['1B1', '1A1 eingefahren']
          },
          [['s1', 't1'], ['t1', 's2'], ['s2', 't2'], ['t2', 's3'], ['s3', 't3'], ['t3', 's4'],
            ['s4', 't4'], ['t4', 's5'], ['s5', 't5'], ['t5', 's1']],
          {
            plant: { id: 'cylinder', options: { valve: 'bi' } },
            note: 'Zylinderfolge A+ B+ B− A− (mit virtueller Anlage)\n' +
              'Bistabile Impulsventile: ein kurzes Signal reicht,\n' +
              'der Zylinder fährt bis in die Endlage.\n' +
              'Jeder Schritt wartet auf den Endlagensensor\n' +
              'der gerade bewegten Zylinderstange.',
            vars: {
              S1: ['Start-Taster', 'button'],
              '1B1': ['1A1 eingefahren'],
              '1B2': ['1A1 ausgefahren'],
              '2B1': ['2A1 eingefahren'],
              '2B2': ['2A1 ausgefahren'],
              '1M1': ['Ventilspule 1A1 ausfahren'],
              '1M2': ['Ventilspule 1A1 einfahren'],
              '2M1': ['Ventilspule 2A1 ausfahren'],
              '2M2': ['Ventilspule 2A1 einfahren']
            }
          }
        );
      }
    },
    {
      id: 'band',
      title: 'Förderband mit Teilezähler – mit Anlage „Förderband“',
      build: function () {
        return build('Beispiel Förderband',
          {
            s1: ['1', true, [], 'Warten auf ein Teil'],
            s2: ['2', false, [['continuous', 'M1']], 'Teil transportieren'],
            s3: ['3', false, [['continuous', 'Y1'], ['stored', 'C1', 'inc']], 'Auswerfen, Teil zählen'],
            s4: ['4', false, [['continuous', 'P1'], ['stored', 'C1', '0', 'deactivation']], 'Ablage voll melden']
          },
          {
            t1: ['B1', 'Teil am Bandanfang'],
            t2: ['B2', 'Teil am Bandende'],
            t3: ['/B2 * [C1 < 3]', 'ausgeworfen, Ablage nicht voll'],
            t4: ['/B2 * [C1 >= 3]', 'ausgeworfen, 3 Teile in der Ablage'],
            t5: ['↑S2', 'Quittiert (Ablage geleert)']
          },
          [['s1', 't1'], ['t1', 's2'], ['s2', 't2'], ['t2', 's3'], ['s3', 't3'], ['s3', 't4'],
            ['t3', 's1'], ['t4', 's4'], ['s4', 't5'], ['t5', 's1']],
          {
            plant: { id: 'conveyor' },
            note: 'Förderband (mit virtueller Anlage)\n' +
              'Simulieren → Start → bei der Anlage „Teil auflegen“.\n' +
              'Das Band läuft, bis das Teil am Ende ist, dann wirft Y1\n' +
              'es in die Ablage und C1 zählt hoch.\n' +
              'Nach 3 Teilen leuchtet P1, bis mit S2 quittiert wird;\n' +
              'beim Verlassen von Schritt 4 wird C1 auf 0 gesetzt.',
            vars: {
              B1: ['Lichtschranke Bandanfang'],
              B2: ['Lichtschranke Bandende'],
              S2: ['Quittier-Taster', 'button'],
              M1: ['Bandmotor'],
              Y1: ['Auswerfer'],
              P1: ['Meldeleuchte „Ablage voll“'],
              C1: ['Teilezähler']
            }
          }
        );
      }
    }
  ];

  // Beispiel für Teil-GRAFCETs und Zwangssteuerung (Etappe 3)
  X.list.push({
    id: 'nothalt',
    title: 'Zylinderfolge mit NOT-HALT – Teil-GRAFCETs, Zwangssteuerung G1{INIT}',
    build: function () {
      return build('Beispiel NOT-HALT',
        {
          s1: ['1', true, [['stored', '1M1', '0'], ['stored', '2M1', '0']], 'Grundstellung, Ventile aus'],
          s2: ['2', false, [['stored', '1M1', '1']], '1A1 ausfahren'],
          s3: ['3', false, [['stored', '2M1', '1']], '2A1 ausfahren'],
          s4: ['4', false, [['stored', '2M1', '0']], '2A1 einfahren'],
          s5: ['5', false, [['stored', '1M1', '0']], '1A1 einfahren'],
          s10: ['10', true, [], 'Normalbetrieb'],
          s11: ['11', false, [['forcing', 'G1', 'init'], ['continuous', 'P0']], 'NOT-HALT: G1 in Grundstellung zwingen']
        },
        {
          t1: ['↑S1 * 1B1 * 2B1', 'Start in Grundstellung'],
          t2: ['1B2', '1A1 ausgefahren'],
          t3: ['2B2', '2A1 ausgefahren'],
          t4: ['2B1', '2A1 eingefahren'],
          t5: ['1B1', '1A1 eingefahren'],
          t6: ['/S0', 'NOT-HALT gedrückt'],
          t7: ['S0 * ↑S3', 'entriegelt und quittiert']
        },
        [['s1', 't1'], ['t1', 's2'], ['s2', 't2'], ['t2', 's3'], ['s3', 't3'], ['t3', 's4'], ['s4', 't4'], ['t4', 's5'],
          ['s5', 't5'], ['t5', 's1'], ['s10', 't6'], ['t6', 's11'], ['s11', 't7'], ['t7', 's10']],
        {
          plant: { id: 'cylinder', options: { valve: 'mono' } },
          frames: [['G1', 's1'], ['G_Sicherheit', 's10']],
          note: 'Zylinderfolge mit NOT-HALT (mit virtueller Anlage)\n' +
            'G1 ist der Ablauf A+ B+ B− A− mit monostabilen Ventilen.\n' +
            'G_Sicherheit überwacht den NOT-HALT S0 (Öffner: 1 = nicht gedrückt).\n' +
            'Wird S0 gedrückt, zwingt Schritt 11 den Teil-GRAFCET G1 in seine\n' +
            'Anfangssituation G1{INIT}: Schritt 1 setzt die Ventile zurück,\n' +
            'die Zylinder fahren ein. G1 steht still, bis entriegelt und mit S3\n' +
            'quittiert wurde.\n' +
            'Grundstellung: S0 = 1 (ist beim Start schon gesetzt).\n' +
            'Lernbeispiel für die Zwangssteuerung. Ein echter NOT-HALT wird zusätzlich\n' +
            'als Sicherheitsfunktion nach DIN EN ISO 13850 und DIN EN 60204-1 aufgebaut\n' +
            '(z. B. mit Sicherheitsschaltgerät), nicht nur im Ablaufprogramm.\n' +
            'Welcher Zustand sicher ist, legt die Risikobeurteilung fest.',
          vars: {
            S0: ['NOT-HALT (Öffner: 1 = nicht gedrückt)', 'switch', 1],
            S1: ['Start-Taster', 'button'],
            S3: ['Quittier-Taster', 'button'],
            P0: ['Meldeleuchte NOT-HALT'],
            '1B1': ['1A1 eingefahren'], '1B2': ['1A1 ausgefahren'], '2B1': ['2A1 eingefahren'], '2B2': ['2A1 ausgefahren'],
            '1M1': ['Ventil 1A1 (monostabil, gespeichert)'], '2M1': ['Ventil 2A1 (monostabil, gespeichert)']
          }
        }
      );
    }
  });

  X.get = function (id) {
    for (var i = 0; i < X.list.length; i++) if (X.list[i].id === id) return X.list[i];
    return null;
  };
})(globalThis.GE = globalThis.GE || {});
