第三方素材与授权说明 / THIRD-PARTY NOTICES
==========================================

本项目（DAO3 编辑器复刻）的**代码**按 Apache License 2.0 发布（见 `LICENSE`）。
但"代码"和"素材"是两件事，本文件说清楚每一类东西的来路与能否再分发。

一句话结论：**代码是 Apache-2.0 的；素材不是。** 方块图集与两张 ID/规格表来自
Apache-2.0 的上游仓库，可再分发；音频与赛道模型不随仓库分发，需自有权限取回。
官方赛车模板地图数据（`official-project/racing-template.json.gz`）**随包分发但默认不启用**：
首次启动时由用户在应用内明确确认"我有权获取并使用该地图"之后，服务端才把它装进世界库。
未经确认时运行的是程序化生成的示例地形。该确认记录在 `server/data/consent.json`，
随时可在工作台左侧「模板授权」改。


1. 本仓库自己编写的部分（Apache-2.0）
-------------------------------------
`server.js`、`start.mjs`、`public/js/*`、`public/css/*`、`public/*.html`、
`scripts/*`、`test/*`、`docs/*`，以及 `public/data/block-atlas.json` 的构建脚本。

这些代码依据官方**公开发布**的文档与类型声明独立编写，目标是接口兼容：
读得懂官方导出的地图、跑得动官方写法的脚本。未复制、未反编译、未分发任何官方源代码。


2. Three.js（MIT）
------------------
    路径：public/vendor/three/{three.module.js, GLTFLoader.js, GLTFExporter.js, OrbitControls.js}
    授权：MIT  © 2010-2023 Three.js Authors
    各文件头部保留了原始 license 注释。


3. 上游 Apache-2.0 素材（有授权，随仓库分发被明确允许）
------------------------------------------------------
    Box3Blocks-unityPackage   © 2026 神岛实验室   Apache-2.0
      https://github.com/box3lab/Box3Blocks-unityPackage
    ArenaPro-CLI（含 GameAPI.d.ts / ClientAPI.d.ts） © 2026 神岛实验室   Apache-2.0
    box3-product-document（产品与 API 文档）          © 2026 神岛实验室   Apache-2.0

    本仓库只带其中构建真正需要的两个数据表（副本，连同上游 LICENSE 一起）：
      data/upstream/block-id.json
      data/upstream/block-spec.json
      data/upstream/LICENSE.Box3Blocks.txt
    完整的上游仓库是各仓库自己的 clone，整体列在 .gitignore 的 vendor/ 之下，不入库。

    `public/data/block-atlas.png` 与 `public/data/thumbnails/` 是上述上游纹理的
    **派生产物**（由 `scripts/build-block-atlas.mjs` 在构建期合成），按 Apache-2.0
    的 Derivative Works 条款随本仓库分发，并在此声明来源与"经过修改"这一事实。

    上游 200MB+ 的完整仓库不镜像在本仓库里。需要从零重建图集时自行取回：
      git clone https://github.com/box3lab/Box3Blocks-unityPackage.git vendor/Box3Blocks-unityPackage
      npm run build:atlas


4. 不随仓库分发的内容（无再分发授权）
--------------------------------------------
下列素材来自 dao3.fun 的内容服务（`static.dao3.fun/block/<CID>`），属于在线游戏内容，
**不在任何开源许可之下**，版权归 box3lab 及其权利人。本仓库不镜像：

    public/data/assets/audio/**     40 个官方音效 mp3
    public/assets/**                由官方 .vb 网格转换而来的赛道模型
    server/data/**                  本地地图存档（含从官方数据派生的种子图）

例外（随包分发，但默认不启用）：

    official-project/racing-template.json.gz   官方赛车模板地图数据 2.8MB
    official-project/cids.json                 纯哈希索引，不含素材本体

    模板由仓库所有者决定随包分发，但服务端不会自动安装它：首次启动时应用内会
    弹出确认，要求使用者声明"我有权获取并在本地使用该地图，仅用于学习与
    技术兼容性研究"。确认后才 copy 进 server/data/worlds/；拒绝则保留
    程序化示例地形。已经由用户改过的示例世界不会被模板覆盖。

    取回方式（需你自有的访问权限，且仅限本地学习与兼容性研究用途）：
      npm run fetch:official
    该脚本按 `official-project/cids.json` 里的 CID 逐个下载，并用
    sha256 → base58btc 重算 CID 校验内容一致（校验实现已用官方音频 40/40 验证）。
    可用 `DAO3_GATEWAY=` 指向你自己的镜像。

    没有这些素材时项目的行为：编辑器与运行时功能完整，199 个官方实体的
    名称、位置、标签、玩法逻辑照常；缺网格的实体显示为占位盒，缺音频的
    音效槽在玩家面板里标注"（缺文件）"而不是静默失效。


5. 与官方的关系
--------------
本项目与 box3lab / 神奇代码岛（dao3.fun）官方**无任何隶属、授权或背书关系**。
站点内每次首次进入都会展示同一份免责声明。
