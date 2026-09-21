// 用你自有的官方账号令牌探测 creator API（只读）。
// 令牌只从环境变量读，绝不写进文件、绝不打印：  DAO3_TOKEN=eyJ... node scripts/official-probe.mjs
const TOKEN = process.env.DAO3_TOKEN || "";
if (!TOKEN) { console.log('未设置 DAO3_TOKEN 环境变量（只读探测也需要你自己的登录令牌）'); process.exit(1); }
console.log('token length', TOKEN.length);

const API = 'https://code-api-pc.dao3.fun/';
const MAP = process.env.MAP_ID || '100020690';

async function hit(url, label) {
  try {
    const r = await fetch(url, { headers: { Authorization: TOKEN, 'Content-Type': 'application/json' } });
    const text = await r.text();
    let j = null;
    try { j = JSON.parse(text); } catch {}
    console.log(`\n### ${label} [${url.replace(API, '')}] http=${r.status}`);
    if (!j) { console.log('  non-json:', text.slice(0, 200)); return null; }
    console.log('  code=', j.code, 'msg=', j.msg ?? '');
    return j;
  } catch (e) {
    console.log(`\n### ${label} FAILED`, e.message);
    return null;
  }
}

const gp = await hit(`${API}engine/map-group-project?mapId=${MAP}&mode=edit`, 'group-project');
if (gp && gp.data) {
  console.log('  data keys:', Object.keys(gp.data).join(', '));
  for (const [k, v] of Object.entries(gp.data)) {
    if (typeof v === 'string') console.log(`   ${k}: ${v.slice(0, 90)}`);
    else if (v && typeof v === 'object') console.log(`   ${k}: {${Object.keys(v).slice(0, 8).join(',')}}`);
    else console.log(`   ${k}: ${v}`);
  }
  fs.writeFileSync('/tmp/dao3_group_project.json', JSON.stringify(gp.data, null, 1));
}

const md = await hit(`${API}models/v2?modelType=2&creativeMode=1&mapId=${MAP}&limit=100&containerMode=edit&offset=0`, 'models');
if (md && md.data) {
  const rows = md.data.rows || [];
  console.log('  count=', md.data.count, 'rows=', rows.length);
  if (rows[0]) {
    console.log('  row keys:', Object.keys(rows[0]).join(', '));
    console.log('  sample:', JSON.stringify(rows[0]).slice(0, 600));
  }
  fs.writeFileSync('/tmp/dao3_models.json', JSON.stringify(md.data, null, 1));
}
