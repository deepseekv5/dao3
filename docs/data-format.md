# 数据格式

## 地图存档：与官方 Unity 侧 `.gz` 完全同构

```
server/data/worlds/<id>.json.gz
  = gzip( JSON( VoxelPayload ) )
```

```jsonc
{
  "formatVersion": "unity",
  "shape": [256, 128, 256],
  "dir":   [1, 1, 1],
  "indices": [ /* x + y*X + z*X*Y */ ],
  "data":    [ /* blockId，稀疏：只存非空 */ ],
  "rot":     [ /* 0..3 的转数；官方 id 里的 16384 倍数在落盘时已折算 */ ],
  "lightIndices": [], "lightFlags": [], "lightIntensity": [],
  "lightRange": [], "lightColorRgb": [], "lightOffsetXyz": [],
  "meta": { /* 编辑器元数据，见下 */ }
}
```

`GET /api/world/:id` 在请求头带 `Accept-Encoding: gzip` 时**原样吐出磁盘上的 gz**，
不重复解压再压缩；浏览器自动解压，所以大地图回源只有一次 gunzip。

### `meta` 里放什么

官方 blob 放不下的东西都进 `meta`：`terrain`（天空/雾/曝光）、`scripts`、
`entities`（官方 22 字段的扁平表）、`zones`、`player`、`worldSettings`、
`environment`、`ambientSound`、`products`、`ui`、`pictureNames`、`assetRoot`。

## 项目包 `.zip`：官方 21 键清单

```
project.json          21 个键、字母序、version "0.3.23"
project/info.json     displayName / description / previewImage / notice
project/player.json   官方 41 键（见下）
project/physics.json  { gravity, useOBB, velocityDamping }
project/environment.json  46 个叶子键（fog7 + rain8 + snow8 + sky13 + 其余）
project/ambientSound.json 5 个槽
project/zones.json    官方 bounds/selector/massScale/force + 环境覆盖
project/uiTree.json   官方 nodes 形态（Root / 组 / 屏幕）
project/assets.json   路径 → {animated,bounds,contentId,hash,ownerId,previewImage,size,type}
project/deleteAssets.json
entities/entitiesTree.json  恰好 22 个 value 字段
code/index.js, code/clientIndex.js
build/voxel-sparse.gz       就是上面那个 .gz
audio/*.{mp3,wav,…}         仅当本地有素材时
mesh/*.gltf|glb             仅当本地有素材时
project/compat.json         本地扩展（官方清单里没有的）
```

`assets.json` 里的 `hash` 是**真算出来的 CIDv0**（sha256 → base58btc），
不是占位串；实现已用官方 40 个音频 40/40 对账验证。

### 为什么需要 `compat.json`

官方 `entitiesTree` 的 value 恰好 22 个字段，多写一个就不该被官方读回。
但本地确实有些官方没有的能力：隐藏网格、物理盒偏移、gameRules、商品表、
界面部件、图片名单。这些一律进 `compat.json`，导入时再合并回来。

`player.json` 同理：官方 41 键，本地运行时的名字要翻回去——

| 本地（= 官方运行期 API 名） | 官方 project.json |
|---|---|
| `canFly` | `allowFlight` |
| `enableJump` / `enableDoubleJump` / `enableCrouch` | `allowJump` / `allowDoubleJump` / `allowCrouch` |
| `spectator` | **`noClip`** |
| `cameraMode` | `cameraType` |
| `color`（GameRGBColor） | `[r,g,b]` 数组 |
| 扁平 `jumpSound` 等 | 嵌在 `playerSounds.{jump,…}` |

`skin` / `skinInvisible` / `gamepad` 不在这 41 键里 → 走 `compat.playerExtras`。
这条切分由 `test/runtime_parity.mjs` 的导出→导入回环断言把守。

## 内容寻址（CIDv0）

```
CID = base58btc( 0x12 0x20 ‖ sha256(bytes) )     // 以 "Qm" 开头
```

用途有两个方向：
- **导出**：给 `assets.json` 填真实 hash，官方编辑器读回时能判断内容一致
- **取回**：`scripts/fetch-official-project.mjs` 按 CID 下载后**重算校验**，
  保证拿到的就是清单指向的那份内容，不是镜像给的另一份东西

## 导入支持什么

| 输入 | 处理 |
|---|---|
| 官方 `.zip` 项目包 | 全量：地图 + 脚本 + 实体 + player/physics/environment + 音频 + 模型 + compat |
| Unity 侧 `.gz` | 地图 + meta |
| `.vox`（MagicaVoxel） | 体素几何，调色板映射到方块 id |

导入 zip 时，模型与图片会落到 `public/assets/worlds/<id>/` 下，
编辑器按 `meta.assetRoot` 懒加载。**图片保留 `picture/` 目录层级**，
这样 `resources.ls("picture")` 返回的路径和 `UiImage.image` 写的路径能对上。

## 这些格式的来源与边界

`.gz` 的 payload 形状、`block-id.json` / `block-spec.json` 的字段，
来自官方 Apache-2.0 的 `Box3Blocks-unityPackage`；
`project.json` 的 21 键与 `player` 的 41 键，来自官方公开的项目数据结构。

**官方 `chunks/<CID>.bin` 不是逐体素列表**，别指望从里面解出方块表：
72 个非空块合计只有 23,995 字节，而地图有 152 万格——信息量差 169 倍。
它是烘焙后的合并网格容器（protobuf 分段，含 `5f5900` 标记）。
复现与判据见 `scripts/decode-official-chunks.mjs`。
