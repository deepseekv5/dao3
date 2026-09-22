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
| 官方音效与赛道模型 | ❌ 需自有权限按 CID 取回 | ❌ 未随包分发 |
| 服务端 | Node 18+，零第三方依赖 | 无（纯静态） |

没有模型资产时，运行时的默认行为是挂橙色线框占位盒并在控制台告警——
在编辑器里那是有用的提示，在一百多万人打开的公开页面上只会被读成"页面坏了"。
所以本页按 `meta.meshNames` 给每个名字登记一个空节点：实体退回"只有碰撞与逻辑"，
体素赛道照常渲染，脚本行为一字不变。

## 授权

代码（本仓库里由 `play-src/` 生成的那部分与运行时模块）：Apache-2.0，
见主仓库 [LICENSE](https://github.com/deepseekv5/dao3/blob/main/LICENSE)
与 [THIRD_PARTY_NOTICES.md](https://github.com/deepseekv5/dao3/blob/main/THIRD_PARTY_NOTICES.md)。
`vendor/three/` 是 MIT 的 three.js r160，许可证随目录同行。

地图体素数据来自官方公开的「赛车模板」项目，**著作权归 box3lab 及其权利人**，
此处仅作接口兼容性展示。本项目与 box3lab / 神奇代码岛官方
**无任何隶属、授权或背书关系**；官方音效与 3D 模型未在本页分发。
