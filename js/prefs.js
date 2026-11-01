/*
 * prefs.js – Bedienvorlieben (Einstellungen), im Browser gespeichert.
 *
 * Gespeichert werden nur Vorlieben der Oberfläche, nie die Zeichnung selbst.
 * Ist der Browserspeicher nicht verfügbar (z. B. privates Fenster), gelten
 * einfach die Vorgaben.
 */
(function (GE) {
  'use strict';

  var KEY = 'grafcet-lernwerkstatt.prefs';
  var DEFAULTS = {
    originZero: true,      // Anordnen legt den Anfangsschritt auf 0/0
    dragSuggest: true,     // beim Ziehen aus dem Menü Verbindungen vorschlagen
    timingOpen: true,      // Zeitverlauf in der Simulation aufgeklappt
    timingHeight: 220,     // Höhe des Zeitverlaufs in Pixeln
    showSolution: false,   // Knopf „Musterlösung“ in Aufgaben (für Lehrkräfte)
    solvedTasks: {},       // gelöste Übungsaufgaben { id: true }
    theme: 'system'        // Darstellung: 'system', 'light' oder 'dark'
  };

  var values = {};
  try {
    values = JSON.parse(window.localStorage.getItem(KEY) || '{}') || {};
  } catch (e) {
    values = {};
  }

  // defekter Speicher (z. B. eine Zahl oder Liste statt eines Objekts)
  if (!values || typeof values !== 'object' || Array.isArray(values)) values = {};

  GE.prefs = {
    get: function (k) {
      return values[k] === undefined ? DEFAULTS[k] : values[k];
    },
    set: function (k, v) {
      values[k] = v;
      try {
        window.localStorage.setItem(KEY, JSON.stringify(values));
      } catch (e) {
        // ohne Speicher gelten die Werte nur bis zum Neuladen
      }
    }
  };
})(globalThis.GE = globalThis.GE || {});
