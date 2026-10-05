/**
 * test/voxa.test.mjs — VOXA 模型层的回归。
 *
 * 为什么单独一份：VOXA 的这几个毛病都属于"按了有反应、结果却不是那回事"，
 * 光看界面截图看不出来——镜像和翻转的函数体曾经逐字相同，
 * serialize 少了 type 字段则要在"存一次盘 / 撤一次销"之后才暴露。
 * 所以判据全部落在纯函数上，跑得起、也钉得住。
 */
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import {
  newDoc, newPart, addPart, serialize, deserialize, transformVoxels, ensureRoom,
  faceCells, fillRange, ensureColor, setVoxel, getVoxel, MAX_BOX,
  addBone, bindPart, toGLB, eulerToQuatXYZ, stats, exposedFaces, contourEdges,
  applySkinTemplate, defaultSkinDoc, SKIN_BONES,
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
/** 导一份 .glb 并把里面的 JSON 块剥出来（glTF 的结构全在这个 JSON 里）。
 *  这里刻意按 GLTFLoader 的做法原样 parse：补齐字节要是写成了 0，这里就当场炸。 */
const glb = async (doc) => {
  const buf = Buffer.from(await (await toGLB(doc)).arrayBuffer());
  const jsonLen = buf.readUInt32LE(12);
  return { buf, jsonLen, g: JSON.parse(new TextDecoder().decode(buf.slice(20, 20 + jsonLen))) };
};

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
  const { buf, jsonLen, g } = await glb(doc);
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

/* ---------------- 真实面数：只数露出来的面 ---------------- */
// 底栏那个"面 N"以前按 体素数 × 6 算，2×2×2 报 48 面、实际只有 24 面是看得见的。
// 数字虚一倍，用户据此判断"这个模型能不能进游戏"就全判错了。
{
  const doc = newDoc("面数", "free");
  const p = newPart("Cube", [4, 4, 4]);
  doc.parts.push(p);
  const c = ensureColor(doc, "#ff8800", 0);
  fillRange(p, [0, 0, 0], [1, 1, 1], c);          // 2×2×2 = 8 个体素
  ok("遮挡剔除后的面数：2×2×2 是 24 个方格面（不是 8×6=48）",
    exposedFaces(p) === 24 && stats(doc).faces === 48, `faces=${exposedFaces(p)} tris=${stats(doc).faces}`);
  const single = newPart("One", [4, 4, 4]);
  doc.parts.push(single);
  fillRange(single, [0, 0, 0], [0, 0, 0], c);
  ok("单个体素才是 6 面，说明剔除只砍掉被邻居挡住的那些", exposedFaces(single) === 6);
  ok("统计里的部件/体素/颜色数与文档一致",
    stats(doc).parts === 2 && stats(doc).voxels === 9 && stats(doc).colors === 1, JSON.stringify(stats(doc)));
}

/* ---------------- 模型中心点(pivot)：存得住，也导得出去 ---------------- */
{
  const mk = () => {
    const doc = newDoc("中心点", "free");
    const p = newPart("Body", [4, 4, 4]);
    doc.parts.push(p);
    fillRange(p, [0, 0, 0], [1, 0, 0], ensureColor(doc, "#00ff00", 0));
    return doc;
  };
  const plain = mk();
  ok("默认中心点在原点：序列化里有这个字段，读回来还在",
    JSON.stringify(plain.pivot) === "[0,0,0]"
    && JSON.stringify(deserialize(serialize(plain)).pivot) === "[0,0,0]", JSON.stringify(plain.pivot));

  const { g: g0 } = await glb(plain);
  ok("没挪过中心点时不写多余数据：根节点无位移、文件里无 voxaPivot 标记",
    g0.nodes[0].translation === undefined && g0.extras === undefined, JSON.stringify(g0.nodes[0]));

  const doc = mk();
  doc.pivot = [2, 3, 4];
  const { g } = await glb(doc);
  ok("挪过的中心点烘进根节点位移（游戏里挂点就是这颗点）",
    JSON.stringify(g.nodes[0].translation) === "[-2,-3,-4]", JSON.stringify(g.nodes[0].translation));
  ok("同时在文件顶层留 voxaPivot 标记：世界加载那步按包围盒重新居中，会把烘进去的位移抹掉，"
    + "认这个标记才知道「作者钦过中心点，别归一」",
    JSON.stringify(g.extras?.voxaPivot) === "[2,3,4]", JSON.stringify(g.extras));
  ok("中心点跟着存盘走：撤销/读档之后不会退回原点",
    JSON.stringify(deserialize(serialize(doc)).pivot) === "[2,3,4]");
}

/* ---------------- 轮廓边缘线：只留外棱，内部缝要没了 ---------------- */
// 判据用"每条棱被几个面共用"是最直觉的写法，但它会把线全删光：
// 一个立方体的每条棱都恰好被两个（互相垂直的）面共用。所以必须分平面数。
{
  const cells = (...cs) => { const p = newPart("P", [4, 4, 4]); p.voxels = cs.map(([x, y, z]) => ({ x, y, z, c: 0 })); return p; };
  const segs = (p) => contourEdges(p).length / 6;
  const solid = cells(...[...Array(8)].map((_, i) => [(i >> 2) & 1, (i >> 1) & 1, i & 1]));
  ok("单个立方体 12 条棱一条不少", segs(cells([0, 0, 0])) === 12, `拿到 ${segs(cells([0, 0, 0]))}`);
  ok("2×2×2 实心只画外壳：24 段（每个立方体各画 12 条是 96 段）",
    segs(solid) === 24, `拿到 ${segs(solid)}`);
  ok("两根并排：中间那条缝不画，长棱按两段算 = 16",
    segs(cells([0, 0, 0], [1, 0, 0])) === 16, `拿到 ${segs(cells([0, 0, 0], [1, 0, 0]))}`);
  ok("L 形转角的两条棱是真轮廓，不能当缝删掉",
    segs(cells([0, 0, 0], [1, 0, 0], [0, 1, 0])) === 22, `拿到 ${segs(cells([0, 0, 0], [1, 0, 0], [0, 1, 0]))}`);
  ok("空部件没有线", segs(newPart("E", [4, 4, 4])) === 0);
}

/* ---------------- 换肤模板：18 根骨骼 + 可选的体素小人 ---------------- */
// 官方换肤模式打开就是"一套已绑好骨骼的角色"，所以体素小人是显式动作（withBody），
// 骨骼与关节位置则永远是那 18 个槽位。
{
  const only = newDoc("换肤作品", "skin");
  const bare = applySkinTemplate(only);
  ok("默认只铺骨骼，不再塞一个方块小人（皮肤模式打开就是一部干净的骨架）",
    bare.bones === 18 && bare.parts === 0 && only.parts.length === 0 && SKIN_BONES.every((n) => only.bones.some((b) => b.name === n)));
  const doc = newDoc("换肤作品", "skin");
  const r = applySkinTemplate(doc, true);
  const byId = new Map(doc.bones.map((b) => [b.id, b]));
  const abs = (name) => {
    const b = doc.bones.find((x) => x.name === name);
    let p = [0, 0, 0], c = b;
    while (c) { p = p.map((v, i) => v + c.position[i]); c = byId.get(c.parent); }
    return p;
  };
  ok("18 根人形骨骼全部建出，且都有父级链", r.bones === 18 && SKIN_BONES.every((n) => doc.bones.some((b) => b.name === n)));
  ok("髋在 8 格高、胸/颈/头依次向上", abs("hips")[1] === 8 && abs("torso")[1] === 11 && abs("head")[1] > abs("neck")[1]);
  ok("四肢有横向偏移（旧模板全是竖直偏移，肘与肩叠在同一根柱子上）",
    abs("leftUpperArm")[0] < -3 && abs("rightUpperArm")[0] > 2 && abs("leftLowerLeg")[0] < 0 && abs("rightLowerLeg")[0] > 0,
    JSON.stringify({ le: abs("leftUpperArm"), re: abs("rightUpperArm") }));
  ok("左右对称：两只手到身体中线的距离一样",
    Math.abs((abs("leftHand")[0] + abs("rightHand")[0]) + 1) < 0.01,
    JSON.stringify([abs("leftHand")[0], abs("rightHand")[0]]));
  ok("T 字人形有身体：15 个部件、每个都有体素且都绑到一根骨骼",
    doc.parts.length === 15 && r.parts === 15 && doc.parts.every((p) => p.voxels.length && p.bone && byId.has(p.bone)),
    `parts=${doc.parts.length} voxels=${doc.parts.reduce((a, p) => a + p.voxels.length, 0)}`);
  // 官方口径：换肤模式只能改"各部件绑定骨骼节点的偏移"——所以部件 pos 必须是
  // 相对所绑骨骼的。渲染层与 toGLB 都按父子链走，写绝对位置会累加两次父偏移，
  // 小人就散架（这正是上一版"部件乱飞"的真因）。
  const headPart = doc.parts.find((p) => p.name === "头");
  const world = (p) => {
    let v = p.pos.slice(), c = byId.get(p.bone);
    while (c) { v = v.map((a, i) => a + c.position[i]); c = byId.get(c.parent); }
    return v;
  };
  ok("部件位置 = 绝对位置 − 所绑骨骼位置（沿父链求和后回到表格里的关节）",
    world(headPart).map((v) => Math.round(v)).join(",") === "-4,16,-3",
    JSON.stringify({ local: headPart.pos, world: world(headPart) }));
  const modeC = (list) => {
    const t = new Map();
    for (const v of list) t.set(v.c, (t.get(v.c) || 0) + 1);
    let best = null, n = -1;
    for (const [c, k] of t) if (k > n) { best = c; n = k; }
    return best;
  };
  const head = headPart;
  const front = head.size[2] - 1;
  const face = modeC(head.voxels.filter((v) => v.z === front && v.y >= 2 && v.y <= 4));
  const hair = modeC(head.voxels.filter((v) => v.y >= head.size[1] - 2));
  ok("头上有头发、脸、眼睛三种以上颜色，且头顶那两层不是脸色的",
    new Set(head.voxels.map((v) => v.c)).size >= 3 && hair !== face,
    `colors=${new Set(head.voxels.map((v) => v.c)).size} hair=${hair} face=${face}`);
  const groups = [...new Set(doc.palette.map((c) => c.g))];
  ok("色板给的是命名色组：肤色 + 衣服", groups.includes("肤色") && groups.includes("衣服"), groups.join("/"));
  const again = applySkinTemplate(doc, true);
  ok("重复点「体素小人」不会把人变成两个", again.parts === 0 && doc.parts.length === 15);
  const { g } = await glb(doc);
  const names = new Set(g.nodes.map((n) => n.name));
  ok("导出的 .glb 里 18 根骨骼名齐全（换肤作品能当骨骼皮肤穿的唯一前提）",
    SKIN_BONES.every((n) => names.has(n)), [...names].slice(0, 6).join(","));
  // 骨骼树必须真的成树：部件节点要挂在它那根骨骼下面，不是全平铺在根上
  const nodeOf = (n) => g.nodes.find((x) => x.name === n);
  const childOfArm = nodeOf("leftUpperArm").children || [];
  ok("glb 里部件是骨骼的子节点、骨骼按父子链成树（平铺出去游戏里四肢不会跟着躯干）",
    childOfArm.length > 0 && (nodeOf("leftShoulder").children || []).includes(g.nodes.indexOf(nodeOf("leftUpperArm"))),
    JSON.stringify({ arm: childOfArm, shoulder: (nodeOf("leftShoulder").children || []).length }));
}

/* ---------------- 内置默认皮肤：打开 VOXA 就是那台已绑骨骼的机甲 ---------------- */
{
  const doc = defaultSkinDoc();
  ok("默认皮肤是换肤作品：18 根骨骼已铺好，底模是内置机甲，不再自带方块小人",
    doc.type === "skin" && SKIN_BONES.every((n) => doc.bones.some((b) => b.name === n))
    && doc.parts.length === 0 && !!doc.ref && doc.ref.model === "/skins/atlas-09.glb",
    JSON.stringify({ type: doc.type, parts: doc.parts.length, bones: doc.bones.length, ref: doc.ref && doc.ref.model }));
  // 机甲本身没有 neck 关节（节点表里就是 head 直接挂 chest），所以缺 neck 是对的；
  // 判据落在"姿态真会写的那 10 个挂点一个都不能少"，而不是凑满 18 这个数字。
  const DRIVE_SLOTS = ["head", "torso", "leftUpperArm", "rightUpperArm", "leftUpperLeg", "rightUpperLeg",
    "leftLowerArm", "rightLowerArm", "leftLowerLeg", "rightLowerLeg"];
  const missed = SKIN_BONES.filter((s) => !doc.ref.bones[s]);
  ok("默认皮肤的关节映射覆盖姿态要驱动的全部 10 个挂点，缺口只有机甲本来就没有的 neck",
    DRIVE_SLOTS.every((s) => doc.ref.bones[s]) && missed.join(",") === "neck",
    `缺 ${missed.join(",")}`);
  ok("底模文件确实在库里（public/skins/atlas-09.glb）",
    !!doc.ref.model && fs.existsSync(path.join(ROOT, "public/skins/atlas-09.glb")));
  ok("色板照旧给肤色/衣服两组（在机甲上涂体素用的就是它）",
    ["肤色", "衣服"].every((g) => doc.palette.some((c) => c.g === g)), [...new Set(doc.palette.map((c) => c.g))].join("/"));
  const back = deserialize(serialize(doc));
  ok("ref 跟着存盘走：往返一次还是那台机甲（丢了它，穿上就不知道用哪副骨架）",
    back.ref && back.ref.model === doc.ref.model && back.ref.bones.head === "head" && back.type === "skin");
  const body = defaultSkinDoc("体素皮肤", true);
  ok("想要方块小人仍然给：withBody=true 出 15 个绑好的部件",
    body.parts.length === 15 && body.parts.every((p) => p.bone) && !!body.ref);
  const again = defaultSkinDoc("另一份");
  ok("每次取默认皮肤都是干净的一份（不共享上一次的骨骼对象）",
    again.name === "另一份" && again.bones[1] !== doc.bones[1] && again.bones.length === doc.bones.length);
}

console.log(`\nvoxa: ${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
