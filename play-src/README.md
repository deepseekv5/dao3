# DAO3 网页体验版

**<https://deepseekv5.github.io/dao3play/>**

不装 Node、不下载包，打开链接就在浏览器里跑官方「赛车模板」：
1,523,592 格体素、199 个实体、两个官方脚本真实执行、20 TPS 定步长物理，
手机上左摇杆 + 七个虚拟键。

这是 [deepseekv5/dao3](https://github.com/deepseekv5/dao3)（DAO3 编辑器复刻）
的**构建产物**，不是独立项目：运行时用的是同一份 `game.js` / `renderer.js` /
`gapi.js` / `clientui.js`，只是换了一个不带服务端的装配层。

## 这个仓库不要直接改

内容全部由主仓库生成：

```bash
git clone https://github.com/deepseekv5/dao3
cd dao3
npm run build:play     # → play/（本仓库的全部内容）
npm run test:play      # 真浏览器回归：桌面 + 手机，31 条断言
```

源码在 `play-src/` 与 `scripts/build-play.mjs`，
构建方式与全部约束见 [`docs/playground.md`](https://deepseekv5.github.io/dao3/playground.html)。

## 与本地版的差别

| | 本地版 | 本页 |
|---|---|---|
| 编辑方块 / 改脚本 / 存档 | ✅ | ❌ 只能游玩 |
| 多人联机 | ❌（本来就是本地单端） | ❌ |
| 官方地图 / 20 个赛道模型 / 40 个音效 | ✅ 随包，确认后服务端才放行 | ✅ 随包，确认点是首屏那张卡 |
| 服务端 | Node 18+，零第三方依赖 | 无（纯静态） |

本地版的素材闸门在服务端：未确认授权时 `/assets/racing/models/*` 与
`/data/assets/audio/*` 一律 `403`。静态托管没有服务端可用来点头，所以本页的确认点
挪到首屏那张卡——它列明来源、著作权，以及"点「进入体验」即表示你确认自己有权
获取并使用它们"。这是同一决定的等价实现，不是绕过。

模型走的是和编辑器 `applySceneModels` 同一条摆放路径（克隆成外部对象放进
`state.models`），这样 `_buildRegistry` 才拿得到 `orientation` 与 `scaleVec`；
只把网格丢给运行时的 `_setMesh` 会让 199 个模型全按默认朝向堆在原点。

## 授权

代码（本仓库里由 `play-src/` 生成的那部分与运行时模块）：Apache-2.0，
见主仓库 [LICENSE](https://github.com/deepseekv5/dao3/blob/main/LICENSE)
与 [THIRD_PARTY_NOTICES.md](https://github.com/deepseekv5/dao3/blob/main/THIRD_PARTY_NOTICES.md)。
`vendor/three/` 是 MIT 的 three.js r160，许可证随目录同行。

地图体素数据、20 个赛道模型与 40 个音效都来自官方公开的「赛车模板」项目，
**著作权归 box3lab 及其权利人所有，不在任何开源许可之下**。它们随包分发是
**仓库所有者做的决定**，不构成任何许可授予；本页仅作接口兼容性展示。
本项目与 box3lab / 神奇代码岛官方**无任何隶属、授权或背书关系**。
