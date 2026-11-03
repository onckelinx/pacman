/* Pac-Man — the game loop, keyboard, layout and score line. */
(function () {
  'use strict';

  var R = PM.rules;
  var G = PM.game;
  var Draw = PM.render;
  var Sound = PM.sound;

  var STEP = 1000 / R.TICKS;
  var MAX_DT = 100;  // a long gap between frames never turns into a burst of ticks

  // By physical key, so WASD sits in the same place on every keyboard layout.
  var KEY_DIRS = {
    ArrowUp: R.UP, ArrowLeft: R.LEFT, ArrowDown: R.DOWN, ArrowRight: R.RIGHT,
    KeyW: R.UP, KeyA: R.LEFT, KeyS: R.DOWN, KeyD: R.RIGHT
  };

  var HINT = 'Arrow keys or WASD to move, P to pause, M for sound.';

  function $(id) { return document.getElementById(id); }

  var els, ctx, palette, fitted;
  var state;
  var mode = 'wait';  // wait (before the first key), run or pause
  var input = R.NONE; // the direction pressed since the last tick
  var last = null;
  var accum = 0;
  var high = 0;
  var lastPhase = null;
  var shown = {};     // what the score line shows now, so the DOM is only touched on change
  var storagePrefix = 'pacman.';
  var laidOut = { w: 0, h: 0, scale: 0 }; // what the canvas was last sized for

  // ---- Stored settings ----

  function loadHigh() {
    try {
      var v = Number(localStorage.getItem(storagePrefix + 'high'));
      if (v > 0) return v;
    } catch (e) { /* storage unavailable */ }
    return 0;
  }

  function saveHigh() {
    try { localStorage.setItem(storagePrefix + 'high', String(high)); } catch (e) { /* storage unavailable */ }
  }

  function loadMuted() {
    try { return localStorage.getItem(storagePrefix + 'sound') === 'off'; } catch (e) { return false; }
  }

  function saveMuted(muted) {
    try { localStorage.setItem(storagePrefix + 'sound', muted ? 'off' : 'on'); } catch (e) { /* storage unavailable */ }
  }

  // ---- Layout ----

  function resizeTo(availW, availH, dpr) {
    fitted = Draw.fit(availW, availH, dpr);
    els.canvas.width = fitted.width;
    els.canvas.height = fitted.height;
    els.canvas.style.width = fitted.cssWidth + 'px';
    els.canvas.style.height = fitted.cssHeight + 'px';
    els.scoreline.style.width = fitted.cssWidth + 'px';
    // Line canvas pixels up with screen pixels, or the browser would blur them.
    var box = els.stage.getBoundingClientRect();
    var left = (availW - fitted.cssWidth) / 2;
    els.canvas.style.left = (Math.round((box.left + left) * dpr) / dpr - box.left) + 'px';
    els.canvas.style.top = (Math.round(box.top * dpr) / dpr - box.top) + 'px';
  }

  // Checked every frame, because no single event covers it all. The window can be resized,
  // the page can move to a screen with another scale, and the status line can wrap.
  function layoutIfChanged() {
    var w = els.stage.clientWidth, h = els.stage.clientHeight;
    var scale = window.devicePixelRatio || 1;
    if (w === laidOut.w && h === laidOut.h && scale === laidOut.scale) return;
    laidOut = { w: w, h: h, scale: scale };
    resizeTo(w, h, scale);
  }

  // ---- Status and score line ----

  function setStatus(text) {
    if (els.status.textContent !== text) els.status.textContent = text;
  }

  // Runs on changes of phase or mode only, so a screen reader is not flooded.
  function refreshStatus() {
    if (mode === 'wait') setStatus('Press an arrow key to start. ' + HINT);
    else if (mode === 'pause') setStatus('Paused. Press an arrow key or P to carry on.');
    else if (state.phase === 'over') setStatus('Game over. You scored ' + state.score + '. Press Enter to play again.');
    else if (state.phase === 'clear') setStatus('Level ' + state.level + ' cleared!');
    else setStatus(HINT);
  }

  function setText(key, node, text) {
    if (shown[key] !== text) {
      shown[key] = text;
      node.textContent = text;
    }
  }

  function updateScoreLine() {
    if (state.score > high) high = state.score;
    setText('score', els.score, String(state.score));
    setText('high', els.high, String(high));
    setText('level', els.level, String(state.level));
    // The life in play is not shown, as in the arcade game.
    var spare = state.phase === 'over' ? 0 : Math.max(0, state.lives - 1);
    if (shown.spare !== spare) {
      shown.spare = spare;
      els.lives.textContent = '';
      els.lives.setAttribute('aria-label', spare + (spare === 1 ? ' spare life' : ' spare lives'));
      for (var i = 0; i < spare; i++) {
        var life = document.createElement('span');
        life.className = 'life';
        els.lives.appendChild(life);
      }
    }
  }

  function updateSoundButton() {
    els.sound.textContent = Sound.isMuted() ? 'Sound off' : 'Sound on';
  }

  // ---- Game flow ----

  function newGame(seed, startMode) {
    state = G.create(seed === undefined ? Date.now() : seed);
    mode = startMode;
    input = R.NONE;
    accum = 0;
    last = null;
    lastPhase = state.phase;
    refreshStatus();
  }

  function pause() {
    if (mode !== 'run' || state.phase === 'over') return;
    mode = 'pause';
    Sound.suspend();
    saveHigh();
    refreshStatus();
  }

  function resume() {
    if (mode === 'run') return;
    Sound.unlock();
    mode = 'run';
    last = null;
    refreshStatus();
  }

  function setMuted(muted) {
    Sound.setMuted(muted);
    saveMuted(muted);
    updateSoundButton();
  }

  function overlayMessage() {
    if (mode === 'wait') return 'PRESS AN ARROW KEY';
    if (mode === 'pause') return 'PAUSED';
    return null;
  }

  // ---- The loop ----

  function frame(now) {
    layoutIfChanged();
    if (last === null) last = now;
    var dt = Math.max(0, Math.min(now - last, MAX_DT));
    last = now;
    if (mode === 'run') {
      accum += dt;
      while (accum >= STEP) {
        accum -= STEP;
        G.tick(state, input);
        input = R.NONE;
        Sound.handle(state.events);
      }
    }
    Draw.draw(ctx, state, mode === 'run' ? accum / STEP : 1, fitted.T, palette, overlayMessage());
    Sound.update(state, mode === 'run');
    updateScoreLine();
    if (state.phase !== lastPhase) {
      lastPhase = state.phase;
      saveHigh();
      refreshStatus();
    }
  }

  function loop(now) {
    frame(now);
    requestAnimationFrame(loop);
  }

  // ---- Input ----

  function onKeyDown(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return; // leave browser shortcuts alone
    var dir = KEY_DIRS[e.code];
    if (dir !== undefined) {
      e.preventDefault();
      Sound.unlock();
      input = dir;
      if (state.phase !== 'over') resume();
      return;
    }
    if (e.repeat) return;
    var key = (e.key || '').toLowerCase();
    if (key === 'p') {
      if (mode === 'run') pause();
      else resume();
    } else if (key === 'm') {
      setMuted(!Sound.isMuted());
    } else if ((key === 'enter' || key === ' ') && !(e.target && e.target.tagName === 'BUTTON')) {
      e.preventDefault();
      if (state.phase === 'over') {
        Sound.unlock();
        newGame(undefined, 'run');
      } else {
        resume();
      }
    }
  }

  function onNewGame() {
    els.newGame.blur();
    if (mode !== 'wait' && state.phase !== 'over') {
      pause();
      if (!window.confirm('Abandon this game and start a new one?')) return;
    }
    Sound.unlock();
    saveHigh();
    newGame(undefined, 'run');
  }

  function onSoundButton() {
    els.sound.blur();
    Sound.unlock();
    setMuted(!Sound.isMuted());
  }

  // ---- Starting up ----

  // Options for the tests: manual (no animation loop; they call frame themselves), seed,
  // and storagePrefix, which keeps their scores away from the player's real high score.
  function start(options) {
    var opts = options || {};
    storagePrefix = opts.storagePrefix || storagePrefix;
    els = {
      canvas: $('game'),
      stage: $('stage'),
      scoreline: $('scoreline'),
      score: $('score'),
      high: $('high'),
      level: $('level'),
      lives: $('lives'),
      status: $('status'),
      newGame: $('new-game'),
      sound: $('sound')
    };
    ctx = els.canvas.getContext('2d');
    palette = Draw.readPalette();
    high = loadHigh();
    Sound.setMuted(loadMuted());
    updateSoundButton();

    document.addEventListener('keydown', onKeyDown);
    els.newGame.addEventListener('click', onNewGame);
    els.sound.addEventListener('click', onSoundButton);
    window.addEventListener('blur', pause);
    window.addEventListener('pagehide', saveHigh);
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) pause();
    });

    newGame(opts.seed, 'wait');
    layoutIfChanged();
    if (!opts.manual) requestAnimationFrame(loop);
  }

  PM.ui = {
    start: start,
    frame: frame,
    newGame: newGame,
    resizeTo: resizeTo,
    state: function () { return state; },
    mode: function () { return mode; },
    tile: function () { return fitted.T; }
  };
})();
