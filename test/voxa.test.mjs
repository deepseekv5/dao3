/**
 * test/voxa.test.mjs — VOXA 模型层的回归。
 *
 * 为什么单独一份：VOXA 的这几个毛病都属于"按了有反应、结果却不是那回事"，
 * 光看界面截图看不出来——镜像和翻转的函数体曾经逐字相同，
 * serialize 少了 type 字段则要在"存一次盘 / 撤一次销"之后才暴露。
 * 所以判据全部落在纯函数上，跑得起、也钉得住。
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  newDoc, newPart, addPart, serialize, deserialize, transformVoxels, ensureRoom,
  faceCells, fillRange, ensureColor, setVoxel, getVoxel, MAX_BOX,
  addBone, bindPart, toGLB, eulerToQuatXYZ,
} from "../public/js/voxa/model.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log("PASS  " + name); }
  else { fail++; console.log("FAIL  " + name + (extra ? "\n      → " + extra : "")); }
};

const box = (size = [4, 2, 2]) => newPart("P", size);
const key = (v) => `${v.x},${v.y},${v.z}`;
const keysOf = (p) => new Set(p.voxels.map(key));

/* ---------------- 作品类型必须活过序列化 ---------------- */
{
  const doc = newDoc("角色");
  doc.type = "skin";
  const p = addPart(doc, box());
  setVoxel(doc, p, 0, 0, 0, "#ff0000");
  const back = deserialize(JSON.parse(JSON.stringify(serialize(doc))));
  ok("换肤类型存盘再读回来还是 skin", back.type === "skin", "拿到 " + back.type);

  const undoRound = deserialize(serialize(deserialize(serialize(doc))));
  ok("再走一轮往返也不掉类型", undoRound.type === "skin", "拿到 " + undoRound.type);

  const free = deserialize(serialize(newDoc("自由作品")));
  ok("没设过类型的作品读回来是 free", free.type === "free", "拿到 " + free.type);
}

/* ---------------- 镜像 ≠ 翻转 ---------------- */
{
  const p = box([4, 4, 1]);
  fillRange(p, [0, 0, 0], [1, 0, 0], "c0");
  const before = p.voxels.length;

  const q = box([4, 4, 1]);
  fillRange(q, [0, 0, 0], [1, 0, 0], "c0");

  ok("镜像报告成功", transformVoxels(p, "mirror", 0) === true);
  transformVoxels(q, "flip", 0);

  ok("镜像保留原件、只往另一侧补", p.voxels.length === before * 2, `体素 ${p.voxels.length}`);
  ok("镜像不动原件的位置", p.voxels.some((v) => v.x === 0 && v.y === 0) && p.voxels.some((v) => v.x === 1 && v.y === 0));
  ok("镜像把框在轴向上长大", p.size[0] === 8 && p.size[1] === 4, JSON.stringify(p.size));
  ok("补出来那半确实是对称的", p.voxels.some((v) => v.x === 7 && v.y === 0) && p.voxels.some((v) => v.x === 6 && v.y === 0));

  ok("翻转是原地翻，不增体素", q.voxels.length === before, `体素 ${q.voxels.length}`);
  ok("翻转不动框", q.size[0] === 4 && q.size[1] === 4, JSON.stringify(q.size));
  ok("镜像与翻转结果不同", JSON.stringify(p.voxels) !== JSON.stringify(q.voxels));
}

/* ---------------- 镜像撞到上限要说得出口 ---------------- */
{
  const p = box([MAX_BOX, 1, 1]);
  fillRange(p, [0, 0, 0], [0, 0, 0], "c0");
  const n = p.voxels.length;
  ok("已经 128 宽的框拒绝再镜像，而不是悄悄截断", transformVoxels(p, "mirror", 0) === false);
  ok("被拒时体素一个没动", p.voxels.length === n && p.size[0] === MAX_BOX, JSON.stringify(p.size));
}

/* ---------------- 扩框 ---------------- */
{
  const p = box([4, 4, 4]);
  fillRange(p, [1, 1, 1], [2, 2, 2], "c0");
  ok("框内不需要扩", ensureRoom(p, 2, 2, 2) === false && p.size.join() === "4,4,4");
  ok("越界往正方向长", ensureRoom(p, 6, 1, 1) === true && p.size[0] === 7, JSON.stringify(p.size));
  ok("长的过程不动已有体素", p.voxels.length === 8);

  const q = box([4, 4, 4]);
  fillRange(q, [1, 1, 1], [1, 1, 1], "c0");
  q.pos = [10, 0, 0];
  ok("负方向越界也能扩", ensureRoom(q, -2, 1, 1) === true);
  ok("负方向扩框时体素整体平移", q.voxels.every((v) => v.x >= 0), JSON.stringify(q.voxels));
  // 原来框盖 0..3、内容在 x=1；往 -2 扩要把内容推到 x=3，框随之变成 0..5。
  // 世界位置不能变：推了 2 格，pos 就得往回补 2 格。
  ok("平移用 pos 补偿，世界位置不变", q.pos[0] === 8 && q.size[0] === 6 && q.voxels[0].x === 3,
    `pos=${q.pos} size=${q.size} vx=${q.voxels[0].x}`);

  const r = box([4, 4, 4]);
  ok("撞到 128 上限时返回 false", ensureRoom(r, MAX_BOX, 0, 0) === false);
}

/* ---------------- 面建造不是实心盒 ---------------- */
{
  const solid = [0, 0, 0], far = [4, 4, 0];
  const cells = faceCells(solid, far);
  ok("同一层拖出来是面不是体", cells.length === 5 * 5, `${cells.length} 格`);
  ok("面只占一层", cells.every((c) => c[2] === 0));
  const diag = faceCells([0, 0, 0], [3, 3, 3]);
  ok("斜着拖按最扁的那根轴摊成一面", diag.length === 4 * 4, `${diag.length} 格`);
  ok("单点拖就是一格", faceCells([2, 2, 2], [2, 2, 2]).length === 1);
}

/* ---------------- 旋转仍然正确 ---------------- */
{
  const p = box([4, 2, 1]);
  fillRange(p, [0, 0, 0], [3, 0, 0], "c0");
  transformVoxels(p, "rot", 1);
  ok("绕 Y 转 90° 交换 X/Z 框", p.size[0] === 1 && p.size[2] === 4, JSON.stringify(p.size));
  ok("转完体素数量不变", p.voxels.length === 4);
}


/* ---------------- glTF 导出：必须是"带骨架、带动画"的活模型 ---------------- */
{
  const doc = newDoc("导出测试", "free");
  const p = newPart("Body", [4, 4, 4]);
  doc.parts.push(p);
  fillRange(p, [0, 0, 0], [1, 1, 1], ensureColor(doc, "#ff0000", 0));
  fillRange(p, [3, 3, 3], [3, 3, 3], ensureColor(doc, "#00ff00", 0.6));
  p.rot = [0, 30, 0]; p.scale = [2, 2, 2];
  const arm = addBone(doc, "Arm", doc.bones[0]);   // addBone 收的是父骨骼对象，不是 id
  arm.position = [1, 2, 3];
  bindPart(doc, p, arm.id);
  doc.anims[0].tracks[arm.id] = [
    { f: 0, pos: [1, 2, 3], rot: [0, 0, 0], scale: [1, 1, 1], op: 1, ease: "normal" },
    { f: 12, pos: [4, 2, 3], rot: [0, 90, 0], scale: [1, 1, 1], op: 1, ease: "inout" },
    { f: 24, pos: [1, 2, 3], rot: [0, 0, 0], scale: [1, 1, 1], op: 1, ease: "step" }];
  const buf = Buffer.from(await (await toGLB(doc)).arrayBuffer());
  const jsonLen = buf.readUInt32LE(12);
  const g = JSON.parse(buf.slice(20, 20 + jsonLen).toString("utf8").replace(/\0+$/, ""));
  const names = g.nodes.map((n) => n.name);
  ok("魔数与容器：glTF 二进制、JSON 块在前、BIN 块 4 字节对齐",
    buf.readUInt32LE(0) === 0x46546C67 && buf.readUInt32LE(4) === 2 && buf.readUInt32LE(8) === buf.length
    && buf.readUInt32LE(20 + jsonLen + 4) === 0x004E4942, `magic=${buf.readUInt32LE(0).toString(16)}`);
  ok("节点树：根 → Root → Arm → 部件，部件挂在绑定它的骨骼下面",
    names.join(",") === "导出测试,Root,Arm,Body"
    && g.nodes[0].children.includes(1) && g.nodes[1].children.includes(2) && g.nodes[2].children.includes(3),
    names.join(",") + " children=" + g.nodes.map((n) => (n.children || []).join("|")).join(","));
  ok("部件节点带自己的位移/旋转/缩放（旧实现只加位移，转过的部件出去是歪的）",
    JSON.stringify(g.nodes[3].translation) === "[0,0,0]" && g.nodes[3].scale[0] === 2
    && Math.abs(Math.hypot(...g.nodes[3].rotation) - 1) < 1e-5, JSON.stringify(g.nodes[3].rotation));
  const anim = (g.animations || [])[0];
  ok("动画导出为三条通道（位移/旋转/缩放），三条共用同一条时间轴",
    !!anim && anim.channels.map((c) => c.target.path).join(",") === "translation,rotation,scale"
    && new Set(anim.samplers.map((x) => x.input)).size === 1        // 三条通道共用同一条时间轴
    && new Set(anim.samplers.map((x) => x.output)).size === 3        // 但各自一份数值
    && g.accessors[anim.samplers[0].input].count > 3
    && anim.samplers.every((x) => g.accessors[x.output].count === g.accessors[x.input].count),
    anim ? `keys=${g.accessors[anim.samplers[0].input].count} paths=${anim.channels.map((c) => c.target.path).join(",")} ins=${JSON.stringify(anim.samplers.map((x) => x.input))} outs=${anim.samplers.map((x) => g.accessors[x.output].count).join("/")} nodes=${anim.channels.map((c) => c.target.node).join(",")}` : "无动画");
  const times = [...Array(g.accessors[anim.samplers[0].input].count).keys()]
    .map((i) => buf.readFloatLE(20 + jsonLen + 8 + g.bufferViews[anim.samplers[0].input].byteOffset + i * 4));
  ok("平滑档被重采样成折线、step 档补了跳变帧（时间轴单调不减）",
    times.length > 3 && times.every((t, i) => i === 0 || t >= times[i - 1]) && times[times.length - 1] === 1,
    `n=${times.length} last=${times[times.length - 1]}`);
  ok("发光色单独成 primitive，材质带 emissiveFactor 并声明扩展",
    g.meshes[0].primitives.length === 2 && g.extensionsUsed?.includes("KHR_materials_emissive_strength")
    && g.materials[1].emissiveFactor?.[1] === 1
    && g.materials[1].extensions.KHR_materials_emissive_strength.emissiveStrength > 1,
    `prims=${g.meshes[0].primitives.length} ext=${JSON.stringify(g.extensionsUsed)}`);
  const posAcc = g.accessors[g.meshes[0].primitives[0].attributes.POSITION];
  ok("POSITION 带 min/max（glTF 强制要求，缺了三D 查看器会拒绝加载）",
    posAcc.min?.length === 3 && posAcc.max?.length === 3, JSON.stringify([posAcc.min, posAcc.max]));
  ok("欧拉角转四元数与 three 同口径：绕 Y 90° 得到 (0,0.707,0,0.707)",
    eulerToQuatXYZ(0, 90, 0).map((v) => +v.toFixed(3)).join(",") === "0,0.707,0,0.707",
    JSON.stringify(eulerToQuatXYZ(0, 90, 0)));
}

console.log(`\nvoxa: ${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
