import { liveAvatar } from "./skin-rig.js";
import { MC_PRESETS, presetUrl, readSkinFile } from "./skin-sheet.js";

const DEFAULT = { skin: "#e7b98f", shirt: "#d5a24a", pants: "#2b3440", hair: "#2a211d", shoe: "#eee9df" };
const PALETTE = ["#e7b98f", "#f4d3b3", "#c9956c", "#8f5d3b", "#513421", "#2a211d", "#d5a24a", "#f0c874", "#2f7f86", "#235c63", "#2b3440", "#3c4958", "#eee9df", "#d94f5f", "#6fbf8b", "#5aa8e8", "#a06bff", "#ff7ab8", "#1c1c1e", "#6b4630"];
const PARTS = [
  ["head", "头部", [[0, 0, 32, 16], [32, 0, 40, 16]]],
  ["body", "躯干", [[16, 16, 24, 16], [16, 32, 24, 16]]],
  ["armR", "右臂", [[32, 16, 16, 16], [40, 32, 16, 16]]],
  ["armL", "左臂", [[32, 48, 16, 16], [48, 48, 16, 16]]],
  ["legR", "右腿", [[0, 16, 16, 16], [0, 32, 16, 16]]],
  ["legL", "左腿", [[16, 48, 16, 16], [0, 48, 16, 16]]],
];
const ICONS = {
  pencil: '<path d="m4 16 1-5L16 0l4 4L9 15l-5 1Z"/><path d="m13 6 4 4"/>',
  eraser: '<path d="m3 12 8-8 9 9-6 6H8l-5-5Z"/><path d="m8 8 9 9M11 19h10"/>',
  fill: '<path d="M4 4h8v8H4z"/><path d="m12 12 7 7M15 4h5v5"/>',
  picker: '<path d="m14 3 7 7M12 5l7 7-8 8-7-7 8-8Z"/><path d="M5 13c-3 0-4 2-4 5 0 2 1 3 3 3 3 0 5-1 5-4"/>',
  line: '<path d="M4 20 20 4"/><circle cx="4" cy="20" r="2"/><circle cx="20" cy="4" r="2"/>',
  rect: '<rect x="4" y="5" width="16" height="14" rx="1"/>',
  undo: '<path d="M9 5 4 10l5 5"/><path d="M5 10h8a6 6 0 0 1 0 12"/>',
  redo: '<path d="m15 5 5 5-5 5"/><path d="M19 10h-8a6 6 0 0 0 0 12"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 20h16"/>',
  upload: '<path d="M12 16V4m-5 5 5-5 5 5M4 20h16"/>',
  reset: '<path d="M4 10a8 8 0 1 1 1 8"/><path d="M4 4v6h6"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
};
const icon = (name) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ""}</svg>`;
const clone = (v) => JSON.parse(JSON.stringify(v || {}));
const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const hex = (v, d = DEFAULT.skin) => (/^#[0-9a-fA-F]{6}$/.test(String(v)) ? String(v).toLowerCase() : d);
const rgba = (c) => { const n = parseInt(c.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255, 255]; };
const shade = (c, k) => {
  const [r, g, b] = rgba(c);
  return "#" + [r, g, b].map((x) => Math.max(0, Math.min(255, Math.round(x * k))).toString(16).padStart(2, "0")).join("");
};

function cross(g, u, v, w, h, d, color) {
  g.fillStyle = color;
  g.fillRect(u + d, v, w, d);
  g.fillRect(u + w + d, v, w, d);
  g.fillRect(u, v + d, d, h);
  g.fillRect(u + d, v + d, w, h);
  g.fillRect(u + w + d, v + d, d, h);
  g.fillRect(u + w + 2 * d, v + d, w, h);
}

function generateAtlas(skin) {
  const c = document.createElement("canvas"); c.width = c.height = 64;
  const g = c.getContext("2d"); g.imageSmoothingEnabled = false;
  const C = { skin: hex(skin.skin), shirt: hex(skin.shirt), pants: hex(skin.pants), hair: hex(skin.hair), shoe: hex(skin.shoe) };
  cross(g, 0, 0, 8, 8, 8, C.skin);
  cross(g, 16, 16, 8, 12, 4, C.shirt);
  cross(g, 32, 16, 4, 12, 4, C.shirt);
  cross(g, 32, 48, 4, 12, 4, C.shirt);
  cross(g, 0, 16, 4, 12, 4, C.pants);
  cross(g, 16, 48, 4, 12, 4, C.pants);
  g.fillStyle = C.hair; g.fillRect(8, 0, 8, 8); g.fillRect(0, 8, 8, 8); g.fillRect(24, 8, 8, 8);
  g.fillStyle = shade(C.hair, .62); g.fillRect(8, 4, 8, 4); g.fillRect(0, 12, 8, 4);
  g.fillStyle = "#26313a"; g.fillRect(9, 10, 2, 1); g.fillRect(13, 10, 2, 1);
  g.fillStyle = "#fff8e9"; g.fillRect(9, 10, 1, 1); g.fillRect(13, 10, 1, 1);
  g.fillStyle = shade(C.skin, .82); g.fillRect(11, 13, 2, 1);
  g.fillStyle = "#2f7f86"; g.fillRect(20, 20, 8, 12); g.fillRect(44, 22, 4, 3); g.fillRect(44, 54, 4, 3);
  g.fillStyle = shade(C.shirt, .72); g.fillRect(36, 22, 4, 2); g.fillRect(36, 54, 4, 2); g.fillRect(4, 22, 4, 2); g.fillRect(20, 54, 4, 2);
  g.fillStyle = C.skin; g.fillRect(36, 24, 4, 6); g.fillRect(44, 24, 4, 6); g.fillRect(36, 56, 4, 6); g.fillRect(44, 56, 4, 6);
  g.fillStyle = shade(C.pants, .72); g.fillRect(4, 24, 4, 4); g.fillRect(20, 56, 4, 4);
  g.fillStyle = C.shoe; g.fillRect(4, 28, 4, 4); g.fillRect(20, 60, 4, 4);
  g.fillStyle = shade(C.shoe, .35); g.fillRect(4, 32, 4, 4); g.fillRect(20, 64, 4, 0);
  return c;
}

function loadImage(src) {
  return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = src; });
}

export function openSkinStudio(options = {}) {
  const old = document.getElementById("skinStudio");
  if (old) { old.__skinStudio?.close(); old.remove(); }
  const host = document.createElement("div");
  host.id = "skinStudio";
  document.body.appendChild(host);
  return mountSkinStudio(host, options);
}

export function mountSkinStudio(host, options = {}) {
  const draft = Object.assign({}, DEFAULT, clone(options.skin || {}));
  const name = String(options.name || draft.name || "未命名皮肤").slice(0, 24);
  let preview = null, closed = false, tool = "pencil", brush = 1, color = draft.shirt, part = "head", zoom = 7;
  let textureOn = !!draft.texture, drawing = false, start = null, last = null, dirty = false;
  const atlas = generateAtlas(draft);
  const actx = atlas.getContext("2d", { willReadFrequently: true });
  let history = [], hAt = 0;

  host.className = "skin-studio";
  host.innerHTML = `<div class="ss-head">
      <div class="ss-title"><b>皮肤工作台</b><span>64 × 64 像素贴图 · 实时 3D 试穿</span></div>
      <div class="ss-head-actions">
        <button class="ss-btn" data-act="import">${icon("upload")}导入</button>
        <button class="ss-btn" data-act="export">${icon("download")}导出 PNG</button>
        <button class="ss-btn primary" data-act="save">保存皮肤</button>
        ${options.onPublish ? '<button class="ss-btn" data-act="publish">发布到社区</button>' : ""}
        <button class="ss-icon" data-act="close" aria-label="关闭">${icon("close")}</button>
      </div>
    </div>
    <div class="ss-body">
      <aside class="ss-tools" aria-label="绘图工具">
        ${[["pencil", "画笔 B"], ["eraser", "橡皮 E"], ["fill", "填充 G"], ["picker", "吸色 I"], ["line", "直线 L"], ["rect", "矩形 R"]].map(([k, t]) => `<button class="ss-tool on" data-tool="${k}" title="${t}">${icon(k)}</button>`).join("")}
        <span class="ss-sep"></span>
        <button class="ss-tool" data-act="undo" title="撤销 Ctrl+Z">${icon("undo")}</button>
        <button class="ss-tool" data-act="redo" title="重做 Ctrl+Shift+Z">${icon("redo")}</button>
      </aside>
      <section class="ss-work">
        <div class="ss-workbar">
          <div class="ss-parts">${PARTS.map(([k, t]) => `<button data-part="${k}">${t}</button>`).join("")}</div>
          <label class="ss-check"><input type="checkbox" data-lock checked/>限定当前部件</label>
        </div>
        <div class="ss-stage">
          <div class="ss-paper"><canvas class="ss-atlas" width="64" height="64" aria-label="64×64 皮肤展开图"></canvas></div>
        </div>
        <div class="ss-status">
          <span data-pos>像素 —</span><span>画笔 <b data-brush>1</b> px</span>
          <label>大小 <input type="range" min="1" max="4" value="1" data-size/></label>
          <span class="ss-grow"></span><button data-zoom="-">−</button><b data-zoomv>700%</b><button data-zoom="+">＋</button><button data-act="fit">适应</button>
        </div>
      </section>
      <aside class="ss-inspect">
        <section class="ss-card">
          <h3>实时试穿</h3>
          <div class="ss-preview"></div>
          <label class="ss-switch"><input type="checkbox" data-texture ${textureOn ? "checked" : ""}/>使用像素贴图</label>
        </section>
        <section class="ss-card">
          <h3>外观配色</h3>
          <div class="ss-colors">${[["skin", "肤色"], ["shirt", "上衣"], ["pants", "裤子"], ["hair", "头发"], ["shoe", "鞋子"]].map(([k, t]) => `<label><span>${t}</span><input type="color" data-color="${k}" value="${hex(draft[k])}"/></label>`).join("")}</div>
          <div class="ss-palette">${PALETTE.map((c) => `<button data-swatch="${c}" style="--sw:${c}" aria-label="${c}"></button>`).join("")}</div>
          <label class="ss-current"><i></i><input type="color" data-current value="${color}"/><span>当前画笔颜色</span></label>
        </section>
        <section class="ss-card">
          <h3>体型</h3>
          ${[["h", "身高"], ["w", "宽窄"], ["leg", "腿长"]].map(([k, t]) => `<label class="ss-slide"><span>${t}</span><input type="range" min="80" max="125" value="${Math.round((draft.body?.[k] || 1) * 100)}" data-body="${k}"/><i>${(draft.body?.[k] || 1).toFixed(2)}</i></label>`).join("")}
        </section>
        <section class="ss-card">
          <h3>皮肤</h3>
          <label class="ss-field">名称<input maxlength="24" data-name value="${esc(name)}"/></label>
          <div class="ss-presets">${MC_PRESETS.map((p) => `<button data-preset="${p.file}">${p.name}</button>`).join("")}<button data-act="reset">${icon("reset")}按配色重建</button></div>
        </section>
      </aside>
    </div>`;
  const $ = (s) => host.querySelector(s);
  const $$ = (s) => [...host.querySelectorAll(s)];
  const view = $(".ss-atlas"), vctx = view.getContext("2d");
  const fileInput = document.createElement("input");
  fileInput.type = "file"; fileInput.accept = "image/png"; fileInput.hidden = true; host.appendChild(fileInput);

  const snapshot = () => new ImageData(new Uint8ClampedArray(actx.getImageData(0, 0, 64, 64).data), 64, 64);
  const checkpoint = () => {
    history = history.slice(0, hAt + 1);
    history.push(snapshot());
    if (history.length > 60) history.shift();
    hAt = history.length - 1;
    paintUndo();
  };
  const restore = (data) => { actx.putImageData(data, 0, 0); dirty = true; textureOn = true; $("[data-texture]").checked = true; paint(); queuePreview(); };
  const paintUndo = () => { $('[data-act="undo"]').disabled = hAt <= 0; $('[data-act="redo"]').disabled = hAt >= history.length - 1; };
  const inPart = (x, y) => {
    if (!$("[data-lock]").checked) return true;
    const rects = PARTS.find(([k]) => k === part)?.[2] || [];
    return rects.some(([rx, ry, rw, rh]) => x >= rx && y >= ry && x < rx + rw && y < ry + rh);
  };
  const pixel = (x, y, erase = false) => {
    if (x < 0 || y < 0 || x >= 64 || y >= 64 || !inPart(x, y)) return;
    if (erase) actx.clearRect(x, y, brush, brush);
    else { actx.fillStyle = color; actx.fillRect(x, y, brush, brush); }
  };
  const line = (a, b, erase = false) => {
    let x0 = a.x, y0 = a.y; const x1 = b.x, y1 = b.y;
    const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1, dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      pixel(x0, y0, erase);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err; if (e2 >= dy) { err += dy; x0 += sx; } if (e2 <= dx) { err += dx; y0 += sy; }
    }
  };
  const flood = (x, y, erase = false) => {
    if (!inPart(x, y)) return;
    const img = actx.getImageData(0, 0, 64, 64), data = img.data;
    const at = (xx, yy) => (yy * 64 + xx) * 4;
    const from = Array.from(data.slice(at(x, y), at(x, y) + 4));
    const to = erase ? [0, 0, 0, 0] : rgba(color);
    if (from.every((v, i) => v === to[i])) return;
    const stack = [[x, y]], seen = new Uint8Array(4096);
    while (stack.length) {
      const [xx, yy] = stack.pop(); if (xx < 0 || yy < 0 || xx >= 64 || yy >= 64 || !inPart(xx, yy)) continue;
      const id = yy * 64 + xx; if (seen[id]) continue; seen[id] = 1;
      const p = at(xx, yy);
      if (![0, 1, 2, 3].every((i) => data[p + i] === from[i])) continue;
      data.set(to, p);
      stack.push([xx + 1, yy], [xx - 1, yy], [xx, yy + 1], [xx, yy - 1]);
    }
    actx.putImageData(img, 0, 0);
  };
  const point = (ev) => { const r = view.getBoundingClientRect(); return { x: Math.floor((ev.clientX - r.left) * 64 / r.width), y: Math.floor((ev.clientY - r.top) * 64 / r.height) }; };
  const paint = () => {
    vctx.clearRect(0, 0, 64, 64); vctx.drawImage(atlas, 0, 0);
    vctx.strokeStyle = "rgba(255,255,255,.09)"; vctx.lineWidth = .08;
    for (let i = 1; i < 64; i++) { vctx.beginPath(); vctx.moveTo(i, 0); vctx.lineTo(i, 64); vctx.moveTo(0, i); vctx.lineTo(64, i); vctx.stroke(); }
    const rects = PARTS.find(([k]) => k === part)?.[2] || [];
    vctx.strokeStyle = "#e3a63c"; vctx.lineWidth = .22;
    for (const [x, y, w, h] of rects) vctx.strokeRect(x + .15, y + .15, w - .3, h - .3);
    if (start && last && (tool === "line" || tool === "rect")) {
      vctx.strokeStyle = color; vctx.lineWidth = Math.max(.3, brush); vctx.setLineDash([1, 1]);
      vctx.beginPath();
      if (tool === "line") { vctx.moveTo(start.x + .5, start.y + .5); vctx.lineTo(last.x + .5, last.y + .5); }
      else vctx.rect(start.x + .5, start.y + .5, last.x - start.x, last.y - start.y);
      vctx.stroke(); vctx.setLineDash([]);
    }
    $("[data-pos]").textContent = `像素 ${last ? last.x + "," + last.y : "—"}`;
  };
  let previewTimer = 0;
  const currentSkin = () => {
    const out = clone(draft); out.name = $("[data-name]").value.trim() || "未命名皮肤";
    if (textureOn) out.texture = atlas.toDataURL("image/png"); else delete out.texture;
    return out;
  };
  const queuePreview = () => {
    clearTimeout(previewTimer); previewTimer = setTimeout(() => {
      if (closed || !preview) return;
      preview.set(currentSkin());
    }, 120);
  };
  const setTool = (k) => { tool = k; $$("[data-tool]").forEach((b) => b.classList.toggle("on", b.dataset.tool === k)); };
  const setColor = (c) => { color = hex(c); $("[data-current]").value = color; $(".ss-current i").style.background = color; };
  const setZoom = (z) => { zoom = Math.max(3, Math.min(12, z)); view.style.width = view.style.height = (64 * zoom) + "px"; $("[data-zoomv]").textContent = Math.round(zoom * 100) + "%"; };
  const fit = () => { const r = $(".ss-stage").getBoundingClientRect(); setZoom(Math.max(3, Math.min(10, Math.floor((Math.min(r.width, r.height) - 48) / 64)))); };
  const loadAtlas = async (src) => {
    try {
      const im = await loadImage(src);
      actx.clearRect(0, 0, 64, 64); actx.imageSmoothingEnabled = false; actx.drawImage(im, 0, 0, 64, 64);
      textureOn = true; $("[data-texture]").checked = true; history = []; hAt = 0; history.push(snapshot()); paintUndo(); paint(); queuePreview();
    } catch { host.dispatchEvent(new CustomEvent("studio-toast", { detail: "这张皮肤图读不出来", bubbles: true })); }
  };

  $$("[data-tool]").forEach((b) => b.onclick = () => setTool(b.dataset.tool));
  $$("[data-part]").forEach((b) => b.onclick = () => { part = b.dataset.part; $$("[data-part]").forEach((x) => x.classList.toggle("on", x === b)); paint(); });
  $("[data-part]").classList.add("on");
  $$("[data-swatch]").forEach((b) => b.onclick = () => setColor(b.dataset.swatch));
  $("[data-current]").oninput = (e) => setColor(e.target.value);
  $$("[data-color]").forEach((inp) => inp.oninput = () => { draft[inp.dataset.color] = inp.value; queuePreview(); });
  $$("[data-body]").forEach((inp) => inp.oninput = () => { draft.body = Object.assign({}, draft.body, { [inp.dataset.body]: Number(inp.value) / 100 }); inp.nextElementSibling.textContent = (Number(inp.value) / 100).toFixed(2); queuePreview(); });
  $("[data-texture]").onchange = (e) => { textureOn = e.target.checked; queuePreview(); };
  $("[data-size]").oninput = (e) => { brush = Number(e.target.value); $("[data-brush]").textContent = brush; };
  $$('[data-zoom="-"], [data-zoom="+"]').forEach((b) => b.onclick = () => setZoom(zoom + Number(b.dataset.zoom)));
  $('[data-act="fit"]').onclick = fit;
  $('[data-act="undo"]').onclick = () => { if (hAt > 0) restore(history[--hAt]); paintUndo(); };
  $('[data-act="redo"]').onclick = () => { if (hAt < history.length - 1) restore(history[++hAt]); paintUndo(); };
  $$("[data-preset]").forEach((b) => b.onclick = () => loadAtlas(presetUrl(b.dataset.preset)));
  $('[data-act="reset"]').onclick = () => { checkpoint(); const fresh = generateAtlas(draft); actx.clearRect(0, 0, 64, 64); actx.drawImage(fresh, 0, 0); textureOn = true; $("[data-texture]").checked = true; paint(); queuePreview(); };
  $('[data-act="import"]').onclick = () => fileInput.click();
  fileInput.onchange = async () => {
    const f = fileInput.files?.[0]; fileInput.value = ""; if (!f) return;
    try { const read = await readSkinFile(f); await loadAtlas(read.dataUrl); } catch (e) { host.dispatchEvent(new CustomEvent("studio-toast", { detail: e.message, bubbles: true })); }
  };
  $('[data-act="export"]').onclick = () => {
    const a = document.createElement("a"); a.href = atlas.toDataURL("image/png"); a.download = ($("[data-name]").value.trim() || "skin") + ".png"; a.click();
  };
  const save = async () => {
    const btn = $('[data-act="save"]'); btn.disabled = true; btn.textContent = "保存中…";
    try {
      const png = await (await fetch(atlas.toDataURL("image/png"))).blob();
      await options.onSave?.({ skin: currentSkin(), png });
      dirty = false; host.dispatchEvent(new CustomEvent("studio-saved", { detail: currentSkin(), bubbles: true }));
    } catch (e) { host.dispatchEvent(new CustomEvent("studio-toast", { detail: e.message || "保存失败", bubbles: true })); }
    finally { btn.disabled = false; btn.textContent = "保存皮肤"; }
  };
  $('[data-act="save"]').onclick = save;
  const pub = $('[data-act="publish"]'); if (pub) pub.onclick = async () => {
    pub.disabled = true;
    try { await options.onPublish?.(currentSkin()); } catch (e) { host.dispatchEvent(new CustomEvent("studio-toast", { detail: e.message || "发布失败", bubbles: true })); pub.disabled = false; }
  };
  const close = () => {
    if (closed) return; closed = true; clearTimeout(previewTimer); if (preview) preview.stop();
    window.removeEventListener("keydown", onKey); host.classList.remove("show"); options.onClose?.();
  };
  $('[data-act="close"]').onclick = close;

  view.addEventListener("contextmenu", (e) => e.preventDefault());
  view.addEventListener("pointerdown", (ev) => {
    if (ev.button > 0) return; ev.preventDefault(); try { view.setPointerCapture?.(ev.pointerId); } catch { }
    const p = point(ev); last = p; start = p; drawing = true;
    if (tool === "picker") { const d = actx.getImageData(p.x, p.y, 1, 1).data; if (d[3]) setColor("#" + [d[0], d[1], d[2]].map((x) => x.toString(16).padStart(2, "0")).join("")); setTool("pencil"); drawing = false; return; }
    checkpoint();
    if (tool === "fill") { flood(p.x, p.y, ev.shiftKey); drawing = false; dirty = true; textureOn = true; $("[data-texture]").checked = true; paint(); queuePreview(); return; }
    if (tool === "pencil" || tool === "eraser") pixel(p.x, p.y, tool === "eraser");
    paint();
  });
  view.addEventListener("pointermove", (ev) => {
    const p = point(ev); last = p;
    if (!drawing) { paint(); return; }
    if (tool === "pencil" || tool === "eraser") line(last || p, p, tool === "eraser");
    last = p; start = start || p; dirty = true; textureOn = true; $("[data-texture]").checked = true; paint();
  });
  const endDraw = () => {
    if (!drawing) return; drawing = false;
    if ((tool === "line" || tool === "rect") && start && last) {
      if (tool === "line") line(start, last);
      else for (let x = Math.min(start.x, last.x); x <= Math.max(start.x, last.x); x++) { pixel(x, start.y); pixel(x, last.y); }
      for (let y = Math.min(start.y, last.y); y <= Math.max(start.y, last.y); y++) { pixel(start.x, y); pixel(last.x, y); }
    }
    start = null; dirty = true; textureOn = true; $("[data-texture]").checked = true; paint(); queuePreview();
  };
  view.addEventListener("pointerup", endDraw); view.addEventListener("pointercancel", endDraw);
  const onKey = (ev) => {
    const mod = ev.ctrlKey || ev.metaKey;
    if (mod && ev.key.toLowerCase() === "z") { ev.preventDefault(); $(ev.shiftKey ? '[data-act="redo"]' : '[data-act="undo"]').click(); return; }
    if (ev.key === "Escape") { ev.preventDefault(); close(); return; }
    if (/INPUT|TEXTAREA|SELECT/.test(ev.target.tagName)) return;
    const map = { b: "pencil", e: "eraser", g: "fill", i: "picker", l: "line", r: "rect" };
    if (map[ev.key.toLowerCase()]) setTool(map[ev.key.toLowerCase()]);
    if (ev.key === "[") { brush = Math.max(1, brush - 1); $("[data-size]").value = brush; $("[data-brush]").textContent = brush; }
    if (ev.key === "]") { brush = Math.min(4, brush + 1); $("[data-size]").value = brush; $("[data-brush]").textContent = brush; }
  };
  window.addEventListener("keydown", onKey);

  history.push(snapshot()); paintUndo(); setColor(color); setZoom(zoom); paint();
  if (draft.texture) loadAtlas(draft.texture);
  requestAnimationFrame(() => { if (closed) return; fit(); preview = liveAvatar($(".ss-preview"), currentSkin(), { w: 220, h: 260, animate: false }); });
  host.classList.add("show");
  const api = { close, getSkin: currentSkin, host };
  host.__skinStudio = api;
  return api;
}
