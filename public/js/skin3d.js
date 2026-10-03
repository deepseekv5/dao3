// skin3d.js — 把 Minecraft 的 64×64 皮肤展开图套到我们的方块人偶上。
//
// 为什么要单独一个文件：MC 皮肤是**一整套 UV 约定**（哪个像素块是脸、哪块是头顶），
// 混进 makeAvatar 里会让那 60 多行"手工雕刻"的细节人偶和贴图人偶两套逻辑搅在一起。
//
// 两套人偶是有意共存的：
//   · 没有贴图 → 走原来那套带头发/领口/纽扣/腮红的细节人偶（默认外观不能是张纸片）。
//   · 有贴图   → 走这里的经典六面体，因为 MC 皮肤只有贴在这套比例上才认得出来：
//                把苦力怕的脸贴到 0.46×0.50 的圆角头上，脸会被挤到变形。
//
// UV 表照 MC 官方展开图的"十字条"排法：每个部件在图里占一条
//   第一行：[顶][底]
// 第二行：[侧面][正面][侧面][背面]
// 六块的宽度依次是 d, w, d, w（不是想当然的 d, d, w, w），顶/底是 w×d。
// 面到 BoxGeometry 的归属（+X −X +Y −Y +Z −Z）与 skinview3d 一致——
// 别按"图里靠左的那块就是角色的左手"来猜，MC 的展开图正是反的。
import * as THREE from "../vendor/three/three.module.js";

const SHEET = 64;
const PX = 1.8 / 32;        // 32 像素 = 1.8 格：腿 12 + 躯干 12 + 头 8

// box = 盒子像素尺寸；uv = 十字条左上角；joint = 关节（脚底为 y=0，正脸朝 +Z）；
// down = 这个部件从关节往下垂（手臂、腿）；outer = 外层（帽子/外套）的十字条与加厚像素。
const PARTS = [
  { name: "head", box: [8, 8, 8], uv: [0, 0], joint: [0, 24], down: false, outer: [32, 0, 1] },
  { name: "body", box: [8, 12, 4], uv: [16, 16], joint: [0, 12], down: false, outer: [16, 32, 0.5] },
  { name: "armL", box: [4, 12, 4], uv: [32, 48], joint: [6, 24], down: true, outer: [48, 48, 0.5] },
  { name: "armR", box: [4, 12, 4], uv: [40, 16], joint: [-6, 24], down: true, outer: [40, 32, 0.5] },
  { name: "legL", box: [4, 12, 4], uv: [16, 48], joint: [2, 12], down: true, outer: [0, 48, 0.5] },
  { name: "legR", box: [4, 12, 4], uv: [0, 16], joint: [-2, 12], down: true, outer: [0, 32, 0.5] },
];

/** 十字条 → 六个面的像素矩形，顺序必须与 BoxGeometry 的分组一致：+X −X +Y −Y +Z −Z。 */
function faceRects(u, v, w, h, d) {
  return [
    [u + w + d, v + d, d, h],      // +X 侧面
    [u, v + d, d, h],              // −X 侧面
    [u + d, v, w, d],              // +Y 顶
    [u + w + d, v, w, d],          // −Y 底
    [u + d, v + d, w, h],          // +Z 正面（脸）
    [u + w + 2 * d, v + d, w, h],  // −Z 背面
  ];
}

/** 按展开图重写一个 BoxGeometry 的 UV。
 *  flipY 默认 true：图像顶边在 v=1，所以矩形顶边 = 1 - y/H。
 *  只有底面要横着翻：展开图里底面是按"从下往上看"画的，不翻就是镜像的鞋底。 */
function setBoxUV(geo, u, v, w, h, d) {
  const uv = geo.attributes.uv;
  const rects = faceRects(u, v, w, h, d);
  for (let f = 0; f < 6; f++) {
    const [rx, ry, rw, rh] = rects[f];
    const u0 = rx / SHEET, u1 = (rx + rw) / SHEET;
    const vTop = 1 - ry / SHEET, vBot = 1 - (ry + rh) / SHEET;
    const b = f * 4;
    if (f === 3) {
      uv.setXY(b + 0, u0, vBot); uv.setXY(b + 1, u1, vBot);
      uv.setXY(b + 2, u0, vTop); uv.setXY(b + 3, u1, vTop);
    } else {
      uv.setXY(b + 0, u0, vTop); uv.setXY(b + 1, u1, vTop);
      uv.setXY(b + 2, u0, vBot); uv.setXY(b + 3, u1, vBot);
    }
  }
  uv.needsUpdate = true;
}

function skinMesh(w, h, d, uv, tex, centerY, outer) {
  const geo = new THREE.BoxGeometry(w * PX, h * PX, d * PX);
  setBoxUV(geo, uv[0], uv[1], w, h, d);
  const mat = new THREE.MeshStandardMaterial({
    map: tex, color: 0xffffff, roughness: 0.82, metalness: 0,
  });
  // 外层是"帽子/外套"：没画的地方必须整个丢弃，否则一层不透明的空壳把里面的皮肤糊掉
  if (outer) mat.alphaTest = 0.5;
  const m = new THREE.Mesh(geo, mat);
  // 外层与内层同心（官方就是这么摆的）：只加厚、不整体下移，
  // 否则外套盒子的底边会齐着关节往下多出一截，脚就扎进地里。
  m.position.y = centerY * PX;
  m.userData.outer = !!outer;
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

/** 加载一张 MC 皮肤。像素画必须用最近邻，否则一缩放整张脸就糊成一片色块。 */
export function loadSkinTexture(src) {
  return new Promise((resolve, reject) => {
    const tex = new THREE.TextureLoader().load(src, (t) => {
      t.magFilter = THREE.NearestFilter;
      t.minFilter = THREE.NearestFilter;
      t.generateMipmaps = false;
      t.colorSpace = THREE.SRGBColorSpace;
      resolve(tex);
    }, undefined, (err) => reject(err));
  });
}

/** 用 MC 皮肤搭一个经典六面体人偶（含外层），接口与 makeAvatar 一致：
 *  userData.parts / userData.rig.base，动画那套代码不用改就能驱动它。 */
export function buildTexturedAvatar(tex) {
  const g = new THREE.Group();
  const parts = {};
  const base = {};
  for (const p of PARTS) {
    const [w, h, d] = p.box;
    const joint = new THREE.Group();
    joint.name = p.name;
    joint.position.set(p.joint[0] * PX, p.joint[1] * PX, 0);
    const centerY = (p.down ? -1 : 1) * h / 2;
    joint.add(skinMesh(w, h, d, p.uv, tex, centerY, false));
    const [ou, ov, grow] = p.outer;
    joint.add(skinMesh(w + grow, h + grow, d + grow, [ou, ov], tex, centerY, true));
    g.add(joint);
    parts[p.name] = joint;
    base[p.name] = joint.position.y;
  }
  g.userData.parts = parts;
  g.userData.rig = { base };
  g.userData.textured = true;
  return g;
}
