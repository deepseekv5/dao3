import { createMusicPlayer, auditionNote, renderMusicToWav, exportMidi, INSTRUMENT_NAMES, DRUM_NAMES } from "./music-synth.js";
import { writeZip } from "./zip.js";

const clone = (v) => JSON.parse(JSON.stringify(v || {}));
const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const uid = () => Math.random().toString(36).slice(2, 9);
const COLORS = ["#e3a63c", "#5aa8e8", "#6fbf8b", "#d94f5f", "#a06bff", "#12b5c9", "#f08a5d", "#8d99ae"];
const LOW = 36, HIGH = 96, ROWS = HIGH - LOW + 1, ROW_H = 11, KEY_W = 58;
const KEYS = [["C", 0], ["C#", 1], ["D", 2], ["D#", 3], ["E", 4], ["F", 5], ["F#", 6], ["G", 7], ["G#", 8], ["A", 9], ["A#", 10], ["B", 11]];
const SCALES = { major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10] };
const KEYMAP = { a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6, g: 7, y: 8, h: 9, u: 10, j: 11, k: 12, o: 13, l: 14, p: 15, ";": 16 };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const noteName = (p) => `${KEYS[((p % 12) + 12) % 12][0]}${Math.floor(p / 12) - 1}`;
const instName = (id) => (INSTRUMENT_NAMES.find(([k]) => k === id) || [, id])[1];
const icon = (name) => {
  const p = {
    play: '<path d="m8 5 11 7-11 7V5Z" fill="currentColor" stroke="none"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="1" fill="currentColor" stroke="none"/>',
    rewind: '<path d="M5 5v14M19 6l-9 6 9 6V6Z"/>',
    undo: '<path d="M9 5 4 10l5 5M5 10h8a6 6 0 0 1 0 12"/>',
    redo: '<path d="m15 5 5 5-5 5M19 10h-8a6 6 0 0 0 0 12"/>',
    save: '<path d="M5 3h12l3 3v15H4V3h1Zm3 0v6h8V3M8 21v-7h8v7"/>',
    download: '<path d="M12 3v12m-5-5 5 5 5-5M4 20h16"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M7 7l1 14h8l1-14"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V4H4v12h4"/>',
    metronome: '<path d="m9 3 6 18M12 6l7 12H5L12 6Z"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    music: '<path d="M9 18V5l10-2v13M9 9l10-2"/><circle cx="6" cy="18" r="3"/><circle cx="16" cy="16" r="3"/>',
  }[name] || "";
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
};

function newTrack(name, instrument, color, notes = []) {
  return { id: uid(), name, instrument, color, volume: .8, pan: 0, mute: false, solo: false,
    synth: { attack: .01, decay: .2, sustain: .5, release: .25, cutoff: 4200 }, sends: { reverb: instrument === "drum" ? 0 : .18, delay: instrument === "drum" || instrument === "bass" ? 0 : .06 },
    automation: { volume: [{ t: 0, v: .8 }], pan: [{ t: 0, v: 0 }] },
    clips: [{ id: uid(), name: name + " 1", start: 0, length: 64, notes }] };
}

export function defaultMusicDoc() {
  const lead = [[0, 69, 2], [4, 72, 2], [8, 76, 2], [12, 72, 2], [16, 74, 2], [20, 72, 2], [24, 69, 2], [28, 67, 2], [32, 69, 2], [36, 72, 2], [40, 76, 2], [44, 79, 2], [48, 76, 2], [52, 72, 2], [56, 69, 4]].map(([t, pitch, dur]) => ({ t, pitch, dur, vel: .78 }));
  const bass = [0, 8, 16, 24, 32, 40, 48, 56].map((t, i) => ({ t, pitch: [45, 45, 43, 43, 41, 41, 45, 45][i], dur: 4, vel: .65 }));
  const drums = [];
  for (let t = 0; t < 64; t += 8) drums.push({ t, pitch: 36, dur: 1, vel: .9 });
  for (let t = 4; t < 64; t += 8) drums.push({ t, pitch: 38, dur: 1, vel: .62 });
  for (let t = 0; t < 64; t += 2) drums.push({ t, pitch: 42, dur: 1, vel: .24 });
  return { v: 2, name: "未命名作品", bpm: 96, beatsPerBar: 4, key: "C", scale: "major", bars: 4,
    loop: { enabled: true, start: 0, end: 64 }, metronome: false, markers: [{ t: 0, name: "开始" }, { t: 32, name: "B 段" }],
    master: { volume: .85, reverb: .12, delay: .08 },
    tracks: [newTrack("主旋律", "pluck", COLORS[0], lead), newTrack("低音", "bass", COLORS[1], bass), newTrack("鼓组", "drum", COLORS[2], drums)] };
}

function normalize(d) {
  const base = defaultMusicDoc();
  const out = { ...base, ...clone(d || {}) };
  out.bpm = clamp(Math.round(+out.bpm || 96), 40, 240);
  out.beatsPerBar = [3, 4, 5, 6, 7].includes(+out.beatsPerBar) ? +out.beatsPerBar : 4;
  out.bars = clamp(Math.round(+out.bars || 4), 1, 32);
  out.name = String(out.name || "未命名作品").slice(0, 40);
  out.key = Object.keys(KEYS.reduce((o, [k]) => (o[k.replace("#", "")] = 1, o), {})).includes(out.key) ? out.key : "C";
  out.scale = SCALES[out.scale] ? out.scale : "major";
  const total = out.bars * out.beatsPerBar * 4;
  out.loop = { enabled: out.loop?.enabled ?? (typeof out.loop === "boolean" ? out.loop : true),
    start: clamp(Math.round(+out.loop?.start || 0), 0, total - 1),
    end: clamp(Math.round(+out.loop?.end || total), 1, total) };
  if (out.loop.end <= out.loop.start) out.loop.end = Math.min(total, out.loop.start + 1);
  out.master = { volume: clamp(+out.master?.volume ?? .85, 0, 1), reverb: clamp(+out.master?.reverb ?? .12, 0, .7), delay: clamp(+out.master?.delay ?? .08, 0, .65) };
  out.markers = (Array.isArray(out.markers) ? out.markers : base.markers).map((m) => ({ t: clamp(Math.round(+m.t || 0), 0, total - 1), name: String(m.name || "标记").slice(0, 24) })).sort((a, b) => a.t - b.t);
  out.tracks = (Array.isArray(out.tracks) && out.tracks.length ? out.tracks : base.tracks).map((t, i) => {
    const clips = Array.isArray(t.clips) && t.clips.length ? t.clips : [{ id: uid(), name: t.name || "轨道 " + (i + 1), start: 0, length: total, notes: t.notes || [] }];
    return { id: t.id || uid(), name: String(t.name || "轨道 " + (i + 1)).slice(0, 24), instrument: INSTRUMENT_NAMES.some(([k]) => k === t.instrument) ? t.instrument : "piano",
      color: COLORS[i % COLORS.length], volume: clamp(+t.volume ?? .8, 0, 1), pan: clamp(+t.pan ?? 0, -1, 1), mute: !!t.mute, solo: !!t.solo,
      synth: { attack: clamp(+t.synth?.attack ?? .01, .002, 2), decay: clamp(+t.synth?.decay ?? .2, .01, 2), sustain: clamp(+t.synth?.sustain ?? .5, .01, 1), release: clamp(+t.synth?.release ?? .25, .03, 3), cutoff: clamp(+t.synth?.cutoff || 4200, 120, 18000) },
      sends: { reverb: clamp(Number.isFinite(+t.sends?.reverb) ? +t.sends.reverb : (t.instrument === "drum" ? 0 : .18), 0, 1), delay: clamp(Number.isFinite(+t.sends?.delay) ? +t.sends.delay : (t.instrument === "drum" || t.instrument === "bass" ? 0 : .06), 0, 1) },
      automation: { volume: (t.automation?.volume || [{ t: 0, v: clamp(+t.volume ?? .8, 0, 1) }]).map((p) => ({ t: clamp(Math.round(+p.t || 0), 0, total - 1), v: clamp(+p.v || 0, 0, 1) })),
        pan: (t.automation?.pan || [{ t: 0, v: clamp(+t.pan ?? 0, -1, 1) }]).map((p) => ({ t: clamp(Math.round(+p.t || 0), 0, total - 1), v: clamp(+p.v || 0, -1, 1) })) },
      clips: clips.map((c) => ({ id: c.id || uid(), name: String(c.name || "片段").slice(0, 24), start: clamp(Math.round(+c.start || 0), 0, total - 1),
        length: clamp(Math.round(+c.length || 16), 1, total), notes: (c.notes || []).filter((n) => n && Number.isFinite(n.t) && Number.isFinite(n.pitch)).map((n) => ({ t: Math.max(0, Math.round(n.t)), pitch: clamp(Math.round(n.pitch), 24, 108), dur: clamp(Math.round(n.dur || 1), 1, 64), vel: clamp(+n.vel || .8, .05, 1) })) })) };
  });
  return out;
}

function addSectionNotes(beatsPerBar, kind, bars, key, scale) {
  const len = bars * beatsPerBar * 4;
  const root = 60 + KEYS.findIndex(([k]) => k === key) + (scale === "minor" ? 9 : 0);
  const notes = [];
  const push = (t, p, d = 1, v = .75) => notes.push({ t, pitch: p, dur: d, vel: v });
  if (kind === "chords") {
    const degree = [0, 5, 3, 4];
    for (let b = 0; b < bars; b++) {
      const r = root + SCALES[scale][degree[b % 4] % 7];
      for (const interval of [0, 4, 7]) for (const t of [b * 16, b * 16 + 8]) push(t, r + interval, 7, .45);
    }
  } else if (kind === "arp") {
    const order = [0, 2, 4, 2, 0, 4, 2, 4];
    for (let i = 0; i < len / 2; i++) push(i * 2, root + SCALES[scale][order[i % order.length] % 7] + 12, 1, .65);
  } else if (kind === "bass") {
    const degree = [0, 0, 5, 3];
    for (let b = 0; b < bars; b++) { const r = root - 12 + SCALES[scale][degree[b % 4] % 7]; push(b * 16, r, 6, .8); push(b * 16 + 8, r, 6, .7); }
  } else if (kind === "drums") {
    for (let t = 0; t < len; t += 8) push(t, 36, 1, .9);
    for (let t = 4; t < len; t += 8) push(t, 38, 1, .65);
    for (let t = 0; t < len; t += 2) push(t, 42, 1, .25);
  } else if (kind === "melody") {
    const melody = [0, 2, 4, 2, 5, 4, 2, 0];
    for (let i = 0; i < len / 4; i++) push(i * 4, root + 12 + SCALES[scale][melody[i % melody.length] % 7], 3, .78);
  }
  return notes;
}

export function openMusicStudio(E) {
  const old = document.getElementById("musicStudio");
  if (old) { try { old.__api?.close(); } catch { } old.remove(); }
  let doc = normalize(E.state.meta.music || defaultMusicDoc());
  let view = "arrange", trackAt = 0, clipAt = 0, selectedNote = null, currentStep = 0, zoom = 1, closed = false, autoParam = "volume", octave = 0;
  let history = [JSON.stringify(doc)], historyAt = 0, drag = null, autoDrag = null;
  const host = document.createElement("div"); host.id = "musicStudio"; host.className = "music-studio da";
  document.body.appendChild(host);

  host.innerHTML = `<div class="da-head">
      <div class="da-brand">${icon("music")}<input class="da-title" data-project maxlength="40" value="${esc(doc.name)}" aria-label="作品名称"/><span>音乐工作台</span></div>
      <div class="da-transport">
        <button class="da-icon" data-act="rewind" title="回到开头">${icon("rewind")}</button>
        <button class="da-play" data-act="play" title="播放/暂停（空格）">${icon("play")}<span>播放</span></button>
        <button class="da-icon" data-act="stop" title="停止">${icon("stop")}</button>
        <button class="da-icon" data-act="metronome" title="节拍器">${icon("metronome")}</button>
        <output class="da-time" data-time>001 : 01 : 000</output>
      </div>
      <div class="da-actions">
        <button class="da-icon" data-act="undo" title="撤销 Ctrl+Z">${icon("undo")}</button>
        <button class="da-icon" data-act="redo" title="重做 Ctrl+Shift+Z">${icon("redo")}</button>
        <button class="da-btn" data-act="save">${icon("save")}保存</button>
        <button class="da-btn" data-act="wav">${icon("download")}导出 WAV</button>
        <button class="da-btn" data-act="stems">${icon("download")}分轨</button>
        <button class="da-btn" data-act="midi">MIDI</button>
        <button class="da-btn" data-act="export">项目</button>
        <button class="da-icon" data-act="close" title="关闭">${icon("close")}</button>
      </div>
    </div>
    <div class="da-subbar">
      <label>速度<input type="number" min="40" max="240" data-bpm value="${doc.bpm}"/> BPM</label>
      <label>拍号<select data-signature>${[3,4,5,6,7].map((n)=>`<option value="${n}" ${doc.beatsPerBar===n?"selected":""}>${n}/4</option>`).join("")}</select></label>
      <label>调性<select data-key>${KEYS.filter(([k])=>!k.includes("#")).map(([k])=>`<option ${doc.key===k?"selected":""}>${k}</option>`).join("")}</select></label>
      <label>小节<select data-bars>${[2,4,8,16,32].map((n)=>`<option value="${n}" ${doc.bars===n?"selected":""}>${n}</option>`).join("")}</select></label>
      <span class="da-sep"></span>
      <label class="da-check"><input type="checkbox" data-loop ${doc.loop.enabled?"checked":""}/>循环</label>
      <label>起<input type="number" min="1" max="${doc.bars}" data-loop-start value="${doc.loop.start/16+1}"/></label>
      <label>止<input type="number" min="1" max="${doc.bars}" data-loop-end value="${doc.loop.end/16+1}"/></label>
      <span class="da-sep"></span><label>吸附<select data-snap><option value="1">1/16</option><option value="4">1/4</option><option value="16">1 小节</option></select></label>
      <span class="da-grow"></span><label class="da-check"><input type="checkbox" data-bgm ${doc.bgm?"checked":""}/>世界背景音乐</label>
    </div>
    <div class="da-body">
      <aside class="da-library">
        <div class="da-libhead"><b>声音与片段</b><span>浏览器实时合成</span></div>
        <input class="da-search" data-libsearch placeholder="搜索乐器或片段"/>
        <div class="da-libscroll">
          <h4>乐器</h4><div class="da-instruments"></div>
          <h4>一键片段</h4><div class="da-sections"></div>
          <div class="da-help"><b>创作流程</b><p>先在编排页放片段，再点开片段进入钢琴卷帘或鼓机。每个轨道都有独立声像、音量与合成器包络。</p><p>WAV 导出使用离线音频渲染，与实时播放共用同一套调度器。</p></div>
        </div>
      </aside>
      <main class="da-main">
        <div class="da-modebar">
          <div class="da-modes"><button data-view="arrange" class="on">编排</button><button data-view="piano">钢琴卷帘</button><button data-view="drum">鼓机</button><button data-view="automation">自动化</button><button data-view="mixer">调音台</button></div>
          <span class="da-grow"></span><button class="da-small" data-act="addClip">＋ 新片段</button><button class="da-small" data-act="dupClip">复制片段</button><button class="da-small" data-act="delClip">删除片段</button>
        </div>
        <section class="da-pane da-arrange">
          <div class="da-trackheads"></div><div class="da-arrangement"><div class="da-ruler"></div><div class="da-lanes"></div><div class="da-looprange"></div><i class="da-playhead"></i></div>
        </section>
        <section class="da-pane da-piano">
          <div class="da-editorbar"><b data-clipname>片段</b><span data-clipmeta></span><span class="da-grow"></span><label>量化<select data-dur><option value="1">1/16</option><option value="2">1/8</option><option value="4">1/4</option><option value="8">1/2</option><option value="16">1 小节</option></select></label></div>
          <div class="da-pianoscroll"><canvas class="da-pianoroll"></canvas><canvas class="da-velocity"></canvas></div>
        </section>
        <section class="da-pane da-drum"><div class="da-drumleft"><h4>鼓垫</h4><div class="da-pads"></div></div><div class="da-seqwrap"><div class="da-seqhead"><b>16 步音序器</b><span class="da-grow"></span><button class="da-small" data-act="clearDrums">清空鼓点</button></div><div class="da-sequencer"></div></div></section>
        <section class="da-pane da-auto"><div class="da-editorbar"><b>轨道自动化</b><span>点击添加控制点 · Alt 点击删除最近点</span><span class="da-grow"></span><label>参数<select data-auto-param><option value="volume">音量</option><option value="pan">声像</option></select></label><button class="da-small" data-act="clearAuto">清空</button></div><canvas class="da-autocanvas"></canvas></section>
        <section class="da-pane da-mixer"><div class="da-mixerchannels"></div></section>
      </main>
      <aside class="da-inspector">
        <section class="da-card"><h3>当前轨道</h3>
          <label class="da-field">名称<input data-tname maxlength="24"/></label>
          <label class="da-field">乐器<select data-inst>${INSTRUMENT_NAMES.map(([k,n])=>`<option value="${k}">${n}</option>`).join("")}</select></label>
          <div class="da-colorrow">${COLORS.map((c)=>`<button data-color="${c}" style="--c:${c}" title="轨道颜色"></button>`).join("")}</div>
          <label class="da-slide"><span>音量</span><input type="range" min="0" max="100" data-vol/><i data-volv></i></label>
          <label class="da-slide"><span>声像</span><input type="range" min="-100" max="100" data-pan/><i data-panv></i></label>
          <div class="da-buttonrow"><button data-act="mute">M</button><button data-act="solo">S</button><button data-act="delTrack" class="danger">删除轨道</button></div>
        </section>
        <section class="da-card"><h3>合成器</h3>
          <label class="da-slide"><span>起音</span><input type="range" min="2" max="2000" data-synth="attack"/><i data-synthv="attack"></i></label>
          <label class="da-slide"><span>衰减</span><input type="range" min="10" max="2000" data-synth="decay"/><i data-synthv="decay"></i></label>
          <label class="da-slide"><span>延音</span><input type="range" min="1" max="100" data-synth="sustain"/><i data-synthv="sustain"></i></label>
          <label class="da-slide"><span>释音</span><input type="range" min="30" max="3000" data-synth="release"/><i data-synthv="release"></i></label>
          <label class="da-slide"><span>亮度</span><input type="range" min="120" max="18000" data-synth="cutoff"/><i data-synthv="cutoff"></i></label>
        </section>
        <section class="da-card"><h3>选中音符</h3><div class="da-noteinfo" data-noteinfo>在钢琴卷帘里选择音符</div>
          <label class="da-slide"><span>力度</span><input type="range" min="5" max="100" data-vel/><i data-velv></i></label>
          <label class="da-slide"><span>长度</span><input type="range" min="1" max="64" data-dur-note/><i data-durv></i></label>
        </section>
        <section class="da-card"><h3>主输出</h3>
          <label class="da-slide"><span>音量</span><input type="range" min="0" max="100" data-master="volume"/><i data-masterv="volume"></i></label>
          <label class="da-slide"><span>空间</span><input type="range" min="0" max="70" data-master="reverb"/><i data-masterv="reverb"></i></label>
          <label class="da-slide"><span>延迟</span><input type="range" min="0" max="65" data-master="delay"/><i data-masterv="delay"></i></label>
        </section>
      </aside>
    </div>
    <div class="da-status"><span data-status>就绪</span><span class="da-grow"></span><span>空格 播放 · A W S E D F… 演奏 · Z/X 八度 · Ctrl+Z 撤销 · Ctrl+S 保存</span></div>
    <input type="file" accept="application/json,.json" hidden data-file/>`;

  const $ = (s) => host.querySelector(s), $$ = (s) => [...host.querySelectorAll(s)];
  const total = () => doc.bars * doc.beatsPerBar * 4;
  const track = () => doc.tracks[trackAt] || doc.tracks[0];
  const clip = () => track()?.clips[clipAt] || track()?.clips[0];
  const file = $("[data-file]");
  let player = null;
  const resetPlayer = () => { try { player?.dispose(); } catch { } player = createMusicPlayer(doc, { onTick: paintPlayhead, onEnd: transportStopped, onMeter }); };
  let snap = 1, pianoDrag = null, loopDrag = null, meterData = new Map();

  function checkpoint() {
    const s = JSON.stringify(doc);
    if (history[historyAt] !== s) { history = history.slice(0, historyAt + 1); history.push(s); if (history.length > 80) history.shift(); historyAt = history.length - 1; }
    $("[data-act=undo]").disabled = historyAt <= 0; $("[data-act=redo]").disabled = historyAt >= history.length - 1;
  }
  function restoreHistory(dir) {
    historyAt = clamp(historyAt + dir, 0, history.length - 1); doc = normalize(JSON.parse(history[historyAt]));
    trackAt = clamp(trackAt, 0, doc.tracks.length - 1); clipAt = clamp(clipAt, 0, track().clips.length - 1); selectedNote = null;
    resetPlayer(); renderAll(); checkpoint();
  }
  function commit() { checkpoint(); renderAll(); }
  function toast(text, bad = false) { host.dispatchEvent(new CustomEvent("music-toast", { detail: text, bubbles: true })); if (bad) host.dataset.error = "1"; }
  function setStatus(text) { $("[data-status]").textContent = text; }

  function renderAll() {
    $("[data-project]").value = doc.name; $("[data-bpm]").value = doc.bpm; $("[data-signature]").value = doc.beatsPerBar;
    $("[data-key]").value = doc.key; $("[data-bars]").value = doc.bars; $("[data-loop]").checked = doc.loop.enabled;
    $("[data-loop-start]").max = doc.bars; $("[data-loop-end]").max = doc.bars + 1;
    $("[data-loop-start]").value = doc.loop.start / 16 + 1; $("[data-loop-end]").value = doc.loop.end / 16 + 1;
    $("[data-bgm]").checked = !!doc.bgm; $("[data-act=metronome]").classList.toggle("on", doc.metronome);
    renderLibrary(); renderTrackHeads(); renderArrangement(); renderInspector(); renderDrum(); renderMixer(); renderMode(); resizeCanvases();
    setStatus(`${doc.tracks.length} 轨 · ${doc.tracks.reduce((n,t)=>n+t.clips.reduce((m,c)=>m+c.notes.length,0),0)} 个音符 · ${doc.bpm} BPM`);
  }

  function renderLibrary() {
    const q = $("[data-libsearch]").value.trim().toLowerCase();
    const instruments = INSTRUMENT_NAMES.filter(([,n,f]) => !q || (n+f).toLowerCase().includes(q));
    $(".da-instruments").innerHTML = instruments.length ? instruments.map(([id,n,f])=>`<button data-inst="${id}"><i class="da-insticon">${icon("music")}</i><span><b>${esc(n)}</b><small>${esc(f)}</small></span><em>＋</em></button>`).join("") : '<p class="da-empty">没有匹配的乐器</p>';
    const sections = [["melody","旋律动机",2,"pluck"],["chords","四小节和弦",4,"pad"],["arp","琶音推进",2,"pluck"],["bass","律动贝斯",2,"bass"],["drums","经典 Groove",2,"drum"]].filter(([id,n])=>!q||n.includes(q));
    $(".da-sections").innerHTML = sections.map(([id,n,b,inst])=>`<button data-section="${id}" data-bars="${b}" data-inst="${inst}"><span><b>${n}</b><small>${b} 小节 · ${esc(instName(inst))}</small></span><em>＋</em></button>`).join("") || '<p class="da-empty">没有匹配的片段</p>';
  }

  function renderMode() {
    $$("[data-view]").forEach((b)=>b.classList.toggle("on", b.dataset.view===view));
    $(".da-arrange").classList.toggle("on", view==="arrange"); $(".da-piano").classList.toggle("on", view==="piano");
    $(".da-drum").classList.toggle("on", view==="drum"); $(".da-auto").classList.toggle("on", view==="automation"); $(".da-mixer").classList.toggle("on", view==="mixer");
    $("[data-clipname]").textContent = clip()?.name || "没有片段";
    $("[data-clipmeta]").textContent = clip() ? `第 ${clip().start/16+1} 小节 · ${clip().length/16} 小节 · ${clip().notes.length} 个音符` : "先添加一个片段";
  }

  function renderTrackHeads() {
    const heads = $(".da-trackheads"); heads.innerHTML = "";
    doc.tracks.forEach((t,i)=>{
      const row = document.createElement("div"); row.className = "da-trackhead"+(i===trackAt?" on":"");
      row.innerHTML = `<i style="background:${t.color}"></i><span><b>${esc(t.name)}</b><small>${esc(instName(t.instrument))}</small></span><button data-m="${i}" title="静音" class="${t.mute?"on":""}">M</button><button data-s="${i}" title="独奏" class="${t.solo?"on":""}">S</button><button data-add="${i}" title="添加片段">＋</button>`;
      row.onclick = (ev)=>{ if(ev.target.dataset.m!=null){t.mute=!t.mute;commit();return;} if(ev.target.dataset.s!=null){t.solo=!t.solo;commit();return;} if(ev.target.dataset.add!=null){addClip(i);return;} trackAt=i;clipAt=0;selectedNote=null;renderAll(); };
      heads.appendChild(row);
    });
  }

  function renderArrangement() {
    const ruler = $(".da-ruler"), lanes = $(".da-lanes");
    const beats = doc.bars * doc.beatsPerBar;
    ruler.innerHTML = Array.from({length:beats},(_,i)=>`<span style="left:${i/beats*100}%">${i%doc.beatsPerBar===0?`<b>${i/doc.beatsPerBar+1}</b>`:"·"}</span>`).join("");
    for (const marker of doc.markers) { const el=document.createElement("button");el.className="da-marker";el.style.left=`${marker.t/total()*100}%`;el.textContent=marker.name;el.title=`${marker.name} · 第 ${Math.floor(marker.t/16)+1} 小节`;el.onclick=()=>paintPlayhead(marker.t);ruler.appendChild(el); }
    lanes.innerHTML = "";
    doc.tracks.forEach((t,i)=>{
      const lane = document.createElement("div"); lane.className = "da-lane"+(i===trackAt?" on":"");
      for (const c of t.clips) {
        const el = document.createElement("div"); el.className = "da-clip"+(c.id===clip()?.id?" sel":""); el.dataset.clip = c.id;
        el.style.cssText = `left:${c.start/total()*100}%;width:${c.length/total()*100}%;--clip:${t.color}`;
        el.dataset.track=t.id;
        el.innerHTML = `<div class="da-cliptop"><b>${esc(c.name)}</b><span>${c.notes.length}</span></div><canvas class="da-clipmini"></canvas>`;
        el.onpointerdown = (ev)=>{ if(ev.button>0)return; trackAt=i;clipAt=t.clips.indexOf(c);selectedNote=null;ev.stopPropagation();
          const r=el.getBoundingClientRect();const resize=ev.clientX>r.right-9;drag={kind:"clip",el,startX:ev.clientX,start:c.start,length:c.length,resize};
          try{el.setPointerCapture(ev.pointerId);}catch{} renderTrackHeads();renderInspector();renderMode(); };
        el.ondblclick = ()=>{view="piano";renderMode();resizeCanvases();};
        lane.appendChild(el);
      }
      lanes.appendChild(lane);
    });
    const loop = $(".da-looprange");
    loop.style.left = doc.loop.start/total()*100+"%"; loop.style.width = (doc.loop.end-doc.loop.start)/total()*100+"%";
    loop.classList.toggle("off", !doc.loop.enabled);
    requestAnimationFrame(()=>$$(".da-clipmini").forEach(drawClipMini));
  }

  function drawClipMini(c) {
    const r = c.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio||1); if(!r.width)return;
    c.width=Math.round(r.width*dpr);c.height=Math.round(r.height*dpr);const g=c.getContext("2d");g.scale(dpr,dpr);
    const clipId=c.closest(".da-clip")?.dataset.clip;const tr=doc.tracks.find((x)=>x.id===c.closest(".da-clip")?.dataset.track);const cp=tr?.clips.find((x)=>x.id===clipId);if(!cp)return;
    const w=r.width,h=r.height;g.clearRect(0,0,w,h);
    for(let x=0;x<cp.length;x+=4){g.strokeStyle="rgba(255,255,255,.1)";g.beginPath();g.moveTo(x/cp.length*w,0);g.lineTo(x/cp.length*w,h);g.stroke();}
    for(const n of cp.notes){const y=h-(n.pitch-LOW)/(HIGH-LOW)*h;g.fillStyle="rgba(255,255,255,.75)";g.fillRect(n.t/cp.length*w,y-1,Math.max(2,n.dur/cp.length*w-1),2);}
  }

  function renderInspector() {
    const t=track();if(!t)return;
    $("[data-tname]").value=t.name;$("[data-inst]").value=t.instrument;
    $$("[data-color]").forEach((b)=>b.classList.toggle("on",b.dataset.color===t.color));
    $("[data-vol]").value=Math.round(t.volume*100);$("[data-volv]").textContent=Math.round(t.volume*100);
    $("[data-pan]").value=Math.round(t.pan*100);$("[data-panv]").textContent=Math.round(t.pan*100);
    $("[data-act=mute]").classList.toggle("on",t.mute);$("[data-act=solo]").classList.toggle("on",t.solo);
    for(const k of ["attack","decay","sustain","release","cutoff"]){const inp=$(`[data-synth="${k}"]`),out=$(`[data-synthv="${k}"]`);const v=t.synth[k];inp.value=k==="attack"||k==="decay"||k==="release"?Math.round(v*1000):k==="cutoff"?Math.round(v):Math.round(v*100);out.textContent=k==="cutoff"?Math.round(v)+" Hz":k==="attack"||k==="decay"||k==="release"?Math.round(v*1000)+" ms":Math.round(v*100);}
    const n=selectedNote;$("[data-noteinfo]").textContent=n?`${noteName(n.pitch)} · 第 ${n.t+1} 格 · 长 ${n.dur} 格`:"在钢琴卷帘里选择音符";
    $("[data-vel]").disabled=$("[data-dur-note]").disabled=!n;
    if(n){$("[data-vel]").value=Math.round(n.vel*100);$("[data-velv]").textContent=Math.round(n.vel*100);$("[data-dur-note]").value=n.dur;$("[data-durv]").textContent=n.dur;}
    for(const k of ["volume","reverb","delay"]){const inp=$(`[data-master="${k}"]`),out=$(`[data-masterv="${k}"]`);inp.value=Math.round(doc.master[k]*100);out.textContent=Math.round(doc.master[k]*100);}
    $("[data-act=delTrack]").disabled=doc.tracks.length<=1;$("[data-act=dupClip]").disabled=!clip();$("[data-act=delClip]").disabled=!clip();
  }

  function renderDrum() {
    const t=track();const pads=$(".da-pads"),seq=$(".da-sequencer");
    pads.innerHTML=DRUM_NAMES.map(([p,n])=>`<button data-pad="${p}"><span>${esc(n)}</span><small>${noteName(p)}</small></button>`).join("");
    const cp=clip();
    seq.innerHTML=DRUM_NAMES.map(([p,n])=>`<div class="da-seqrow"><b>${esc(n)}</b>${Array.from({length:16},(_,s)=>`<button data-step="${s}" data-pitch="${p}" class="${cp?.notes.some((x)=>x.pitch===p&&x.t===s)?"on":""}"></button>`).join("")}</div>`).join("");
    $(".da-drum").classList.toggle("is-drum",t?.instrument==="drum");
  }

  function renderMixer() {
    const host2=$(".da-mixerchannels");host2.innerHTML="";
    doc.tracks.forEach((t,i)=>{
      const strip=document.createElement("div");strip.className="da-strip"+(i===trackAt?" on":"");
      strip.innerHTML=`<div class="da-striptitle"><i style="background:${t.color}"></i><b>${esc(t.name)}</b><small>${esc(instName(t.instrument))}</small></div>
        <div class="da-stripknobs"><label>PAN<input type="range" min="-100" max="100" value="${Math.round(t.pan*100)}" data-mixpan="${i}"/></label><label>VOL<input type="range" min="0" max="100" value="${Math.round(t.volume*100)}" data-mixvol="${i}"/></label><label>REV<input type="range" min="0" max="100" value="${Math.round(t.sends.reverb*100)}" data-mixsend="reverb:${i}"/></label><label>DLY<input type="range" min="0" max="100" value="${Math.round(t.sends.delay*100)}" data-mixsend="delay:${i}"/></label></div>
        <div class="da-meter"><i data-meter="${t.id}"></i></div><div class="da-buttonrow"><button data-mixmute="${i}" class="${t.mute?"on":""}">M</button><button data-mixsolo="${i}" class="${t.solo?"on":""}">S</button></div>`;
      host2.appendChild(strip);
    });
    const master=document.createElement("div");master.className="da-strip master";
    master.innerHTML=`<div class="da-striptitle"><b>主输出</b><small>Stereo Out</small></div><div class="da-meter"><i data-meter="master"></i></div><label>VOL<input type="range" min="0" max="100" value="${Math.round(doc.master.volume*100)}" data-master="volume"/></label>`;
    host2.appendChild(master);
  }

  function onMeter(id, level) { meterData.set(id, level); const el=$(`[data-meter="${id}"]`); if(el)el.style.height=clamp(level*650,2,100)+"%"; }
  function paintPlayhead(step) {
    currentStep=step;
    const pos=step<0?-9:step/total()*100;
    $(".da-playhead").style.left=pos+"%";$(".da-playhead").style.opacity=step<0?"0":"1";
    const bar=Math.floor(step/16)+1,beat=Math.floor(step%16/4)+1,tick=step%4;
    $("[data-time]").textContent=step<0?"001 : 01 : 000":`${String(bar).padStart(3,"0")} : ${String(beat).padStart(2,"0")} : ${String(tick).padStart(3,"0")}`;
    drawPiano();drawVelocity();drawAutomation();
  }

  function resizeCanvases() {
    const roll=$(".da-pianoroll"),vel=$(".da-velocity");
    if(roll){const r=roll.parentElement.getBoundingClientRect();const dpr=Math.min(2,window.devicePixelRatio||1);roll.width=Math.max(480,Math.round(r.width*dpr));roll.height=Math.round((PAD_TOP+ROWS*ROW_H)*dpr);roll.style.height=(PAD_TOP+ROWS*ROW_H)+"px";roll._dpr=dpr;drawPiano();}
    if(vel){const r=vel.parentElement.getBoundingClientRect();const dpr=Math.min(2,window.devicePixelRatio||1);vel.width=Math.max(480,Math.round(r.width*dpr));vel.height=Math.round(64*dpr);vel.style.height="64px";vel._dpr=dpr;drawVelocity();}
    const auto=$(".da-autocanvas");if(auto){const r=auto.parentElement.getBoundingClientRect(),dpr=Math.min(2,window.devicePixelRatio||1);auto.width=Math.max(480,Math.round(r.width*dpr));auto.height=Math.round(260*dpr);auto.style.height="260px";auto._dpr=dpr;drawAutomation();}
  }
  const PAD_TOP=14;
  function drawPiano() {
    const c=$(".da-pianoroll");if(!c)return;const g=c.getContext("2d"),dpr=c._dpr||1,w=c.width/dpr,h=c.height/dpr,cp=clip();if(!cp)return;
    g.setTransform(dpr,0,0,dpr,0,0);g.clearRect(0,0,w,h);g.fillStyle="#11110f";g.fillRect(0,0,w,h);
    const black=new Set([1,3,6,8,10]),gridW=w-KEY_W,nw=gridW/cp.length;
    for(let row=0;row<ROWS;row++){const pitch=HIGH-row,isBlack=black.has(pitch%12),y=PAD_TOP+row*ROW_H;g.fillStyle=isBlack?"#171715":"#20201d";g.fillRect(KEY_W,y,gridW,ROW_H-1);
      if(pitch%12===0){g.fillStyle="#a9a199";g.font="9px ui-monospace,monospace";g.fillText(noteName(pitch),6,y+9);}
      g.fillStyle=isBlack?"#0b0b0a":"#e8e6e1";g.fillRect(0,y,KEY_W,ROW_H);g.strokeStyle="rgba(0,0,0,.2)";g.strokeRect(0,y,KEY_W,ROW_H);
    }
    for(let s=0;s<=cp.length;s++){g.strokeStyle=s%16===0?"rgba(227,166,60,.35)":s%4===0?"rgba(255,255,255,.13)":"rgba(255,255,255,.045)";g.lineWidth=s%16===0?1:.5;g.beginPath();g.moveTo(KEY_W+s*nw+.5,PAD_TOP);g.lineTo(KEY_W+s*nw+.5,h);g.stroke();if(s<cp.length&&s%16===0){g.fillStyle="rgba(255,255,255,.35)";g.font="9px ui-monospace,monospace";g.fillText(String(s/16+1),KEY_W+s*nw+4,11);}}
    for(const n of cp.notes){if(n.pitch<LOW||n.pitch>HIGH)continue;const y=PAD_TOP+(HIGH-n.pitch)*ROW_H,x=KEY_W+n.t*nw,ww=Math.max(3,n.dur*nw-1);g.fillStyle=track().color;g.globalAlpha=.55+.4*n.vel;g.fillRect(x+.5,y+1,ww,ROW_H-3);g.globalAlpha=1;g.fillStyle="rgba(0,0,0,.18)";g.fillRect(x+.5,y+ROW_H-5,ww,3);if(n===selectedNote){g.strokeStyle="#fff";g.lineWidth=1.4;g.strokeRect(x+.5,y+1,ww,ROW_H-3);}}
    if(currentStep>=clip()?.start&&currentStep<clip().start+cp.length){const x=KEY_W+(currentStep-cp.start)*nw;g.strokeStyle="#e3a63c";g.lineWidth=1;g.beginPath();g.moveTo(x,PAD_TOP);g.lineTo(x,h);g.stroke();}
  }
  function drawVelocity() {
    const c=$(".da-velocity"),cp=clip();if(!c||!cp)return;const g=c.getContext("2d"),dpr=c._dpr||1,w=c.width/dpr,h=c.height/dpr,nw=(w-KEY_W)/cp.length;
    g.setTransform(dpr,0,0,dpr,0,0);g.clearRect(0,0,w,h);g.fillStyle="#161614";g.fillRect(0,0,w,h);g.fillStyle="#0e0e0d";g.fillRect(0,0,KEY_W,h);
    for(const n of cp.notes){const x=KEY_W+n.t*nw,bh=n.vel*(h-12);g.fillStyle=n===selectedNote?"#fff":track().color;g.fillRect(x+1,h-bh-4,Math.max(2,nw-2),bh);}
  }
  function drawAutomation() {
    const c=$(".da-autocanvas"),t=track();if(!c||!t)return;const g=c.getContext("2d"),dpr=c._dpr||1,w=c.width/dpr,h=c.height/dpr;
    g.setTransform(dpr,0,0,dpr,0,0);g.clearRect(0,0,w,h);g.fillStyle="#111314";g.fillRect(0,0,w,h);
    for(let i=0;i<=8;i++){const x=i/8*w;g.strokeStyle=i%2?"rgba(255,255,255,.05)":"rgba(227,166,60,.18)";g.beginPath();g.moveTo(x,0);g.lineTo(x,h);g.stroke();}
    for(let i=0;i<=4;i++){const y=i/4*h;g.strokeStyle="rgba(255,255,255,.07)";g.beginPath();g.moveTo(0,y);g.lineTo(w,y);g.stroke();}
    const points=(t.automation?.[autoParam]||[]).slice().sort((a,b)=>a.t-b.t),yOf=(v)=>autoParam==="pan"?h*(1-(v+1)/2):h*(1-v);
    if(points.length){g.strokeStyle=t.color;g.lineWidth=2;g.beginPath();points.forEach((p,i)=>{const x=p.t/total()*w,y=yOf(p.v);if(!i)g.moveTo(x,y);else g.lineTo(x,y);});g.stroke();}
    for(const p of points){const x=p.t/total()*w,y=yOf(p.v);g.fillStyle=t.color;g.beginPath();g.arc(x,y,5,0,Math.PI*2);g.fill();g.strokeStyle="#fff";g.lineWidth=1;g.stroke();}
    if(currentStep>=0){const x=currentStep/total()*w;g.strokeStyle="rgba(255,255,255,.55)";g.beginPath();g.moveTo(x,0);g.lineTo(x,h);g.stroke();}
  }
  function pianoPoint(ev) {
    const c=$(".da-pianoroll"),r=c.getBoundingClientRect(),dpr=c._dpr||1,w=c.width/dpr,cp=clip();const x=(ev.clientX-r.left)*dpr,y=(ev.clientY-r.top)*dpr;
    const step=clamp(Math.floor((x-KEY_W)/((w-KEY_W)/cp.length)),0,cp.length-1),pitch=clamp(HIGH-Math.floor((y-PAD_TOP)/ROW_H),LOW,HIGH);
    const hit=cp.notes.find((n)=>n.pitch===pitch&&step>=n.t&&step<n.t+n.dur)||null;
    return {x,y,step,pitch,hit};
  }

  function addClip(i=trackAt) {
    const t=doc.tracks[i];const start=doc.loop.start;const length=Math.min(64,total()-start);
    const c={id:uid(),name:t.name+" "+String(t.clips.length+1),start,length,notes:[]};t.clips.push(c);trackAt=i;clipAt=t.clips.length-1;selectedNote=null;checkpoint();renderAll();toast("已添加空白片段");
  }
  function duplicateClip() {
    const t=track(),c=clip();if(!c)return;const start=clamp(c.start+c.length,0,total()-1),length=Math.min(c.length,total()-start);
    const cp={...clone(c),id:uid(),name:c.name+" 副本",start,length};t.clips.push(cp);clipAt=t.clips.length-1;checkpoint();renderAll();
  }
  function deleteClip() {const t=track();if(!clip()||t.clips.length<=1)return;t.clips.splice(clipAt,1);clipAt=Math.max(0,clipAt-1);selectedNote=null;checkpoint();renderAll();}

  function transportStopped() {$("[data-act=play]").classList.remove("playing");$("[data-act=play] span").textContent="播放";paintPlayhead(-1);}
  function stop() { player?.stop(); transportStopped(); }
  function play() { if(player?.playing){stop();return;} resetPlayer();player.play();$("[data-act=play]").classList.add("playing");$("[data-act=play] span").textContent="暂停"; }

  $("[data-libsearch]").oninput=renderLibrary;
  host.addEventListener("click",(ev)=>{
    const b=ev.target.closest("button");if(!b)return;
    if(b.dataset.section){const bars=+b.dataset.bars;const start=doc.loop.start;const c={id:uid(),name:b.querySelector("b").textContent,start,length:Math.min(bars*doc.beatsPerBar*4,total()-start),notes:addSectionNotes(doc.beatsPerBar,b.dataset.section,bars,doc.key,doc.scale)};const i=doc.tracks.length;const t=newTrack(c.name,b.dataset.inst,COLORS[i%COLORS.length]);t.clips=[c];doc.tracks.push(t);trackAt=i;clipAt=0;selectedNote=null;checkpoint();renderAll();return;}
    if(b.dataset.inst){const t=track();t.instrument=b.dataset.inst;checkpoint();renderAll();auditionNote(t.instrument,60,.7,t.synth);return;}
    if(b.dataset.view){view=b.dataset.view;renderAll();return;}
    if(b.dataset.pad){const t=track();if(t.instrument!=="drum"){t.instrument="drum";checkpoint();}const p=+b.dataset.pad;const cp=clip();if(cp){const n={t:currentStep<0?0:currentStep%cp.length,pitch:p,dur:1,vel:.8};cp.notes.push(n);selectedNote=n;checkpoint();renderAll();}auditionNote("drum",p,.8);return;}
    if(b.dataset.step!=null){const cp=clip();if(!cp)return;const s=+b.dataset.step,p=+b.dataset.pitch;const hit=cp.notes.find((n)=>n.t===s&&n.pitch===p);if(hit)cp.notes.splice(cp.notes.indexOf(hit),1);else cp.notes.push({t:s,pitch:p,dur:1,vel:.75});checkpoint();renderAll();return;}
    if(b.dataset.mixmute!=null){const t=doc.tracks[+b.dataset.mixmute];t.mute=!t.mute;commit();return;}
    if(b.dataset.mixsolo!=null){const t=doc.tracks[+b.dataset.mixsolo];t.solo=!t.solo;commit();return;}
    const act=b.dataset.act;
    if(act==="play")play();else if(act==="stop")stop();else if(act==="rewind"){stop();paintPlayhead(0);}
    else if(act==="metronome"){doc.metronome=!doc.metronome;checkpoint();renderAll();}
    else if(act==="undo")restoreHistory(-1);else if(act==="redo")restoreHistory(1);
    else if(act==="save"){stop();E.state.meta.music=clone(doc);E.markDirty&&E.markDirty();checkpoint();toast(`已保存 ${doc.tracks.length} 轨 / ${doc.tracks.reduce((n,t)=>n+t.clips.reduce((m,c)=>m+c.notes.length,0),0)} 个音符`);}
    else if(act==="addClip")addClip();else if(act==="dupClip")duplicateClip();else if(act==="delClip")deleteClip();
    else if(act==="mute"){track().mute=!track().mute;commit();}else if(act==="solo"){track().solo=!track().solo;commit();}
    else if(act==="delTrack"){if(doc.tracks.length<=1)return;doc.tracks.splice(trackAt,1);trackAt=Math.max(0,trackAt-1);clipAt=0;selectedNote=null;checkpoint();renderAll();}
    else if(act==="clearDrums"){const cp=clip();if(cp){cp.notes=[];checkpoint();renderAll();}}
    else if(act==="clearAuto"){const t=track();t.automation=t.automation||{volume:[],pan:[]};t.automation[autoParam]=[{t:0,v:autoParam==="pan"?0:t.volume}];checkpoint();renderAll();}
    else if(act==="export"){const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([JSON.stringify(doc,null,2)],{type:"application/json"}));a.download=(doc.name||"music")+".music.json";a.click();setTimeout(()=>URL.revokeObjectURL(a.href),3000);}
    else if(act==="midi"){const a=document.createElement("a");a.href=URL.createObjectURL(exportMidi(doc));a.download=(doc.name||"music")+".mid";a.click();setTimeout(()=>URL.revokeObjectURL(a.href),3000);toast("MIDI 已导出");}
    else if(act==="close")close();
    else if(act==="wav"){const btn=b;btn.disabled=true;btn.textContent="渲染中…";renderMusicToWav(doc).then((blob)=>{const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=(doc.name||"music")+".wav";a.click();setTimeout(()=>URL.revokeObjectURL(a.href),5000);toast("WAV 已导出");}).catch((e)=>toast("WAV 导出失败："+e.message,true)).finally(()=>{btn.disabled=false;btn.innerHTML=icon("download")+"导出 WAV";});}
    else if(act==="stems"){const btn=b;btn.disabled=true;setStatus("正在逐轨离线渲染…");(async()=>{const files=[];for(let i=0;i<doc.tracks.length;i++){const t=doc.tracks[i];setStatus(`正在渲染 ${i+1}/${doc.tracks.length}：${t.name}`);const blob=await renderMusicToWav(doc,{trackId:t.id});files.push({name:`${String(i+1).padStart(2,"0")}-${t.name.replace(/[\\/:*?"<>|]/g,"_")}.wav`,data:new Uint8Array(await blob.arrayBuffer())});}const zip=await writeZip(files),a=document.createElement("a");a.href=URL.createObjectURL(new Blob([zip],{type:"application/zip"}));a.download=(doc.name||"music")+"-stems.zip";a.click();setTimeout(()=>URL.revokeObjectURL(a.href),8000);toast(`已导出 ${files.length} 条 WAV 分轨`);})().catch((e)=>toast("分轨导出失败："+e.message,true)).finally(()=>{btn.disabled=false;setStatus("分轨导出完成");});}
  });

  $("[data-project]").onchange=(e)=>{doc.name=e.target.value.trim()||"未命名作品";checkpoint();};
  $("[data-bpm]").onchange=(e)=>{doc.bpm=clamp(+e.target.value||96,40,240);checkpoint();renderAll();};
  $("[data-signature]").onchange=(e)=>{doc.beatsPerBar=+e.target.value;doc.bars=Math.max(1,Math.ceil(total()/(doc.beatsPerBar*4)));doc.loop.end=total();checkpoint();renderAll();};
  $("[data-bars]").onchange=(e)=>{doc.bars=+e.target.value;doc.loop.end=total();checkpoint();renderAll();};
  $("[data-loop]").onchange=(e)=>{doc.loop.enabled=e.target.checked;checkpoint();renderAll();};
  $("[data-loop-start]").onchange=(e)=>{doc.loop.start=clamp((+e.target.value-1)*16,0,doc.loop.end-1);checkpoint();renderAll();};
  $("[data-loop-end]").onchange=(e)=>{doc.loop.end=clamp(+e.target.value*16,doc.loop.start+1,total());checkpoint();renderAll();};
  $("[data-snap]").onchange=(e)=>{snap=+e.target.value;};
  $("[data-auto-param]").onchange=(e)=>{autoParam=e.target.value;drawAutomation();};
  $("[data-bgm]").onchange=(e)=>{doc.bgm=e.target.checked;checkpoint();};
  $("[data-tname]").oninput=(e)=>{track().name=e.target.value;renderTrackHeads();renderMixer();};
  $("[data-tname]").onchange=checkpoint;
  $("[data-inst]").onchange=(e)=>{track().instrument=e.target.value;checkpoint();renderAll();auditionNote(track().instrument,60,.7,track().synth);};
  $$("[data-color]").forEach((b)=>b.onclick=()=>{track().color=b.dataset.color;checkpoint();renderAll();});
  $("[data-vol]").oninput=(e)=>{track().volume=+e.target.value/100;const p=track().automation?.volume?.find(x=>x.t===0);if(p)p.v=track().volume;$("[data-volv]").textContent=e.target.value;drawAutomation();};$("[data-vol]").onchange=commit;
  $("[data-pan]").oninput=(e)=>{track().pan=+e.target.value/100;const p=track().automation?.pan?.find(x=>x.t===0);if(p)p.v=track().pan;$("[data-panv]").textContent=e.target.value;drawAutomation();};$("[data-pan]").onchange=commit;
  for(const k of ["attack","decay","sustain","release","cutoff"]){const inp=$(`[data-synth="${k}"]`);inp.oninput=()=>{const v=+inp.value;track().synth[k]=k==="attack"||k==="decay"||k==="release"?v/1000:k==="cutoff"?v:v/100;$(`[data-synthv="${k}"]`).textContent=k==="cutoff"?v+" Hz":k==="attack"||k==="decay"||k==="release"?v+" ms":v;};inp.onchange=checkpoint;}
  $("[data-vel]").oninput=(e)=>{if(!selectedNote)return;selectedNote.vel=+e.target.value/100;$("[data-velv]").textContent=e.target.value;drawPiano();drawVelocity();};$("[data-vel]").onchange=checkpoint;
  $("[data-dur-note]").oninput=(e)=>{if(!selectedNote)return;selectedNote.dur=+e.target.value;drawPiano();};$("[data-dur-note]").onchange=commit;
  for(const k of ["volume","reverb","delay"]){const inp=$(`[data-master="${k}"]`);inp.oninput=()=>{doc.master[k]=+inp.value/100;$(`[data-masterv="${k}"]`).textContent=inp.value;};inp.onchange=checkpoint;}
  host.addEventListener("input",(ev)=>{const i=ev.target.dataset.mixvol,p=ev.target.dataset.mixpan,send=ev.target.dataset.mixsend;if(i!=null){const t=doc.tracks[+i];t.volume=+ev.target.value/100;const q=t.automation?.volume?.find(x=>x.t===0);if(q)q.v=t.volume;}if(p!=null){const t=doc.tracks[+p];t.pan=+ev.target.value/100;const q=t.automation?.pan?.find(x=>x.t===0);if(q)q.v=t.pan;}if(send){const [key,index]=send.split(":");doc.tracks[+index].sends[key]=+ev.target.value/100;}});
  host.addEventListener("change",(ev)=>{if(ev.target.dataset.mixvol!=null||ev.target.dataset.mixpan!=null||ev.target.dataset.mixsend!=null)commit();});

  $(".da-pianoroll").addEventListener("contextmenu",(e)=>e.preventDefault());
  $(".da-pianoroll").addEventListener("pointerdown",(ev)=>{
    if(ev.button>0||!clip())return;const c=$(".da-pianoroll"),r=c.getBoundingClientRect(),dpr=c._dpr||1;const x=(ev.clientX-r.left)*dpr,y=(ev.clientY-r.top)*dpr;
    if(x<KEY_W){const pitch=clamp(HIGH-Math.floor((y-PAD_TOP)/ROW_H),LOW,HIGH);auditionNote(track().instrument,pitch,.8,track().synth);return;}
    const p=pianoPoint(ev),cp=clip();
    if(ev.button===2){if(p.hit){cp.notes.splice(cp.notes.indexOf(p.hit),1);selectedNote=null;checkpoint();renderAll();}return;}
    if(p.hit){selectedNote=p.hit;const right=KEY_W+(p.hit.t+p.hit.dur)*((c.width/dpr-KEY_W)/cp.length);pianoDrag={note:p.hit,dx:p.step-p.hit.t,resize:x>right-7};}
    else{const n={t:Math.round(p.step/snap)*snap,pitch:p.pitch,dur:+$("[data-dur]").value,vel:.8};cp.notes.push(n);selectedNote=n;pianoDrag={note:n,dx:n.t-p.step,resize:false};auditionNote(track().instrument,n.pitch,n.vel,track().synth);}
    try{c.setPointerCapture(ev.pointerId);}catch{}drawPiano();drawVelocity();renderInspector();
  });
  $(".da-pianoroll").addEventListener("pointermove",(ev)=>{if(!pianoDrag)return;const p=pianoPoint(ev),cp=clip(),n=pianoDrag.note;
    if(pianoDrag.resize)n.dur=clamp(p.step-n.t+1,1,cp.length-n.t);else{n.t=clamp(Math.round((p.step-pianoDrag.dx)/snap)*snap,0,cp.length-1);n.pitch=p.pitch;}drawPiano();drawVelocity();renderInspector();});
  const endPiano=()=>{if(!pianoDrag)return;pianoDrag=null;checkpoint();renderAll();};$(".da-pianoroll").addEventListener("pointerup",endPiano);$(".da-pianoroll").addEventListener("pointercancel",endPiano);
  $(".da-velocity").addEventListener("pointerdown",(ev)=>{const cp=clip();if(!cp)return;const c=$(".da-velocity"),r=c.getBoundingClientRect(),x=ev.clientX-r.left,step=clamp(Math.floor((x-KEY_W)/((r.width-KEY_W)/cp.length)),0,cp.length-1);const n=cp.notes.find((x)=>step>=x.t&&step<x.t+x.dur);if(n){selectedNote=n;n.vel=clamp(1-(ev.clientY-r.top)/r.height,.05,1);checkpoint();renderAll();}});
  const autoPoint=(ev)=>{const c=$(".da-autocanvas"),r=c.getBoundingClientRect();return{t:clamp(Math.round((ev.clientX-r.left)/r.width*total()/snap)*snap,0,total()-1),v:autoParam==="pan"?clamp((1-(ev.clientY-r.top)/r.height)*2-1,-1,1):clamp(1-(ev.clientY-r.top)/r.height,0,1),x:ev.clientX-r.left,y:ev.clientY-r.top};};
  $(".da-autocanvas").addEventListener("pointerdown",(ev)=>{if(ev.button>0)return;const t=track();t.automation=t.automation||{volume:[],pan:[]};const arr=t.automation[autoParam]||(t.automation[autoParam]=[]),p=autoPoint(ev);let hit=null,best=12;for(const q of arr){const x=q.t/total()*ev.currentTarget.getBoundingClientRect().width,y=(autoParam==="pan"?(1-(q.v+1)/2):1-q.v)*ev.currentTarget.getBoundingClientRect().height,d=Math.hypot(x-p.x,y-p.y);if(d<best){best=d;hit=q;}}if(ev.altKey&&hit){arr.splice(arr.indexOf(hit),1);checkpoint();renderAll();return;}if(!hit){hit={t:p.t,v:p.v};arr.push(hit);}autoDrag=hit;try{ev.currentTarget.setPointerCapture(ev.pointerId);}catch{}drawAutomation();});
  $(".da-autocanvas").addEventListener("pointermove",(ev)=>{if(!autoDrag)return;const p=autoPoint(ev);autoDrag.t=p.t;autoDrag.v=p.v;drawAutomation();});
  const endAuto=()=>{if(!autoDrag)return;autoDrag=null;checkpoint();renderAll();};$(".da-autocanvas").addEventListener("pointerup",endAuto);$(".da-autocanvas").addEventListener("pointercancel",endAuto);

  $(".da-looprange").addEventListener("pointerdown",(ev)=>{ev.stopPropagation();const el=ev.currentTarget,r=el.getBoundingClientRect();loopDrag={x:ev.clientX,start:doc.loop.start,end:doc.loop.end,mode:ev.clientX<r.left+8?"left":ev.clientX>r.right-8?"right":"move"};try{el.setPointerCapture(ev.pointerId);}catch{}});
  host.addEventListener("pointermove",(ev)=>{if(!drag&&!loopDrag)return;const stepsPerPx=total()/$(".da-arrangement").getBoundingClientRect().width;
    if(loopDrag){const d=Math.round((ev.clientX-loopDrag.x)*stepsPerPx);if(loopDrag.mode==="move"){const len=loopDrag.end-loopDrag.start;doc.loop.start=clamp(loopDrag.start+d,0,total()-len);doc.loop.end=doc.loop.start+len;}else if(loopDrag.mode==="left")doc.loop.start=clamp(loopDrag.start+d,0,doc.loop.end-1);else doc.loop.end=clamp(loopDrag.end+d,doc.loop.start+1,total());renderArrangement();return;}
    if(drag?.kind==="clip"){const t=track(),c=t.clips[clipAt];if(drag.resize)c.length=clamp(Math.round((drag.length+(ev.clientX-drag.startX)*stepsPerPx)/snap)*snap,1,total()-c.start);else c.start=clamp(Math.round((drag.start+(ev.clientX-drag.startX)*stepsPerPx)/snap)*snap,0,total()-1);renderArrangement();}
  });
  host.addEventListener("pointerup",()=>{if(loopDrag||drag){loopDrag=null;drag=null;checkpoint();renderAll();}});

  file.onchange=async()=>{const f=file.files?.[0];file.value="";if(!f)return;try{stop();doc=normalize(JSON.parse(await f.text()));trackAt=0;clipAt=0;selectedNote=null;resetPlayer();checkpoint();renderAll();toast("项目已导入");}catch{toast("这份项目 JSON 读不出来",true);}};
  const close=()=>{if(closed)return;closed=true;stop();player?.dispose();window.removeEventListener("keydown",onKey);window.removeEventListener("resize",resizeCanvases);host.remove();E.closeMusic&&E.closeMusic();};
  function onKey(ev){const mod=ev.ctrlKey||ev.metaKey,editing=/INPUT|SELECT|TEXTAREA/.test(ev.target.tagName);if(mod&&ev.key.toLowerCase()==="z"){ev.preventDefault();restoreHistory(ev.shiftKey?1:-1);}else if(mod&&ev.key.toLowerCase()==="s"){ev.preventDefault();$("[data-act=save]").click();}else if(ev.code==="Space"&&!editing){ev.preventDefault();play();}else if((ev.key==="Delete"||ev.key==="Backspace")&&selectedNote&&!editing){ev.preventDefault();const cp=clip();cp.notes.splice(cp.notes.indexOf(selectedNote),1);selectedNote=null;checkpoint();renderAll();}else if(ev.key==="Escape")close();else if(!editing&&!mod&&!ev.repeat){const k=ev.key.toLowerCase();if(k==="z"||k==="x"){octave=clamp(octave+(k==="z"?-12:12),-24,24);toast(`键盘八度 ${octave>=0?"+":""}${octave}`);return;}const semitone=KEYMAP[k];if(semitone==null)return;const t=track(),pitch=clamp(60+octave+semitone,24,108);auditionNote(t.instrument,pitch,.8,t.synth);const cp=clip();if(player?.playing&&cp){const n={t:currentStep<0?0:currentStep%cp.length,pitch,dur:+$("[data-dur]").value,vel:.8};cp.notes.push(n);selectedNote=n;drawPiano();drawVelocity();renderInspector();checkpoint();}}}
  window.addEventListener("keydown",onKey);window.addEventListener("resize",resizeCanvases);
  E.markMusicOpen?.(true);resetPlayer();renderAll();checkpoint();
  const api={close,doc:()=>doc,setDoc:(d)=>{doc=normalize(d);checkpoint();renderAll();}};host.__api=api;window.__musicStudio=api;return api;
}
