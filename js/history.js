/*
 * history.js – Rückgängig und Wiederholen über Schnappschüsse.
 *
 * Vor einer Änderung wird begin() aufgerufen, danach commit(). Nur wenn sich
 * der Zustand tatsächlich geändert hat, entsteht ein Eintrag. So lassen sich
 * auch längere Vorgänge (Ziehen mit der Maus, Tippen in ein Feld) als ein
 * einziger Schritt rückgängig machen.
 */
(function (GE) {
  'use strict';

  /**
   * @param {function():string} getState  liefert den Zustand als Text
   * @param {function(string)} setState    stellt einen Zustand wieder her
   * @param {number} [limit]               maximale Anzahl Einträge
   */
  function History(getState, setState, limit) {
    this.getState = getState;
    this.setState = setState;
    this.limit = limit || 200;
    this.undoStack = [];
    this.redoStack = [];
    this.pending = null;
    this.version = 0;   // zählt jede Änderung (commit, undo, redo) – für „ungespeichert“
  }

  History.prototype.begin = function () {
    if (this.pending === null) this.pending = this.getState();
  };

  History.prototype.commit = function () {
    if (this.pending === null) return false;
    var before = this.pending;
    this.pending = null;
    if (before === this.getState()) return false;
    this.undoStack.push(before);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = [];
    this.version++;
    return true;
  };

  /** Führt fn als einen rückgängig machbaren Schritt aus. */
  History.prototype.run = function (fn) {
    this.begin();
    var r = fn();
    this.commit();
    return r;
  };

  History.prototype.undo = function () {
    this.commit();
    if (!this.undoStack.length) return false;
    this.redoStack.push(this.getState());
    this.setState(this.undoStack.pop());
    this.version++;
    return true;
  };

  History.prototype.redo = function () {
    this.commit();
    if (!this.redoStack.length) return false;
    this.undoStack.push(this.getState());
    this.setState(this.redoStack.pop());
    this.version++;
    return true;
  };

  History.prototype.canUndo = function () { return this.undoStack.length > 0 || this.pending !== null && this.pending !== this.getState(); };
  History.prototype.canRedo = function () { return this.redoStack.length > 0; };

  History.prototype.clear = function () {
    this.undoStack = [];
    this.redoStack = [];
    this.pending = null;
  };

  GE.History = History;
})(globalThis.GE = globalThis.GE || {});
