# 致谢

## 感谢 box3lab / 神奇代码岛

本项目存在的唯一原因是 [dao3.fun（神奇代码岛）](https://dao3.fun) 把一套
"用方块写游戏"的编辑器做成了网页端能跑的东西，并且**把接口面公开了出来**：

- `GameAPI.d.ts` 与 `ClientAPI.d.ts`——329 个可调用成员、41 键的 `player` 结构、
  全部 `Game*` 值类型与事件通道。逐字段对账的可能，来自这份声明是公开的。
- [box3-product-document](https://github.com/box3lab/box3-product-document)——玩法语义
  （玻璃挡人、`sunPhase` 的 0..1 口径、`say` 不进聊天频道）在这里能查到官方说法。
- [Box3Blocks-unityPackage](https://github.com/box3lab/Box3Blocks-unityPackage)——
  `block-id.json` / `block-spec.json` 与 2000 多张 16×16 真实贴图，让 383 种方块
  不必被凭空"设计"一遍。

这三个仓库都是 Apache-2.0。**这不是"抄了没关系"的意思**：本仓库没有复制、
没有反编译任何官方源代码，实现全部是自己写的；官方开源的部分按 Apache-2.0
保留 LICENSE 并在 [THIRD_PARTY_NOTICES](https://github.com/deepseekv5/dao3/blob/main/THIRD_PARTY_NOTICES.md) 里逐条声明。

## 感谢 three.js

[r160](https://github.com/mrdoob/three.js) 是本仓库唯一随包分发的第三方代码，
MIT 授权。WebGL 那一层几乎所有麻烦——图集接缝、序列帧动画、实例化网格、
glTF 往返——它都已经解决过了。

## 感谢 Node 的标准库

`node:http` + `node:zlib` + `node:fs` 就够撑起一个带持久化 REST API 的本地服务。
"零第三方依赖"能成立，是因为 Node 的内置面这些年确实够用了。

## 关于本项目与官方的关系

必须写清楚，因为它同时也是给使用者的一句提醒：

> 本项目与 box3lab / 神奇代码岛官方**无任何隶属、授权或背书关系**。
> 它是一个独立实现，目标是**接口兼容**——官方导出的地图能打开，官方写法的脚本能跑。

方块贴图、方块 ID 表、地图数据、模型与音频素材的**著作权归 box3lab 及其权利人所有**。
本仓库刻意不含游戏素材本体：那些内容来自 dao3.fun 的在线内容服务，没有再分发授权。
需要时用你自有权限执行 `npm run fetch:official` 按 CID 取回，脚本会逐文件校验
CIDv0（`base58(0x12 0x20 ‖ sha256)`）再落盘。取回的内容仅限本地学习与兼容性研究。

## 也想感谢这几件具体的事

- **愿意公开类型声明**这件事本身。兼容层最难的部分从来不是实现，而是"我不知道你以为
  `transparent` 是什么意思"。
- **官方导出格式没有被加密**。`.gz` 是 `gzip(JSON(VoxelPayload))`，Unity 侧和网页侧同格式，
  这让"互通"是一个可以做到的目标，而不是猜测。
- **每一个报症状的人**。"玩家根本没有在车上"、"运行模式下会穿模"、"部分模型设置的是隐藏"——
  这三句听起来像三个 bug，实际都指向同一个根因（模型锚点与碰撞判据）。用户按玩家的说法描述，
  比按工程师的术语描述，更容易把问题带到正确的地方。

## 贡献

代码按 Apache-2.0 发布，欢迎提 issue 与 PR：
<https://github.com/deepseekv5/dao3>。
提交前请先跑 `npm test` 与 `npm run test:e2e`——这个仓库的判断标准是
**在真实浏览器里把功能跑出来**，不是类型检查通过。
