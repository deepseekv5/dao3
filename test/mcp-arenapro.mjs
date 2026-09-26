// mcp-arenapro.mjs — ArenaPro MCP 契约的端到端验证。
// 运行：node test/mcp-arenapro.mjs      （服务要先起：node start.mjs --no-open --port=5180 --host=127.0.0.1）
// 可用 BASE=http://127.0.0.1:PORT 覆盖。
//
// 这里当自己是**一个真的 MCP 客户端**：开 SSE、按 JSON-RPC 走 initialize →
// tools/list → tools/call。不 import 被测模块，否则等于自己给自己打分。
import { pathToFileURL } from "node:url";
import path from "node:path";

const BASE = process.env.BASE || "http://127.0.0.1:5180";
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log("PASS  " + n); } else { fail++; console.log("FAIL  " + n + (x ? "   " + x : "")); } };

/* --------- 最小 SSE + JSON-RPC 客户端 --------- */
function connect() {
  return new Promise((resolve, reject) => {
    const pending = new Map();
    let sid = null, buf = "", settled = false;
    fetch(BASE + "/ap-mcp", { headers: { Accept: "text/event-stream" } })
      .then(async (res) => {
        if (!res.ok || !res.body) return reject(new Error("SSE 连不上：HTTP " + res.status));
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let sep;
          while ((sep = buf.indexOf("\n\n")) >= 0) {
            const frame = buf.slice(0, sep); buf = buf.slice(sep + 2);
            let event = "message"; const dataLines = [];
            for (const line of frame.split("\n")) {
              if (line.startsWith("event:")) event = line.slice(6).trim();
              else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
            }
            if (!dataLines.length) continue;
            const data = dataLines.join("\n");
            if (event === "endpoint") {
              sid = data;
              settled = true;
              resolve({
                sid,
                call: (method, params) => new Promise((res2, rej2) => {
                  const id = pending.size + 1;
                  pending.set(id, { res: res2, rej: rej2 });
                  fetch(BASE + sid, {
                    method: "POST", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
                  }).then((r) => { if (r.status !== 202) rej2(new Error("POST → " + r.status)); }).catch(rej2);
                }),
                notify: (method, params) => fetch(BASE + sid, {
                  method: "POST", headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ jsonrpc: "2.0", method, params }),
                }),
                close: () => res.body.cancel().catch(() => {}),
              });
            } else {
              try {
                const msg = JSON.parse(data);
                if (msg.id !== undefined && pending.has(msg.id)) {
                  const p = pending.get(msg.id); pending.delete(msg.id);
                  msg.error ? p.rej(new Error(msg.error.message || JSON.stringify(msg.error))) : p.res(msg.result);
                }
              } catch { /* 非 JSON 帧忽略 */ }
            }
          }
        }
      })
      .catch((e) => { if (!settled) reject(e); });
    setTimeout(() => { if (!settled) reject(new Error("等 endpoint 超时")); }, 8000);
  });
}

const c = await connect();
ok("SSE 连上并拿到 endpoint 帧", !!c.sid, c.sid);

const init = await c.call("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "regression", version: "1" } });
ok("initialize 回 protocolVersion + serverInfo", !!init.protocolVersion && !!init.serverInfo, JSON.stringify(init.serverInfo || {}));
ok("声明 tools 能力", !!(init.capabilities && init.capabilities.tools));
await c.notify("notifications/initialized", {});

const { tools } = await c.call("tools/list", {});
const names = tools.map((t) => t.name);
// 官方 mcp/index.md 附录里的工具名，一个都不能少（不支持的也要在册，
// 否则客户端按官方清单调用会拿到 unknown tool，AI 会以为契约对不上开始猜）
const OFFICIAL = ["userCenterTool_userTokenAndUA", "userCenterTool_userInfo", "userCenterTool_accountsLogin",
  "userCenterTool_accountsLogout", "chatjpt_onlyKnowledgeBase", "file_npm_package_get", "file_outputName",
  "file_mapTool", "file_buildNUpload", "file_createProject", "file_checkDts", "file_nodeJs_setting",
  "file_openArena", "file_reHMR", "file_stopHMR", "file_upLoad", "file_debugger", "file_openOutputLog",
  "file_dao3config_open", "file_npm_package_path", "map_showMap", "map_playData", "map_resource",
  "component_showComponentStats"];
const missing = OFFICIAL.filter((n) => !names.includes(n));
ok(`官方 24 个工具名全部在册（实到 ${names.length}）`, missing.length === 0, missing.join(","));
ok("每个工具都带 inputSchema", tools.every((t) => t.inputSchema && t.inputSchema.type === "object"));
const unsup = tools.filter((t) => /本地不支持/.test(t.description)).map((t) => t.name);
ok("做不到的工具在描述里就写明「本地不支持」", unsup.length >= 13, unsup.length + " 个");

const call = async (name, args) => {
  const r = await c.call("tools/call", { name, arguments: args });
  return { text: (r.content && r.content[0] && r.content[0].text) || "", isError: !!r.isError };
};

/* --------- 账号类：必须明确拒绝，且不能吐出像 token 的东西 --------- */
const login = await call("userCenterTool_userTokenAndUA", {});
ok("账号工具返回 isError 而不是假装成功", login.isError === true, login.text.slice(0, 60));
ok("拒绝理由说清了「没有账号系统」", /账号/.test(login.text), login.text.slice(0, 60));
ok("拒绝文本里没有像 JWT 的串", !/eyJ[A-Za-z0-9_-]{10,}/.test(login.text));

/* --------- 真读写：建图 → 写脚本 → 查 → 删 --------- */
const id = "mcp" + Date.now().toString(36);
const made = await call("file_createProject", { name: "MCP回归图", mapId: id, shape: "32,16,32", floor: 0 });
ok("file_createProject 建出地图", /已创建/.test(made.text) && !made.isError, made.text.slice(0, 80));

const up = await call("file_upLoad", { mapId: id, end: "server", name: "index.js", code: "world.say('hi');" });
ok("file_upLoad 写入服务端脚本", /已写入/.test(up.text) && !up.isError, up.text.slice(0, 80));

const bad = await call("file_upLoad", { mapId: id, end: "nonsense", code: "x" });
ok("end 传错值被挡下", bad.isError === true, bad.text.slice(0, 60));

const shown = await call("map_showMap", { mapId: id });
ok("map_showMap 回创作端地址与规模", /edit\//.test(shown.text) && /脚本：1/.test(shown.text), shown.text.replace(/\n/g, " | ").slice(0, 120));

const kb = await call("chatjpt_onlyKnowledgeBase", { query: "say" });
ok("知识库查得到 world.say（说明 spec 形状读对了）", /say/.test(kb.text) && !/没找到/.test(kb.text), kb.text.split("\n")[0]);
const kb2 = await call("chatjpt_onlyKnowledgeBase", { query: "raycast" });
ok("知识库第二个词也有命中", /raycast/.test(kb2.text), kb2.text.split("\n")[0]);
ok("知识库不是永远返回空", kb.text.length > 10 && kb2.text.length > 10);

const chk = await call("file_checkDts", { code: "world.say('a'); world.notARealApi(1); // world.alsoFakeInComment()" });
// 断言的是语义而不是某句措辞：真成员不该被列进"查不到"，假的必须被列出来。
const unknownBlock = (chk.text.split("查不到的")[1] || "").split("注意")[0];
ok("checkDts 不把真成员 say 误报为不存在", !/\bsay\b/.test(unknownBlock), chk.text.split("\n").slice(0, 3).join(" | "));
ok("checkDts 揪出不存在的成员", /notARealApi/.test(chk.text), chk.text.slice(0, 160));
ok("checkDts 不被注释里的假引用骗到", !/alsoFakeInComment/.test(chk.text));
ok("checkDts 报出规范规模（说明真读到 api-spec）", /规范里有 \d+ 个名字/.test(chk.text), chk.text.split("\n")[0]);

const stats = await call("component_showComponentStats", { mapId: id });
ok("组件统计回得来", /实体/.test(stats.text) && !stats.isError, stats.text.replace(/\n/g, " | ").slice(0, 100));

const out = await call("file_outputName", { mapId: id, path: "pictures/a.png", content: "hello" });
ok("file_outputName 写进该图资产目录", /已写/.test(out.text) && !out.isError, out.text.slice(0, 80));
const trav = await call("file_outputName", { mapId: id, path: "../../escape.txt", content: "x" });
// 要的是"明确拒绝"，不是"清洗后照写还报成功"
ok("路径穿越被明确拒绝（不静默改写）", trav.isError === true && /\.\./.test(trav.text), trav.text.slice(0, 80));

const res = await call("map_resource", { mapId: id });
ok("map_resource 列出了刚写的资产", /a\.png/.test(res.text), res.text.replace(/\n/g, " | ").slice(0, 90));

const del = await fetch(`${BASE}/api/world/${id}`, { method: "DELETE" });
ok("清掉回归图", del.ok);

c.close();
console.log(`\nmcp-arenapro: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
