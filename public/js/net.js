// net.js — 联机通道的客户端：只负责收发与重连，不认识 three.js。
//
// 分成两层是因为：帧格式、节流、断线重连这些是传输问题；
// 而"远端玩家该长什么样、怎么插值"是渲染问题。混在一起写过一次，
// 结果是想单测传输层就必须把编辑器拖进来。
const backoff = [0, 1200, 2500, 5000, 10000];

export function connect(opts) {
  const { pubId, on } = opts;
  let ws = null, tries = 0, closedByUs = false, hb = null;
  const url = () => `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws/play/${encodeURIComponent(pubId)}`;

  function emit(kind, msg) { const f = on[kind]; if (f) f(msg); }

  function send(obj) {
    if (!ws || ws.readyState !== 1) return false;
    try { ws.send(JSON.stringify(obj)); return true; } catch { return false; }
  }

  function open() {
    if (closedByUs) return;
    emit("status", { connected: false, trying: tries });
    ws = new WebSocket(url());
    ws.onopen = () => {
      tries = 0;
      emit("status", { connected: true });
      // 对端静默 30 秒就会被服务端当僵尸清掉，所以活着就得定期发点东西。
      hb = setInterval(() => send({ t: "ping" }), 20000);
    };
    ws.onmessage = (ev) => {
      let m = null;
      try { m = JSON.parse(String(ev.data)); } catch { return; }
      if (!m || typeof m !== "object") return;
      emit(m.t, m);
    };
    ws.onclose = () => {
      clearInterval(hb); hb = null; ws = null;
      emit("status", { connected: false, closed: true });
      if (closedByUs) return;
      const wait = backoff[Math.min(tries, backoff.length - 1)];
      tries++;
      setTimeout(open, wait);
    };
    ws.onerror = () => { /* onclose 会跟着来，那里统一处理 */ };
  }

  open();

  return {
    send,
    // a=动作码，m=当前网格名，s=网格缩放，h=本体是否隐藏。
    // 后三个是赛车这类"把玩家换成载具"的地图能不能联机的前提。
    state(p, r, a, look) {
      const extra = {};
      if (a) extra.a = a;
      if (look && look.m) extra.m = look.m;
      if (look && Number.isFinite(look.s)) extra.s = look.s;
      if (look && look.h) extra.h = 1;
      return send({ t: "state", p, r, ...extra });
    },
    // 世界改动交给服务端定序再发给所有人：每个人只有提案权，没有"我先改所以是我对"。
    op(v, e) { return send({ t: "op", ...(v && v.length ? { v } : {}), ...(e && e.length ? { e } : {}) }); },
    chat(m) { return send({ t: "chat", m }); },
    get live() { return !!ws && ws.readyState === 1; },
    close() { closedByUs = true; clearInterval(hb); try { ws && ws.close(); } catch { /* 已经关了 */ } },
  };
}
