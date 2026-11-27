// pack.js — 「代码包」tab：一张图的全部素材文件管理。
//
// 仿的是官方 dao3.fun 编辑器的文件管理面板：左边分类带计数、底部储存空间进度，
// 右边表格每行是「文件名 + 第二行 IPFS CID + 大小 + 缩略图 + ⋮ 菜单」，右下 + 上传。
//
// 为什么值得单独做一个 tab 而不是塞进现有面板：官方包里的模型**只带名字不带文件**
// （名字下面那个 hash 才是内容地址）。之前我们导入完就只剩一串名字，用户看着
// "导入成功但画面是空的"却无能为力。这里把 CID 明明白白列出来，并且给一条
// 「按 CID 取回」的路，缺的东西才有救回来的可能。
//
// 默认**不联网**：取回资源表、取回单个文件都是用户点一下才发生的动作。

const CATS = [
  { key: "model", name: "模型", icon: "M12 2 3 7v10l9 5 9-5V7z", match: (p) => /^models?\//i.test(p) },
  { key: "picture", name: "图片", icon: "M4 5h16v14H4zM8 11l3 3 2-2 3 4", match: (p) => /^(pictures?|images?)\//i.test(p) && !/\/snow\//i.test(p) },
  { key: "part", name: "纹理", icon: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z", match: (p) => /^parts?\//i.test(p) || /\/snow\//i.test(p) },
  { key: "lut", name: "滤镜", icon: "M12 3a9 9 0 100 18 4.5 4.5 0 000-9 4.5 4.5 0 010-9z", match: (p) => /^luts?\//i.test(p) },
  { key: "script", name: "脚本", icon: "M9 7l-5 5 5 5M15 7l5 5-5 5", match: () => false },
  { key: "audio", name: "音频", icon: "M4 9v6h4l5 4V5L8 9zM17 8a5 5 0 010 8", match: (p) => /^audios?\//i.test(p) || /^sounds?\//i.test(p) },
  { key: "trash", name: "回收站", icon: "M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13", match: (p) => /^trash\//i.test(p) },
];
const QUOTA = 100 * 1024 * 1024;   // 官方面板显示 100.00MB，照抄这个上限
const apiBlock = (hash) => `/api/official-block/${encodeURIComponent(hash)}`;

// 这一屏的表格是拼 innerHTML 的，而里面**每一段文字都不可信**：文件名来自用户
// 上传、CID 与资源表键名来自官方网关的远端 JSON。少转义一处就是一个存储型 XSS，
// 所以统一走 esc()，包括塞进属性值里的（引号能逃出属性）。
const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const kb = (n) => (n >= 1024 * 1024 ? (n / 1048576).toFixed(2) + "MB" : (n / 1024).toFixed(2) + "KB");
const base = (p) => p.split("/").pop();
const svg = (d) => `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`;

let E = null;
let cat = "model";
let query = "";
let files = [];
let menu = null;
let preview = null;

function closeMenu() { menu?.remove(); menu = null; }
function closePreview() {
  if (!preview) return;
  const p = preview;
  preview = null;
  try { p.cleanup?.(); } catch {}
  p.el.remove();
}

const extOf = (p) => (base(p).split(".").pop() || "").toLowerCase();
const isImage = (p) => ["png", "jpg", "jpeg", "webp", "gif", "bmp", "svg"].includes(extOf(p));
const isAudio = (p) => ["mp3", "wav", "ogg", "m4a", "aac", "flac"].includes(extOf(p));
const isModel = (p) => ["glb", "gltf", "vox", "vb", "bin"].includes(extOf(p));
const canPreview = (p) => isImage(p) || isAudio(p) || isModel(p);

function idxOf(path) {
  const t = E.state.meta.assetIndex;
  if (!t || typeof t !== "object") return null;
  const name = base(path);
  // 官方资源表按 "mesh/1048.vb"、"audio/jump.mp3" 这种「目录/文件名」存键，
  // 而我们落盘的路径是 models/1048.vb。目录名对不上，只能按文件名认。
  for (const k of Object.keys(t)) if (base(k) === name || base(k).replace(/\.\w+$/, "") === name.replace(/\.\w+$/, "")) return t[k];
  return null;
}

async function refresh() {
  closePreview();
  const id = E.worldId;
  try {
    const r = await fetch(`/api/world/${encodeURIComponent(id)}/asset`);
    files = (await r.json()).files || [];
  } catch (e) { files = []; E.toast("读不到素材清单：" + (e.message || e)); }
  render();
}

function rows() {
  const c = CATS.find((x) => x.key === cat);
  if (cat === "script") {
    return (E.state.scripts || []).map((s) => ({ path: "code/" + s.name, bytes: new Blob([s.code || ""]).size, script: s.name }));
  }
  const all = files.filter((f) => (cat === "trash" ? f.path.startsWith("trash/") : c.match(f.path) && !f.path.startsWith("trash/")));
  const q = query.trim().toLowerCase();
  return q ? all.filter((f) => f.path.toLowerCase().includes(q)) : all;
}

/** 官方资源表的目录名 → 我们落盘用的目录名。 */
function normKey(k) {
  return String(k).replace(/^mesh\//i, "models/").replace(/^audios?\//i, "audio/")
    .replace(/^(pictures?|images?|ui)\//i, "pictures/").replace(/^luts?\//i, "luts/")
    .replace(/^(parts?|snow)\//i, "parts/");
}

/**
 * 资源表里有、但本地没有的文件。
 *
 * 这一条是「按 CID 取回」能不能用起来的关窍：以前列表只列**磁盘上已有**的文件，
 * 于是最需要取回的东西（就是缺的那些）根本没有行可以点，功能等于只给已存在的文件
 * 又下了一遍。官方包恰恰是"只带名字不带本体"，缺的才是主体。
 */
function remoteRows() {
  const t = E.state.meta.assetIndex;
  if (!t || typeof t !== "object") return [];
  const have = new Set(files.map((f) => base(f.path).toLowerCase()));
  const out = [];
  for (const [k, v] of Object.entries(t)) {
    if (!v || typeof v !== "object" || !v.hash) continue;
    const path = normKey(k);
    if (have.has(base(path).toLowerCase())) continue;
    out.push({ path, bytes: Number(v.size) || 0, remote: true, hash: String(v.hash) });
  }
  return out;
}

function thumb(f) {
  const name = base(f.path);
  const ext = name.split(".").pop().toLowerCase();
  if (isImage(f.path)) {
    return `<img src="${esc(assetUrl(f.path))}" alt="" loading="lazy"/>`;
  }
  if (isAudio(f.path)) return `<span class="pk-audio">♪</span>`;
  if (["js", "json"].includes(ext)) return `<span class="pk-code">${ext.toUpperCase()}</span>`;
  if (isModel(f.path)) return `<span class="pk-vb">3D</span>`;
  return `<span class="pk-vb">${name.slice(0, 2)}</span>`;
}

function previewShell(path) {
  closePreview();
  const el = document.createElement("div");
  el.className = "pk-preview";
  el.innerHTML = `<div class="pk-preview-card" role="dialog" aria-modal="true">
    <header><span class="pk-preview-name">${esc(base(path))}</span><span class="pk-preview-path">${esc(path)}</span><button class="pk-preview-close" title="关闭">×</button></header>
    <div class="pk-preview-body"></div>
  </div>`;
  document.body.appendChild(el);
  const cleanupFns = [];
  const escKey = (ev) => { if (ev.key === "Escape") closePreview(); };
  window.addEventListener("keydown", escKey);
  cleanupFns.push(() => window.removeEventListener("keydown", escKey));
  el.onclick = (ev) => { if (ev.target === el) closePreview(); };
  el.querySelector(".pk-preview-close").onclick = closePreview;
  preview = { el, cleanup: () => cleanupFns.forEach((fn) => fn()) };
  return { body: el.querySelector(".pk-preview-body"), cleanupFns };
}

async function openPreview(path) {
  if (!canPreview(path)) return E.toast("这种文件没有预览", true);
  const { body, cleanupFns } = previewShell(path);
  const session = preview;
  if (isImage(path)) {
    const img = document.createElement("img");
    img.className = "pk-preview-image"; img.src = assetUrl(path); img.alt = base(path);
    img.onerror = () => { body.innerHTML = '<p class="pk-preview-error">图片读取失败</p>'; };
    body.appendChild(img);
    return;
  }
  if (isAudio(path)) {
    const audio = document.createElement("audio");
    audio.controls = true; audio.autoplay = true; audio.src = assetUrl(path);
    const wave = document.createElement("canvas");
    wave.className = "pk-preview-wave"; wave.width = 960; wave.height = 200;
    body.append(audio, wave);
    cleanupFns.push(() => { audio.pause(); audio.removeAttribute("src"); audio.load(); });
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const data = await ctx.decodeAudioData(await (await fetch(assetUrl(path))).arrayBuffer());
      if (preview !== session) { ctx.close(); return; }
      const g = wave.getContext("2d"), ch = data.getChannelData(0), step = Math.max(1, Math.floor(ch.length / wave.width));
      g.fillStyle = "#1b1b19"; g.fillRect(0, 0, wave.width, wave.height);
      g.strokeStyle = "#e3a63c"; g.lineWidth = 1; g.beginPath();
      for (let x = 0; x < wave.width; x++) {
        let peak = 0;
        for (let i = x * step; i < Math.min(ch.length, (x + 1) * step); i += 16) peak = Math.max(peak, Math.abs(ch[i]));
        const y = peak * (wave.height * .46);
        g.moveTo(x + .5, wave.height / 2 - y); g.lineTo(x + .5, wave.height / 2 + y);
      }
      g.stroke();
      ctx.close();
    } catch { /* 解码失败时仍保留原生播放器 */ }
    return;
  }
  body.innerHTML = '<p class="pk-preview-loading">正在解析模型…</p>';
  try {
    const THREE = await import("../vendor/three/three.module.js");
    const { OrbitControls } = await import("../vendor/three/OrbitControls.js");
    if (preview !== session) return;
    const canvas = document.createElement("canvas");
    canvas.className = "pk-preview-canvas";
    body.innerHTML = ""; body.appendChild(canvas);
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x4a4038, 2.2));
    const sun = new THREE.DirectionalLight(0xfff2dd, 2.4);
    sun.position.set(4, 8, 6); scene.add(sun);
    const camera = new THREE.PerspectiveCamera(45, 1, .01, 500);
    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true; controls.autoRotate = true; controls.autoRotateSpeed = 1.4;
    let object;
    const ext = extOf(path);
    if (ext === "glb" || ext === "gltf") {
      const { GLTFLoader } = await import("../vendor/three/GLTFLoader.js");
      const buf = await (await fetch(assetUrl(path))).arrayBuffer();
      const gltf = await new Promise((res, rej) => new GLTFLoader().parse(buf, "", res, rej));
      object = gltf.scene;
    } else if (ext === "bin") {
      const { buildBoxModel } = await import("./box-model.js");
      object = buildBoxModel(new Uint8Array(await (await fetch(assetUrl(path))).arrayBuffer()));
    } else if (ext === "vox") {
      const { decodeVox } = await import("./world.js");
      const { voxListToModel } = await import("./features.js");
      object = voxListToModel(decodeVox(new Uint8Array(await (await fetch(assetUrl(path))).arrayBuffer())), E.atlas);
    } else {
      const { vbToVoxList } = await import("./vb.js");
      const { voxListToModel } = await import("./features.js");
      const list = vbToVoxList(JSON.parse(await (await fetch(assetUrl(path))).text()), E.atlas.list());
      object = voxListToModel(list.voxels, E.atlas);
    }
    const box = new THREE.Box3().setFromObject(object);
    if (preview !== session) { renderer.dispose(); return; }
    const size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
    object.position.set(-center.x, -box.min.y, -center.z);
    const wrap = new THREE.Group(); wrap.add(object); scene.add(wrap);
    const radius = Math.max(1, size.length() * .5);
    camera.position.set(radius * 2.2, radius * 1.6, radius * 2.4);
    controls.target.set(0, size.y * .45, 0); controls.update();
    const grid = new THREE.GridHelper(radius * 3, 12, 0x70624b, 0x3c3831);
    grid.position.y = 0; scene.add(grid);
    const fit = () => {
      const r = body.getBoundingClientRect();
      const w = Math.max(240, Math.round(r.width)), h = Math.max(240, Math.round(r.height));
      renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
    };
    fit();
    const ro = new ResizeObserver(fit); ro.observe(body);
    let raf = 0;
    const loop = () => { raf = requestAnimationFrame(loop); controls.update(); renderer.render(scene, camera); };
    loop();
    cleanupFns.push(() => {
      cancelAnimationFrame(raf); ro.disconnect(); controls.dispose(); renderer.dispose();
      object.traverse?.((n) => { if (n.isMesh) { n.geometry?.dispose?.(); if (n.material) (Array.isArray(n.material) ? n.material : [n.material]).forEach((m) => m.dispose?.()); } });
    });
  } catch (err) {
    body.innerHTML = `<p class="pk-preview-error">模型预览失败：${esc(err.message || err)}</p>`;
  }
}

function render() {
  const host = document.getElementById("packBody");
  if (!host) return;
  const total = files.reduce((a, f) => a + f.bytes, 0);
  // 缺的文件也算进数：不显示出来，用户不知道这一类到底该有多少东西
  const remote = cat === "script" || cat === "trash" ? [] : remoteRows();
  const c0 = CATS.find((x) => x.key === cat);
  const countOf = (c) => (c.key === "script" ? (E.state.scripts || []).length
    : c.key === "trash" ? files.filter((f) => f.path.startsWith("trash/")).length
      : files.filter((f) => c.match(f.path)).length + remoteRows().filter((r) => c.match(r.path)).length);
  const shown = rows().concat(remote.filter((r) => (c0 ? c0.match(r.path) : false)))
    .filter((f) => (query ? f.path.toLowerCase().includes(query.trim().toLowerCase()) : true));
  host.innerHTML = `
    <aside class="pk-rail">
      ${CATS.map((c) => `<button class="pk-cat${c.key === cat ? " on" : ""}" data-c="${c.key}">${svg(c.icon)}<span>${c.name}</span><b>${countOf(c)}</b></button>`).join("")}
      <div class="pk-space">
        <div class="pk-space-head"><span>储存空间</span><b>${kb(total)} / ${kb(QUOTA)}</b></div>
        <div class="pk-bar"><i style="width:${Math.min(100, total / QUOTA * 100).toFixed(2)}%"></i></div>
      </div>
    </aside>
    <section class="pk-main">
      <div class="pk-search"><input type="search" placeholder="搜索" value="${esc(query)}"/></div>
      <div class="pk-thead"><span>名称</span><span>大小</span><span></span></div>
      <div class="pk-rows">
        ${shown.length ? shown.map((f) => {
    const ent = f.remote ? { hash: f.hash } : idxOf(f.path);
    const hash = (ent && ent.hash) || "";
    return `<div class="pk-row${f.remote ? " pk-missing" : ""}" data-p="${esc(f.path)}" data-hash="${esc(hash)}" data-remote="${f.remote ? 1 : ""}">
            <span class="pk-thumb">${thumb(f)}</span>
            <span class="pk-name"><b>${esc(base(f.path))}</b>${hash ? `<i title="${esc(hash)}">${esc(hash)}</i>` : `<i class="pk-nohash">无内容地址</i>`}</span>
            <span class="pk-size">${f.remote ? "未下载 · " + kb(f.bytes) : kb(f.bytes)}</span>
            <button class="pk-more" data-p="${esc(f.path)}" title="更多">⋮</button>
          </div>`;
  }).join("") : `<div class="pk-empty">${cat === "trash" ? "回收站是空的" : "这一类还没有文件"}</div>`}
      </div>
    </section>
    <button class="pk-fab" id="packAdd" title="上传素材文件">＋</button>`;

  host.querySelectorAll(".pk-cat").forEach((b) => { b.onclick = () => { cat = b.dataset.c; render(); }; });
  host.querySelector(".pk-search input").oninput = (ev) => { query = ev.target.value; render(); host.querySelector(".pk-search input").focus(); };
  host.querySelectorAll(".pk-more").forEach((b) => {
    b.onclick = (ev) => {
      ev.stopPropagation();
      const row = b.closest(".pk-row");
      openMenu(b.dataset.p, b.getBoundingClientRect(), row && row.dataset.remote ? row.dataset.hash : null);
    };
  });
  // 缺的行整行可点：一眼就能看出"点它会去下载"，比只藏在 ⋮ 里好找
  host.querySelectorAll(".pk-missing").forEach((r) => {
    r.onclick = () => { if (r.dataset.hash) fetchByCid(r.dataset.p, r.dataset.hash); };
  });
  host.querySelectorAll(".pk-row:not(.pk-missing)").forEach((r) => {
    if (!canPreview(r.dataset.p)) return;
    r.classList.add("pk-previewable");
    r.onclick = (ev) => { if (!ev.target.closest(".pk-more")) openPreview(r.dataset.p); };
  });
  host.querySelector("#packAdd").onclick = upload;
}

function openMenu(path, rect, remoteHash) {
  closeMenu();
  const ent = idxOf(path);
  const inTrash = path.startsWith("trash/");
  const hash = remoteHash || (ent && ent.hash) || "";
  // 缺的文件只给"取回"：它本地根本没有字节，"下载"和"删除"都是假的
  const items = inTrash
    ? [...(canPreview(path) ? [["预览", () => openPreview(path)]] : []), ["还原", () => restore(path)], ["彻底删除", () => destroy(path)]]
    : remoteHash
      ? (hash ? [["按 CID 取回内容", () => fetchByCid(path, hash)]] : [])
      : [...(canPreview(path) ? [["预览", () => openPreview(path)]] : []), ["下载", () => download(path)],
        ...(hash ? [["按 CID 取回内容", () => fetchByCid(path, hash)]] : []),
        ["删除", () => toTrash(path)]];
  menu = document.createElement("div");
  menu.className = "pk-menu";
  menu.style.cssText = `left:${Math.min(innerWidth - 190, rect.left - 150)}px;top:${rect.bottom + 4}px`;
  for (const [label, fn] of items) {
    const b = document.createElement("button");
    b.textContent = label;
    b.onclick = () => { closeMenu(); fn(); };
    menu.appendChild(b);
  }
  document.body.appendChild(menu);
}

async function toTrash(path) {
  const to = "trash/" + path.replace(/\//g, "__");
  await put(path, to);
  await del(path);
  E.toast("已移入回收站");
  await refresh();
}
async function restore(path) {
  const back = path.slice("trash/".length).replace(/__/g, "/");
  await put(path, back);
  await del(path);
  E.toast("已还原为 " + back);
  await refresh();
}
async function destroy(path) {
  if (!confirm("彻底删除后无法恢复，确定？")) return;
  await del(path);
  E.toast("已删除");
  await refresh();
}
async function download(path) {
  const a = document.createElement("a");
  a.href = assetUrl(path); a.download = base(path); a.click();
}
async function put(from, to) {
  const buf = await (await fetch(assetUrl(from))).arrayBuffer();
  await fetch(`/api/world/${encodeURIComponent(E.worldId)}/asset?path=${encodeURIComponent(to)}`, { method: "POST", body: buf });
}
async function del(path) {
  await fetch(`/api/world/${encodeURIComponent(E.worldId)}/asset?path=${encodeURIComponent(path)}`, { method: "DELETE" });
}
const assetUrl = (path) => `/assets/worlds/${encodeURIComponent(E.worldId)}/${path.split("/").map(encodeURIComponent).join("/")}`;

async function upload() {
  const inp = document.createElement("input");
  inp.type = "file"; inp.multiple = true;
  inp.onchange = async () => {
    let ok = 0;
    for (const f of inp.files) {
      const ext = (f.name.split(".").pop() || "").toLowerCase();
      const dir = ["png", "jpg", "jpeg", "webp", "gif", "bmp", "svg"].includes(ext) ? "images"
        : ["mp3", "wav", "ogg", "m4a", "aac"].includes(ext) ? "audio"
          : ["glb", "gltf", "vox", "vb"].includes(ext) ? "models" : "misc";
      const r = await fetch(`/api/world/${encodeURIComponent(E.worldId)}/asset?path=${encodeURIComponent(dir + "/" + f.name)}`,
        { method: "POST", body: f });
      if (r.ok) ok++;
    }
    E.toast(`已上传 ${ok} 个文件`);
    await refresh();
    E.markDirty();
  };
  inp.click();
}

/**
 * 按 CID 从官方网关取回内容。
 * 这是"导入的图只剩名字、模型全空"唯一的补救路：官方包里 mesh/*.vb 的
 * 内容地址记在资源表里，文件本体不在包内。取回来落盘后，下一次就是本地读取。
 */
async function fetchByCid(path, hash) {
  E.toast("正在按 CID 取回…");
  try {
    const r = await fetch(apiBlock(hash));
    if (!r.ok) throw new Error("网关返回 " + r.status);
    const buf = await r.arrayBuffer();
    if (!buf.byteLength) throw new Error("取回的内容是空的");
    const to = path.replace(/^models?\//i, "models/");
    const w = await fetch(`/api/world/${encodeURIComponent(E.worldId)}/asset?path=${encodeURIComponent(to)}`, { method: "POST", body: buf });
    if (!w.ok) throw new Error("落盘失败 " + w.status);
    // .vb 光落盘还不够：不解成体素注册进 meshes，实体那边照旧只是个标记框，
    // 用户点了"取回"却什么都没变，这条功能就等于假的。
    let extra = "";
    if (/\.vb$/i.test(to)) {
      try {
        const { vbToVoxList } = await import("./vb.js");
        const { voxListToModel } = await import("./features.js");
        const list = vbToVoxList(JSON.parse(new TextDecoder().decode(buf)), E.atlas.list());
        if (!list || !list.voxels.length) extra = "，但解出来是空的";
        else {
          const key = base(to).replace(/\.vb$/i, "");
          E.state.assets = E.state.assets || { meshes: {} };
          E.state.assets.meshes[key] = { object: voxListToModel(list.voxels, E.atlas), scale: 1 };
          // 重摆一次场景：引用这个网格的实体要从标记框换成真模型
          if (E.replaceSceneModels) { await E.replaceSceneModels(); extra = `，已建模（${list.solid} 格）并重新摆放场景`; }
          else extra = `，已建模（${list.solid} 格），重开这张图后生效`;
        }
      } catch (err) { extra = "，但建模失败：" + ((err && err.message) || err); }
    }
    E.toast(`已取回 ${base(to)}（${kb(buf.byteLength)}）${extra}`);
    await refresh();
    E.markDirty();
  } catch (e) {
    // 明说失败原因。这个项目里"静默什么都不发生"是最难查的一类 bug。
    E.toast("取回失败：" + (e.message || e));
  }
}

/** 官方包只给了资源表的 CID 时，让用户点一下才去联网读它。 */
async function loadIndex() {
  const cid = E.state.meta.assetsCid;
  if (!cid) return;
  E.toast("正在读取官方资源表…");
  try {
    const r = await fetch(apiBlock(cid));
    if (!r.ok) throw new Error("网关返回 " + r.status);
    const j = await r.json();
    E.state.meta.assetIndex = j;
    E.markDirty();
    E.toast(`资源表已载入：${Object.keys(j).length} 条`);
    render();
  } catch (e) { E.toast("读资源表失败：" + (e.message || e)); }
}

export function initPack(editor) {
  E = editor;
  document.addEventListener("click", closeMenu);
  E.renderPack = async () => { await refresh(); };
  E.packLoadIndex = loadIndex;
  E.packClosePreview = closePreview;
}
