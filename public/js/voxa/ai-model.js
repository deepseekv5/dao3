// voxa/ai-model.js — 「AI 生成模型」：把一句话变成一个可继续手工修的体素模型。
//
// 为什么让模型输出**图元**而不是一格一格的体素：
// 语言模型对精确三维坐标没有可靠的空间感，让它逐格报 2 万个坐标，结果是糊成一团
// 噪声；而"长方体 + 椭球 + 圆柱"正是体素美术打形体的真实做法，模型在这个抽象层上
// 表现稳定得多，我们也能在展开之前就把规模钳死。
//
// 展开与校验在 ai.js（validateVoxelProgram / programToVoxels），这里只负责
// 问、预览、以及**用户点确认之后**才写进工程——写之前先 snapshot 进撤销栈。
import { chat, aiReady, openSettings, extractJson, validateVoxelProgram, programToVoxels } from "../ai.js";
import { newPart, addPart, setVoxel } from "./model.js";

const $ = (id) => document.getElementById(id);

function systemPrompt() {
  return `你是体素模型生成器。只输出**一个 JSON 对象**，不要解释、不要 markdown 围栏。

形状：
{"name":"小房子","parts":[{"name":"墙体","size":[24,20,24],"prims":[
  {"shape":"box","from":[4,0,4],"to":[19,11,19],"color":"#8a5a2b","shell":true},
  {"shape":"box","from":[2,11,2],"to":[21,13,21],"color":"#6b3f20"},
  {"shape":"cylinder","center":[20,14,12],"axis":"y","radius":1,"height":6,"color":"#7d7d7d"},
  {"shape":"sphere","center":[12,6,12],"radii":[3,3,3],"color":"#f2c14e"}
]}]}

规则（违反的部分会被程序丢弃，请严格遵守）：
- size 是部件框大小，三个值都在 1..64；坐标从 0 起，最大到 size-1，**不能越界**。
- y 轴向上。模型要立在 y=0 上：最低的一层图元从 y=0 开始。
- 一个部件最多 40 个图元，整个模型最多 16 个部件，总体素数控制在 2 万以内。
- color 用 #rrggbb 十六进制；需要发光就加 "emissive": 1~15。
- 墙、屋顶、容器这类用 "shell":true 做成空心，省体素也才看得见内部。
- 先大形体（底座/主体），再中等（屋顶/四肢/尾巴），最后细节（眼睛/按钮/把手，半径 1~2）。
- 细节要真的存在：至少 2 个半径 1~2 的小图元当眼睛或装饰，否则模型会像个色块堆。
- 只允许 box / sphere / cylinder 三种 shape；不要发明别的键。`;
}

/** 打开对话框。app 是 VoxaApp 实例。 */
export async function openAiModel(app) {
  if (!aiReady()) { openSettings(() => openAiModel(app)); return; }
  const old = $("vxAiModal"); if (old) old.remove();

  const m = document.createElement("div");
  m.id = "vxAiModal"; m.className = "vx-modal show";
  const box = document.createElement("div"); box.className = "vx-modal-box";
  const h = document.createElement("h3"); h.textContent = "AI 生成体素模型"; box.appendChild(h);
  const hint = document.createElement("div");
  hint.className = "vx-hint";
  hint.textContent = "描述一个对象，AI 给出由长方体/椭球/圆柱拼成的方案，预览确认后才写进工程（会先进撤销栈，可撤销）。";
  box.appendChild(hint);

  const row = (label, node) => { const r = document.createElement("div"); r.className = "vx-row"; const l = document.createElement("label"); l.textContent = label; r.append(l, node); return r; };
  const ta = document.createElement("textarea");
  ta.className = "vx-code-ta"; ta.spellcheck = false;
  ta.placeholder = "例如：一座带烟囱和木门的小木屋，屋顶是红色的";
  ta.style.height = "70px";
  box.appendChild(row("想要什么", ta));

  const size = document.createElement("input");
  size.type = "number"; size.min = "8"; size.max = "64"; size.value = "24"; size.className = "vx-num";
  box.appendChild(row("部件框边长（1..64）", size));

  const mode = document.createElement("select"); mode.className = "vx-sel";
  for (const [v, t] of [["append", "追加为部件（保留现有模型）"], ["replace", "替换整个模型"]]) {
    const o = document.createElement("option"); o.value = v; o.textContent = t; mode.appendChild(o);
  }
  box.appendChild(row("落地方式", mode));

  const stat = document.createElement("div"); stat.className = "vx-hint"; stat.textContent = "还没生成"; box.appendChild(stat);
  const prev = document.createElement("pre");
  prev.className = "vx-code-ta";
  prev.style.height = "150px"; prev.style.overflow = "auto"; prev.style.whiteSpace = "pre-wrap";
  prev.textContent = "（还没生成）";
  box.appendChild(prev);

  const acts = document.createElement("div"); acts.className = "vx-row";
  const gen = document.createElement("button"); gen.className = "vx-btn"; gen.textContent = "生成";
  const apply = document.createElement("button"); apply.className = "vx-btn"; apply.textContent = "写进工程"; apply.disabled = true;
  const cfg = document.createElement("button"); cfg.className = "vx-mini"; cfg.textContent = "接口设置";
  const close = document.createElement("button"); close.className = "vx-mini"; close.textContent = "关闭";
  acts.append(gen, apply, cfg, close); box.appendChild(acts);
  m.appendChild(box);
  m.onclick = (e) => { if (e.target === m) m.remove(); };
  document.body.appendChild(m);

  let prog = null;
  close.onclick = () => m.remove();
  cfg.onclick = () => openSettings();
  gen.onclick = async () => {
    const want = ta.value.trim();
    if (!want) { stat.textContent = "先写一句描述"; return; }
    gen.disabled = true; stat.textContent = "生成中…";
    try {
      const n = Math.max(8, Math.min(64, Number(size.value) || 24));
      const r = await chat([
        { role: "system", content: systemPrompt() },
        { role: "user", content: `对象：${want}\n每个部件的 size 用 [${n}, ${n}, ${n}] 左右（可按对象实际比例调整三轴，但都不要超过 ${n}）。` },
      ], { json: true });
      const parsed = validateVoxelProgram(extractJson(r.text));
      prog = parsed;
      const list = parsed.models.map((mo) => {
        const vox = mo.parts.reduce((a, p) => a + programToVoxels(p).length, 0);
        return `${mo.name}：${mo.parts.length} 部件 / ${vox.toLocaleString()} 体素`;
      });
      stat.textContent = `已生成 ${list.join("；")}` + (parsed.dropped ? `｜丢弃 ${parsed.dropped} 个越界或超配额图元` : "");
      prev.textContent = JSON.stringify(parsed.models, null, 1).slice(0, 4000);
      apply.disabled = false;
    } catch (e) {
      prog = null; apply.disabled = true;
      stat.textContent = "失败：" + (e && (e.message || String(e))).slice(0, 200);
    } finally { gen.disabled = false; }
  };
  apply.onclick = () => {
    if (!prog) return;
    app.snapshot("AI 生成模型");
    if (mode.value === "replace") { app.doc.parts = []; app.doc.bones = app.doc.bones.filter((b) => b.id === "root"); }
    let parts = 0, voxels = 0;
    for (const mo of prog.models) {
      for (const p of mo.parts) {
        const part = newPart(p.name, p.size);
        addPart(app.doc, part);
        for (const v of programToVoxels(p)) { setVoxel(app.doc, part, v.x, v.y, v.z, v.color, v.emissive || 0); voxels++; }
        parts++;
      }
    }
    app.activePart = app.doc.parts[app.doc.parts.length - 1] || null;
    app.view.setDoc(app.doc);
    app.renderAll(); app.saveLocal(); app.view.focus();
    m.remove();
    app.toast(`AI 生成完成：${parts} 部件 / ${voxels.toLocaleString()} 体素${prog.dropped ? `，丢弃 ${prog.dropped} 个图元` : ""}。不满意可 Ctrl+Z`);
  };
}
