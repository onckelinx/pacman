/* Pac-Man — every sound is generated with Web Audio, so there are no asset files. */
(function () {
  'use strict';

  var PM = (window.PM = window.PM || {});

  var VOLUME = 0.25;
  var LOOP_VOLUME = 0.12;

  var ctx = null;
  var master = null;
  var voice = null;      // the one continuous tone: siren, fright or eyes
  var voiceGain = null;
  var muted = false;
  var wakaHigh = false;

  // Browsers keep audio silent until a key press or click, so the first one calls this.
  function unlock() {
    if (!ctx) {
      var AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      try {
        ctx = new AudioCtx();
      } catch (e) {
        ctx = null;
        return;
      }
      master = ctx.createGain();
      master.gain.value = muted ? 0 : VOLUME;
      master.connect(ctx.destination);
      voiceGain = ctx.createGain();
      voiceGain.gain.value = 0;
      voiceGain.connect(master);
      voice = ctx.createOscillator();
      voice.type = 'triangle';
      voice.connect(voiceGain);
      voice.start();
    }
    if (ctx.state === 'suspended') ctx.resume();
  }

  function suspend() {
    if (ctx && ctx.state === 'running') ctx.suspend();
  }

  function setMuted(value) {
    muted = value;
    if (master) master.gain.setTargetAtTime(muted ? 0 : VOLUME, ctx.currentTime, 0.01);
  }

  function isMuted() { return muted; }

  // One short note, with quick ramps at both ends so it does not click.
  function note(freq, at, length, type, volume, endFreq) {
    var start = ctx.currentTime + at;
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    if (endFreq) osc.frequency.linearRampToValueAtTime(endFreq, start + length);
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(volume, start + 0.005);
    gain.gain.setValueAtTime(volume, start + Math.max(0.006, length - 0.015));
    gain.gain.linearRampToValueAtTime(0, start + length);
    osc.connect(gain);
    gain.connect(master);
    osc.start(start);
    osc.stop(start + length + 0.01);
  }

  function melody(freqs, step, type, volume) {
    freqs.forEach(function (freq, i) {
      if (freq) note(freq, i * step, step * 0.9, type, volume);
    });
  }

  // This project's own start tune, not the arcade one. 0 is a rest.
  var START_TUNE = [392, 494, 587, 494, 659, 587, 494, 392, 440, 523, 659, 523, 587, 0, 784, 0];

  var EFFECTS = {
    start: function () { melody(START_TUNE, 0.25, 'square', 0.35); },
    dot: function () {
      wakaHigh = !wakaHigh;
      note(wakaHigh ? 520 : 390, 0, 0.07, 'triangle', 0.8, wakaHigh ? 390 : 520);
    },
    energizer: function () { note(180, 0, 0.18, 'square', 0.5, 420); },
    ghost: function () { note(220, 0, 0.45, 'square', 0.5, 1000); },
    fruit: function () { melody([660, 880, 1100], 0.08, 'square', 0.5); },
    life: function () { melody([523, 659, 784, 1047], 0.09, 'square', 0.5); },
    clear: function () { melody([523, 659, 784, 1047, 784, 1047], 0.12, 'square', 0.4); },
    death: function () { note(880, 0.6, 0.9, 'square', 0.5, 90); }
  };

  function handle(events) {
    if (!ctx) return;
    for (var i = 0; i < events.length; i++) {
      if (EFFECTS[events[i]]) EFFECTS[events[i]]();
    }
  }

  // Rises and falls between 0 and 1 over the given number of ticks.
  function wave(tick, period) {
    return Math.abs(((tick % period) / period) * 2 - 1);
  }

  function loopPitch(state) {
    var eyes = state.ghosts.some(function (g) { return g.loc === 'eyes' || g.loc === 'entering'; });
    if (eyes) return 700 + 300 * wave(state.tick, 10);
    if (state.frightT > 0) return 160 + 80 * wave(state.tick, 8);
    // The siren climbs as the dots run out.
    return 240 + (244 - state.dotsLeft) * 0.8 + 70 * wave(state.tick, 36);
  }

  // Called every frame for the continuous tone.
  function update(state, running) {
    if (!ctx) return;
    var now = ctx.currentTime;
    var playing = running && state.phase === 'play';
    voice.frequency.cancelScheduledValues(now);
    voiceGain.gain.cancelScheduledValues(now);
    if (playing) voice.frequency.setTargetAtTime(loopPitch(state), now, 0.01);
    voiceGain.gain.setTargetAtTime(playing ? LOOP_VOLUME : 0, now, 0.02);
  }

  PM.sound = {
    unlock: unlock,
    suspend: suspend,
    setMuted: setMuted,
    isMuted: isMuted,
    handle: handle,
    update: update,
    EVENTS: Object.keys(EFFECTS)
  };
})();
