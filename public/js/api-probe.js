// api-probe.js — 运行时 API 对账：拿 scripts/api-audit.mjs 生成的官方成员清单，
// 逐个检查真实运行中的 world / entity / player / voxels 是否具备。
// 用法（浏览器控制台）：(await import('/js/api-probe.js')).probe()
export async function probe() {
  const spec = await (await fetch("/data/api-members.json")).json();
  const mspec = await (await fetch("/data/api-methods.json")).json();
  const g = window.__game;
  if (!g || !g.running) return { error: "运行模式未启动：先点右上角 ▶ 或 __editor.enterPlay()" };
  const w = g._globals().world;
  const ent = g.playerEntity;
  const pl = g.player;
  const vox = g._globals().voxels;
  const targets = { GameWorld: w, GameEntity: ent, GamePlayer: pl, GameVoxels: vox };
  const out = {};
  let total = 0, missingAll = [], badKindAll = [];
  for (const [cls, obj] of Object.entries(targets)) {
    const names = spec[cls] || [];
    const missing = names.filter((k) => {
      try { return obj[k] === undefined; } catch { return true; }
    });
    // 官方声明成方法的成员必须真的可调用（实现成属性也算不达标）
    const notCallable = (mspec[cls] || []).filter((k) => {
      try { return typeof obj[k] !== "function"; } catch { return true; }
    });
    total += names.length;
    missingAll = missingAll.concat(missing.map((m) => cls + "." + m));
    badKindAll = badKindAll.concat(notCallable.map((m) => cls + "." + m));
    out[cls] = { official: names.length, ok: names.length - missing.length, missing, notCallable };
  }
  return {
    per: out, total, missingCount: missingAll.length, coverage: +(100 * (1 - missingAll.length / total)).toFixed(1),
    missing: missingAll, badKind: badKindAll, kindOk: badKindAll.length === 0,
  };
}
if (typeof window !== "undefined") window.__apiProbe = probe;
