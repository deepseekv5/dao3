// publish-skin.js — 皮肤社区：把皮肤库里的皮肤发出去，也把广场上的取回库里。
//
// 单独一个文件：皮肤库面板（panels/skins.js）已经够长了，而这一整块只在点这两个
// 菜单时才需要。口径与 publish-model.js 一致：发布的是**此刻的快照**，
// 资产（贴图 PNG / 骨骼 GLB）以 base64 附件收进这份发布自己的 .assets/ 目录，
// 记录里只留指回它自己的站内路径——否则别人下载到的皮肤指向作者本机。
import * as auth from "/js/auth.js";

const { api, esc } = auth;

const slug = (s) => String(s || "skin").replace(/[\\/:*?"<>|\s]+/g, "_").slice(0, 48) || "skin";

/** 站内路径或 dataURL → base64（data: 也能 fetch，不必分两条路）。 */
async function toB64(src) {
  const r = await fetch(src);
  if (!r.ok) throw new Error("资产读不出来：" + r.status);
  const buf = new Uint8Array(await r.arrayBuffer());
  if (!buf.length) throw new Error("资产是空的");
  let s = "";
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  return btoa(s);
}

async function asDataURL(src) {
  const r = await fetch(src);
  if (!r.ok) throw new Error("资产读不出来：" + r.status);
  const blob = await r.blob();
  return await new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result));
    fr.onerror = () => rej(new Error("资产读取失败"));
    fr.readAsDataURL(blob);
  });
}

/** 把作者快照里的资产复制进本地这份世界：作者之后下架，我们的皮肤不能跟着变空。 */
async function copyAsset(url, rel, worldId) {
  const buf = await (await fetch(url)).arrayBuffer();
  const r = await fetch(`/api/world/${worldId}/asset?path=${encodeURIComponent(rel)}`, { method: "POST", body: buf });
  if (!r.ok) throw new Error("资产落地失败：" + r.status);
  return `/assets/worlds/${worldId}/${rel}`;
}

/* ---------------- 发布 ---------------- */
export function openSkinPublishDialog(skin, notify) {
  if (!auth.me) { auth.openAuth("register"); notify && notify("发布要先有个账号"); return; }
  let box = document.getElementById("skpModal");
  if (!box) {
    box = document.createElement("div");
    box.id = "skpModal";
    box.className = "cm-modal";
    document.body.appendChild(box);
  }
  const kindLabel = skin.kind === "rig" ? "骨骼皮肤（glb）" : skin.texture ? "贴图皮肤（MC 展开图）" : "配色皮肤（六块）";
  const title = String(skin.name || "未命名皮肤").slice(0, 60);
  box.innerHTML = `<div class="cm-mbox">
    <h3>发布皮肤到社区</h3>
    <p class="cm-hint">发出去的是<b>此刻这份「${esc(title)}」</b>（${esc(kindLabel)}）。
      别人可以在广场看到它、一键穿到自己角色上，或取回自己的皮肤库继续改。</p>
    <label>标题<input id="skTitle" maxlength="60" value="${esc(title)}"/></label>
    <label>说明<textarea id="skDesc" maxlength="2000" placeholder="这套皮肤适合什么场景、有没有配色要求、骨骼皮肤说明它是哪台模型"></textarea></label>
    <label>标签（逗号分隔，最多 6 个）<input id="skTags" placeholder="机甲, 日常, 像素, 联动"/></label>
    <div class="cm-mbtns"><button class="cm-btn" data-x="cancel">取消</button><button class="cm-btn primary" id="skOk">发布</button></div>
  </div>`;
  box.classList.add("show");
  const close = () => box.classList.remove("show");
  box.onclick = (e) => { if (e.target === box) close(); };
  box.querySelector('[data-x="cancel"]').onclick = close;
  box.querySelector("#skOk").onclick = async () => {
    const btn = box.querySelector("#skOk");
    const t = box.querySelector("#skTitle").value.trim();
    if (t.length < 2) { notify && notify("标题至少 2 个字"); return; }
    btn.disabled = true; btn.textContent = "正在打包…";
    try {
      const payload = {
        kind: "skin", title: t, slug: t,
        desc: box.querySelector("#skDesc").value.trim(),
        tags: box.querySelector("#skTags").value.split(/[,，]/).map((x) => x.trim()).filter(Boolean).slice(0, 6),
        skin: {
          name: t, skin: skin.skin, kind: skin.kind, bones: skin.bones, axes: skin.axes, scale: skin.scale,
        },
      };
      // 资产本体走附件；本地记录里那条 URL（dataURL 或本图资产）由服务端改写成快照自己的
      if (skin.texture) payload.textureB64 = await toB64(skin.texture);
      if (skin.model) payload.modelB64 = await toB64(skin.model);
      // 封面是本地渲好的 PNG（配色皮肤用人偶图、机甲皮肤用导入时的预览图）
      if (skin.cover) payload.coverUrl = await uploadCover(skin.cover);
      const r = await api("POST", "/api/community/publish", payload);
      close();
      notify && notify("已发布：" + r.pub.title);
      setTimeout(() => (location.href = "/p/" + r.pub.id), 700);
    } catch (e) {
      btn.disabled = false; btn.textContent = "发布";
      notify && notify("发布失败：" + (e.message || e));
    }
  };
}

/** 封面：皮肤卡片的封面是本地渲出来的 PNG（dataURL），先上传成站内路径再引用。 */
async function uploadCover(dataUrl) {
  const buf = await (await fetch(dataUrl)).arrayBuffer();
  const headers = { "Content-Type": "image/png" };
  if (auth.me) headers["X-CSRF-Token"] = (await api("GET", "/api/community/me")).csrf || "";
  const res = await fetch("/api/community/upload?kind=skin", { method: "POST", headers, body: buf, credentials: "same-origin" });
  const j = await res.json().catch(() => null);
  if (!res.ok) throw new Error((j && j.error) || "封面上传失败");
  return j.url;
}

/* ---------------- 取回 ---------------- */
export async function listCommunitySkins() {
  const r = await api("GET", "/api/community/feed?kind=skin&sort=hot&limit=48");
  return r.rows || [];
}

/** 把社区上的一套皮肤取回本地皮肤库：记录 + 资产都复制一份，之后作者下架不影响我们。 */
export async function importCommunitySkin(pub, E) {
  const r = await fetch(`/api/community/pubs/${pub.id}/skin`);
  if (!r.ok) throw new Error("这份发布不是皮肤，或记录已不在");
  const doc = await r.json();
  const wid = (E && E.worldId) || null;
  const out = {
    name: String(doc.name || pub.title || "社区皮肤").slice(0, 24),
    skin: Object.assign({ head: "#ffd7b0", body: "#5aa8e8", armL: "#5aa8e8", armR: "#5aa8e8", legL: "#5b6c8e", legR: "#48566f" }, doc.skin || {}),
    created: Date.now(), edited: Date.now(), from: pub.id,
  };
  if (doc.kind === "rig") out.kind = "rig";
  if (doc.bones) out.bones = doc.bones;
  if (doc.axes) out.axes = doc.axes;
  if (doc.scale) out.scale = doc.scale;
  if (doc.texture) out.texture = await asDataURL(doc.texture);
  if (doc.model) out.model = wid ? await copyAsset(doc.model, `models/${slug(out.name)}.glb`, wid) : doc.model;
  return out;
}
