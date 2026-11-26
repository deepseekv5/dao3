const STEPS_PER_BEAT = 4;
const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

const INSTRUMENTS = {
  piano: { label: "音乐会钢琴", family: "键盘", wave: "triangle", env: { attack: .004, decay: .32, sustain: .24, release: .38 }, gain: .25, detune: 0, lp: 5200 },
  epiano: { label: "复古电钢", family: "键盘", wave: "sine", env: { attack: .008, decay: .48, sustain: .25, release: .5 }, gain: .3, detune: 7, lp: 6200 },
  pluck: { label: "琥珀拨弦", family: "弦乐", wave: "sawtooth", env: { attack: .003, decay: .11, sustain: .16, release: .16 }, gain: .14, detune: -4, lp: 3600 },
  bass: { label: "深潜贝斯", family: "低音", wave: "square", env: { attack: .008, decay: .18, sustain: .48, release: .2 }, gain: .16, detune: 0, octave: -12, lp: 620 },
  bell: { label: "玻璃钟琴", family: "打击", wave: "sine", env: { attack: .002, decay: .75, sustain: .08, release: .9 }, gain: .24, detune: 1200, lp: 9000 },
  pad: { label: "暖雾铺底", family: "合成器", wave: "triangle", env: { attack: .3, decay: .45, sustain: .68, release: .7 }, gain: .11, detune: 5, lp: 2400 },
  strings: { label: "弦乐合奏", family: "弦乐", wave: "sawtooth", env: { attack: .16, decay: .3, sustain: .62, release: .45 }, gain: .09, detune: 9, lp: 3200 },
  brass: { label: "黄铜管乐", family: "管乐", wave: "sawtooth", env: { attack: .07, decay: .22, sustain: .58, release: .25 }, gain: .12, detune: 3, lp: 2800 },
  flute: { label: "长笛", family: "管乐", wave: "sine", env: { attack: .06, decay: .18, sustain: .72, release: .22 }, gain: .22, detune: 2, lp: 8000 },
  synth: { label: "模拟合成器", family: "合成器", wave: "square", env: { attack: .02, decay: .24, sustain: .42, release: .3 }, gain: .11, detune: 6, lp: 1800 },
  organ: { label: "教堂风琴", family: "键盘", wave: "sine", env: { attack: .03, decay: .08, sustain: .82, release: .22 }, gain: .22, detune: 0, lp: 7000 },
  harp: { label: "竖琴", family: "弦乐", wave: "triangle", env: { attack: .002, decay: .48, sustain: .05, release: .6 }, gain: .24, detune: 3, lp: 8500 },
  marimba: { label: "马林巴", family: "打击", wave: "sine", env: { attack: .002, decay: .22, sustain: .03, release: .28 }, gain: .28, detune: 0, lp: 5200 },
  accordion: { label: "手风琴", family: "管乐", wave: "sawtooth", env: { attack: .06, decay: .12, sustain: .72, release: .18 }, gain: .11, detune: 11, lp: 3600 },
  choir: { label: "空灵合唱", family: "人声", wave: "triangle", env: { attack: .18, decay: .3, sustain: .76, release: .7 }, gain: .1, detune: 18, lp: 4200 },
  synthlead: { label: "模拟主音", family: "合成器", wave: "sawtooth", env: { attack: .01, decay: .18, sustain: .55, release: .24 }, gain: .12, detune: 5, lp: 5200 },
  subbass: { label: "超低音", family: "低音", wave: "sine", env: { attack: .006, decay: .16, sustain: .68, release: .2 }, gain: .24, detune: 0, octave: -24, lp: 480 },
  pizz: { label: "拨奏弦乐", family: "弦乐", wave: "square", env: { attack: .002, decay: .09, sustain: .04, release: .12 }, gain: .1, detune: 2, lp: 2800 },
  drum: { label: "电子鼓组", family: "鼓组", gain: .5 },
};
export const INSTRUMENT_NAMES = Object.entries(INSTRUMENTS).map(([id, s]) => [id, s.label, s.family]);

const DRUM_NAMES = [[36, "底鼓"], [38, "军鼓"], [42, "闭镲"], [46, "开镲"], [49, "强镲"], [51, "拍手"], [45, "低音鼓"], [48, "中鼓"], [50, "高鼓"]];

function noiseBuffer(ctx, seconds = .4) {
  const n = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * seconds), ctx.sampleRate);
  const d = n.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return n;
}

function impulseBuffer(ctx, seconds = 1.6) {
  const n = ctx.createBuffer(2, Math.ceil(ctx.sampleRate * seconds), ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = n.getChannelData(c);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2.8);
  }
  return n;
}

function envelope(ctx, dest, t, dur, vel, env) {
  const g = ctx.createGain();
  const peak = Math.max(0.0001, vel);
  const attack = Math.max(.002, +env.attack || .008);
  const decay = Math.max(.01, +env.decay || .12);
  const sustain = clamp(+env.sustain ?? .6, .001, 1);
  const release = Math.max(.03, +env.release || .16);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak * sustain), t + attack + decay);
  const hold = Math.max(attack + decay, dur);
  g.gain.setValueAtTime(Math.max(0.0001, peak * sustain), t + hold);
  g.gain.exponentialRampToValueAtTime(0.0001, t + hold + release);
  g.connect(dest);
  return g;
}

function playTone(ctx, out, instrument, midi, t, dur, vel, synth = {}, active) {
  const spec = INSTRUMENTS[instrument] || INSTRUMENTS.piano;
  const env = { ...spec.env, ...synth };
  const g = envelope(ctx, out, t, dur, vel * spec.gain, env);
  const detunes = spec.detune ? [0, spec.detune, -spec.detune] : [0];
  for (const det of detunes) {
    const o = ctx.createOscillator();
    o.type = spec.wave;
    o.frequency.value = midiHz(midi + (spec.octave || 0));
    o.detune.value = det;
    const ng = ctx.createGain(); ng.gain.value = 1 / detunes.length;
    let tail = o;
    const cutoff = clamp(+synth.cutoff || spec.lp || 8000, 120, 18000);
    const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = cutoff; f.Q.value = .7;
    tail.connect(f); tail = f;
    tail.connect(ng); ng.connect(g);
    const stopAt = t + Math.max(.12, dur) + Math.max(.1, +env.release || .2) + .05;
    o.start(t); o.stop(stopAt);
    if (active) { active.add(o); o.onended = () => active.delete(o); }
  }
}

function playDrum(ctx, out, midi, t, vel, active) {
  const spec = INSTRUMENTS.drum;
  if (midi <= 47) {
    const o = ctx.createOscillator(); o.type = "sine";
    o.frequency.setValueAtTime(midi <= 38 ? 145 : 110, t);
    o.frequency.exponentialRampToValueAtTime(midi <= 38 ? 42 : 58, t + .19);
    const g = envelope(ctx, out, t, .05, vel * spec.gain, { attack: .002, decay: .1, sustain: .04, release: .13 });
    o.connect(g); o.start(t); o.stop(t + .38);
    if (active) { active.add(o); o.onended = () => active.delete(o); }
    return;
  }
  const src = ctx.createBufferSource(); src.buffer = noiseBuffer(ctx);
  const f = ctx.createBiquadFilter();
  const hat = midi >= 42 && (midi <= 46 || midi >= 72);
  f.type = hat ? "highpass" : "bandpass";
  f.frequency.value = hat ? 7200 : 1900; f.Q.value = hat ? .6 : .8;
  const g = envelope(ctx, out, t, hat ? .035 : .06, vel * spec.gain, { attack: .001, decay: hat ? .045 : .1, sustain: .05, release: hat ? .05 : .12 });
  src.connect(f); f.connect(g); src.start(t); src.stop(t + .35);
  if (active) { active.add(src); src.onended = () => active.delete(src); }
}

function buildMaster(ctx, doc) {
  const input = ctx.createGain();
  const compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = -14; compressor.knee.value = 18; compressor.ratio.value = 5;
  compressor.attack.value = .006; compressor.release.value = .18;
  const dry = ctx.createGain(); dry.gain.value = 1;
  const wet = ctx.createGain(); wet.gain.value = clamp(+doc.master?.reverb ?? .1, 0, .7);
  const convolver = ctx.createConvolver(); convolver.buffer = impulseBuffer(ctx);
  const delay = ctx.createDelay(1); delay.delayTime.value = .28;
  const feedback = ctx.createGain(); feedback.gain.value = clamp(+doc.master?.delay ?? .08, 0, .65) * .55;
  const delayWet = ctx.createGain(); delayWet.gain.value = clamp(+doc.master?.delay ?? .08, 0, .65);
  input.connect(compressor); compressor.connect(dry); dry.connect(ctx.destination);
  compressor.connect(convolver); convolver.connect(wet); wet.connect(ctx.destination);
  compressor.connect(delay); delay.connect(feedback); feedback.connect(delay);
  delay.connect(delayWet); delayWet.connect(ctx.destination);
  input.gain.value = clamp(+doc.master?.volume ?? .85, 0, 1);
  return input;
}

function buildChannels(ctx, master, doc) {
  const channels = new Map();
  const solo = (doc.tracks || []).some((t) => t.solo);
  for (const track of doc.tracks || []) {
    const input = ctx.createGain();
    const panner = ctx.createStereoPanner();
    const analyser = ctx.createAnalyser(); analyser.fftSize = 256;
    input.gain.value = track.muted || (solo && !track.solo) ? 0 : clamp(+track.volume ?? .8, 0, 1);
    panner.pan.value = clamp(+track.pan ?? 0, -1, 1);
    input.connect(panner); panner.connect(analyser); analyser.connect(master);
    channels.set(track.id, { input, panner, analyser });
  }
  return channels;
}

function scheduleNote(ctx, channel, track, note, at, stepSec, active) {
  const dur = Math.max(.04, (note.dur || 1) * stepSec * .94);
  if (track.instrument === "drum") playDrum(ctx, channel.input, note.pitch, at, note.vel || .8, active);
  else playTone(ctx, channel.input, track.instrument, note.pitch, at, dur, note.vel || .8, track.synth || {}, active);
}

function projectEvents(doc, startStep, endStep) {
  const events = [];
  for (const track of doc.tracks || []) {
    if (track.muted || (doc.tracks.some((t) => t.solo) && !track.solo)) continue;
    for (const clip of track.clips || [{ start: 0, notes: track.notes || [] }]) {
      for (const note of clip.notes || []) {
        const step = clip.start + note.t;
        if (step >= startStep && step < endStep) events.push({ step: step - startStep, track, note });
      }
    }
    for (const param of ["volume", "pan"]) {
      for (const point of track.automation?.[param] || []) {
        if (point.t >= startStep && point.t < endStep) events.push({ step: point.t - startStep, track, automation: param, value: point.v });
      }
    }
  }
  if (doc.metronome) {
    for (let s = 0; s < endStep - startStep; s += 4) {
      events.push({ step: s, metronome: true, accent: s % 16 === 0 });
    }
  }
  return events.sort((a, b) => a.step - b.step);
}

function click(ctx, out, t, accent) {
  const o = ctx.createOscillator(); o.type = "sine"; o.frequency.value = accent ? 1200 : 850;
  const g = ctx.createGain(); g.gain.setValueAtTime(.12, t); g.gain.exponentialRampToValueAtTime(.0001, t + .045);
  o.connect(g); g.connect(out); o.start(t); o.stop(t + .06);
}

export function createMusicPlayer(doc, { onTick, onEnd, onMeter } = {}) {
  let ctx = null, master = null, channels = null, timer = 0, raf = 0, active = new Set();
  let playing = false, startAt = 0, loopAt = 0, events = [], eventAt = 0, stepSec = .15, loopSec = 1;
  const range = () => {
    const total = Math.max(16, (+doc.bars || 4) * (+doc.beatsPerBar || 4) * 4);
    const loopEnabled = doc.loop?.enabled ?? (typeof doc.loop === "boolean" ? doc.loop : true);
    const start = clamp(Math.round(+doc.loop?.start || 0), 0, total - 1);
    const end = clamp(Math.round(+doc.loop?.end || total), start + 1, total);
    return { start, end, enabled: loopEnabled };
  };
  function ensure() {
    if (ctx) return;
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = buildMaster(ctx, doc);
    channels = buildChannels(ctx, master, doc);
  }
  function play() {
    ensure();
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    stop(false);
    const r = range();
    stepSec = 60 / clamp(+doc.bpm || 96, 40, 240) / STEPS_PER_BEAT;
    loopSec = (r.end - r.start) * stepSec;
    events = projectEvents(doc, r.start, r.end);
    eventAt = 0; loopAt = ctx.currentTime + .06; startAt = loopAt - r.start * stepSec;
    playing = true;
    const pump = () => {
      if (!playing) return;
      const horizon = ctx.currentTime + .14;
      while (eventAt < events.length && loopAt + events[eventAt].step * stepSec <= horizon) {
        const e = events[eventAt++];
        const at = Math.max(ctx.currentTime + .005, loopAt + e.step * stepSec);
        if (e.metronome) click(ctx, master, at, e.accent);
        else {
          const ch = channels.get(e.track.id);
          if (!ch) continue;
          if (e.automation) {
            const param = e.automation === "pan" ? ch.panner.pan : ch.input.gain;
            const value = e.automation === "pan" ? clamp(+e.value || 0, -1, 1) : clamp(+e.value || 0, 0, 1);
            param.linearRampToValueAtTime(value, at);
          } else scheduleNote(ctx, ch, e.track, e.note, at, stepSec, active);
        }
      }
      if (ctx.currentTime >= loopAt + loopSec - .12) {
        if (r.enabled) { loopAt += loopSec; eventAt = 0; }
        else { stop(); onEnd?.(); return; }
      }
    };
    pump(); timer = setInterval(pump, 25);
    const tick = () => {
      if (!playing) return;
      const step = Math.floor((ctx.currentTime - startAt) / stepSec);
      onTick?.(step);
      if (onMeter && channels) {
        const data = new Uint8Array(analyserByteLength(channels));
        for (const [id, ch] of channels) {
          ch.analyser.getByteTimeDomainData(data);
          let sum = 0;
          for (let i = 0; i < data.length; i++) { const v = (data[i] - 128) / 128; sum += v * v; }
          onMeter(id, Math.sqrt(sum / data.length));
        }
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
  }
  function stop() {
    playing = false; clearInterval(timer); timer = 0; cancelAnimationFrame(raf); raf = 0;
    for (const node of active) { try { node.stop(); } catch { } }
    active.clear(); onTick?.(-1);
  }
  function dispose() { stop(); if (ctx) { try { ctx.close(); } catch { } ctx = null; } channels = null; master = null; }
  return { play, stop, dispose, get playing() { return playing; }, stepSec, totalSec: () => loopSec };
}
function analyserByteLength(channels) {
  const first = channels.values().next().value;
  return first ? first.analyser.fftSize : 256;
}

export async function auditionNote(instrument, midi, vel = .8, synth = {}) {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const out = ctx.createGain(); out.gain.value = .8; out.connect(ctx.destination);
  if (instrument === "drum") playDrum(ctx, out, midi, ctx.currentTime + .02, vel);
  else playTone(ctx, out, instrument, midi, ctx.currentTime + .02, .3, vel, synth);
  setTimeout(() => { try { ctx.close(); } catch { } }, 1100);
}

function wavFromBuffer(buffer) {
  const channels = buffer.numberOfChannels, frames = buffer.length;
  const bytes = new ArrayBuffer(44 + frames * channels * 2);
  const v = new DataView(bytes);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, "RIFF"); v.setUint32(4, 36 + frames * channels * 2, true); str(8, "WAVE"); str(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, channels, true);
  v.setUint32(24, buffer.sampleRate, true); v.setUint32(28, buffer.sampleRate * channels * 2, true);
  v.setUint16(32, channels * 2, true); v.setUint16(34, 16, true); str(36, "data"); v.setUint32(40, frames * channels * 2, true);
  const data = Array.from({ length: channels }, (_, c) => buffer.getChannelData(c));
  let p = 44;
  for (let i = 0; i < frames; i++) for (let c = 0; c < channels; c++) {
    const x = clamp(data[c][i], -1, 1);
    v.setInt16(p, x < 0 ? x * 0x8000 : x * 0x7fff, true); p += 2;
  }
  return new Blob([bytes], { type: "audio/wav" });
}

/** 离线渲染：和实时播放共用同一套音符/通道/效果调度，不另写一份“试听很好、导出没声”的逻辑。 */
export async function renderMusicToWav(doc, { trackId } = {}) {
  const renderDoc = trackId ? { ...doc, metronome: false, tracks: (doc.tracks || []).filter((t) => t.id === trackId) } : doc;
  const loopEnabled = renderDoc.loop?.enabled ?? (typeof renderDoc.loop === "boolean" ? renderDoc.loop : true);
  const r = loopEnabled
    ? { start: clamp(+renderDoc.loop.start || 0, 0, (+renderDoc.bars || 4) * (+renderDoc.beatsPerBar || 4) * 4 - 1), end: clamp(+renderDoc.loop.end || (+renderDoc.bars || 4) * (+renderDoc.beatsPerBar || 4) * 4, 1, (+renderDoc.bars || 4) * (+renderDoc.beatsPerBar || 4) * 4) }
    : { start: 0, end: (+renderDoc.bars || 4) * (+renderDoc.beatsPerBar || 4) * 4 };
  const stepSec = 60 / clamp(+renderDoc.bpm || 96, 40, 240) / STEPS_PER_BEAT;
  const duration = Math.max(.2, (r.end - r.start) * stepSec + 1.2);
  const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!Offline) throw new Error("这个浏览器不支持离线音频渲染");
  const ctx = new Offline(2, Math.ceil(duration * 44100), 44100);
  const master = buildMaster(ctx, renderDoc);
  const channels = buildChannels(ctx, master, renderDoc);
  for (const e of projectEvents(renderDoc, r.start, r.end)) {
    const at = .04 + e.step * stepSec;
    if (e.metronome) click(ctx, master, at, e.accent);
    else {
      const ch = channels.get(e.track.id);
      if (!ch) continue;
      if (e.automation) {
        const param = e.automation === "pan" ? ch.panner.pan : ch.input.gain;
        const value = e.automation === "pan" ? clamp(+e.value || 0, -1, 1) : clamp(+e.value || 0, 0, 1);
        param.linearRampToValueAtTime(value, at);
      } else scheduleNote(ctx, ch, e.track, e.note, at, stepSec, null);
    }
  }
  const rendered = await ctx.startRendering();
  return wavFromBuffer(rendered);
}

function vlq(n) {
  const out = [n & 0x7f]; n = Math.floor(n / 128);
  while (n > 0) { out.unshift((n & 0x7f) | 0x80); n = Math.floor(n / 128); }
  return out;
}
const ascii = (s) => Array.from(new TextEncoder().encode(String(s || "").slice(0, 80)));
function midiTrack(events, name) {
  const bytes = [0, 0xff, 0x03, ...vlq(ascii(name).length), ...ascii(name)];
  let last = 0;
  for (const e of events.sort((a,b)=>a.tick-b.tick || a.order-b.order)) {
    bytes.push(...vlq(Math.max(0, e.tick - last)), ...e.data); last = e.tick;
  }
  bytes.push(0, 0xff, 0x2f, 0);
  return [0x4d, 0x54, 0x72, 0x6b, ...vlq(bytes.length), ...bytes];
}
/** 标准 MIDI File（type 1，480 TPQN），可进 Logic / GarageBand / Ableton 继续编曲。 */
export function exportMidi(doc) {
  const ppqn = 480, stepTicks = ppqn / 4;
  const tempo = Math.round(60000000 / clamp(+doc.bpm || 96, 40, 240));
  const sig = clamp(+doc.beatsPerBar || 4, 1, 7);
  const conductor = [
    { tick: 0, order: 0, data: [0xff, 0x51, 3, (tempo >> 16) & 255, (tempo >> 8) & 255, tempo & 255] },
    { tick: 0, order: 1, data: [0xff, 0x58, 4, sig, 2, 24, 8] },
  ];
  const tracks = [midiTrack(conductor, "Conductor")];
  (doc.tracks || []).forEach((track, i) => {
    const events = [];
    for (const clip of track.clips || [{ start: 0, notes: track.notes || [] }]) for (const n of clip.notes || []) {
      const tick = Math.round((clip.start + n.t) * stepTicks);
      const end = Math.round((clip.start + n.t + Math.max(1, n.dur) * .9) * stepTicks);
      const channel = track.instrument === "drum" ? 9 : i % 16;
      events.push({ tick, order: 1, data: [0x90 | channel, clamp(Math.round(n.pitch), 0, 127), clamp(Math.round((n.vel || .8) * 127), 1, 127)] });
      events.push({ tick: end, order: 0, data: [0x80 | channel, clamp(Math.round(n.pitch), 0, 127), 0] });
    }
    tracks.push(midiTrack(events, track.name || "Track " + (i + 1)));
  });
  const header = [0x4d,0x54,0x68,0x64,0,0,0,6,0,1,...vlq(tracks.length),...vlq(ppqn)];
  const body = tracks.flat();
  return new Blob([new Uint8Array([...header, ...body])], { type: "audio/midi" });
}

export { DRUM_NAMES };
