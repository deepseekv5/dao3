# 标准地图格式

这篇是**规范**：一张"标准地图"由哪些层组成、每个键叫什么、类型与取值域是什么、
哪些东西必须一致才算兼容。想快速知道"我们的存档长什么样、为什么长这样"，看
[数据格式](data-format.md)；这篇按字段查。

> 本文所有数字与键名都是**从仓库里那份真实官方赛车模板量出来的**，不是照抄某个文档。
> 复现命令在[最后一节](#verify)。凡是没量到、只在官方代码里见过一面的东西，
> 都明确标了"未证实"，不要当依据用。

## 一张地图分三层

```
第 1 层  世界 payload      体素 + meta          →  server/data/worlds/<id>.json.gz
第 2 层  项目包            21 键 project.json + 13 个内容寻址 blob
第 3 层  派生资源          方块图集 json/png     →  public/data/block-atlas.*
```

第 1 层是**运行时真正读的**；第 2 层是**编辑器之间交换的**；第 3 层是从官方
Apache 仓库构建出来的贴图索引，不属于地图本体但可以随包分发。
一个 `.zip` 项目包里同时含第 1 与第 2 层。

---

## 第 1 层：世界 payload

gzip 后的 JSON，**顶层恰好 7 个键**，顺序无关：

| 键 | 类型 | 赛车模板实测值 | 含义 |
|---|---|---|---|
| `formatVersion` | string | `"unity"` | 落盘来源。`"unity"` 表示 Unity 侧导出 |
| `shape` | `[X,Y,Z]` | `[256,128,256]` | 世界尺寸，单位＝格。边界由它给出 |
| `dir` | `[dx,dy,dz]` | `[1,1,1]` | 三轴手性/翻转，`-1` 表示该轴反向 |
| `indices` | `int[]` | 1,523,592 项 | 每格的线性索引 |
| `data` | `int[]` | 1,523,592 项 | 每格的方块数值 id，`0`＝空气 |
| `rot` | `int[]` | 1,523,592 项 | 每格的旋转，**取值只有 0/1/2/3** |
| `meta` | object | 18 键 | 见下一节 |

三个数组**必须等长**，逐格一一对应；这是格式里最硬的约束。

### 线性索引的算法

```
index = x + y * X + z * X * Y          // X=shape[0], Y=shape[1]
```

即 **x 最快、z 最慢**。写错这条会得到一座"旋转过的"地图，而且不报错。

### `rot` 与"16384"的关系

落盘的 `rot` 是**转数**（0–3，每次 90°）。实测分布：

```
0 → 1,513,195 格      1 → 2,625 格      2 → 2,176 格      3 → 5,596 格
```

而运行期从编辑器到 API 暴露的**数值 id** 里另有一套旋转编码：id 的 `16384`（2¹⁴）
为一个旋转档位。两者不要混——**落盘时已经折算成 `rot` 数组**，
`data` 里存的是不含旋转位的纯 id。赛车模板的 152 万格里只出现 33 种不同 id。

### 不支持的键

官方某些导出里可能出现 `lightIndices` / `lightFlags` / `lightIntensity` /
`lightRange` / `lightColorRgb` / `lightOffsetXyz` 六个光照数组。**本实现既不写也不读**，
带光照的官方地图导入后光照会丢，其余部分不受影响。

---

## `meta`：18 个键

| 键 | 类型 | 说明 |
|---|---|---|
| `name` / `displayName` / `description` | string | 地图名、展示名、简介 |
| `terrain` | object | 本地地形/天空/雾/曝光的合并表（11 个本地字段） |
| `worldSettings` | object | 官方世界设置，16 键：`gravity -0.1`、`useOBB false`、`airFriction 0.01`、`drawDistance 1024` 等 |
| `physics`（在 `worldSettings` 内） | — | 见[项目包](#project-json)一节的三键表 |
| `scripts` | `[{name, code}]` | 多文件脚本表。模板里 `index.js` 8367 字节、`clientIndex.js` 空 |
| `entities` | object[] | **实体表，本实现唯一的一份**，见下一节 |
| `models` / `meshNames` / `assetRoot` | — | 场景模型索引与素材根路径 |
| `player` | object | 玩家默认属性（本地名，导出时翻译成官方 41 键） |
| `ui` | object[] | 运行 HUD 控件表（`type/id/x/y/w/h/text/…`） |
| `zones` | array | 区域触发器。官方模板是 `[]` |
| `products` | array | 商城商品表，8 键。官方模板是 `[]` |
| `ambientSound` | object | 5 个环境音槽 |
| `groups` | array | 实体分组（模板里 2 个） |
| `spawnPoint` | `[x,y,z]` | 出生点 |
| `gameRules` | object | 游戏规则。官方模板是 `{}` |

> `pictureNames` **不在** meta 里（旧文档写错了）。图片名单只在导出时写进
> `compat.json`，运行期由 `resources.ls("picture")` 现算。

---

## 实体表：官方树形 vs 本地扁平

### 官方 `entities/entitiesTree.json`

节点表，**202 个节点**，每个节点 6 个键：

```
{ id, name, parentId, type, childrenIds, value? }
```

`type` 是数字枚举，实测分布：

| type | 含义 | 模板数量 |
|---|---|---|
| `0` | 根节点 `ROOT_ID` | 1 |
| `1` | 实体 | 199 |
| `2` | 组 | 2 |

`type:1` 的节点带 `value`，**value 恰好 22 个键**（199/199 全部命中，一个不多一个不少）：

| 键 | 类型 | 取值域 / 默认 | 备注 |
|---|---|---|---|
| `name` | string | 可重复 | 选择器 `.名字` 用的就是它 |
| `mesh` | string | `"mesh/<名>.vb"` | 官方带目录与扩展名 |
| `meshId` | int | 大整数 | 内容寻址用的 id；本实现原样保存但不用其语义 |
| `position` | `[x,y,z]` | 格 | |
| `orientation` | `[x,y,z,w]` | 四元数 | |
| `scale` | `[x,y,z]` | 倍率 | |
| `bounds` | `[w,h,d]` | 格 | 物理盒尺寸 |
| `collision` | bool | | 模板里 199 个实体**全是 `false`**，碰撞由方块提供 |
| `fixed` | bool | | |
| `gravity` | bool | | |
| `mass` | number | 模板里普遍 `1` | |
| `friction` | number | 模板里 `1` | |
| `restitution` | number | 模板里 `0` | |
| `emissive` | bool | | |
| `metalness` | number | | |
| `shininess` | number | | |
| `tint` | `[r,g,b,a]` | `0..255` | 注意与 `player.color` 的 `0..1` 不同域 |
| `damage` | object | `{enabled,hp,maxHp,showDamage,showHealth}` | |
| `sound` | object | `{chat,die,hurt,interact}`，每个 `{gain,gainRange,pitch,pitchRange,radius,sample}` | |
| `particle` | object | 38 个叶子字段 | 序列帧粒子；`color0..4`/`size0..4` 走 `/256` |
| `tags` | string[] | | 选择器 `#标签` 用的 |
| `defaultMotionId` | string | 模板里 `""` | |

### 本地 `meta.entities`

**26 个键**：上面 22 个（`mesh` 去掉 `mesh/` 前缀与 `.vb` 后缀）
＋ 节点级的 `id` / `parentId` ＋ 两个本地扩展 `meshInvisible` / `anchorOffset`。

那两个扩展官方没有，导出时进 `compat.json`，导入时合并回来。

### ⚠ `id` 与 `name` 的语义陷阱

官方数据里 **`id` 是十进制数字串**（`"228101676"`），**`name` 才是 `"检查点-0"`**。
而官方脚本这样给检查点排序：

```js
world.querySelectorAll('.检查点').forEach((entity) => {
    const index = parseInt(entity.id.match(/\d+/)[0]);   // ← 取的是 id
```

这行能成立，是因为**官方运行期把 `name` 当 `id` 暴露**给脚本。本实现照此办理：
`game.js` 里 `id: d.name || d.id`。后果是——任何依赖"从 id 里抠数字"的官方脚本，
在本地必须保持 `name` 里带序号（`检查点-0…4`）才能拿到同样的顺序。
**新建地图时给实体起名要带序号**，否则这类脚本会静默拿到同一个 index。

---

<a id="project-json"></a>
## 第 2 层：项目包

### `project.json`：恰好 21 键、按字母序

```
ambientSound assets collisionFilter committerId deleteAssets entitiesTree
environment features info physics player prevHash scriptAssets scriptIndex
storageMode timestamp type uiTree version voxels zones
```

其中 **13 个键的值是 CIDv0**（指向同目录的 `<key>.raw`），8 个是字面值：
`committerId: 0`、`scriptIndex: "index.js"`、`storageMode: "sqlite"`、
`timestamp`（ISO 串）、`type: "project"`、`version: "0.3.23"`、`prevHash`、`features`。

`features` 实测只有一个键：`{ enableTriggerAPI: true }`。

`collisionFilter` 与 `deleteAssets` 在模板里都是 `[]`；
**两者 CID 相同**（因为内容相同）——这正好说明 CID 是纯内容哈希，与键名无关。

### 各 blob 的字段域

| blob | 实测 | 关键取值 |
|---|---|---|
| `player.raw` | **41 键** | `jumpPower 0.96`、`runSpeed 0.4`、`walkSpeed 0.22`、`gravity -0.1` |
| `physics.raw` | 3 键 | `gravity -0.1`、`useOBB false`、`velocityDamping 0.01` |
| `environment.raw` | **61 个叶子** | `drawDistance 1` ＋ `fog 8` ＋ `rain 12` ＋ `sky 30` ＋ `snow 10` |
| `ambientSound.raw` | 5 槽 | `ambient / breakVoxel / placeVoxel / playerJoin / playerLeave`，每槽 `{gain,gainRange,pitch,pitchRange,radius,sample}` |
| `zones.raw` | `[]` | 有区域时的字段域见 [API 参考](api-reference.md) 的 GameZone |
| `uiTree.raw` | 2 节点 | `type 0` 根 ＋ `type 2` 默认屏幕 |
| `assets.raw` | 77 项 | 8 键：`animated bounds contentId hash ownerId previewImage size type` |
| `scriptAssets.raw` | 2 项 | 键名就是脚本名（`index.js` / `clientIndex.js`） |

`environment` 的叶子数要按**递归到标量**算：`fog` 只有 6 个键，但 `fogColor` 是
`{r,g,b}`；`sky` 14 个键里有 8 个是 `{r,g,b}` 或 `{x,y,z}` 子对象。所以
"6 键"和"8 叶子"都对，**引用时必须说清按哪种数**。

颜色一律是**分量对象**（`{"r":1,"g":1,"b":1}`），不是 `#rrggbb`，也不是数组。

### `assets` 的 `type` 数字枚举

官方 `GameAssetType` 是**字符串**枚举（`"mesh" "lut" "sound" …`），
但项目包里的 `type` 是**另一套数字**。从真实模板数出来的对应关系：

| type | 项数 | 内容 |
|---|---|---|
| `3` | 27 | `lut/` 滤镜 |
| `4` | 10 | `part/` 部件 |
| `6` | 40 | `audio/` 音频（正好是模板的 40 个音效） |
| `7` | 2 | 脚本（出现在 `scriptAssets`） |

`0/1/2/5` 在模板里没出现，**不做推测**。导出时本实现按同一套数字写
（`io.js` 的 `type: 6 / 3 / 4`），所以官方编辑器能认。

### `map.json`

4 个键：`id`（数字，模板 `100135749`）、`name`、`branch`（`"master"`）、`projectHash`。

---

## 内容寻址：CIDv0

```
CID = base58btc( 0x12 ‖ 0x20 ‖ sha256(bytes) )      // 因此一律以 "Qm" 开头
```

`0x12` 是 dag-pb 的 codec、`0x20` 是 sha256 的摘要长度——**没有** CIDv1 的
`0x01` 前缀，所以模板里 13 个 CID 全部以 `Qm` 开头。参与哈希的是各 blob 的
**原始 JSON 字节**，不是重新序列化后的结果：先格式化再哈希会得到不同的 CID。

取回时**必须重算校验**：`scripts/fetch-official-project.mjs` 下载后算一遍
`cidOf(buf)`，与清单不符就拒绝落盘。公开网关会限流，所以这一步不能省——
它保证拿到的是清单指向的那份内容，而不是镜像给的别的东西。

---

## 第 3 层：方块表与图集

| 来源 | 数量 | 说明 |
|---|---|---|
| `data/upstream/block-id.json` | 384 项 | `"数字串" → 名字`，id **稀疏**：`0..767`，`0` 是空气 |
| `data/upstream/block-spec.json` | 384 项 | 每块的物理与贴图参数 |
| `public/data/block-atlas.json` | `blocks/byId/idMap` 各 383 | 去掉空气后的非空方块数 |

`block-spec.json` 的字段：`category color emissive friction id mass restitution
soundGroup texture[6] transparent type strength` 各 384 项都有，
`thumbnail` 只有 369 项。流体相关 `fluid / fluidColor / fluidExtinction` 12 项，
**其中包含空气，所以真流体是 11 种**。`velocity` 只有 2 项。

图集参数：瓦片 `16×16`、单元 `18`（含 1px 内缩）、padding `1`、
图集宽 `576`、每行 `32` 格、共 `991` 个瓦片。每块的六面索引在 `byId[id].faces[6]`，
序列帧在 `.anim[{face, duration, frames[]}]`——**有 `anim` 的恰好 15 种**
（熔岩 2、LED 地板 2、星光灯、雪花灯、4 色装饰灯、彩虹块、鞭炮、风扇、风草、传送带）。
分类 9 个：`color element food light nature number structure symbol letter`。

---

## 本地存档的实际布局

```
server/data/worlds/<id>.json.gz        一张地图＝一个扁平文件（不是目录）
server/data/models/<hex>.json.gz       VOXA 建模文档
server/data/assets/<id>/               世界上传件（安装目录只读时）
public/assets/worlds/<id>/             同一批文件的仓库内位置
```

前端 URL 始终是 `/assets/worlds/<id>/…`，所以服务端要在**两个根目录**里都解析这个前缀
——安装到只读卷（`.dmg`）时数据会落到 `~/.dao3-editor`，URL 却不能变。

保存链：`main.js save() → world.toPayload({...meta, terrain, scripts,
entities: collectEntities(), models: [], meshNames}) → POST /api/world`，gzip level 6。

---

<a id="chunks"></a>
## 官方 `chunks/<CID>.bin` 解不出方块表

**这是本实现不采用官方分块的根本原因，别再试。**

判据（`node scripts/decode-official-chunks.mjs` 可复现）：

| 量 | 实测 |
|---|---|
| chunk 文件数 | 73（其中 72 个非空，空块固定 2 字节） |
| 72 个非空块总字节 | **23,997** |
| 地图非空格数 | **1,523,592** |
| 比值 | 约 **63.5 格 / 字节** |

任何 `(index, id)` 类编码至少要 4–8 字节**每格**，而这里是 63 格每字节——
信息量差一个数量级以上，**物理上不可能**是逐格列表。

脚本试了 5 种假设，全部失败，且失败得很干净：

```
(id,index) / (index,id) / delta-zigzag / id→0 终止 / depth-5 稀疏八叉树
   → 精确耗尽的文件数：0 / 72
   首个反证：QmcmVeMaGj(403B) @offset 1 → 非法 id 4
```

剩下的字节特征（含 `5f 59 00` 标记）指向"烘焙后的合并网格容器"。
**注意**：protobuf 只是证据指向，未被证明，本文不把它当结论写。

`voxels.raw` 里另有 `chunks[256]` 的槽位表。**槽位与坐标的映射关系仓库里没有任何证据**，
所以本文不给"16×16 列"之类的猜测——写错比不写更糟。

---

<a id="roundtrip"></a>
## 往返一致性：什么会丢

| 方向 | 状态 |
|---|---|
| 官方 `.zip` → 导入 → 导出 `.zip` | ✅ `player` 不超 41 键、14 个音效槽齐全、`color` 是数组、`compat` 带回 `skin/gamepad` |
| 官方 `.gz` → 导入 → 保存 | ✅ 体素逐格一致 |
| 光照六数组 | ❌ 读不懂也不写回，**会丢** |
| 官方 `chunks/` 分块布局 | ❌ 只写单文件 `build/voxel-sparse.gz`，不还原分块 |
| `assets.hash` 对 `lut/` `part/` | ⚠️ 留空串（只有音频算真 CID），官方编辑器可能据此判"内容变化" |
| `map.json.projectHash` | ⚠️ 写空串 |
| 官方 `.vb` 网格容器 | ❌ 不解析，模型走 `mesh/*.gltf|glb` |
| `meshId` 大整数 | ⚠️ 原样保存，但语义未使用 |

把守这些的是 `test/runtime_parity.mjs` 的导出→导入回环断言，不是人工检查。

---

<a id="verify"></a>
## 自己验证一份地图

```bash
# 顶层键、三个数组是否等长、rot 取值域、id 种类数
node -e 'const fs=require("fs"),z=require("zlib");
const j=JSON.parse(z.gunzipSync(fs.readFileSync("official-project/racing-template.json.gz")));
console.log(Object.keys(j).join(" "));
console.log(j.indices.length, j.data.length, j.rot.length, new Set(j.rot));
console.log("非空格:", j.indices.filter((_,i)=>j.data[i]).length);'

# 实体表：节点数、type 分布、value 键数是不是恰好 22
# （同一段思路可直接对 official-project/racing-template/entitiesTree.raw 跑）

# 项目包键数与字母序、CID 数量与前缀
node -e 'const p=require("./official-project/racing-template/project.json");
const k=Object.keys(p);console.log(k.length, JSON.stringify([...k].sort())===JSON.stringify(k));'

# chunk 为什么不是方块表
node scripts/decode-official-chunks.mjs

# 整套往返/格式断言
npm test
```

## 与其他文档的分工

- 这篇：**字段级规范**与取值域，用来判断"我的文件合不合规"。
- [数据格式](data-format.md)：**实现说明**，为什么这样存、接口怎么暴露。
- [物理与单位制](physics.md)：`gravity`、`walkSpeed` 这些数值的**单位口径**。
- [架构与数据流](architecture.md)：为什么实体只有一张表、模型为什么是实体。
- [API 参考](api-reference.md)：这些字段在脚本里叫什么、怎么读写。
