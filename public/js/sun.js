// sun.js — 昼夜相位的唯一一份数学。
//
// 为什么单独一个文件：这段公式原来有**四份手抄副本**（main.js、ui.js 内联、
// play-src/js/play.js、game.js），其中三份用的是同一个错误式子。抽出来之后
// 编辑器的「昼夜」滑杆、「世界」页时间按钮、网页体验版和运行模式不可能再各说各话。
//
// 官方 sunPhase 约定（见 vendor/ArenaPro-CLI/server/types/GameAPI.d.ts）：
//   0 = 06:00 黎明、0.25 = 12:00 正午、0.5 = 18:00 黄昏、0.75 = 子夜
// 编辑器的 terrain.dayNight 与运行时的 world.sunPhase 都是这个 0..1 量
// （terrain.dayNight = world.time / 24000，而 time = (sunPhase + 0.25) * 24000）。
//
// 被抄错的那三份写的是 `a = (h*1.25 - 0.12)*PI`：a 只在 0..π 之间走，
// sin(a) 在 h∈(0.096, 0.896) 全程为正——太阳升起来就再也不落下去。
// 实测编辑器点「午夜」和点「正午」得到的 sunDir.y 一模一样（都是 0.793），
// 也就是说那三份里**根本不存在夜晚**。

/** 相位 0..1 → 太阳方向（未归一，长度约 1）。 */
export function sunDirFromPhase(h) {
  const p = ((h % 1) + 1) % 1;
  const th = (p - 0.25) * Math.PI * 2;
  // y 用 cos 而不是 sin：p=0.25（正午）时 th=0 → y=1 在头顶，p=0.75（子夜）→ y=-1 在脚下
  return [Math.sin(th) * 0.55, Math.cos(th), Math.sin(th * 0.5) * 0.3];
}

/**
 * 太阳高度 → 夜晚度 0..1。
 * 0.12/0.24 这组常数是原 renderer.js 里的取值，保持不变，否则昼夜时刻会整体平移，
 * 连带影响日照/半球光/环境光三档衰减。
 */
export function nightFromElev(elev) {
  return Math.max(0, Math.min(1, (0.12 - elev) / 0.24));
}
