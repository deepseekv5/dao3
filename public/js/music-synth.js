const STEPS_PER_BEAT = 4;
const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

function envelope(ctx, dest, t, dur, vel, { attack = 0.008, decay = 0.12, sustain = 0.6, release = 0.16 } = {}) {
  const g = ctx.createGain();
  const peak = Math.max(0.0001, vel);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak * sustain), t + attack + decay);
  g.gain.setValueAtTime(Math.max(0.0001, peak * sustain), t + Math.max(attack + decay, dur));
  g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(attack + decay, dur) + release);
  g.connect(dest);
  return g;
}

const INSTRUMENTS = {
  piano: { kind: "tone", wave: "triangle", env: { attack: .006, decay: .28, sustain: .35, release: .35 }, gain: .26, detune: 0 },
  epiano: { kind: "tone", wave: "sine", env: { attack: .008, decay: .5, sustain: .28, release: .5 }, gain: .3, detune: 7 },
  pluck: { kind: "tone", wave: "sawtooth", env: { attack: .004, decay: .09, sustain: .18, release: .12 }, gain: .16, detune: 0 },
  bass: { kind: "tone", wave: "square", env: { attack: .01, decay: .16, sustain: .45, release: .18 }, gain: .16, detune: 0, octave: -12, lp: 520 },
  bell: { kind: "tone", wave: "sine", env: { attack: .003, decay: .7, sustain: .12, release: .9 }, gain: .22, detune: 1200 },
  pad: { kind: "tone", wave: "triangle", env: { attack: .28, decay: .4, sustain: .65, release: .6 }, gain: .12, detune: 5 },
  drum: { kind: "drum", gain: .5 },
};
export const INSTRUMENT_NAMES = [["piano", "键盘"], ["epiano", "电钢"], ["pluck", "拨弦"], ["bass", "贝斯"], ["bell", "钟琴"], ["pad", "铺底"], ["drum", "鼓组"]];

function noiseBuffer(ctx) {
  const n = ctx.createBuffer(1, ctx.sampleRate * .4, ctx.sampleRate);
  const d = n.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return n;
}

function playTone(ctx, out, inst, midi, t, dur, vel) {
  const spec = INSTRUMENTS[inst] || INSTRUMENTS.piano;
  const g = envelope(ctx, out, t, dur, vel * spec.gain, spec.env);
  const notes = spec.detune ? [0, spec.detune, -spec.detune] : [0];
  for (const det of notes) {
    const o = ctx.createOscillator();
    o.type = spec.wave;
    o.frequency.value = midiHz(midi + (spec.octave || 0));
    o.detune.value = det;
    const ng = ctx.createGain(); ng.gain.value = 1 / notes.length;
    let tail = o;
    if (spec.lp) { const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = spec.lp; tail.connect(f); tail = f; }
    tail.connect(ng); ng.connect(g);
    o.start(t); o.stop(t + Math.max(.12, dur) + 1.2);
  }
}

function playDrum(ctx, out, midi, t, vel) {
  const spec = INSTRUMENTS.drum;
  if (midi <= 47) {
    const o = ctx.createOscillator(); o.type = "sine";
    o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(42, t + .18);
    const g = envelope(ctx, out, t, .05, vel * spec.gain, { attack: .002, decay: .1, sustain: .05, release: .12 });
    o.connect(g); o.start(t); o.stop(t + .35); return;
  }
  const src = ctx.createBufferSource(); src.buffer = noiseBuffer(ctx);
  const f = ctx.createBiquadFilter();
  f.type = midi >= 72 ? "highpass" : "bandpass";
  f.frequency.value = midi >= 72 ? 7000 : 1800;
  const g = envelope(ctx, out, t, .04, vel * spec.gain, { attack: .001, decay: .06, sustain: .1, release: .08 });
  src.connect(f); f.connect(g); src.start(t); src.stop(t + .35);
}

export function createMusicPlayer(doc, { onTick, onEnd } = {}) {
  let ctx = null, master = null, timer = 0, startAt = 0, loopSec = 0, playing = false, raf = 0;
  const bpm = () => Math.max(40, Math.min(240, Number(doc.bpm) || 96));
  const stepSec = () => 60 / bpm() / STEPS_PER_BEAT;
  const bars = () => Math.max(1, Math.min(32, Number(doc.bars) || 4));
  const stepCount = () => bars() * 16;
  const totalSec = () => stepCount() * stepSec();

  function ensure() {
    if (ctx) return;
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain(); master.gain.value = .85; master.connect(ctx.destination);
  }
  function scheduleLoop(at) {
    for (const track of doc.tracks || []) {
      if (track.muted) continue;
      const out = ctx.createGain(); out.gain.value = track.volume == null ? .8 : track.volume; out.connect(master);
      for (const n of track.notes || []) {
        const t = at + (n.t || 0) * stepSec();
        const dur = Math.max(.05, (n.dur || 1) * stepSec() * .92);
        if (track.instrument === "drum") playDrum(ctx, out, n.pitch, t, n.vel || .8);
        else playTone(ctx, out, track.instrument, n.pitch, t, dur, n.vel || .8);
      }
    }
  }
  function play() {
    ensure();
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    stop(false);
    playing = true; loopSec = totalSec(); startAt = ctx.currentTime + .06;
    scheduleLoop(startAt);
    if (doc.loop) timer = setInterval(() => { startAt += loopSec; scheduleLoop(startAt); }, loopSec * 1000);
    else timer = setTimeout(() => { playing = false; timer = 0; onTick && onTick(-1); onEnd && onEnd(); }, loopSec * 1000);
    const tick = () => {
      if (!playing) return;
      const step = Math.floor(((ctx.currentTime - startAt) % loopSec) / stepSec());
      onTick && onTick(((step % stepCount()) + stepCount()) % stepCount());
      raf = requestAnimationFrame(tick);
    };
    tick();
  }
  function stop(clear = true) {
    playing = false; clearInterval(timer); clearTimeout(timer); timer = 0; cancelAnimationFrame(raf); raf = 0;
    if (ctx && clear) { startAt = 0; }
    onTick && onTick(-1);
  }
  function dispose() { stop(); if (ctx) { try { ctx.close(); } catch { } ctx = null; } }
  return { play, stop, dispose, get playing() { return playing; }, stepSec, totalSec };
}

export async function auditionNote(instrument, midi, vel = .8) {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const out = ctx.createGain(); out.gain.value = .8; out.connect(ctx.destination);
  if (instrument === "drum") playDrum(ctx, out, midi, ctx.currentTime + .02, vel);
  else playTone(ctx, out, instrument, midi, ctx.currentTime + .02, .28, vel);
  setTimeout(() => { try { ctx.close(); } catch { } }, 900);
}
