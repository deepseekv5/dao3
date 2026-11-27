let current = null, busy = false, checkedAt = 0, timer = 0;

function chip() {
  const top = document.getElementById("topbar");
  if (!top) return null;
  let el = document.getElementById("upChip");
  if (el) return el;
  el = document.createElement("button");
  el.id = "upChip"; el.className = "up-chip"; el.hidden = true;
  const anchor = document.getElementById("saveState");
  top.insertBefore(el, anchor || null);
  el.onclick = openDialog;
  return el;
}

async function check({ silent = true } = {}) {
  checkedAt = Date.now();
  try {
    const r = await fetch("/api/update/check", { cache: "no-store" });
    const j = await r.json();
    if (j && j.error && !silent && window.__editor?.toast) window.__editor.toast("检查更新失败：" + j.error, true);
    if (!j || !j.enabled || !j.updateAvailable) { const b = chip(); if (b) b.hidden = true; return j; }
    current = j;
    const b = chip();
    if (b) { b.hidden = false; b.textContent = "新版本 v" + j.latestVersion; b.title = "当前 v" + j.currentVersion + "，点击更新"; }
    if (!silent) closeDialog();
    if (!silent && j.updateAvailable) openDialog();
    return j;
  } catch (err) {
    if (!silent) closeDialog();
    if (!silent && window.__editor?.toast) window.__editor.toast("检查更新失败：" + (err.message || err), true);
    return null;
  }
}

function closeDialog() { document.getElementById("upMask")?.remove(); }

function openDialog() {
  if (!current || busy) return;
  closeDialog();
  const mask = document.createElement("div");
  mask.id = "upMask"; mask.className = "up-mask";
  const card = document.createElement("div"); card.className = "up-card";
  const title = document.createElement("h3"); title.textContent = `发现新版本 v${current.latestVersion}`;
  const meta = document.createElement("p"); meta.className = "up-meta";
  meta.textContent = `当前 v${current.currentVersion} → 最新 v${current.latestVersion} · 下载后自动备份并重启`;
  const notes = document.createElement("pre"); notes.className = "up-notes"; notes.textContent = String(current.notes || "本次更新没有附说明。").slice(0, 12000);
  const status = document.createElement("p"); status.className = "up-status";
  const actions = document.createElement("div"); actions.className = "up-actions";
  const later = document.createElement("button"); later.textContent = "稍后"; later.onclick = closeDialog;
  const install = document.createElement("button"); install.className = "primary"; install.textContent = "立即更新";
  install.onclick = async () => {
    if (busy) return;
    busy = true; install.disabled = true; later.disabled = true; install.textContent = "正在下载…";
    status.textContent = "正在下载并校验更新包，请保持页面打开。";
    try {
      const r = await fetch("/api/update/apply", { method: "POST", headers: { "x-laoyou-update-token": current.token } });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error(j.error || ("HTTP " + r.status));
      status.textContent = `已安装 ${j.files} 个文件，正在重启本地服务…`;
      install.textContent = "正在重启…";
      for (let i = 0; i < 45; i++) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        try {
          const c = await (await fetch("/api/version", { cache: "no-store" })).json();
          if (c.version === current.latestVersion) { status.textContent = "更新完成，正在刷新页面…"; location.reload(); return; }
        } catch { /* 服务重启中 */ }
      }
      status.textContent = "服务已重启但页面未自动刷新，请手动刷新。";
      busy = false;
    } catch (err) {
      status.textContent = "更新失败：" + (err.message || err);
      install.disabled = false; later.disabled = false; install.textContent = "重试";
      busy = false;
    }
  };
  actions.append(later, install);
  card.append(title, meta, notes, status, actions);
  mask.appendChild(card);
  mask.onclick = (ev) => { if (ev.target === mask && !busy) closeDialog(); };
  document.body.appendChild(mask);
}

export function initUpdateUi() {
  if (!/^https?:$/.test(location.protocol)) return;
  chip();
  check({ silent: true });
  clearInterval(timer);
  timer = setInterval(() => { if (Date.now() - checkedAt > 6 * 60 * 60 * 1000) check({ silent: true }); }, 30 * 60 * 1000);
  window.__checkUpdate = () => check({ silent: false });
}