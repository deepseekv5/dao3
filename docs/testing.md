# 测试与验证

判断标准只有一条：**在真实浏览器里把功能跑出来**，而不是类型检查通过。
所以本项目的回归套件是驱动真页面的，截图和断言同源。

```bash
npm start &                      # 起本地服务
npm test                         # test/runtime_parity.mjs · 77 条断言
npm run test:e2e                 # test/e2e.mjs · 39 条端到端断言（截图落在 test/out/）
```

套件需要 `playwright-core` + 一个 Chromium。它**不是**项目依赖
（运行时零依赖是硬要求），测试自己可移植地找：

```bash
npm i -D playwright-core && npx playwright install chromium
# 或指向已有安装：
CHROME=/path/to/chrome PLAYWRIGHT_MODULE=/path/to/playwright-core node test/runtime_parity.mjs
# 找不到就打印 SKIP 并退出 0，不会抛一堆模块解析错误
```

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

## 77 + 35 条断言覆盖什么

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
# 期望：199 / 0 / undefined / 0
```
