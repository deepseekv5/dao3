// skin-rig.js — 「骨骼皮肤」：把一台带骨架的 glTF 模型（机甲那类）映射到官方
// 18 个 GameBodyPart 上，然后让我们**现有的**程序化姿态去驱动它的关节。
//
// 为什么是"映射 + 重定向"而不是"直接放它自带的动画剪辑"：
// 自带的 Walk/Run 剪辑按它自己的节拍与位移做的，接不进我们的移动状态机
// （速度、腾空、游泳、飞行都是实时算出来的），一播就变成"脚在动、人滑走"。
// 反过来把人偶姿态写到它的骨骼上，动作与物理永远一致，也不需要它带剪辑。
//
// 关节名映射解决"哪根是什么"，轴向推导解决"绕哪根轴摆才对"：每根骨骼的局部
// 坐标系是建模软件给的，朝向可能任意。做法是把模型朝向换算成两条期望的世界轴
// （前后摆 = 绕左右轴、外张 = 绕前后轴），在该骨骼的三条局部轴里挑最接近的那条、
// 符号取点积。所以只要 facing 选对，整套骨架一次到位；选错了预览里立刻看得出来。
import * as THREE from "../vendor/three/three.module.js";
import { GLTFLoader } from "../vendor/three/GLTFLoader.js";
import { makeAvatar, blobShadowMesh } from "./avatar.js";

// 官方 GameBodyPart 的 18 个槽位（与 gapi.js 那份枚举同名，别在这里改出第二套口径）
export const SLOTS = ["hips", "torso", "neck", "head",
  "leftShoulder", "leftUpperArm", "leftLowerArm", "leftHand",
  "rightShoulder", "rightUpperArm", "rightLowerArm", "rightHand",
  "leftUpperLeg", "leftLowerLeg", "leftFoot",
  "rightUpperLeg", "rightLowerLeg", "rightFoot"];

// 姿态驱动真正会写的十个挂点：六块 + 四个二级关节
export const DRIVE = ["head", "body", "armL", "armR", "legL", "legR", "elbowL", "elbowR", "kneeL", "kneeR"];
const PART_KEYS = ["head", "body", "armL", "armR", "legL", "legR"];
// 每个挂点对应官方槽位里的哪一根（二级关节用它的上一段：肘挂在小臂上、膝挂在小腿上）
const SLOT_OF = {
  head: "head", body: "torso", armL: "leftUpperArm", armR: "rightUpperArm",
  legL: "leftUpperLeg", legR: "rightUpperLeg",
  elbowL: "leftLowerArm", elbowR: "rightLowerArm", kneeL: "leftLowerLeg", kneeR: "rightLowerLeg",
};
// 人偶基准高（game.js 里细节人偶的头顶高度），机甲按它归一
export const AVATAR_H = 1.82;

/* ---------------- 关节名识别 ---------------- */
// 各家骨架叫法差得很远（mixamo 前缀、UE5 的 hand_l、Blender 的 .L 后缀），
// 所以按"槽位 → 一组正则"来认，而不是硬编码某一台模型的名字。
const ALIAS = {
  hips: [/hip|pelvis|waist|cog/i],
  torso: [/chest|torso|abdomen|spine[ _-]?0?1\b|body/i],
  neck: [/neck|cervical/i],
  head: [/head|cranium/i],
  leftShoulder: [/shoulder\.?l\b|l_?shoulder|clavicle\.?l|l_?clavicle|left_?shoulder/i],
  rightShoulder: [/shoulder\.?r\b|r_?shoulder|clavicle\.?r|r_?clavicle|right_?shoulder/i],
  leftUpperArm: [/upper_?arm\.?l\b|l_?upper_?arm|left_?upper_?arm|arm\.?l\b|l_?arm\b|left_?arm\b/i],
  rightUpperArm: [/upper_?arm\.?r\b|r_?upper_?arm|right_?upper_?arm|arm\.?r\b|r_?arm\b|right_?arm\b/i],
  leftLowerArm: [/lower_?arm\.?l|l_?lower_?arm|left_?lower_?arm|forearm\.?l|l_?forearm|left_?forearm|elbow\.?l|l_?elbow/i],
  rightLowerArm: [/lower_?arm\.?r|r_?lower_?arm|right_?lower_?arm|forearm\.?r|r_?forearm|right_?forearm|elbow\.?r|r_?elbow/i],
  leftHand: [/hand\.?l\b|l_?hand\b|left_?hand|wrist\.?l|l_?wrist/i],
  rightHand: [/hand\.?r\b|r_?hand\b|right_?hand|wrist\.?r|r_?wrist/i],
  leftUpperLeg: [/thigh\.?l|l_?thigh|left_?thigh|upper_?leg\.?l|l_?upper_?leg|left_?upper_?leg/i],
  rightUpperLeg: [/thigh\.?r|r_?thigh|right_?thigh|upper_?leg\.?r|r_?upper_?leg|right_?upper_?leg/i],
  leftLowerLeg: [/shin\.?l|l_?shin|calf\.?l|l_?calf|left_?shin|lower_?leg\.?l|l_?lower_?leg|left_?lower_?leg/i],
  rightLowerLeg: [/shin\.?r|r_?shin|calf\.?r|r_?calf|right_?shin|lower_?leg\.?r|r_?lower_?leg|right_?lower_?leg/i],
  leftFoot: [/foot\.?l|l_?foot|left_?foot|ankle\.?l|l_?ankle|toe\.?l/i],
  rightFoot: [/foot\.?r|r_?foot|right_?foot|ankle\.?r|r_?ankle|toe\.?r/i],
};

/** 给一组候选关节名，返回 {槽位: 关节名}。认不出的留空，由导入对话框手选。 */
export function autoMap(names) {
  const list = (names || []).filter((n) => typeof n === "string" && n);
  const out = {};
  const used = new Set();
  // 先认带侧向的（更具体），再认中线的，免得 "left arm" 抢走 "shoulder" 的候选
  const order = SLOTS.filter((s) => !["hips", "torso", "neck", "head"].includes(s))
    .concat(["hips", "torso", "neck", "head"]);
  for (const slot of order) {
    for (const re of ALIAS[slot] || []) {
      const hit = list.find((n) => !used.has(n) && re.test(n));
      if (hit) { out[slot] = hit; used.add(hit); break; }
    }
  }
  return out;
}

/* ---------------- 加载与关节枚举 ---------------- */
// 字节按 URL 缓存一份：同屏四个玩家穿同一台机甲，不该拉四次 6.8MB。
// 但**解析**必须每个实体各来一遍——GLTFLoader 之外没有现成的 SkeletonUtils，
// 而 Object3D.clone() 出来的 SkinnedMesh 仍然绑在原来那套骨骼上，
// 驱动克隆体的骨骼不会让它变形（表现就是"模型纹丝不动"）。
const _bytes = new Map();
export async function loadRigScene(url) {
  let buf = _bytes.get(url);
  if (!buf) {
    const r = await fetch(url);
    if (!r.ok) throw new Error("模型读不出来：" + r.status);
    buf = await r.arrayBuffer();
    _bytes.set(url, buf);
  }
  return await new Promise((res, rej) => new GLTFLoader().parse(buf, "", (g) => res(g.scene), rej));
}

/** 场景里所有能当骨骼用的节点名（有名字、不是叶子网格）。 */
export function boneNames(scene) {
  const out = [];
  scene.traverse((o) => {
    if (!o || o === scene || !o.name || o.isMesh || o.isCamera || o.isLight) return;
    out.push(o.name);
  });
  return out;
}

/* ---------------- 轴向推导 ---------------- */
const AXES = ["x", "y", "z"];
const _q = new THREE.Quaternion();

/** 该骨骼局部坐标系里最接近目标世界轴的那条轴（含符号）。 */
function nearestAxis(bone, target) {
  bone.getWorldQuaternion(_q);
  let best = null;
  for (let i = 0; i < 3; i++) {
    const v = new THREE.Vector3(i === 0 ? 1 : 0, i === 1 ? 1 : 0, i === 2 ? 1 : 0).applyQuaternion(_q).normalize();
    const d = v.dot(target);
    if (!best || Math.abs(d) > Math.abs(best.d)) best = { ax: AXES[i], sign: d < 0 ? -1 : 1, d };
  }
  return { ax: best.ax, sign: best.sign };
}

const FACINGS = { "+z": [0, 0, 1], "-z": [0, 0, -1], "+x": [1, 0, 0], "-x": [-1, 0, 0] };

/**
 * 从骨架自己的几何推"这台模型脸朝哪"：左→右那根轴与"上"叉乘就是前。
 * 为什么要推而不是让人填四选一：作者自己也不知道 Blender 导出的这台朝 +Z 还是 -Z，
 * 填错的表现是"走路时两条腿往左右劈"，而这完全可以由左右肩/左右腿的位置算出来。
 * 推不出来（缺成对关节）才退回 +Z，并在导入对话框里留一个手动翻转。
 */
export function deriveFacing(scene, map) {
  const byName = new Map();
  scene.traverse((o) => { if (o.name && !byName.has(o.name)) byName.set(o.name, o); });
  const pos = (slot) => {
    const b = byName.get((map || {})[slot]);
    return b ? b.getWorldPosition(new THREE.Vector3()) : null;
  };
  const pairs = [["rightShoulder", "leftShoulder"], ["rightUpperArm", "leftUpperArm"],
    ["rightUpperLeg", "leftUpperLeg"], ["rightHand", "leftHand"], ["rightFoot", "leftFoot"]];
  const acc = new THREE.Vector3();
  let n = 0;
  for (const [a, b] of pairs) {
    const pa = pos(a), pb = pos(b);
    if (!pa || !pb) continue;
    const d = pa.sub(pb); d.y = 0;
    if (d.lengthSq() < 1e-8) continue;
    acc.add(d.normalize()); n++;
  }
  if (!n || acc.lengthSq() < 1e-8) return new THREE.Vector3(0, 0, 1);
  acc.normalize();
  return new THREE.Vector3().crossVectors(acc, new THREE.Vector3(0, 1, 0)).normalize();
}

/**
 * 十个驱动挂点各自的 {x:{ax,sign}, z:{ax,sign}}：x 是"前后摆"（绕模型的左右轴），
 * z 是"外张"（绕模型的前后轴）。map 里缺关节就跳过那个挂点（等于不驱动）。
 */
export function deriveAxes(scene, map, facing = "+z") {
  scene.updateMatrixWorld(true);
  const byName = new Map();
  scene.traverse((o) => { if (o.name && !byName.has(o.name)) byName.set(o.name, o); });
  const fwd = (facing instanceof THREE.Vector3) ? facing.clone()
    : new THREE.Vector3(...(FACINGS[facing] || FACINGS["+z"]));
  if (!fwd.lengthSq()) fwd.set(0, 0, 1);
  fwd.y = 0; if (!fwd.lengthSq()) fwd.set(0, 0, 1); fwd.normalize();
  const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), fwd).normalize();
  const out = {};
  for (const key of DRIVE) {
    const bone = byName.get((map || {})[SLOT_OF[key]]);
    if (!bone) continue;
    out[key] = { x: nearestAxis(bone, right), z: nearestAxis(bone, fwd) };
  }
  return out;
}

/* ---------------- 装配成可穿的人偶 ---------------- */
const AXISV = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };

/** 写法转发器：把 _updateAvatar 写的 rotation.x/.z 合成成"骨骼自身四元数 = 静息 × 增量"。
 *  必须在骨骼自己身上转：往骨骼下挂一个空物体再转它，只会旋到它的子树，
 *  而关节链里下一段骨骼是这个骨骼的兄弟、不是那个空物体的孩子——结果就是位移全为 0。 */
function jointProxy(bone, spec) {
  const rest = bone.quaternion.clone();
  const q1 = new THREE.Quaternion(), q2 = new THREE.Quaternion();
  const st = { x: 0, z: 0 };
  const apply = () => {
    q1.setFromAxisAngle(AXISV[spec.x ? spec.x.ax : "x"], st.x * ((spec.x && spec.x.sign) || 1));
    q2.setFromAxisAngle(AXISV[spec.z ? spec.z.ax : "z"], st.z * ((spec.z && spec.z.sign) || 1));
    bone.quaternion.copy(rest).multiply(q1).multiply(q2);
  };
  return {
    object3d: bone,
    position: bone.position,
    rotation: {
      get x() { return st.x; }, set x(v) { st.x = v; apply(); },
      get z() { return st.z; }, set z(v) { st.z = v; apply(); },
      get y() { return 0; }, set y(_) { /* 骨架不做 yaw 驱动：转向由实体自己转 */ },
    },
    reset() { st.x = st.z = 0; bone.quaternion.copy(rest); },
  };
}

/**
 * 把一台模型 + 映射表装成与 game.js makeAvatar() 同一份契约的对象：
 * userData.parts / userData.rig。rig.base 故意留空 = 不做上下起伏，
 * 骨骼整体平移会把骨架从根上拔出来，看着像模型在抽搐。
 */
export function assembleRig(scene, rec) {
  const map = (rec && rec.bones) || {};
  // 没给轴向表就现场推一遍：内置预设只需要写"哪个关节是什么"，
  // 换一台模型、甚至作者改了骨架朝向，也不需要有人去手填十组轴。
  let axes = rec && rec.axes && Object.keys(rec.axes).length ? rec.axes : null;
  if (!axes) {
    scene.updateMatrixWorld(true);
    const lbl = rec && rec.facing;
    let fwd = FACINGS[lbl] ? new THREE.Vector3(...FACINGS[lbl]) : deriveFacing(scene, map);
    if (rec && Number(rec.flip) < 0) fwd.multiplyScalar(-1);
    axes = deriveAxes(scene, map, fwd);
  }
  scene.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  // 归一到人偶身高：模型按作者给的尺寸建模，进我们的世界必须和方块对得上
  const box = new THREE.Box3().setFromObject(scene);
  const h = box.max.y - box.min.y;
  const s = (Number(rec && rec.scale) > 0 ? Number(rec.scale) : 1) * (h > 1e-4 ? AVATAR_H / h : 1);
  const wrap = new THREE.Group();
  wrap.add(scene);
  wrap.scale.setScalar(s);
  wrap.position.set(-(box.min.x + box.max.x) / 2 * s, -box.min.y * s, -(box.min.z + box.max.z) / 2 * s);
  const g = new THREE.Group();
  g.add(wrap);
  g.userData.rigSkin = true;

  const byName = new Map();
  scene.traverse((o) => { if (o.name && !byName.has(o.name)) byName.set(o.name, o); });
  const parts = {}, rig = { base: {} };
  for (const key of DRIVE) {
    const bone = byName.get(map[SLOT_OF[key]]);
    if (!bone) continue;
    const spec = axes[key] || { x: { ax: "x", sign: 1 }, z: { ax: "z", sign: 1 } };
    const p = jointProxy(bone, spec);
    (PART_KEYS.includes(key) ? parts : rig)[key] = p;
  }
  g.userData.joints = Object.values(parts).concat(Object.values(rig).filter((x) => x && x.reset));
  g.userData.parts = parts;
  g.userData.rig = rig;
  return g;
}

export async function buildRigAvatar(rec) {
  if (!rec || !rec.model) return null;
  return assembleRig(await loadRigScene(rec.model), rec);
}

/** 走路姿态：与 game.js _updateAvatar 同一套公式，导入对话框的预览靠它自检映射对不对。 */
export function poseWalk(av, t, amp = 0.52) {
  const parts = av.userData.parts || {};
  const rig = av.userData.rig || {};
  const s = Math.sin(t) * amp;
  if (parts.legL) parts.legL.rotation.x = s;
  if (parts.legR) parts.legR.rotation.x = -s;
  if (parts.armL) parts.armL.rotation.x = -s * 0.85;
  if (parts.armR) parts.armR.rotation.x = s * 0.85;
  if (rig.kneeL) rig.kneeL.rotation.x = Math.max(0, parts.legL ? parts.legL.rotation.x : 0) * 0.95;
  if (rig.kneeR) rig.kneeR.rotation.x = Math.max(0, parts.legR ? -parts.legR.rotation.x : 0) * 0.95;
  const elbowOf = (a) => -(0.2 + 0.5 * Math.max(0, -a));
  if (rig.elbowL) rig.elbowL.rotation.x = elbowOf(parts.armL ? parts.armL.rotation.x : 0);
  if (rig.elbowR) rig.elbowR.rotation.x = elbowOf(parts.armR ? parts.armR.rotation.x : 0);
  if (parts.armL) parts.armL.rotation.z = -0.05;
  if (parts.armR) parts.armR.rotation.z = 0.05;
  if (parts.body) parts.body.rotation.x = amp * 0.1;
  if (parts.head) parts.head.rotation.x = -amp * 0.05;
}

/** 映射覆盖度：驱动链路里缺哪几段。缺胳膊少腿时提示用户，而不是默默不动。 */
export function missingJoints(map) {
  const need = ["head", "torso", "leftUpperArm", "rightUpperArm", "leftUpperLeg", "rightUpperLeg"];
  const labels = { head: "头", torso: "躯干", leftUpperArm: "左上臂", rightUpperArm: "右上臂", leftUpperLeg: "左大腿", rightUpperLeg: "右大腿" };
  return need.filter((k) => !(map || {})[k]).map((k) => labels[k]);
}

/* ---------------- 预览：走路循环 ---------------- */
/** 一个能站住人的小舞台：画布、灯光、相机、循环都在这里，内容谁给都行。
 *  灯光刻意与运行时同一取向（半球天光 + 一盏主光），因为"主页上好看、进图变灰"
 *  多半就是预览打光比场景里讲究。 */
function makeStage(host, { w = 230, h = 270 }) {
  const cv = document.createElement("canvas");
  cv.width = w; cv.height = h;
  cv.style.width = w + "px"; cv.style.height = h + "px";
  host.appendChild(cv);
  const renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setClearColor(0x000000, 0);
  const sc = new THREE.Scene();
  sc.add(new THREE.HemisphereLight(0xffffff, 0x2a3040, 2.3));
  const key = new THREE.DirectionalLight(0xffffff, 1.3); key.position.set(3, 5, 4); sc.add(key);
  const cam = new THREE.PerspectiveCamera(34, w / h, 0.05, 60);
  cam.position.set(2.9, 1.55, 2.6); cam.lookAt(0, 0.9, 0);
  let t = 0, raf = 0, dead = false, last = performance.now();
  return {
    get dead() { return dead; },
    /** 内容准备好之后再开循环：早开一帧就是拍封面时抓到空背景。 */
    start(obj, pose) {
      sc.add(obj);
      const loop = () => {
        if (dead) return;
        const now = performance.now();
        t += (now - last) / 1000 * 7; last = now;
        if (pose) pose(obj, t);
        renderer.render(sc, cam);
        raf = requestAnimationFrame(loop);
      };
      loop();
    },
    remove(obj) { sc.remove(obj); },
    stop() { dead = true; cancelAnimationFrame(raf); renderer.dispose(); cv.remove(); },
    /** 抓一张当卡片缩略图/发布封面：省得皮肤库还要为骨骼皮肤另想一套渲染 */
    snap() { try { return cv.toDataURL("image/png"); } catch { return null; } },
  };
}

/** 在给定容器里起一个小画布，用**运行时同一套**姿态公式驱动这台模型。
 *  映射对不对只有动起来才看得出来——静着一张图，前后摆和左右劈长得一模一样。 */
export function previewRig(host, rec, { w = 230, h = 270, walk = true } = {}) {
  const stage = makeStage(host, { w, h });
  loadRigScene(rec.model).then((scene) => {
    if (stage.dead) return;
    stage.start(assembleRig(scene, rec), walk ? (o, t) => poseWalk(o, t, 0.52) : null);
  }).catch(() => {
    host.appendChild(document.createTextNode("预览读不出这个模型"));
    stage.stop();
  });
  return stage;
}

/** 人偶（体素配色 / MC 贴图皮肤）的预览：直接吃 avatar.js 那一份几何，
 *  所以这张脸就是进图之后那张脸，没有第二套画法可以漂移。 */
export function previewAvatar(host, avatar, { w = 230, h = 270, walk = true } = {}) {
  const stage = makeStage(host, { w, h });
  const blob = blobShadowMesh();
  blob.visible = true; blob.scale.setScalar(1.15);
  const wrap = new THREE.Group();
  wrap.add(avatar); wrap.add(blob);
  stage.start(wrap, walk ? (o, t) => poseWalk(avatar, t, 0.52) : null);
  return stage;
}

/** 三种皮肤走同一个入口：骨骼皮肤上真模型，其余用人偶几何。
 *  调用方（个人主页、皮肤面板）不该自己去判断 kind。 */
export function previewSkin(host, skin, opts = {}) {
  const s = skin && typeof skin === "object" ? skin : {};
  if (s.kind === "rig" && s.model) return previewRig(host, s, opts);
  return previewAvatar(host, makeAvatar(s), opts);
}

/** 会随配色实时换装的那一份预览：编辑资料弹窗里挑颜色时用。
 *  以前这里是一张纯 CSS 纸片人（五个 div），于是"挑颜色时看到的"和"进图之后的"
 *  是两个东西——纸片人不会显示领口、袖口、鞋底、眉毛这些运行时才有的细节。
 *  set() 只换材质色重搭一具人偶（37 块网格，比一次布局还便宜），不换画布，
 *  所以自定义取色器在系统面板里连续拖动时不会闪。 */
export function liveAvatar(host, skin, opts = {}) {
  const stage = makeStage(host, opts);
  let cur = null;
  const set = (next) => {
    const g = makeAvatar(next || {});
    const blob = blobShadowMesh();
    blob.visible = true; blob.scale.setScalar(1.15);
    g.userData.blob = blob;
    if (cur) {
      stage.remove(cur);
      cur.traverse((o) => { if (o.isMesh) o.material.dispose(); });
    }
    const wrap = new THREE.Group();
    wrap.add(g); wrap.add(blob);
    stage.start(wrap, (o, t) => poseWalk(g, t, 0.52));
    cur = wrap;
  };
  set(skin);
  return {
    set,
    stop() { if (cur) cur.traverse((o) => { if (o.isMesh) o.material.dispose(); }); cur = null; stage.stop(); },
    snap: () => stage.snap(),
  };
}
