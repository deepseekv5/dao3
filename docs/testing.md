# 测试与验证

判断标准只有一条：**在真实浏览器里把功能跑出来**，而不是类型检查通过。
所以本项目的回归套件是驱动真页面的，截图和断言同源。

```bash
npm start &                      # 起本地服务（测试自己另起端口的也有）

# —— 不需要 playwright、真的跑得起来的 ——
npm run test:ide                 # test/ide.test.mjs · 编辑器外壳与脚本补全
npm run test:creative            # test/creative.test.mjs · 皮肤与 DAW 创作回归
npm run test:pro-features        # test/pro-features.test.mjs · 801 积木/天气/自动化/分轨/相机/大地图
npm run test:voxa                # test/voxa.test.mjs · VOXA 模型层纯函数（裸 Node）
npm run test:voxa-ui             # test/voxa-ui.test.mjs · VOXA 交互层（真指针 + 真 DOM）
npm run test:community           # test/community.test.mjs · 社区后端 HTTP 全量
npm run test:platform            # test/platform.test.mjs · 社区前端与游玩外壳（真浏览器）
npm run test:realtime            # test/realtime.test.mjs · 手写 WebSocket 客户端打房间
npm run test:social              # test/social.test.mjs · 两个浏览器会话对打社交层
npm run test:skin                # test/skin.test.mjs · 骨骼皮肤重定向
npm run test:skin3d              # test/skin3d.test.mjs · MC 展开图与皮肤库
npm run test:pause               # test/pause.test.mjs · 运行态暂停与单步
npm run test:api                 # test/api.test.mjs · API 运行时对账
npm run test:vox                 # test/vox.test.mjs · .vox 导入导出
npm run test:voxel-worker        # test/voxel-worker.test.mjs · Worker 零拷贝解码（裸 Node VM）
npm run test:pkg                 # test/packaging.mjs · 项目包导出/回环导入
npm run test:play-bundle         # test/play-bundle.test.mjs · 把 play/ 产物真跑一遍
npm run check:dist               # 分发内容审计（授权、凭据、必需文件）
```

每条套件跑完会自己打印 `N passed, M failed`。**这里不抄这些数字**：
抄过一次，之后每次加断言都要记得回来改文档，改漏一次就是一个假数——
而"测试有多少条"本来就该由测试自己回答。

`test/runtime_parity.mjs`（`npm test`）与 `test/e2e.mjs` 需要 `playwright-core` + 一个 Chromium，
本机没装时它们打印 SKIP 并退出 0——**别把 SKIP 当成通过**。

```bash
npm i -D playwright-core && npx playwright install chromium
# 或指向已有安装：
CHROME=/path/to/chrome PLAYWRIGHT_MODULE=/path/to/playwright-core node test/runtime_parity.mjs
# 找不到就打印 SKIP 并退出 0，不会抛一堆模块解析错误
```

## 关键技巧零：测试自己 spawn 的服务端会留在原地

每条浏览器套件都自己起一个 `server.js`（独立 `DATA_DIR`，独立端口）。
被打断的那一轮，**子进程不会跟着死**：它继续占着那个端口，而数据目录里
账号已经注册过了。下一轮如果挑到同一个端口，bind 失败但没人报错，
于是 `fetch(首页)` 照样 200 —— 回答的是上一轮那个陌生人。测试接下来看到的是
"注册按钮不见了"，红得莫名其妙，而产品代码一点问题都没有。

所以端口一律走 `freePort(base, span)`（`test/cdp.mjs`）：先真空着才交出去。

同理两条现场纪律，踩过才知道：

- 跑测试期间**不要** `pkill -f "node server.js"`——那会连测试自己的服务端一起杀掉，
  剩下的断言就在等一个永远不会来的 WebSocket 推送。
- 浏览器套件**一次只跑一条**。两条并发时软件光栅化的 WebGL 页面互相抢 CPU，
  "B 进图后 A 看到同伴"这种等待型断言会先超时。

## 关键技巧一：后台标签页没有 rAF，必须手动推 tick

浏览器把后台标签页的 `requestAnimationFrame` 饿死，于是"等 1 秒看走了多远"
这种测试在 CI 上必然随机失败。确定性做法是自己造时间：

```js
for (let i = 0; i < 16; i++) { g._last -= 320; g._frame(); await sleep(6); }
```

`_last -= 320` 让运行时以为过了 320ms → 补满一帧 5 个 tick 的上限。
**归一必须除以真实 tick 数**（`currentTick - t0`），不能假设"16 帧 = 16 tick"——
实际是 ~80 tick，写错就会把正确的物理判成错误。

## 关键技巧二：夹具不能依赖地图内容

早期版本直接在赛车图出生点量走路位移。结果碰撞判据一修（玻璃开始挡人），
测试就"失败"了——但失败的是夹具，不是引擎：前方本来就有一块装饰玻璃。

现在物理断言在**运行时现搭**的平台上量，测完连方块一起还原：

```js
// 64³ 超平坦的半空里搭 20×20 平台，只留 2 格净空的一段当门洞
for (let x = X; x < X + N; x++) for (let z = Z; z < Z + N; z++) {
  keep(x, Y - 1, z); w.set(x, Y - 1, z, sid, 0);
  for (let y = Y; y < Y + 13; y++) { keep(x, y, z); w.set(x, y, z, 0, 0); }
}
```

两个教训值得记住：
- 夹具坐标必须在世界范围内。`w.set` **不做越界检查**（写进去了），
  但 `_solidAt` 会按 `shape` 判越界返回 0 —— 于是平台"存在却挡不住人"，
  表现为玩家一路往下掉，非常难查。现在有一条断言专门守这个。
- 撤掉夹具前必须先把玩家搬回出生点，否则他一自由落体，后面的区域/存档断言全被污染。

## 关键技巧三：渲染要可证伪，不能只看"没报错"

没有截图条件时，用 `readPixels` 做 A/B 差分来证明"画面真的变了"：
改一次环境参数 → 读同一块像素 → 断言差异比超过阈值。
天气/雾/天光那批断言就是这么写的，而不是"调用没抛异常"。

## 关键技巧四：全新上下文会撞上首启门禁，要走过去而不是绕过去

playwright 每次给的是干净 `localStorage`，于是免责声明遮罩会挡在编辑器前面。
用 `addInitScript` 预置 `dao3_disclaimer_ack` 当然能让测试变绿，但那样就永远
测不到"首启用户实际看到什么"——遮罩吃掉点击时，症状是 `#sizeOk` 超时 30s，
排查起来完全看不出根因。

所以 `test/e2e.mjs` 把这一步当成被测对象：断言未勾选时「进入」禁用 → 勾选 →
断言可用 → 点掉 → 断言遮罩移除且 `localStorage` 记住 → reload 断言不再打扰。
6 条断言，顺带把后面所有点击的路径清干净。

## 断言覆盖什么

| 组 | 内容 |
|---|---|
| 单位制 | 行走 0.22 格/tick、跳跃量级、tick 单调 + 64ms 换算、`GameTickEvent` 字段 |
| 碰撞 | 玻璃挡人、单帧 5 格不隧穿、1 格墙走不上去但跳得过、实体盒按盒心、踏步不白送高度 |
| 方块 | 旋转码进网格（turn t 的世界面 = 第 (d−t) mod 4 个面）、批量写不逐格重建、只读 `shape/VoxelTypes` |
| 粒子 | `color0..4` 按 /1000 归一、`size0..4` 五阶段、逐粒子尺寸与颜色 |
| 玩家 | `scale` 同时放大盒与人偶、`spectator` 穿墙、`color/metalness/emissive/shininess` 即时生效、`showName` |
| 相机 | `cameraFreezedAxis` 八种取值逐个、FOLLOW 转身体 vs RELATIVE 刚性对齐、RELATIVE+冻结Y |
| 世界 | `sunPhase` 0..1、`say ≠ Chat`、`searchBox` 完全包含、`raycast`、临时聊天、克隆、选择器过滤 |
| 客户端 | UI 默认值对齐官方、`richText` 只放行 font/stroke、`UiScale` 拒负值、`pointerLockEvents` 事件名、`rendering3d` 冻结最后一帧、按端裁剪沙箱 |
| 建图 | 重新生成地形后出生点回到新图中心（旧 `initialPosition` 不许把玩家拽回旧坐标）、首启门禁走完才能操作 |
| 导航 | 编辑器/VOXA/文档站都能返回工作台；编辑器返回前必须把脏状态存盘 |
| 数据 | 导出 `player.json` 恰好官方 41 键、导出→导入回环、CID 校验、音效衰减参数不丢 |
| 官方模板 | 取到官方 `index.js`、零改动运行、`#报名点 / .检查点 / #加速道具` 可查、报名后换车与速度覆盖 |

## 一条硬规矩：测试绝不能写进默认地图

`server.js` 首次启动会 `ensureSeed()` 生成示例世界；编辑器有 30 秒自动保存。
两者叠加的后果是：**跑一次自动化测试，就把测试残留固化进地图存档**。
历史上真发生过（`gameRules` 被写回、实体数从 199 变成 200）。

防线有三道：
1. 测试页统一 `window.__noAutosave = true`
2. `stopPlay()` 不回写任何运行期状态
3. 改完跑完套件后，用基线核对一次：

```bash
node -e "const z=require('zlib'),f=require('fs');const j=JSON.parse(z.gunzipSync(f.readFileSync('server/data/worlds/216d665d3ca92bd1b9a2.json.gz')));
const m=j.meta;console.log({entities:(m.entities||[]).length,collision:(m.entities||[]).filter(e=>e.collision).length,gameRules:m.gameRules,products:(m.products||[]).length})"
# 期望：199 / 0 / {} / 0 —— 与 official-project/racing-template.json.gz 逐项相同
```
