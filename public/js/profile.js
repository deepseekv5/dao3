// profile.js — 个人主页：横幅、头像、昵称、简介、皮肤，以及三种作品列表。
//
// 皮肤为什么在账号上而不是地图里：角色外观是"我是谁"，不是"这张图长什么样"，
// 换图、进别人发的图都应该带着走。运行时会读 auth.me.skin 贴到人偶上。
import * as auth from "/js/auth.js";
import { cardHtml, bindCards, face, toast } from "/js/pubs.js";
import { MC_PRESETS, presetUrl, facePreview, readSkinFile, skinNameFrom } from "/js/skin-sheet.js";
import { REGIONS, GENDERS, PERSONA, LOOKING, genderLabel, personaLabel, lookingLabel, MAX_PERSONA } from "/js/profile-fields.js";

const { api, esc } = auth;
const $ = (id) => document.getElementById(id);
const timeAgo = (t) => {
  if (!t) return "—";
  const s = Math.max(1, Math.round((Date.now() - t) / 1000));
  if (s < 3600) return Math.floor(s / 60) + " 分钟前";
  if (s < 86400) return Math.floor(s / 3600) + " 小时前";
  if (s < 86400 * 30) return Math.floor(s / 86400) + " 天前";
  return new Date(t).toLocaleDateString();
};

const SKIN_DEFAULT = { skin: "#ffd7b0", shirt: "#c9714f", pants: "#6b625a", hair: "#6b4630", shoe: "#7b5441" };
/** 体型三档。量程与服务端 normalizeSkin 的夹取区间一致（0.80~1.25）：
 *  两边各写一套的话，滑杆能拖到一个服务端会悄悄改掉的值。 */
const BODY_MIN = 80, BODY_MAX = 125;
const BODY_ROWS = [["h", "身高"], ["w", "宽窄"], ["leg", "腿长"]];
const pctOf = (v) => (Number.isFinite(Number(v)) ? Number(Number(v)).toFixed(2) : "1.00");
/** 主页上把非默认体型写出来：别人看到"腿长 1.25"才明白那个人为什么比你高一截。
 *  全默认时整行不出现——三颗"1.00"的徽章只是噪音。 */
function bodyChips(b) {
  if (!b || typeof b !== "object") return "";
  const on = BODY_ROWS.filter(([k]) => Number.isFinite(Number(b[k])) && Number(b[k]) !== 1);
  if (!on.length) return "";
  return `<div class="pf-bodyrow"><span class="pf-blabel">体型</span>${
    on.map(([k, label]) => `<span class="pf-bchip">${label} ${pctOf(b[k])}</span>`).join("")}</div>`;
}
const SKIN_PARTS = [
  ["shirt", "上衣"], ["pants", "裤子"], ["skin", "皮肤"], ["hair", "头发"], ["shoe", "鞋子"],
];
const SWATCHES = ["#c9714f", "#e8604c", "#5aa8e8", "#4ecb8d", "#f2c14e", "#a06bff", "#ff7ab8", "#2f3b52", "#e8e6e1", "#6b4630", "#12b5c9"];
// 皮肤那一格给的是肤色梯度，不是通用色板：拿挑上衣的十色去挑脸，怎么选都像贴了块塑料。
const TONES = ["#f6d7bd", "#eab98f", "#d3925f", "#a96a3d", "#7b4a28", "#4e2f1c"];
const HAIRS = ["#1c1c1e", "#3b2a1c", "#6b4630", "#a86a2f", "#c9a227", "#8c8c90", "#b4483c", "#4a63c9"];
/** 成套预设。没有预设时用户得自己挑五色才可能好看，多数人挑完只会得到一坨。 */
const OUTFITS = [
  { name: "水手", shirt: "#2f5fd0", pants: "#e8e6e1", shoe: "#2b2f38", hair: "#3b2a1c" },
  { name: "工装", shirt: "#c8792f", pants: "#3f4a3b", shoe: "#241f1a", hair: "#1c1c1e" },
  { name: "运动", shirt: "#e8443c", pants: "#e8e8ff", shoe: "#2b2f38", hair: "#6b4630" },
  { name: "夜行", shirt: "#22252c", pants: "#2f3b52", shoe: "#12b5c9", hair: "#1c1c1e" },
  { name: "学院", shirt: "#f2c14e", pants: "#2b3550", shoe: "#3b2a1c", hair: "#a86a2f" },
  { name: "森系", shirt: "#4ecb8d", pants: "#5b4a32", shoe: "#2f3b2a", hair: "#6b4630" },
];
const rand = (a) => a[(Math.random() * a.length) | 0];
const randomOutfit = () => ({ skin: rand(TONES), shirt: rand(SWATCHES), pants: rand(SWATCHES), hair: rand(HAIRS), shoe: rand(["#2b2f38", "#3b2a1c", "#e8e6e1", "#241f1a"]) });

/** 纯 CSS 的角色预览，现在只是**兜底**：WebGL 起不来（老设备、驱动被禁、
 *  软件渲染被关掉）时这一格不能空着。正常路径由 `mountSkinPreview()` 换成
 *  `avatar.js` 那具与运行时同一份几何的人偶——主页上看到的必须就是进图之后那身。
 *  贴图皮肤只把头那一格换成展开图的正脸（src 由 paintFace 异步填），
 *  身体仍按配色画——展开图整张塞进去只会糊成一片噪点，读不出任何东西。 */
function previewHtml(skin) {
  const src = skin || {};
  // 颜色要进 style 属性，`red;background:url(...)` 这种值就能改写样式：
  // 只认 #rrggbb，其它一律退回默认色。
  const hex = (v, d) => (/^#[0-9a-fA-F]{6}$/.test(String(v)) ? String(v) : d);
  const c = {
    skin: hex(src.skin, SKIN_DEFAULT.skin), shirt: hex(src.shirt, SKIN_DEFAULT.shirt),
    pants: hex(src.pants, SKIN_DEFAULT.pants), hair: hex(src.hair, SKIN_DEFAULT.hair),
    shoe: hex(src.shoe, SKIN_DEFAULT.shoe),
  };
  const mc = sameSiteSkin(src.texture);
  return `<div class="pf-doll${mc ? " is-mc" : ""}" aria-hidden="true">
    <i class="d-hair" style="background:${esc(c.hair)}"></i>
    <i class="d-head" style="background:${esc(c.skin)}"></i>
    <img class="d-face" alt=""${mc ? ` data-src="${esc(mc)}"` : " hidden"}/>
    <i class="d-torso" style="background:${esc(c.shirt)}"></i>
    <i class="d-arm l" style="background:${esc(c.shirt)}"></i><i class="d-arm r" style="background:${esc(c.shirt)}"></i>
    <i class="d-leg l" style="background:${esc(c.pants)}"></i><i class="d-leg r" style="background:${esc(c.pants)}"></i>
    <i class="d-foot l" style="background:${esc(c.shoe)}"></i><i class="d-foot r" style="background:${esc(c.shoe)}"></i>
  </div>`;
}

/** 账号皮肤只可能是站内的图：随包预设或用户上传后的地址。别的（外链、data:）不认。 */
const sameSiteSkin = (v) => {
  const s = String(v || "");
  return /^(\/img\/skins\/|\/api\/community\/uploads\/)[A-Za-z0-9_.\/%-]{1,160}$/.test(s) && !s.startsWith("//") ? s : null;
};

/** 把展开图的正脸裁出来贴到预览的头部（裁脸逻辑与皮肤库共用 skin-sheet.js）。 */
function paintFace(root) {
  for (const im of root.querySelectorAll(".d-face")) {
    const src = im.dataset.src;
    if (!src || im.dataset.loading) continue;
    im.dataset.loading = "1";
    facePreview(src).then((url) => { if (url) { im.src = url; im.hidden = false; } else im.hidden = true; });
  }
}

async function uploadImage(file, kind) {
  const buf = await file.arrayBuffer();
  const headers = { "Content-Type": file.type || "image/png" };
  if (auth.me) headers["X-CSRF-Token"] = (await api("GET", "/api/community/me")).csrf || "";
  const res = await fetch("/api/community/upload?kind=" + kind, { method: "POST", headers, body: buf, credentials: "same-origin" });
  const j = await res.json().catch(() => null);
  if (!res.ok) throw new Error((j && j.error) || "上传失败");
  return j.url;
}

/** 把一段我们自己生成的 HTML 变成节点（不是用户输入，但也不走 outerHTML 注入）。 */
function fragmentFirst(html) {
  const t2 = document.createElement("template");
  t2.innerHTML = html.trim();
  return t2.content.firstChild;
}

/** 建一个带 class/文本的元素：MC 那块全走 DOM，用户选的文件名不能拼进 innerHTML。 */
function mk(tag, cls, text) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text != null) el.textContent = text;
  return el;
}

const presetName = (url) => {
  const hit = MC_PRESETS.find((p) => presetUrl(p.file) === url);
  return hit ? hit.name : null;
};

/* ---------------- 编辑资料 ---------------- */
function openEditor(u, onSaved) {
  const box = $("cmModal");
  const skin = Object.assign({}, SKIN_DEFAULT, u.skin || {});
  const b0 = (u.skin && u.skin.body) || {};
  box.innerHTML = `<div class="cm-mbox pf-edit">
    <h3>编辑资料</h3>
    <div class="pf-cols">
      <div>
        <label>昵称<input id="eName" maxlength="20" value="${esc(u.name)}"/></label>
        <label>简介<textarea id="eBio" maxlength="200">${esc(u.bio || "")}</textarea></label>
        <div class="pf-up">
          <label class="pf-file">头像<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" id="eAvatar"/></label>
          <label class="pf-file">横幅<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" id="eBanner"/></label>
          <span class="pf-hint">图片最大 3 MB，只存本机</span>
        </div>
        <div class="pf-factgrid">
          <label>地区<select id="eRegion">
            <option value="">不展示</option>${REGIONS.map((r) => `<option value="${esc(r)}" ${u.region === r ? "selected" : ""}>${esc(r)}</option>`).join("")}
          </select></label>
          <label>性别<select id="eGender">
            ${GENDERS.map((g) => `<option value="${esc(g.id)}" ${(u.gender || "") === g.id ? "selected" : ""}>${esc(g.label)}</option>`).join("")}
          </select></label>
          <label>扩列状态<select id="eLooking">
            <option value="">不展示</option>${LOOKING.map((l) => `<option value="${esc(l.id)}" ${u.looking === l.id ? "selected" : ""}>${esc(l.label)}</option>`).join("")}
          </select></label>
        </div>
        <div class="pf-tags" id="eTags" title="最多挑 6 个：别人在「扩列」里就是按这些找到你的">
          ${PERSONA.map((p) => `<button type="button" class="pf-tag${(u.persona || []).includes(p.id) ? " on" : ""}" data-tag="${esc(p.id)}">${esc(p.label)}</button>`).join("")}
        </div>
      </div>
      <div>
        <h4 title="配色会带进你游玩的每一张地图；模型皮肤在 VOXA 里发布后选择。">角色皮肤</h4>
        <div class="pf-skinrow">
          <div class="pf-dollslot" id="eDoll">${previewHtml(skin)}</div>
          <div class="pf-swatches" id="eSkin"></div>
        </div>
        <div class="pf-mcblk" id="eMc"></div>
        <div class="pf-body" id="eBody" title="只有身材比例：这三档会带进你游玩的每一张地图，别人看你也是这个身材">
          ${BODY_ROWS.map(([k, label]) => `<label class="pf-slide">
            <span>${label}</span>
            <input type="range" min="${BODY_MIN}" max="${BODY_MAX}" step="1" data-b="${k}"
              value="${Math.round(pctOf((b0 || {})[k]) * 100)}"/>
            <i>${pctOf((b0 || {})[k])}</i>
          </label>`).join("")}
          <button type="button" class="cm-btn sm" id="eBody0">标准体型</button>
        </div>
      </div>
    </div>
    <div class="cm-mbtns"><button class="cm-btn" data-x="cancel">取消</button><button class="cm-btn primary" id="eSave">保存</button></div>
  </div>`;
  box.classList.add("show");
  // 编辑弹窗里那格预览换成运行时同一具人偶：挑颜色时看到的就是进图之后的样子。
  // 起不来（没有 WebGL）就留着 CSS 纸片人，这一格不能空。
  let live = null;
  (async () => {
    try {
      const { liveAvatar } = await import("/js/skin-rig.js");
      const slot = box.querySelector("#eDoll");
      if (!slot || !box.isConnected) return;
      slot.innerHTML = "";
      live = liveAvatar(slot, draft, { w: 150, h: 190 });
    } catch { /* 纸片人还在 */ }
  })();
  const close = () => {
    box.classList.remove("show");
    if (live) { try { live.stop(); } catch { /* 已经停了 */ } live = null; }
  };
  box.onclick = (e) => { if (e.target === box) close(); };
  box.querySelector('[data-x="cancel"]').onclick = close;

  let active = "shirt";
  const draft = Object.assign({}, skin);
  // 每一格给自己的色板：肤色梯度 / 发色 / 通用色
  const paletteFor = (k) => (k === "skin" ? TONES : k === "hair" ? HAIRS : SWATCHES);
  const paintParts = () => {
    for (const b of box.querySelectorAll("[data-p]")) b.classList.toggle("on", b.dataset.p === active);
    const pal = box.querySelector(".pf-pal");
    if (pal) pal.replaceChildren(...paletteFor(active).map((c) => {
      const el = document.createElement("button");
      el.className = "pf-c"; el.dataset.c = c; el.style.background = c;
      el.onclick = () => { draft[active] = c; markCustom(); syncDoll(); paintParts(); };
      return el;
    }));
  };
  // 人偶单独刷，不连带重建色板：自定义取色器是 <input type=color>，
  // 它在系统面板里每动一下都触发 input，那时把宿主拆掉等于中途销毁用户正在用的控件
  const syncDoll = () => {
    for (const b of box.querySelectorAll("[data-p]")) {
      b.querySelector("span").style.background = draft[b.dataset.p];
    }
    if (live) live.set(draft);
    else {
      const doll = box.querySelector(".pf-doll");
      if (doll) doll.replaceWith(fragmentFirst(previewHtml(draft)));
    }
    paintFace(box);
  };
  /** 体型滑杆：拖一下就当场重画，和挑颜色一样。
   *  值存成 0.80~1.25 的乘数而不是 80~125，是为了让 skin.body 直接能被
   *  `makeAvatar` 用（运行时、主页、皮肤库读的是同一份记录），
   *  不必在每个消费点各自除以 100。 */
  for (const el of box.querySelectorAll("#eBody [data-b]")) {
    el.oninput = () => {
      const body = Object.assign({}, draft.body);
      const v = Number(el.value) / 100;
      body[el.dataset.b] = v;
      draft.body = body;
      el.nextElementSibling.textContent = pctOf(v);
      syncDoll();
    };
  }
  const reset = box.querySelector("#eBody0");
  if (reset) reset.onclick = () => {
    delete draft.body;
    for (const el of box.querySelectorAll("#eBody [data-b]")) {
      el.value = 100; el.nextElementSibling.textContent = pctOf(1);
    }
    syncDoll();
  };
  const applyPreset = (o, btn) => {
    Object.assign(draft, o);
    for (const b of box.querySelectorAll("[data-o]")) b.classList.toggle("on", b === btn);
    syncDoll(); paintParts();
  };
  const markCustom = () => { for (const b of box.querySelectorAll("[data-o]")) b.classList.remove("on"); };
  const host = box.querySelector("#eSkin");
  host.innerHTML = `<div class="pf-fit" id="eFit">${OUTFITS.map((o, i) =>
    `<button class="pf-o" data-o="${i}" title="${esc(o.name)}"><i style="background:${esc(o.hair)}"></i><i style="background:${esc(o.shirt)}"></i><i style="background:${esc(o.pants)}"></i></button>`).join("")}
    <button class="pf-o dice" id="eDice" title="随机一套"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/></svg></button></div>
    <div class="pf-parts">${SKIN_PARTS.map(([k, label]) =>
      `<div class="pf-part ${k === active ? "on" : ""}" data-p="${k}"><span style="background:${esc(draft[k])}"></span>${esc(label)}</div>`).join("")}</div>
    <div class="pf-pal"></div>
    <label class="pf-c pf-custom" title="自定义颜色"><input type="color" id="eCustom" value="${esc(draft[active])}"/></label>`;
  for (const b of host.querySelectorAll("[data-p]")) b.onclick = () => { active = b.dataset.p; paintParts(); };
  for (const b of host.querySelectorAll("[data-o]")) b.onclick = () => applyPreset(OUTFITS[Number(b.dataset.o)], b);
  host.querySelector("#eDice").onclick = () => applyPreset(randomOutfit());
  const custom = host.querySelector("#eCustom");
  custom.oninput = () => { draft[active] = custom.value; markCustom(); syncDoll(); };
  paintParts();
  paintFace(box);

  /* ---------------- MC 贴图皮肤 ---------------- */
  // 配色只能改六块纯色，想要"有脸有花纹"就得贴一张 MC 展开图。
  // 上传走社区图床而不是 dataURL：账号档案要下发给别人看，存 base64 等于
  // 每次访问主页都拖几百 KB。
  const mcHost = box.querySelector("#eMc");
  let mcName = presetName(draft.texture) || (draft.texture ? "我的皮肤" : "");
  const mcBtn = (label, url) => {
    const b = mk("button", "pf-mc-btn" + (draft.texture === url ? " on" : ""));
    b.type = "button";
    b.title = label;
    const im = document.createElement("img");
    im.alt = ""; im.loading = "lazy";
    b.appendChild(im);
    facePreview(url).then((u2) => { if (u2) im.src = u2; });
    b.onclick = () => { draft.texture = url; mcName = label; syncDoll(); paintMc(); };
    return b;
  };
  function paintMc() {
    mcHost.replaceChildren();
    const head = mk("div", "pf-mc-h", "或套一张 Minecraft 皮肤");
    head.appendChild(mk("span", "pf-mc-tip", "64×64 展开图 · 套上后角色改用经典六面体身形"));
    const row = mk("div", "pf-mc-row");
    for (const p of MC_PRESETS) row.appendChild(mcBtn(p.name, presetUrl(p.file)));
    const up = mk("label", "pf-file pf-mc-up", "上传皮肤图");
    up.title = "64×64 的 MC 皮肤展开图（PNG）";
    const file = document.createElement("input");
    file.type = "file"; file.accept = "image/png,image/jpeg";
    file.onchange = async () => {
      const f = file.files && file.files[0];
      file.value = "";
      if (!f) return;
      try {
        await readSkinFile(f);          // 先卡尺寸再上传：省一次往返，也给用户一句人话
        const url = await uploadImage(f, "skin");
        draft.texture = url;
        mcName = skinNameFrom(f, "我的皮肤");
        syncDoll(); paintMc();
      } catch (err) { toast(String(err && err.message || err), true); }
    };
    up.appendChild(file);
    row.appendChild(up);
    if (draft.texture) {
      row.appendChild(mk("span", "pf-mc-name", mcName));
      const off = mk("button", "pf-mc-off", "不用贴图");
      off.type = "button";
      off.onclick = () => { delete draft.texture; mcName = ""; syncDoll(); paintMc(); };
      row.appendChild(off);
    }
    mcHost.append(head, row);
  }
  paintMc();

  // 性格标签：多选但封顶 6 个。封顶要在界面上就拦掉，而不是等保存时服务端报错——
  // 那时候人已经填完一整屏了。
  const picked = new Set(u.persona || []);
  for (const b of box.querySelectorAll("[data-tag]")) b.onclick = () => {
    const id = b.dataset.tag;
    if (picked.has(id)) picked.delete(id);
    else if (picked.size >= MAX_PERSONA) { b.classList.add("shake"); setTimeout(() => b.classList.remove("shake"), 260); return; }
    else picked.add(id);
    b.classList.toggle("on", picked.has(id));
  };

  for (const [id, kind] of [["eAvatar", "avatar"], ["eBanner", "banner"]]) {
    box.querySelector("#" + id).onchange = async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      try {
        const url = await uploadImage(f, kind);
        const r = await api("PATCH", "/api/community/me", { [kind]: url });
        auth.setMe(r.user);
        // 传完就让人看到：底下的主页立刻重绘，否则要等"保存"才刷新，像是没传上去。
        onSaved && onSaved(r.user);
        box.querySelector("#" + id).replaceWith(Object.assign(document.createElement("span"), {
          className: "pf-ok", textContent: (kind === "avatar" ? "头像" : "横幅") + "已更新",
        }));
      } catch (err) { toast(err.message, true); }
    };
  }
  box.querySelector("#eSave").onclick = async () => {
    const btn = box.querySelector("#eSave");
    btn.disabled = true;
    try {
      const r = await api("PATCH", "/api/community/me", {
        name: box.querySelector("#eName").value.trim(),
        bio: box.querySelector("#eBio").value.trim(),
        skin: draft,
        region: box.querySelector("#eRegion").value,
        gender: box.querySelector("#eGender").value,
        looking: box.querySelector("#eLooking").value,
        persona: [...picked],
      });
      // 服务端会丢掉它不认的 texture。它丢了却说"已保存"，用户进图才发现还是那张
      // 纯色人偶，只会以为是我们没接上——所以按返回值说。
      if (draft.texture && (!r.user.skin || r.user.skin.texture !== draft.texture)) {
        throw new Error("贴图皮肤没被接受：只能是随包预设或站内上传的皮肤图");
      }
      auth.setMe(r.user);
      close(); onSaved && onSaved(r.user);
    } catch (e) { btn.disabled = false; toast(e.message, true); }
  };
}

/* ---------------- 页面 ---------------- */
const factCell = (k, v) => `<span class="pf-fact"><i>${esc(k)}</i><b>${esc(v)}</b></span>`;

// 一台机甲 6.9 MB，绝不该在每页都开一份 WebGL 上下文：切页时把上一个预览停掉并释放。
let rigLive = null;
/** 皮肤预览统一走 skin-rig 的那个舞台：骨骼皮肤上真模型，其余上 avatar.js 那具
 *  与运行时同一份几何的人偶。以前这里非 rig 就留一张纯 CSS 纸片人，于是"主页上
 *  看到的我"和"进图之后的我"是两种东西——现在只有一份画法，漂移不了。
 *  CSS 纸片人退成兜底：WebGL 起不来（老设备 / 驱动被禁）时至少有个轮廓。 */
async function mountSkinPreview(u, host) {
  if (rigLive) { try { rigLive.stop(); } catch { /* 已经没了 */ } rigLive = null; }
  if (!host) return;
  const fallback = host.innerHTML;   // 兜底那张纸片人，先留着
  try {
    const { previewSkin } = await import("/js/skin-rig.js");
    host.innerHTML = "";             // 画布要 append 进来，不清掉就会叠在纸片人上面
    rigLive = previewSkin(host, u.skin || {}, { w: 172, h: 220 });
  } catch {
    host.innerHTML = fallback;       // WebGL 起不来就还原，这一格不能空
  }
}

export async function profileView(name, root, setTitle, setSub) {
  let d;
  try { d = await api("GET", "/api/community/users/" + encodeURIComponent(name)); }
  catch (e) { root.innerHTML = `<div class="cm-empty"><b>${esc(e.message)}</b><a href="/community">回广场</a></div>`; return; }
  const u = d.user;
  const mine = !!(auth.me && auth.me.id === u.id);
  const c = u.counts || {};
  setTitle(u.name);
  setSub(u.bio || "这个人还没写简介");
  const banner = u.banner
    ? `<img src="${esc(u.banner)}" alt=""/>`
    : "";
  const bstyle = u.banner ? "" : `style="background-image:radial-gradient(120% 90% at 16% 0%,#4a3d28,transparent 60%),linear-gradient(120deg,#1b1917,#2a2118)"`;
  root.innerHTML = `<div class="pf-wrap">
    <div class="pf-banner" id="pfBanner" ${bstyle}>${banner}</div>
    <div class="pf-head">
      <div class="pf-avatar">${face(u)}${u.online ? '<i class="pf-online" title="在线"></i>' : '<i class="pf-online off" title="离线"></i>'}</div>
      <div class="pf-id">
        <h2>${esc(u.name)}${u.role === "admin" ? '<span class="pf-role">管理员</span>' : ""}</h2>
        <p class="pf-bio">${esc(u.bio || "")}</p>
        <p class="pf-meta">加入于 ${esc(new Date(u.createdAt).toLocaleDateString())} · ${c.pubs || 0} 张发布 · ${c.friends || 0} 好友 · ${c.followers || 0} 关注者</p>
      </div>
      <div class="pf-acts" id="pfActs"></div>
    </div>
    <div class="pf-card">
      <div class="pf-dollbox" id="pfSkin">${previewHtml(u.skin || {})}</div>
      <div class="pf-facts">
        <b>${esc(mine ? "你现在穿的皮肤" : "这个人的皮肤")}${mine ? '<button class="cm-btn sm" id="pfSkinEdit">改皮肤</button>' : ""}</b>
        <div class="pf-factsrow">
          ${factCell("地区", u.region || "未填")}
          ${factCell("性别", u.gender ? genderLabel(u.gender) : "未填")}
          ${factCell("扩列", u.looking ? lookingLabel(u.looking) : "未填")}
        </div>
        <div class="pf-tagline">${(u.persona || []).length
          ? (u.persona || []).map((t) => `<span class="pf-tag on">${esc(personaLabel(t))}</span>`).join("")
          : '<span class="pf-notag">没填性格标签</span>'}</div>
        ${bodyChips(u.skin && u.skin.body)}
      </div>
    </div>
    <div class="cm-tabs" id="pfTabs">
      <button class="cm-btn on" data-t="map">地图</button>
      <button class="cm-btn" data-t="model">模型</button>
      <button class="cm-btn" data-t="followers">关注者</button>
      <button class="cm-btn" data-t="following">关注中</button>
      ${mine ? '<button class="cm-btn" data-t="favorites">收藏</button>' : ""}
      <button class="cm-btn" data-t="recent">最近游玩</button>
    </div>
    <div id="pfBody"></div>
  </div>`;
  paintFace(root);
  mountSkinPreview(u, $("pfSkin"));
  const skinEdit = $("pfSkinEdit");
  if (skinEdit) skinEdit.onclick = () => openEditor(u, (nu) => profileView(nu.name, root, setTitle, setSub));
  /** 没上传横幅的人占绝大多数，而那块 200px 的纯色渐变是整页最难看的地方。
   *  拿 TA 自己最近一张图的封面垫在下面：内容是真的（就是这张图），
   *  也不用再多一个上传入口。压暗 + 盖一层底色，标题文字仍然读得清。 */
  if (!u.banner && (c.pubs || 0) > 0) {
    api("GET", `/api/community/users/${encodeURIComponent(name)}/pubs?kind=map`).then((r) => {
      const top = (r.rows || []).find((p) => p.hasCover);
      const host = document.getElementById("pfBanner");
      if (!top || !host || host.querySelector(".pf-bannerimg")) return;
      const img = document.createElement("img");
      img.className = "pf-bannerimg"; img.alt = ""; img.loading = "lazy";
      img.src = `/api/community/pubs/${top.id}/cover`;
      img.onerror = () => img.remove();
      host.insertBefore(img, host.firstChild);
    }).catch(() => { /* 拿不到就留着渐变，不值得为横幅报错 */ });
  }

  const acts = $("pfActs");
  if (mine) {
    acts.innerHTML = `<button class="cm-btn primary" id="pfEdit">编辑资料</button>
      ${auth.me.role === "admin" ? '<a class="cm-btn" href="/admin">管理后台</a>' : ""}`;
    acts.querySelector("#pfEdit").onclick = () => openEditor(u, (nu) => profileView(nu.name, root, setTitle, setSub));
  } else {
    const rel = u.relation || {};
    acts.innerHTML = `<button class="cm-btn ${rel.following ? "" : "primary"}" id="pfFollow">${rel.following ? "已关注" : "关注"}</button>
      <button class="cm-btn" id="pfFriend">${rel.friend ? "已是好友" : rel.pendingOut ? "等待回应" : rel.pendingIn ? "接受好友请求" : "加好友"}</button>
      ${rel.friend ? '<button class="cm-btn" id="pfDm">私聊</button>' : ""}`;
    if (rel.friend) {
      acts.querySelector("#pfDm").onclick = async () => {
        const m = await import("/js/social.js");
        m.openDm({ id: u.id, name: u.name, note: u.note });
      };
    }
    acts.querySelector("#pfFollow").onclick = async () => {
      if (!auth.me) return auth.openAuth("login");
      const r = await api("POST", "/api/community/follow", { name: u.name });
      acts.querySelector("#pfFollow").textContent = r.following ? "已关注" : "关注";
      acts.querySelector("#pfFollow").classList.toggle("primary", !r.following);
    };
    acts.querySelector("#pfFriend").onclick = async () => {
      if (!auth.me) return auth.openAuth("login");
      try {
        await api("POST", `/api/community/friend/${rel.pendingIn ? "accept" : "request"}`, { name: u.name });
        profileView(name, root, setTitle, setSub);
      } catch (e) { toast(e.message, true); }
    };
  }

  const tabs = $("pfTabs"), body = $("pfBody");
  async function show(which) {
    for (const b of tabs.querySelectorAll("[data-t]")) b.classList.toggle("on", b.dataset.t === which);
    body.innerHTML = `<div class="cm-empty">读取中…</div>`;
    if (which === "favorites") {
      // 上一轮加收藏开关时没给地方看，等于一个按下去只会亮起来的按钮。
      // 这里复用广场那张卡（cardHtml + bindCards），所以"我收藏的"和广场长得一样，
      // 也能直接从列表里点进详情页。
      const rows = (await api("GET", `/api/community/users/${encodeURIComponent(name)}/favorites`)).rows;
      body.innerHTML = rows.length ? `<div class="cm-grid">${rows.map(cardHtml).join("")}</div>`
        : `<div class="cm-empty">还没有收藏。<div>在地图详情页点「☆ 收藏」就会进这份清单——它和点赞不是一回事：赞是给作者的，收藏是给自己的。</div></div>`;
      bindCards(body);
      return;
    }
    if (which === "recent") {
      const rows = (await api("GET", `/api/community/users/${encodeURIComponent(name)}/recent`)).rows;
      body.innerHTML = rows.length ? `<div class="pf-recent">${rows.map((h) => `<a class="pf-rrow" href="/p/${esc(h.pubId)}">
        <span class="pf-rtitle">${esc(h.pub.title)}</span><span class="pf-rmeta">${esc(h.pub.author ? h.pub.author.name : "")} · ${esc(timeAgo(h.ts))}${h.count > 1 ? " · 玩过 " + h.count + " 次" : ""}</span></a>`).join("")}</div>`
        : `<div class="cm-empty">还没有游玩记录。</div>`;
      return;
    }
    if (which === "followers" || which === "following") {
      const rows = (await api("GET", `/api/community/users/${encodeURIComponent(name)}/${which}`)).rows;
      /** 关注者这一栏最该有的一颗按钮是「回关」：看到有人跟着我，却要先进他的主页
       *  才能关注，等于把一次点击摊成三次。已关注的显示成"已关注"，再点就是取消。 */
      const op = (x) => !auth.me || x.id === auth.me.id ? ""
        : `<button class="cm-btn sm${x.relation && x.relation.following ? "" : " primary"}" data-fo="${esc(x.name)}">${x.relation && x.relation.following ? "已关注" : "关注"}</button>`;
      body.innerHTML = rows.length ? `<div class="cm-rows">${rows.map((x) => `<div class="cm-row">${face(x)}
        <div class="grow"><b>${esc(x.name)}</b><div class="sub"><span class="cm-on${x.online ? " on" : ""}">${x.online ? "在线" : "离线"}</span>${esc(x.bio || "")}</div></div>
        ${op(x)}<a class="cm-btn sm" href="/u/${encodeURIComponent(x.name)}">主页</a></div>`).join("")}</div>`
        : `<div class="cm-empty">${which === "followers" ? "还没有人关注这个人。" : "这个人还没关注谁。"}</div>`;
      for (const b of body.querySelectorAll("[data-fo]")) b.onclick = async () => {
        try { await api("POST", "/api/community/follow", { name: b.dataset.fo }); await show(which); }
        catch (e) { toast(e.message, true); }
      };
      return;
    }
    const rows = (await api("GET", `/api/community/users/${encodeURIComponent(name)}/pubs?kind=${which}`)).rows;
    body.innerHTML = rows.length ? `<div class="cm-grid">${rows.map(cardHtml).join("")}</div>`
      : `<div class="cm-empty"><b>${which === "model" ? "还没有发布模型" : "还没有发布地图"}</b>${mine ? (which === "model" ? "在 VOXA 里点「发布到社区」。" : "打开工作台，把这张图发出去。") : ""}</div>`;
    bindCards(body);
  }
  /** 主页的页签和广场一样要能在地址栏里活下来：刷新不丢、能直接把"他的关注者"
   *  甩给别人。跟广场用同一套规矩——replaceState，不压历史，否则后退键会变成
   *  "回到我三分钟前点过的那个页签"。收藏那一格只有自己看得见，所以白名单要连着
   *  页签是否真的存在一起判。 */
  const PF_TABS = ["map", "model", "followers", "following", "favorites", "recent"];
  const fromUrl = () => {
    const t = new URLSearchParams(location.search).get("tab");
    return PF_TABS.includes(t) && tabs.querySelector(`[data-t="${t}"]`) ? t : "map";
  };
  for (const b of tabs.querySelectorAll("[data-t]")) b.onclick = () => {
    const u = new URLSearchParams(location.search);
    if (b.dataset.t === "map") u.delete("tab"); else u.set("tab", b.dataset.t);
    const qs = u.toString();
    history.replaceState(null, "", location.pathname + (qs ? "?" + qs : ""));
    show(b.dataset.t);
  };
  await show(fromUrl());
}
export { previewHtml, SKIN_DEFAULT };
