// skin-sheet.js — MC 皮肤展开图里"看得懂"的那一半：预设清单、脸在哪一格、什么文件能当皮肤。
//
// 为什么不放在 skin3d.js 里：skin3d.js 要拖 three.js。个人资料页只需要裁一张脸当
// 缩略图和校验用户上传的图，为了四个预设按钮把渲染引擎拉进社区页不值当。
// 几何 UV 表在 skin3d.js，这里是展示与录入。

export const SHEET = 64;                 // 展开图固定 64×64
export const FACE_RECT = [8, 8, 8, 8];   // 正脸那块像素矩形（x, y, w, h）

/** 随包附带的 MC 皮肤预设。文件名即 public/img/skins/ 下的图片。 */
export const MC_PRESETS = [
  { file: "creeper-tnt.png", name: "TNT 苦力怕" },
  { file: "dream.png", name: "Dream 风格" },
  { file: "pastel-maid.png", name: "粉白女仆" },
  { file: "pixel-hero.png", name: "像素旅人" },
];
export const presetUrl = (file) => "/img/skins/" + file;

// 裁脸是异步的（要等 Image.onload），先用一个 1px 透明 gif 占位，卡片不会闪一下空白
export const FACE_PLACEHOLDER = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

const _faceCache = new Map();

/** 取展开图正脸那一格放大成缩略图。
 *  整张 64×64 塞进小卡里读不出是谁，而脸那一格恰好就是"认得出"的部分。
 *  皮肤库与个人资料页共用这一个实现：两边各裁一份，早晚裁成两个位置。 */
export function facePreview(src) {
  if (!src) return Promise.resolve(null);
  if (_faceCache.has(src)) return _faceCache.get(src);
  const p = new Promise((res) => {
    const im = new Image();
    im.onload = () => {
      try {
        const c = document.createElement("canvas");
        c.width = c.height = 64;
        const g = c.getContext("2d");
        g.imageSmoothingEnabled = false;   // 像素画一平滑就是一团糊，脸直接没了
        g.drawImage(im, ...FACE_RECT, 0, 0, 64, 64);
        res(c.toDataURL("image/png"));
      } catch { res(null); }        // 跨域图会在这一步抛，宁可留占位图
    };
    im.onerror = () => res(null);
    im.src = src;
  });
  _faceCache.set(src, p);
  return p;
}

export const MAX_SKIN_BYTES = 300 * 1024;   // 64×64 的 PNG 一般 1~3KB，超 300KB 的一定不是皮肤

/** 读一张本地皮肤图，不合格就抛中文消息（消息直接给用户看）。
 *  两个入口（皮肤库、个人资料）必须卡同一套口径，各写一份早晚分歧。
 *  尺寸卡死是因为 UV 表按 64×64 排：拿 1200×1600 的照片贴上去不会报错，
 *  只会得到六块被切烂的陌生色块——比不贴更糟。 */
export async function readSkinFile(file) {
  if (!file) throw new Error("没选中文件");
  if (file.size > MAX_SKIN_BYTES) {
    throw new Error(`这张图 ${Math.round(file.size / 1024)}KB，太大了：皮肤是 64×64 的像素图`);
  }
  const dataUrl = await new Promise((res) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => res(null);
    r.readAsDataURL(file);
  });
  if (!dataUrl) throw new Error("读不出来，换一张 PNG 试试");
  const dim = await new Promise((res) => {
    const im = new Image();
    im.onload = () => res({ w: im.naturalWidth, h: im.naturalHeight });
    im.onerror = () => res(null);
    im.src = dataUrl;
  });
  if (!dim) throw new Error("这张图打不开");
  if (dim.w !== SHEET || dim.h !== SHEET) {
    // 只认 64×64：旧版 64×32 没有左臂/左腿的格子，靠渲染时镜像右肢补，
    // 我们的 UV 表按 64×64 排，喂旧图只会得到两只长反的袖子。
    throw new Error(dim.w === SHEET && dim.h === 32
      ? "这是 64×32 的旧版展开图（左臂左腿没有自己的格子），请先在皮肤编辑器里另存为 64×64"
      : `皮肤要是 64×64 的 MC 展开图，这张是 ${dim.w}×${dim.h}`);
  }
  return { dataUrl, ...dim };
}

/** 起个文件名：去掉扩展名、压掉路径和奇怪字符，最长 24。 */
export function skinNameFrom(file, fallback) {
  const base = String((file && file.name) || "").replace(/\.(png|jpe?g|webp)$/i, "").replace(/[\\/:*?<>|"']/g, "").trim();
  return (base || fallback || "我的皮肤").slice(0, 24);
}
