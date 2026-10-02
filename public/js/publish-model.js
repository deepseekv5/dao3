// publish-model.js — VOXA 的"发布模型到社区"对话框。
// 单独一个文件：VOXA 的主文件已经够大了，而这段只在点这个菜单时才需要。
import * as auth from "/js/auth.js";
import { serialize, stats } from "./voxa/model.js";

const { api, esc } = auth;

export function openModelPublishDialog(doc, notify) {
  if (!auth.me) { auth.openAuth("register"); notify && notify("发布要先有个账号"); return; }
  let box = document.getElementById("mpModal");
  if (!box) {
    box = document.createElement("div");
    box.id = "mpModal";
    box.className = "cm-modal";
    document.body.appendChild(box);
  }
  const s = stats(doc);
  const title = (doc.name || "未命名模型").slice(0, 60);
  box.innerHTML = `<div class="cm-mbox">
    <h3>发布模型到社区</h3>
    <p class="cm-hint">发布的是<b>当前这份 VOXA 文档</b>（部件 ${s.parts ?? doc.parts.length} · 体素 ${(s.voxels ?? 0).toLocaleString()} · 颜色 ${s.colors ?? 0}）。
      别人可以在广场看到它、下载 .voxa，或在 VOXA 里打开继续改。</p>
    <label>标题<input id="mpTitle" maxlength="60" value="${esc(title)}"/></label>
    <label>说明<textarea id="mpDesc" maxlength="2000" placeholder="这个模型是做什么的、怎么摆、有没有贴图要求"></textarea></label>
    <label>标签（逗号分隔，最多 6 个）<input id="mpTags" placeholder="建筑, 载具, 道具"/></label>
    <div class="cm-mbtns"><button class="cm-btn" data-x="cancel">取消</button><button class="cm-btn primary" id="mpOk">发布</button></div>
  </div>`;
  box.classList.add("show");
  const close = () => box.classList.remove("show");
  box.onclick = (e) => { if (e.target === box) close(); };
  box.querySelector('[data-x="cancel"]').onclick = close;
  box.querySelector("#mpOk").onclick = async () => {
    const btn = box.querySelector("#mpOk");
    const t = box.querySelector("#mpTitle").value.trim();
    if (t.length < 2) { notify && notify("标题至少 2 个字"); return; }
    btn.disabled = true;
    try {
      const r = await api("POST", "/api/community/publish", {
        kind: "model", title: t, slug: t,
        desc: box.querySelector("#mpDesc").value.trim(),
        tags: box.querySelector("#mpTags").value.split(/[,，]/).map((x) => x.trim()).filter(Boolean),
        doc: serialize(doc),
      });
      close();
      notify && notify("已发布：" + r.pub.title);
      setTimeout(() => (location.href = "/p/" + r.pub.id), 700);
    } catch (e) { btn.disabled = false; notify && notify("发布失败：" + e.message); }
  };
}
