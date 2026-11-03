/*
 * tasklist.js – Aufgabenbibliothek für den Übungsmodus (frei erfunden).
 *
 * Aufbau einer Aufgabe siehe tasks.js. Die Musterlösung hat dieselbe Form
 * wie die Beispiele (examples.js):
 *   steps: { key: [Name, Anfangsschritt, [Aktionen], Kommentar] }
 *   trans: { key: [Bedingung, Kommentar] }
 *   links: [[von, nach, Sprung?]]
 * Aktion: ['continuous', Var] | ['stored', Var, '1'|'0'|'inc', 'deactivation'?]
 *       | ['event', Var, Wert, Ereignis] | ['forcing', Teil-GRAFCET, 'init']
 * Die Prüfabläufe beschreiben, was ein Prüfer an der Anlage tun würde:
 * 'S1^' = Taster drücken, 'B1=1' = Sensor meldet, '5s' = warten.
 */
(function (GE) {
  'use strict';

  var C = 'continuous';

  GE.tasks.list = [
    // ---------------------------------------------------------------- Grundlagen
    {
      id: 'stempel',
      level: 1,
      topic: 'Lineare Ablaufkette',
      title: 'Stempelpresse',
      text: 'Eine Presse stempelt Werkstücke. In der Grundstellung ist der Stempel oben (B1 = 1).\n' +
        'Wird der Start-Taster S1 gedrückt und ist der Stempel oben, fährt er abwärts (Y1), bis er unten ankommt (B2).\n' +
        'Danach fährt er aufwärts (Y2), bis er wieder oben ist (B1). Dann wartet die Presse auf den nächsten Start.\n' +
        'Ist der Stempel beim Drücken von S1 nicht oben, passiert nichts.',
      vars: {
        S1: ['Start-Taster', 'button'],
        B1: ['Stempel oben', 'switch', 1],
        B2: ['Stempel unten', 'switch'],
        Y1: ['Stempel abwärts', 'out'],
        Y2: ['Stempel aufwärts', 'out']
      },
      solution: {
        steps: {
          s1: ['1', true, [], 'Grundstellung'],
          s2: ['2', false, [[C, 'Y1']], 'Stempel abwärts'],
          s3: ['3', false, [[C, 'Y2']], 'Stempel aufwärts']
        },
        trans: {
          t1: ['↑S1 * B1', 'Start in Grundstellung'],
          t2: ['B2', 'Stempel unten'],
          t3: ['B1', 'Stempel oben']
        },
        links: [['s1', 't1'], ['t1', 's2'], ['s2', 't2'], ['t2', 's3'], ['s3', 't3'], ['t3', 's1']]
      },
      runs: [
        ['Ein Arbeitstakt', ['S1^', 'B1=0', 'B2=1', 'B2=0', 'B1=1', '1s']],
        ['Zwei Takte nacheinander', ['S1^', 'B1=0', 'B2=1', 'B2=0', 'B1=1', 'S1^', 'B1=0', 'B2=1', 'B2=0', 'B1=1']],
        ['Start, wenn der Stempel nicht oben ist', ['B1=0', 'S1^', '1s', 'B1=1', '1s']]
      ],
      hints: [
        'Du brauchst drei Schritte: Grundstellung, abwärts fahren, aufwärts fahren.',
        'Die erste Transition muss zwei Dinge gleichzeitig prüfen: den Start und die Grundstellung (UND).',
        'Nach dem Aufwärtsfahren führt eine Verbindung zurück zum Anfangsschritt.'
      ]
    },
    {
      id: 'ampel',
      level: 1,
      topic: 'Zeiten',
      title: 'Fußgängerampel',
      text: 'In der Grundstellung zeigt die Autoampel Grün (P3) und die Fußgängerampel Rot (P4).\n' +
        'Drückt ein Fußgänger den Taster S1, läuft folgender Ablauf:\n' +
        '1. Autos Gelb (P2) für 2 s\n' +
        '2. Autos Rot (P1) für 1 s\n' +
        '3. Autos Rot, Fußgänger Grün (P5) für 5 s\n' +
        '4. Autos Rot, Fußgänger Rot für 1 s\n' +
        '5. Autos Rot und Gelb für 1 s\n' +
        'Danach wieder Grundstellung. Fußgänger-Rot (P4) leuchtet immer, wenn Fußgänger-Grün aus ist.\n' +
        'Die Zeiten sind für die Übung vereinfacht (an echten Ampeln z. B. Gelb 3 s bei 50 km/h).\n' +
        'Ein erneuter Druck auf S1 während des Ablaufs wird nicht gespeichert.',
      vars: {
        S1: ['Anforderungs-Taster', 'button'],
        P1: ['Autos Rot', 'out'],
        P2: ['Autos Gelb', 'out'],
        P3: ['Autos Grün', 'out'],
        P4: ['Fußgänger Rot', 'out'],
        P5: ['Fußgänger Grün', 'out']
      },
      solution: {
        steps: {
          s1: ['1', true, [[C, 'P3'], [C, 'P4']], 'Autos Grün'],
          s2: ['2', false, [[C, 'P2'], [C, 'P4']], 'Autos Gelb'],
          s3: ['3', false, [[C, 'P1'], [C, 'P4']], 'Autos Rot'],
          s4: ['4', false, [[C, 'P1'], [C, 'P5']], 'Fußgänger Grün'],
          s5: ['5', false, [[C, 'P1'], [C, 'P4']], 'Räumzeit'],
          s6: ['6', false, [[C, 'P1'], [C, 'P2'], [C, 'P4']], 'Autos Rot-Gelb']
        },
        trans: {
          t1: ['↑S1', 'Anforderung'],
          t2: ['2s/X2', '2 s Gelb'],
          t3: ['1s/X3', '1 s Rot'],
          t4: ['5s/X4', '5 s Fußgänger Grün'],
          t5: ['1s/X5', '1 s Räumzeit'],
          t6: ['1s/X6', '1 s Rot-Gelb']
        },
        links: [['s1', 't1'], ['t1', 's2'], ['s2', 't2'], ['t2', 's3'], ['s3', 't3'], ['t3', 's4'],
          ['s4', 't4'], ['t4', 's5'], ['s5', 't5'], ['t5', 's6'], ['s6', 't6'], ['t6', 's1']],
        layout: { s1: 'column', s2: 'column', s3: 'column', s4: 'column', s5: 'column', s6: 'column' }
      },
      runs: [
        ['Ein Durchlauf', ['S1^', '11s']],
        ['S1 während Fußgänger-Grün erneut gedrückt', ['S1^', '4s', 'S1^', '8s']]
      ],
      hints: [
        'Jede Phase der Ampel ist ein eigener Schritt.',
        'Eine Zeit schreibt man als Bedingung, z. B. 2s/X2: erfüllt, wenn Schritt 2 seit 2 s aktiv ist.',
        'In einem Schritt dürfen mehrere Aktionen stehen.'
      ]
    },
    {
      id: 'schranke',
      level: 1,
      topic: 'Flanken und Zeit',
      title: 'Parkhausschranke',
      text: 'Die Schranke ist zu (B4 = 1). Steht ein Auto auf der Induktionsschleife (B1 = 1), öffnet sie (Y1),\n' +
        'bis sie oben ist (B2). Sie bleibt offen, bis das Auto die Lichtschranke B3 vollständig durchfahren hat:\n' +
        'B3 wird erst 1 und dann wieder 0 (fallende Flanke ↓B3).\n' +
        '2 s danach schließt die Schranke (Y2), bis sie unten ist (B4).\n' +
        'Vereinfachung für die Übung: Ein weiteres Auto während des Schließens wird nicht beachtet\n' +
        '(eine echte Schranke würde dann wieder öffnen).',
      vars: {
        B1: ['Auto auf der Induktionsschleife', 'switch'],
        B2: ['Schranke oben', 'switch'],
        B3: ['Lichtschranke Durchfahrt', 'switch'],
        B4: ['Schranke unten', 'switch', 1],
        Y1: ['Schranke öffnen', 'out'],
        Y2: ['Schranke schließen', 'out']
      },
      solution: {
        steps: {
          s1: ['1', true, [], 'Schranke zu'],
          s2: ['2', false, [[C, 'Y1']], 'Öffnen'],
          s3: ['3', false, [], 'Warten auf die Durchfahrt'],
          s4: ['4', false, [], 'Wartezeit'],
          s5: ['5', false, [[C, 'Y2']], 'Schließen']
        },
        trans: {
          t1: ['B1 * B4', 'Auto wartet, Schranke zu'],
          t2: ['B2', 'Schranke oben'],
          t3: ['↓B3', 'Auto durchgefahren'],
          t4: ['2s/X4', '2 s gewartet'],
          t5: ['B4', 'Schranke unten']
        },
        links: [['s1', 't1'], ['t1', 's2'], ['s2', 't2'], ['t2', 's3'], ['s3', 't3'], ['t3', 's4'],
          ['s4', 't4'], ['t4', 's5'], ['s5', 't5'], ['t5', 's1']]
      },
      runs: [
        ['Ein Auto fährt durch', ['B1=1', 'B4=0', 'B2=1', '1s', 'B3=1', 'B1=0', '1s', 'B3=0', '3s', 'B2=0', 'B4=1', '1s']],
        ['Das Auto lässt sich Zeit', ['B1=1', 'B4=0', 'B2=1', '4s', 'B3=1', 'B1=0', '2s', 'B3=0', '3s', 'B2=0', 'B4=1', '1s']]
      ],
      hints: [
        'Eine fallende Flanke schreibt man ↓B3 (oder FE(B3)). Sie ist nur im Augenblick des Wechsels von 1 auf 0 erfüllt.',
        'Prüfe nicht einfach /B3: Bevor das Auto die Lichtschranke erreicht, ist B3 auch schon 0.',
        'Die 2 s Wartezeit brauchen einen eigenen Schritt, an dessen Transition 2s/X… steht.'
      ]
    },

    // ---------------------------------------------------------------- Mittel
    {
      id: 'getraenk',
      level: 2,
      topic: 'ODER-Verzweigung',
      title: 'Getränkeautomat',
      text: 'In der Grundstellung leuchtet „Bereit“ (P1).\n' +
        'Steht ein Becher unter dem Auslauf (B1 = 1), wählt man mit S1 Kaffee oder mit S2 Tee.\n' +
        'Kaffee: Kaffeeventil Y1 für 4 s. Tee: Heißwasserventil Y2 für 3 s.\n' +
        'Danach leuchtet „Bitte entnehmen“ (P2), bis der Becher weg ist (B1 = 0).\n' +
        'Ohne Becher und beim gleichzeitigen Drücken von S1 und S2 passiert nichts.\n' +
        'Löse die Auswahl mit einer ODER-Verzweigung.',
      require: ['or'],
      vars: {
        S1: ['Taste Kaffee', 'button'],
        S2: ['Taste Tee', 'button'],
        B1: ['Becher steht', 'switch'],
        Y1: ['Kaffeeventil', 'out'],
        Y2: ['Heißwasserventil', 'out'],
        P1: ['Meldeleuchte „Bereit“', 'out'],
        P2: ['Meldeleuchte „Bitte entnehmen“', 'out']
      },
      solution: {
        steps: {
          s1: ['1', true, [[C, 'P1']], 'Bereit'],
          s2: ['2', false, [[C, 'Y1']], 'Kaffee'],
          s3: ['3', false, [[C, 'Y2']], 'Tee'],
          s4: ['4', false, [[C, 'P2']], 'Bitte entnehmen']
        },
        trans: {
          t1: ['B1 * S1 * /S2', 'Kaffee gewählt'],
          t2: ['B1 * S2 * /S1', 'Tee gewählt'],
          t3: ['4s/X2', '4 s Kaffee'],
          t4: ['3s/X3', '3 s Tee'],
          t5: ['/B1', 'Becher entnommen']
        },
        links: [['s1', 't1'], ['s1', 't2'], ['t1', 's2'], ['t2', 's3'], ['s2', 't3'], ['s3', 't4'],
          ['t3', 's4'], ['t4', 's4'], ['s4', 't5'], ['t5', 's1']]
      },
      runs: [
        ['Kaffee', ['B1=1', 'S1^', '5s', 'B1=0', '1s']],
        ['Tee', ['B1=1', 'S2^', '4s', 'B1=0', '1s']],
        ['Ohne Becher', ['S1^', 'S2^', '1s']],
        ['Beide Tasten gleichzeitig', ['B1=1', 'S1=1 S2=1', '1s', 'S1=0 S2=0', '1s']]
      ],
      hints: [
        'Von Schritt 1 gehen zwei Transitionen ab – das ist die ODER-Verzweigung.',
        'Die Bedingungen der beiden Zweige müssen sich gegenseitig ausschließen, z. B. mit /S2 im Kaffee-Zweig.',
        'Beide Zweige laufen in einem gemeinsamen Schritt wieder zusammen (ODER-Zusammenführung).'
      ]
    },
    {
      id: 'abfuellen',
      level: 2,
      topic: 'UND-Verzweigung',
      title: 'Abfüllen und Etikettieren',
      text: 'Steht eine Flasche in der Station (B0 = 1) und wird S1 gedrückt, laufen zwei Arbeiten gleichzeitig:\n' +
        '– Füllen: Das Ventil Y1 ist offen, bis der Füllstand erreicht ist (B1).\n' +
        '– Etikettieren: Der Etikettierer M1 läuft 3 s.\n' +
        'Erst wenn beide Arbeiten fertig sind, schiebt der Auswerfer Y2 die Flasche hinaus, bis sie weg ist (B0 = 0).\n' +
        'Löse die gleichzeitigen Arbeiten mit einer UND-Verzweigung.',
      require: ['and'],
      vars: {
        S1: ['Start-Taster', 'button'],
        B0: ['Flasche in der Station', 'switch', 1],
        B1: ['Füllstand erreicht', 'switch'],
        Y1: ['Füllventil', 'out'],
        M1: ['Etikettierer', 'out'],
        Y2: ['Auswerfer', 'out']
      },
      solution: {
        steps: {
          s1: ['1', true, [], 'Grundstellung'],
          s2: ['2', false, [[C, 'Y1']], 'Füllen'],
          s3: ['3', false, [], 'Füllen fertig'],
          s4: ['4', false, [[C, 'M1']], 'Etikettieren'],
          s5: ['5', false, [], 'Etikett fertig'],
          s6: ['6', false, [[C, 'Y2']], 'Auswerfen']
        },
        trans: {
          t1: ['↑S1 * B0', 'Start mit Flasche'],
          t2: ['B1', 'Füllstand erreicht'],
          t3: ['3s/X4', '3 s etikettiert'],
          t4: ['1', 'beide fertig'],
          t5: ['/B0', 'Flasche draußen']
        },
        links: [['s1', 't1'], ['t1', 's2'], ['t1', 's4'], ['s2', 't2'], ['t2', 's3'], ['s4', 't3'], ['t3', 's5'],
          ['s3', 't4'], ['s5', 't4'], ['t4', 's6'], ['s6', 't5'], ['t5', 's1']]
      },
      runs: [
        ['Füllen ist schneller', ['S1^', '1s', 'B1=1', '3s', 'B0=0 B1=0', '1s']],
        ['Etikettieren ist schneller', ['S1^', '4s', 'B1=1', '1s', 'B0=0 B1=0', '1s']],
        ['Start ohne Flasche', ['B0=0', 'S1^', '1s']]
      ],
      hints: [
        'Nach einer UND-Verzweigung (Doppellinie unter der Transition) laufen beide Zweige gleichzeitig.',
        'Ein Zweig, der früher fertig ist, braucht einen Warteschritt ohne Aktion.',
        'Die UND-Zusammenführung schaltet erst, wenn alle Schritte davor aktiv sind. Als Bedingung genügt dann 1.'
      ]
    },
    {
      id: 'lackieren',
      level: 2,
      topic: 'Speichernde Aktionen',
      title: 'Lackierkabine',
      text: 'In der Grundstellung ist die Tür offen (B2 = 1). Nach Start mit S1 – nur bei offener Tür:\n' +
        '1. Die Absaugung M1 wird eingeschaltet und die Tür schließt (Y1), bis sie zu ist (B1).\n' +
        '2. Lackieren (Y2) für 10 s.\n' +
        '3. Trocknen mit der Heizung E1 für 5 s.\n' +
        '4. Die Tür öffnet (Y3), bis sie offen ist (B2). Erst dann wird die Absaugung ausgeschaltet.\n' +
        'Schalte die Absaugung M1 mit speichernden Aktionen ein und aus (M1 := 1, M1 := 0).',
      require: ['stored'],
      vars: {
        S1: ['Start-Taster', 'button'],
        B1: ['Tür zu', 'switch'],
        B2: ['Tür offen', 'switch', 1],
        Y1: ['Tür schließen', 'out'],
        Y2: ['Lackierpistole', 'out'],
        E1: ['Heizung', 'out'],
        Y3: ['Tür öffnen', 'out'],
        M1: ['Absaugung', 'out']
      },
      solution: {
        steps: {
          s1: ['1', true, [], 'Grundstellung'],
          s2: ['2', false, [['stored', 'M1', '1'], [C, 'Y1']], 'Absaugung ein, Tür schließen'],
          s3: ['3', false, [[C, 'Y2']], 'Lackieren'],
          s4: ['4', false, [[C, 'E1']], 'Trocknen'],
          s5: ['5', false, [[C, 'Y3'], ['stored', 'M1', '0', 'deactivation']], 'Tür öffnen, danach Absaugung aus']
        },
        trans: {
          t1: ['↑S1 * B2', 'Start bei offener Tür'],
          t2: ['B1', 'Tür zu'],
          t3: ['10s/X3', '10 s lackiert'],
          t4: ['5s/X4', '5 s getrocknet'],
          t5: ['B2', 'Tür offen']
        },
        links: [['s1', 't1'], ['t1', 's2'], ['s2', 't2'], ['t2', 's3'], ['s3', 't3'], ['t3', 's4'],
          ['s4', 't4'], ['t4', 's5'], ['s5', 't5'], ['t5', 's1']]
      },
      runs: [
        ['Ein Lackiervorgang', ['S1^', 'B2=0', '1s', 'B1=1', '10s', '5s', 'B1=0', '1s', 'B2=1', '1s']],
        ['Start bei geschlossener Tür', ['B2=0', 'S1^', '1s', 'B2=1', '1s']]
      ],
      hints: [
        'Eine speichernde Aktion bei Aktivierung zeichnet man mit Pfeil nach oben: M1 := 1. Der Wert bleibt danach erhalten.',
        'Das Ausschalten (M1 := 0) kann bei Deaktivierung des letzten Schritts stehen (Pfeil nach unten) oder bei Aktivierung des Anfangsschritts.'
      ]
    },
    {
      id: 'stapeln',
      level: 2,
      topic: 'Zähler',
      title: 'Kartons stapeln',
      text: 'Nach Start mit S1 läuft das Band (M1). Jeder Karton, der die Lichtschranke B1 passiert,\n' +
        'wird gezählt (steigende Flanke ↑B1). Nach 4 Kartons hält das Band an und „Stapel fertig“ (P1) leuchtet,\n' +
        'bis der Stapel abgeholt und mit S2 quittiert wurde. Danach beginnt die Zählung wieder bei 0\n' +
        'und das Band wartet auf den nächsten Start.\n' +
        'Zähle mit einem Zähler C1 (Aktion C1 := C1 + 1) und frage den Zählerstand mit [C1 ≥ 4] ab.',
      require: ['counter'],
      vars: {
        S1: ['Start-Taster', 'button'],
        S2: ['Quittier-Taster', 'button'],
        B1: ['Lichtschranke Karton', 'switch'],
        M1: ['Bandmotor', 'out'],
        P1: ['Meldeleuchte „Stapel fertig“', 'out'],
        C1: ['Zähler Kartons', 'mem']
      },
      solution: {
        steps: {
          s1: ['1', true, [], 'Warten auf Start'],
          s2: ['2', false, [[C, 'M1'], ['event', 'C1', 'inc', '↑B1']], 'Band läuft, Kartons zählen'],
          s3: ['3', false, [[C, 'P1'], ['stored', 'C1', '0', 'deactivation']], 'Stapel fertig']
        },
        trans: {
          t1: ['↑S1', 'Start'],
          t2: ['C1 >= 4', '4 Kartons gezählt'],
          t3: ['↑S2', 'quittiert']
        },
        links: [['s1', 't1'], ['t1', 's2'], ['s2', 't2'], ['t2', 's3'], ['s3', 't3'], ['t3', 's1']],
        layout: { s2: 'column' }
      },
      runs: [
        ['Ein Stapel', ['S1^', 'B1=1', 'B1=0', 'B1=1', 'B1=0', 'B1=1', 'B1=0', 'B1=1', 'B1=0', 'S2^', '1s']],
        ['Zwei Stapel nacheinander', ['S1^', 'B1=1', 'B1=0', 'B1=1', 'B1=0', 'B1=1', 'B1=0', 'B1=1', 'B1=0', 'S2^',
          'S1^', 'B1=1', 'B1=0', 'B1=1', 'B1=0', 'B1=1', 'B1=0', 'B1=1', 'B1=0', 'S2^', '1s']],
        ['Quittieren, bevor der Stapel fertig ist', ['S1^', 'B1=1', 'B1=0', 'S2^', '1s', 'B1=1', 'B1=0', '1s']]
      ],
      hints: [
        'Eine Aktion bei Ereignis (Fähnchen) wirkt nur im Augenblick des Ereignisses, z. B. bei ↑B1: C1 := C1 + 1.',
        'Die Transition nach dem Zählen fragt den Zählerstand ab: C1 >= 4 (gezeichnet [C1 ≥ 4]).',
        'Vergiss nicht, den Zähler wieder auf 0 zu setzen (speichernde Aktion C1 := 0).'
      ]
    },

    // ---------------------------------------------------------------- Fortgeschritten
    {
      id: 'tank',
      level: 3,
      topic: 'Anlage Tank, ODER-Verzweigung',
      title: 'Tank mit Abbruch',
      text: 'Mit der Anlage „Tank“ kannst du deine Lösung in der Simulation ausprobieren.\n' +
        'Nach Start mit S1 (nur bei leerem Tank, B1 = 0) füllt das Zulaufventil Y1 den Tank, bis er voll ist (B2).\n' +
        'Dann läuft das Rührwerk M1 für 5 s, danach wird über Y2 entleert, bis der Tank leer ist (B1 = 0).\n' +
        'Wird während des Füllens oder Rührens der Abbruch-Taster S2 gedrückt, wird sofort entleert, ohne zu rühren.\n' +
        'Danach wartet die Anlage wieder auf den Start.',
      plant: { id: 'tank' },
      vars: {
        S1: ['Start-Taster', 'button'],
        S2: ['Abbruch-Taster', 'button'],
        B1: ['Füllstand unten erreicht, Tank nicht leer', 'switch'],
        B2: ['Füllstand oben erreicht, Tank voll', 'switch'],
        Y1: ['Zulaufventil', 'out'],
        Y2: ['Ablaufventil', 'out'],
        M1: ['Rührwerk', 'out']
      },
      solution: {
        steps: {
          s1: ['1', true, [], 'Tank leer'],
          s2: ['2', false, [[C, 'Y1']], 'Füllen'],
          s3: ['3', false, [[C, 'M1']], 'Rühren'],
          s4: ['4', false, [[C, 'Y2']], 'Entleeren']
        },
        trans: {
          t1: ['↑S1 * /B1', 'Start bei leerem Tank'],
          t2: ['B2 * /S2', 'Tank voll'],
          t3: ['S2', 'Abbruch beim Füllen'],
          t4: ['5s/X3 * /S2', '5 s gerührt'],
          t5: ['S2', 'Abbruch beim Rühren'],
          t6: ['/B1', 'Tank leer']
        },
        links: [['s1', 't1'], ['t1', 's2'], ['s2', 't2'], ['s2', 't3'], ['t2', 's3'], ['s3', 't4'], ['s3', 't5'],
          ['t4', 's4'], ['t3', 's4'], ['t5', 's4'], ['s4', 't6'], ['t6', 's1']]
      },
      runs: [
        ['Normaler Ablauf', ['S1^', '1s', 'B1=1', '2s', 'B2=1', '6s', 'B2=0', '1s', 'B1=0', '1s']],
        ['Abbruch beim Füllen', ['S1^', '1s', 'B1=1', '1s', 'S2^', '1s', 'B1=0', '1s']],
        ['Abbruch beim Rühren', ['S1^', 'B1=1', '1s', 'B2=1', '2s', 'S2^', 'B2=0', '1s', 'B1=0', '1s']],
        ['Start bei gefülltem Tank', ['B1=1', 'S1^', '1s']]
      ],
      hints: [
        'Von „Füllen“ und von „Rühren“ führt je eine zusätzliche Transition mit S2 direkt zum Entleeren.',
        'Die Bedingungen einer ODER-Verzweigung müssen sich ausschließen, z. B. B2 · /S2 und S2.'
      ]
    },
    {
      id: 'zylinder',
      level: 3,
      topic: 'Anlage Zylinder, Zylinderfolge',
      title: 'Zylinderfolge A+ B+ A− B−',
      text: 'Mit der Anlage „Zylinder“ (bistabile Impulsventile) kannst du deine Lösung ausprobieren.\n' +
        'Nach Start mit S1 – nur wenn beide Zylinder eingefahren sind – läuft die Folge:\n' +
        '1A1 fährt aus (A+), dann 2A1 aus (B+), dann 1A1 ein (A−), dann 2A1 ein (B−).\n' +
        'Jeder Schritt wartet auf den Endlagensensor der gerade bewegten Kolbenstange:\n' +
        '1B1/1B2 = 1A1 eingefahren/ausgefahren, 2B1/2B2 = 2A1 eingefahren/ausgefahren.\n' +
        'Bistabile Ventile brauchen nur einen Impuls: 1M1 = 1A1 ausfahren, 1M2 = 1A1 einfahren, 2M1 und 2M2 für 2A1.\n' +
        'Jede Ventilspule soll nur in ihrem eigenen Schritt angesteuert sein.',
      plant: { id: 'cylinder', options: { valve: 'bi' } },
      vars: {
        S1: ['Start-Taster', 'button'],
        '1B1': ['1A1 eingefahren', 'switch', 1],
        '1B2': ['1A1 ausgefahren', 'switch'],
        '2B1': ['2A1 eingefahren', 'switch', 1],
        '2B2': ['2A1 ausgefahren', 'switch'],
        '1M1': ['Ventilspule 1A1 ausfahren', 'out'],
        '1M2': ['Ventilspule 1A1 einfahren', 'out'],
        '2M1': ['Ventilspule 2A1 ausfahren', 'out'],
        '2M2': ['Ventilspule 2A1 einfahren', 'out']
      },
      solution: {
        steps: {
          s1: ['1', true, [], 'Grundstellung'],
          s2: ['2', false, [[C, '1M1']], '1A1 ausfahren (A+)'],
          s3: ['3', false, [[C, '2M1']], '2A1 ausfahren (B+)'],
          s4: ['4', false, [[C, '1M2']], '1A1 einfahren (A−)'],
          s5: ['5', false, [[C, '2M2']], '2A1 einfahren (B−)']
        },
        trans: {
          t1: ['↑S1 * 1B1 * 2B1', 'Start in Grundstellung'],
          t2: ['1B2', '1A1 ausgefahren'],
          t3: ['2B2', '2A1 ausgefahren'],
          t4: ['1B1', '1A1 eingefahren'],
          t5: ['2B1', '2A1 eingefahren']
        },
        links: [['s1', 't1'], ['t1', 's2'], ['s2', 't2'], ['t2', 's3'], ['s3', 't3'], ['t3', 's4'],
          ['s4', 't4'], ['t4', 's5'], ['s5', 't5'], ['t5', 's1']]
      },
      runs: [
        ['Ein Durchlauf', ['S1^', '1B1=0', '1B2=1', '2B1=0', '2B2=1', '1B2=0', '1B1=1', '2B2=0', '2B1=1', '1s']],
        ['Start, wenn 2A1 nicht eingefahren ist', ['2B1=0', 'S1^', '1s', '2B1=1', '1s']]
      ],
      hints: [
        'Zeichne für jede Bewegung einen eigenen Schritt mit der passenden Ventilspule.',
        'Weitergeschaltet wird mit dem Sensor der Endlage, in die der Zylinder gerade fährt.',
        'Für einen Impuls genügt eine kontinuierliche Aktion – sie endet mit dem Schritt.'
      ]
    },
    {
      id: 'nothalt',
      level: 3,
      topic: 'Teil-GRAFCETs, Zwangssteuerung',
      title: 'Förderband mit NOT-HALT',
      text: 'Baue zwei Teil-GRAFCETs (Werkzeug „Teil-GRAFCET“):\n' +
        'G1 (Ablauf): Nach Start mit S1 läuft das Band M1, bis ein Teil am Ende ist (B2).\n' +
        'Dann schiebt der Auswerfer Y1 das Teil 2 s lang hinaus, danach wartet G1 auf den nächsten Start.\n' +
        'G2 (Sicherheit): Wird der NOT-HALT S0 betätigt (Öffner, S0 = 0), zwingt G2 den Ablauf G1 in seine\n' +
        'Anfangssituation (Zwangssteuerung G1{INIT}) und die Meldeleuchte P0 leuchtet.\n' +
        'Erst wenn S0 entriegelt ist (S0 = 1) und mit S3 quittiert wurde, geht G2 zurück in den Normalbetrieb.\n' +
        'Lernbeispiel für die Zwangssteuerung. Ein echter NOT-HALT wird zusätzlich als Sicherheitsfunktion nach ' +
        'DIN EN ISO 13850 und DIN EN 60204-1 aufgebaut (z. B. mit Sicherheitsschaltgerät), nicht nur im Ablaufprogramm. ' +
        'Welcher Zustand sicher ist, legt die Risikobeurteilung fest.',
      require: ['partial', 'forcing'],
      vars: {
        S0: ['NOT-HALT (Öffner: 1 = nicht betätigt)', 'switch', 1],
        S1: ['Start-Taster', 'button'],
        S3: ['Quittier-Taster', 'button'],
        B2: ['Teil am Bandende', 'switch'],
        M1: ['Bandmotor', 'out'],
        Y1: ['Auswerfer', 'out'],
        P0: ['Meldeleuchte NOT-HALT', 'out']
      },
      solution: {
        steps: {
          s1: ['1', true, [], 'Warten auf Start'],
          s2: ['2', false, [[C, 'M1']], 'Band läuft'],
          s3: ['3', false, [[C, 'Y1']], 'Auswerfen'],
          s10: ['10', true, [], 'Normalbetrieb'],
          s11: ['11', false, [['forcing', 'G1', 'init'], [C, 'P0']], 'NOT-HALT: G1 in Grundstellung zwingen']
        },
        trans: {
          t1: ['↑S1', 'Start'],
          t2: ['B2', 'Teil am Ende'],
          t3: ['2s/X3', '2 s ausgeworfen'],
          t4: ['/S0', 'NOT-HALT betätigt'],
          t5: ['S0 * ↑S3', 'entriegelt und quittiert']
        },
        links: [['s1', 't1'], ['t1', 's2'], ['s2', 't2'], ['t2', 's3'], ['s3', 't3'], ['t3', 's1'],
          ['s10', 't4'], ['t4', 's11'], ['s11', 't5'], ['t5', 's10']],
        frames: [['G1', 's1'], ['G2', 's10']]
      },
      runs: [
        ['Normaler Ablauf', ['S1^', '1s', 'B2=1', '1s', 'B2=0', '2s']],
        ['NOT-HALT, während das Band läuft', ['S1^', '1s', 'S0=0', '1s', 'S0=1', '1s', 'S3^', '1s', 'S1^', '1s']],
        ['Quittieren, solange NOT-HALT betätigt ist', ['S1^', 'S0=0', '1s', 'S3^', '1s', 'S1^', '1s', 'S0=1', '1s']]
      ],
      hints: [
        'Lege mit dem Werkzeug „Teil-GRAFCET“ (G) zwei Rahmen an und nenne sie G1 und G2.',
        'Die Zwangssteuerung ist eine eigene Aktionsart (Werkzeug „Zwang“): G1{INIT}.',
        'Ein Öffner meldet im Normalzustand 1. Die Transition zum NOT-HALT heißt deshalb /S0.'
      ]
    }
  ];
})(globalThis.GE = globalThis.GE || {});
