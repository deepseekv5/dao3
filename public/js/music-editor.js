import { createMusicPlayer, auditionNote, INSTRUMENT_NAMES } from "./music-synth.js";

const clone = (v) => JSON.parse(JSON.stringify(v || {}));
const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const LOW = 36, HIGH = 96, ROWS = HIGH - LOW + 1, PAD_TOP = 14, ROW_H = 11, MIN_STEPS = 16;
const TRACK_COLORS = ["#e3a63c", "#5aa8e8", "#6fbf8b", "#d94f5f", "#a06bff", "#12b5c9"];

export function defaultMusicDoc() {
  const mk = (name, instrument, color, notes, volume = .8) => ({ id: Math.random().toString(36).slice(2, 8), name, instrument, color, volume, muted: false, notes });
  const lead = [[0, 69, 2], [4, 72, 2], [8, 76, 2], [12, 72, 2], [16, 74, 2], [20, 72, 2], [24, 69, 2], [28, 67, 2], [32, 69, 2], [36, 72, 2], [40, 76, 2], [44, 79, 2], [48, 76, 2], [52, 72, 2], [56, 69, 4]].map(([t, pitch, dur]) => ({ t, pitch, dur, vel: .78 }));
  const bass = [0, 8, 16, 24, 32, 40, 48, 56].map((t, i) => ({ t, pitch: [45, 45, 43, 43, 41, 41, 45, 45][i], dur: 4, vel: .65 }));
  const drums = [];
  for (let t = 0; t < 64; t += 8) drums.push({ t, pitch: 36, dur: 1, vel: .9 });
  for (let t = 4; t < 64; t += 8) drums.push({ t, pitch: 60, dur: 1, vel: .6 });
  for (let t = 0; t < 64; t += 2) drums.push({ t, pitch: 84, dur: 1, vel: .22 });
  return {
    v: 1, bpm: 96, bars: 4, loop: true, bgm: false,
    tracks: [
      mk("主旋律", "pluck", TRACK_COLORS[0], lead, .85),
      mk("低音", "bass", TRACK_COLORS[1], bass, .7),
      mk("鼓组", "drum", TRACK_COLORS[2], drums, .55),
    ],
  };
}

export function openMusicStudio(E) {
  const old = document.getElementById("musicStudio");
  if (old) { try { old.__api?.close(); } catch { } old.remove(); }
  const doc = normalize(E.state.meta.music || defaultMusicDoc());
  const host = document.createElement("div");
  host.id = "musicStudio"; host.className = "music-studio";
  document.body.appendChild(host);
  const player = createMusicPlayer(doc, { onTick: (step) => paintPlayhead(step), onEnd: () => transportStopped() });
  let trackAt = 0, selected = null, drag = null, playStep = -1, closed = false;

  host.innerHTML = `<div class="ss-head">
      <div class="ss-title"><b>音乐工作台</b><span>16 分音符钢琴卷帘 · Web Audio 实时合成</span></div>
      <div class="ss-head-actions">
        <button class="ss-btn" data-act="play">播放</button>
        <button class="ss-btn" data-act="stop" disabled>停止</button>
        <button class="ss-btn" data-act="import">导入</button>
        <button class="ss-btn" data-act="export">导出 JSON</button>
        <button class="ss-btn primary" data-act="save">保存到这张图</button>
        <button class="ss-icon" data-act="close" aria-label="关闭">×</button>
      </div>
    </div>
    <div class="me-body">
      <aside class="me-tracks">
        <div class="me-sidehead"><b>轨道</b><button data-act="addTrack">新增</button></div>
        <div class="me-tracklist"></div>
        <div class="me-tip">左键画音符，拖动移动；右键删除。网格每格 1/16 拍。</div>
      </aside>
      <section class="me-work">
        <div class="me-toolbar">
          <label>速度 <input type="number" min="40" max="240" value="${doc.bpm}" data-bpm/> BPM</label>
          <label>小节 <select data-bars>${[2, 4, 8, 16].map((n) => `<option value="${n}" ${Number(doc.bars) === n ? "selected" : ""}>${n}</option>`).join("")}</select></label>
          <label class="me-check"><input type="checkbox" data-loop ${doc.loop ? "checked" : ""}/>循环</label>
          <label class="me-check"><input type="checkbox" data-bgm ${doc.bgm ? "checked" : ""}/>作为这张图的背景音乐</label>
          <span class="me-grow"></span><span class="me-read" data-read>第 1 拍</span>
        </div>
        <div class="me-stage"><canvas class="me-roll" aria-label="钢琴卷帘"></canvas><i class="me-playhead"></i></div>
        <div class="me-status"><span data-count></span><span class="me-grow"></span><span>Ctrl+Z 撤销 · Delete 删除 · Space 播放/停止</span></div>
      </section>
      <aside class="me-inspect">
        <section class="ss-card"><h3>当前轨道</h3>
          <label class="ss-field">名称<input data-tname maxlength="16"/></label>
          <label class="ss-field">乐器<select data-inst>${INSTRUMENT_NAMES.map(([k, n]) => `<option value="${k}">${n}</option>`).join("")}</select></label>
          <label class="ss-slide"><span>音量</span><input type="range" min="0" max="100" data-vol/><i data-volv></i></label>
          <label class="ss-switch"><input type="checkbox" data-mute/>静音这条</label>
          <button class="ss-btn me-del" data-act="delTrack">删除轨道</button>
        </section>
        <section class="ss-card"><h3>选中的音符</h3>
          <div data-noteinfo class="me-noteinfo">还没有选中音符</div>
          <label class="ss-slide"><span>力度</span><input type="range" min="10" max="100" data-vel/><i data-velv></i></label>
          <label class="ss-slide"><span>长度</span><input type="range" min="1" max="16" data-dur/><i data-durv></i></label>
        </section>
        <section class="ss-card"><h3>合成器</h3>
          <p class="me-synthcopy">全部声音由浏览器实时合成：不依赖采样包，也不会把授权音频带进项目。试听与游玩使用同一套合成器。</p>
        </section>
      </aside>
    </div>
    <input type="file" accept="application/json,.json" hidden data-file/>`;
  const $ = (s) => host.querySelector(s), $$ = (s) => [...host.querySelectorAll(s)];
  const roll = $(".me-roll"), ctx2d = roll.getContext("2d"), file = $("[data-file]");
  const track = () => doc.tracks[trackAt];
  const steps = () => Math.max(MIN_STEPS, Number(doc.bars) * 16);
  const noteW = () => roll.getBoundingClientRect().width / steps();
  const noteH = () => ROW_H;
  const noteAt = (x, y) => {
    const t = track(); if (!t) return null;
    const step = Math.floor(x / noteW());
    const pitch = HIGH - Math.floor((y - PAD_TOP) / ROW_H);
    return (t.notes || []).find((n) => n.pitch === pitch && step >= n.t && step < n.t + (n.dur || 1)) || null;
  };
  function normalize(d) {
    const out = Object.assign(defaultMusicDoc(), clone(d));
    out.tracks = (Array.isArray(d && d.tracks) && d.tracks.length ? d.tracks : defaultMusicDoc().tracks).map((t, i) => ({
      id: t.id || Math.random().toString(36).slice(2, 8),
      name: String(t.name || "轨道 " + (i + 1)).slice(0, 16),
      instrument: INSTRUMENT_NAMES.some(([k]) => k === t.instrument) ? t.instrument : "piano",
      color: TRACK_COLORS[i % TRACK_COLORS.length],
      volume: Math.max(0, Math.min(1, Number(t.volume ?? .8))),
      muted: !!t.muted,
      notes: (t.notes || []).filter((n) => n && Number.isFinite(n.t) && Number.isFinite(n.pitch)).map((n) => ({
        t: Math.max(0, Math.round(n.t)), pitch: Math.max(24, Math.min(96, Math.round(n.pitch))),
        dur: Math.max(1, Math.min(32, Math.round(n.dur || 1))), vel: Math.max(.05, Math.min(1, Number(n.vel || .8))),
      })),
    }));
    out.bpm = Math.max(40, Math.min(240, Number(out.bpm) || 96));
    out.bars = Math.max(2, Math.min(16, Number(out.bars) || 4));
    return out;
  }
  function paintPlayhead(step) {
    playStep = step;
    const line = $(".me-playhead");
    line.style.left = step < 0 ? "-9px" : (PAD_TOP ? 0 : 0) + step * noteW() + "px";
    line.style.opacity = step < 0 ? "0" : "1";
    $("[data-read]").textContent = step < 0 ? "第 1 拍" : `第 ${Math.floor(step / 16) + 1} 小节 · 第 ${(step % 16) + 1} 格`;
  }
  function resize() {
    const r = roll.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    roll.width = Math.max(320, Math.round(r.width * dpr));
    roll.height = Math.round((PAD_TOP + ROWS * ROW_H) * dpr);
    roll.style.height = (PAD_TOP + ROWS * ROW_H) + "px";
    ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
    paint(); paintPlayhead(playStep);
  }
  function paint() {
    const w = roll.getBoundingClientRect().width, h = PAD_TOP + ROWS * ROW_H;
    ctx2d.clearRect(0, 0, w, h);
    ctx2d.fillStyle = "#10100f"; ctx2d.fillRect(0, 0, w, h);
    const nw = w / steps(), black = new Set([1, 3, 6, 8, 10]);
    for (let row = 0; row < ROWS; row++) {
      const pitch = HIGH - row;
      const isBlack = black.has(pitch % 12);
      ctx2d.fillStyle = isBlack ? "#161615" : "#1c1b19";
      ctx2d.fillRect(0, PAD_TOP + row * ROW_H, w, ROW_H - 1);
      ctx2d.fillStyle = pitch % 12 === 0 ? "#5c554a" : "#3d3832";
      ctx2d.font = "9px ui-monospace,monospace"; ctx2d.fillText("C" + (Math.floor(pitch / 12) - 1), 4, PAD_TOP + row * ROW_H + 10);
    }
    for (let s = 0; s <= steps(); s++) {
      ctx2d.strokeStyle = s % 16 === 0 ? "rgba(227,166,60,.32)" : s % 4 === 0 ? "rgba(255,255,255,.12)" : "rgba(255,255,255,.045)";
      ctx2d.lineWidth = s % 16 === 0 ? 1 : .5;
      ctx2d.beginPath(); ctx2d.moveTo(s * nw + .5, PAD_TOP); ctx2d.lineTo(s * nw + .5, h); ctx2d.stroke();
      if (s < steps() && s % 16 === 0) { ctx2d.fillStyle = "rgba(255,255,255,.28)"; ctx2d.font = "9px ui-monospace,monospace"; ctx2d.fillText(String(s / 16 + 1), s * nw + 4, 11); }
    }
    ctx2d.strokeStyle = "rgba(255,255,255,.06)"; ctx2d.beginPath(); ctx2d.moveTo(0, PAD_TOP); ctx2d.lineTo(w, PAD_TOP); ctx2d.stroke();
    for (const tr of doc.tracks) {
      if (tr.muted) continue;
      for (const n of tr.notes) {
        if (n.pitch < LOW || n.pitch > HIGH) continue;
        const y = PAD_TOP + (HIGH - n.pitch) * ROW_H;
        const x = n.t * nw, ww = Math.max(3, (n.dur || 1) * nw - 1);
        ctx2d.fillStyle = tr.color;
        ctx2d.globalAlpha = .55 + .35 * (n.vel || .8);
        ctx2d.fillRect(x + .5, y + 2, ww, ROW_H - 4);
        ctx2d.globalAlpha = 1;
        if (tr === track() && selected === n) { ctx2d.strokeStyle = "#fff"; ctx2d.lineWidth = 1.4; ctx2d.strokeRect(x + .5, y + 2, ww, ROW_H - 4); }
        ctx2d.fillStyle = "rgba(0,0,0,.18)"; ctx2d.fillRect(x + .5, y + ROW_H - 6, ww, 3);
      }
    }
    if (drawingPreview()) {
      const n = drag.preview, tr = track();
      const y = PAD_TOP + (HIGH - n.pitch) * ROW_H, x = n.t * nw;
      ctx2d.strokeStyle = tr.color; ctx2d.lineWidth = 1.5; ctx2d.strokeRect(x + .5, y + 2, Math.max(3, n.dur * nw - 1), ROW_H - 4);
    }
    const t = track();
    $("[data-count]").textContent = `${t ? t.notes.length : 0} 个音符 · ${doc.tracks.length} 条轨道`;
  }
  const drawingPreview = () => drag && drag.preview;
  function paintTracks() {
    const list = $(".me-tracklist"); list.replaceChildren();
    doc.tracks.forEach((t, i) => {
      const row = document.createElement("button");
      row.className = "me-track" + (i === trackAt ? " on" : "");
      row.innerHTML = `<i style="background:${t.color}"></i><span><b>${esc(t.name)}</b><small>${esc((INSTRUMENT_NAMES.find(([k]) => k === t.instrument) || [, t.instrument])[1])} · ${t.notes.length}</small></span><em data-mute="${i}" title="静音">${t.muted ? "静音" : ""}</em>`;
      row.onclick = (ev) => { if (ev.target.dataset.mute != null) return; trackAt = i; selected = null; paintTracks(); paintInspector(); paint(); };
      row.querySelector("[data-mute]").onclick = (ev) => { ev.stopPropagation(); t.muted = !t.muted; paintTracks(); paint(); };
      list.appendChild(row);
    });
    $("[data-act='delTrack']").disabled = doc.tracks.length <= 1;
  }
  function paintInspector() {
    const t = track(); if (!t) return;
    $("[data-tname]").value = t.name;
    $("[data-inst]").value = t.instrument;
    $("[data-vol]").value = Math.round((t.volume ?? .8) * 100); $("[data-volv]").textContent = Math.round((t.volume ?? .8) * 100);
    $("[data-mute]").checked = !!t.muted;
    const n = selected;
    $("[data-noteinfo]").textContent = n ? `${["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"][n.pitch % 12]}${Math.floor(n.pitch / 12) - 1} · 第 ${n.t + 1} 格 · 长 ${n.dur} 格` : "还没有选中音符";
    $("[data-vel]").disabled = $("[data-dur]").disabled = !n;
    if (n) { $("[data-vel]").value = Math.round(n.vel * 100); $("[data-velv]").textContent = Math.round(n.vel * 100); $("[data-dur]").value = n.dur; $("[data-durv]").textContent = n.dur; }
  }
  function changed() { paintTracks(); paint(); paintInspector(); }
  function snap(ev) {
    const r = roll.getBoundingClientRect();
    const step = Math.max(0, Math.min(steps() - 1, Math.floor((ev.clientX - r.left) / (r.width / steps()))));
    const pitch = HighClamp(HIGH - Math.floor((ev.clientY - r.top - PAD_TOP) / ROW_H));
    return { step, pitch };
  }
  const HighClamp = (p) => Math.max(LOW, Math.min(HIGH, p));

  roll.addEventListener("contextmenu", (e) => e.preventDefault());
  roll.addEventListener("pointerdown", (ev) => {
    if (ev.button === 2) {
      const p = snap(ev), hit = noteAt(ev.clientX - roll.getBoundingClientRect().left, ev.clientY - roll.getBoundingClientRect().top);
      if (hit) { const t = track(); t.notes.splice(t.notes.indexOf(hit), 1); selected = null; changed(); }
      return;
    }
    if (ev.button > 0) return;
    const r = roll.getBoundingClientRect();
    const hit = noteAt(ev.clientX - r.left, ev.clientY - r.top);
    const p = snap(ev);
    if (hit) { selected = hit; drag = { note: hit, dx: p.step - hit.t, preview: null }; }
    else {
      const n = { t: p.step, pitch: p.pitch, dur: 1, vel: .8 };
      const t = track(); t.notes.push(n); selected = n; drag = { note: n, dx: 0, preview: null };
      auditionNote(t.instrument, n.pitch, n.vel);
    }
    try { roll.setPointerCapture(ev.pointerId); } catch { }
    paintInspector(); paint();
  });
  roll.addEventListener("pointermove", (ev) => {
    if (!drag) return;
    const p = snap(ev);
    drag.note.t = Math.max(0, Math.min(steps() - 1, p.step - drag.dx));
    drag.note.pitch = p.pitch;
    paint(); paintInspector();
  });
  const endDrag = () => { if (!drag) return; drag = null; changed(); };
  roll.addEventListener("pointerup", endDrag); roll.addEventListener("pointercancel", endDrag);

  $("[data-bpm]").oninput = (e) => { doc.bpm = Math.max(40, Math.min(240, Number(e.target.value) || 96)); paint(); };
  $("[data-bars]").onchange = (e) => { doc.bars = Number(e.target.value); selected = null; paint(); };
  $("[data-loop]").onchange = (e) => { doc.loop = e.target.checked; };
  $("[data-bgm]").onchange = (e) => { doc.bgm = e.target.checked; };
  $("[data-tname]").oninput = (e) => { track().name = e.target.value.slice(0, 16); paintTracks(); };
  $("[data-inst]").onchange = (e) => { track().instrument = e.target.value; changed(); };
  $("[data-vol]").oninput = (e) => { track().volume = Number(e.target.value) / 100; $("[data-volv]").textContent = e.target.value; };
  $("[data-mute]").onchange = (e) => { track().muted = e.target.checked; paintTracks(); paint(); };
  $("[data-vel]").oninput = (e) => { if (!selected) return; selected.vel = Number(e.target.value) / 100; $("[data-velv]").textContent = e.target.value; paint(); paintInspector(); };
  $("[data-dur]").oninput = (e) => { if (!selected) return; selected.dur = Number(e.target.value); $("[data-durv]").textContent = e.target.value; paint(); paintInspector(); };
  $("[data-act='addTrack']").onclick = () => {
    const i = doc.tracks.length;
    doc.tracks.push({ id: Math.random().toString(36).slice(2, 8), name: "轨道 " + (i + 1), instrument: "piano", color: TRACK_COLORS[i % TRACK_COLORS.length], volume: .8, muted: false, notes: [] });
    trackAt = doc.tracks.length - 1; selected = null; changed();
  };
  $("[data-act='delTrack']").onclick = () => {
    if (doc.tracks.length <= 1) return;
    doc.tracks.splice(trackAt, 1); trackAt = Math.max(0, trackAt - 1); selected = null; changed();
  };
  function transportStopped() { $("[data-act='play']").disabled = false; $("[data-act='stop']").disabled = true; paintPlayhead(-1); }
  const stop = () => { player.stop(); transportStopped(); };
  $("[data-act='play']").onclick = () => { player.play(); $("[data-act='play']").disabled = true; $("[data-act='stop']").disabled = false; };
  $("[data-act='stop']").onclick = stop;
  $("[data-act='export']").onclick = () => {
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([JSON.stringify(doc, null, 2)], { type: "application/json" }));
    a.download = "music.json"; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  };
  $("[data-act='import']").onclick = () => file.click();
  file.onchange = async () => {
    const f = file.files?.[0]; file.value = ""; if (!f) return;
    try { Object.assign(doc, normalize(JSON.parse(await f.text()))); trackAt = 0; selected = null; $("[data-bpm]").value = doc.bpm; $("[data-bars]").value = doc.bars; $("[data-bgm]").checked = doc.bgm; changed(); }
    catch { host.dispatchEvent(new CustomEvent("music-toast", { detail: "这份 JSON 读不出来", bubbles: true })); }
  };
  $("[data-act='save']").onclick = () => {
    stop();
    E.state.meta.music = clone(doc);
    E.markDirty && E.markDirty();
    host.dispatchEvent(new CustomEvent("music-toast", { detail: `已保存 ${doc.tracks.length} 轨 / ${doc.tracks.reduce((n, t) => n + t.notes.length, 0)} 个音符`, bubbles: true }));
  };
  const close = () => { if (closed) return; closed = true; stop(); player.dispose(); window.removeEventListener("keydown", onKey); window.removeEventListener("resize", resize); host.remove(); E.closeMusic && E.closeMusic(); };
  $("[data-act='close']").onclick = close;
  const onKey = (ev) => {
    if (ev.code === "Space" && !/INPUT|SELECT|TEXTAREA/.test(ev.target.tagName)) { ev.preventDefault(); player.playing ? stop() : $("[data-act='play']").click(); }
    if ((ev.key === "Delete" || ev.key === "Backspace") && selected) { ev.preventDefault(); const t = track(); t.notes.splice(t.notes.indexOf(selected), 1); selected = null; changed(); }
    if (ev.key === "Escape") close();
  };
  window.addEventListener("keydown", onKey);
  window.addEventListener("resize", resize);
  E.markMusicOpen?.(true);
  requestAnimationFrame(() => { resize(); paintTracks(); paintInspector(); });
  const api = { close, doc };
  host.__api = api;
  window.__musicStudio = api;
  return api;
}
