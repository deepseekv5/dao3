// ai-spec.js — 交给 AI 的**开发规范**，单一来源。
//
// 为什么要有这个文件：只把「类 → 成员名」丢给模型是不够的。名字不带单位、不带端、
// 也不带"这个成员我们其实没实现"，而恰恰是这三类信息决定生成的代码能不能跑。
// 更关键的是本项目有一整批**看着理所当然、实际与常识相反**的语义（见 PITFALLS），
// 模型靠通用知识一定会写错——这些必须明说。
//
// 三条防腐原则：
//  1. 数字**一律 import，不重抄**。这里出现的每个常量都直接来自 gapi.js，
//     所以不存在"文档说 0.22、代码改成 0.25"这种事。
//  2. 禁用清单**从 api-spec.json 的 i 标记算出来**，不是手写的名单。
//  3. PITFALLS 是手写的（语义没法自动生成），但每条都带 `api` 键，
//     test/ai.mjs 会断言它引用的成员真实存在于规格里——改了名会红，不会烂在这里没人知道。

import { TICK_MS, PLAYER_DEFAULTS, WORLD_DEFAULTS, ENTITY_QUOTA, STEP_UP } from "./gapi.js";

/** 从规格里算出"官方有、我们没有"的成员清单，用来明确禁止模型使用。 */
export function forbiddenMembers(spec) {
  const out = [];
  for (const [cls, d] of Object.entries((spec && spec.classes) || {})) {
    if (!d || d.tracked !== 1) continue;   // interface 不谈实现与否
    for (const [name, m] of Object.entries(d.m || {})) if (m && m.i === 0) out.push(`${cls}.${name}`);
  }
  return out;
}

/**
 * 与常识相反、必须写进提示的语义。
 * 来源是 docs/api-compat.md 那张对账表里**会影响生成代码**的行
 * （其余是运行时内部实现细节，模型用不到）。
 */
/**
 * 与常识相反、必须写进提示的语义。
 * 来源是官方文档（box3-product-document 的 api/**），不是"通用编程常识"。
 *
 * ⚠️ 这一份先前有 **四条是我自己编的**，官方文档里根本找不到：
 *   · "world.say 只出气泡不进聊天" —— 恰好相反，官方 resident.md 说 world.say 是
 *     "向所有玩家广播一条消息"，归在聊天系统下；头顶气泡那个是 entity.say。
 *   · "movementBounds 越界是夹回边界" —— 官方 info.md 写"如超出此范围，则传回出生点"。
 *   · "enableInteract 要设 distance/displayText/buttonType/buttonKey" ——
 *     后两个名字**整个仓库都搜不到**，官方是 interactHint/interactRadius/interactColor。
 *   · "searchBox 要求完全包含" —— 官方 querySelectorEntity.md 没说这条，那是我们自己的实现。
 * 规范里写一条假的比不写更坏：模型会照着错的那条自信地生成，而它看起来很像人话。
 * 所以每条现在都带 `src`（官方文档出处）。没有官方出处的，一律标 `ours`，
 * 并在文案里明说"这是本实现的行为"，不冒充官方语义。
 */
export const PITFALLS = [
  { api: "GameWorld.sunPhase", src: "api/GameWorld/weather/illumination.md:39-49", rule: "sunPhase 是 0..1 的相位，不是小时数：0=06:00、0.25=12:00、0.5=18:00、0.75=午夜。当 0..24 用会让正午永远是黄昏。" },
  { api: "GameRGBColor", src: "api/GameRGBColor/index.md:7 与 api/ClientUI/maths/Vec3.md", rule: "服务端颜色（GameRGBColor / GameRGBAColor）分量取值 **0..1**；而客户端 UI 的 Vec3 颜色分量取值 **0..255**。两边混用会让 UI 颜色全黑。" },
  { api: "GameVector3.fromPolar", src: "api/GameVector3/index.md:47", rule: "fromPolar(mag, phi, theta)：**第一个参数是长度**，不是角度。写成 fromPolar(theta, phi, mag) 会得到一个方向乱指的向量。" },
  { api: "GameQuaternion", src: "api/GameQuaternion/index.md:13,82", rule: "四元数构造与 set 的参数顺序是 **(w, x, y, z)**，不是 Three.js 的 (x, y, z, w)。fromAxisAngle 收 (axis: GameVector3, rad) 两个参数。" },
  { api: "GameEntity.hurt", src: "api/GameEntity/fight.md:17-20", rule: "hurt() 在 enableDamage 为真之前是**静默空操作**，而 enableDamage 默认 false。要掉血必须先 entity.enableDamage = true，否则代码跑得好好的就是不见伤害。" },
  { api: "global:sleep", src: "api/GameWorld/fight.md:68、api/GameEntity/physics.md:87", rule: "官方脚本里 await sleep(毫秒) 与 setInterval/setTimeout 都是可用的（引擎托管、退出运行会清），**不要自己造 tick 计数器去替代它们**。" },
  { api: "UiRenderable.rotation", src: "api/ClientUI/UiRenderable.md:35-39", rule: "客户端 UI 的 rotation 是**角度**（-179..180），不是弧度；而 world/entity 的角度是弧度。两边别混。" },
  { api: "UiRenderable.position", src: "api/ClientUI/UiRenderable.md:19-24、api/ClientUI/maths/Coord2.md", rule: "UI 的 position/size 是 Coord2：{offset 像素, scale 占父节点比例 0..1}。直接 position.x = 100 这种赋值不产生预期的布局效果，要用 offset/scale 两个字段。" },
  { api: "UiBox.create", src: "api/ClientUI/index.md（节点创建）", rule: "UI 节点用 UiBox.create() / UiText.create() 这类工厂创建，不是 new UiBox()。" },
  { api: "GameAssetListEntry.type", src: "d.ts + 地图 project 结构", rule: "scriptAssets 里的 entity.type 是**数字**：1=服务端、7=客户端。写成 \"server\"/\"client\" 不生效。" },
  { api: "global:nextEventFilter", src: "api/notice/eventDiff.md:60-90", rule: "next* 事件可以传一个**对象当过滤器**：await world.nextChat({ message: \"start\" }) 只会等到匹配的那一次；不传参数才是等任意下一次。on* 则每次都触发。" },
  { api: "GameDataStorage.list", src: "api/GameDataStorage/help.md:351-352", rule: "list({ cursor, pageSize })：cursor **必选**且是页码（从 0 起），pageSize 默认 100、范围 [0,100]。漏传 cursor 就是没写完。" },
  { api: "GameDataStorage.get", src: "api/GameDataStorage/setSpace.md:57-72", rule: "get(key) 返回的是 { key, value, updateTime, createTime, version } 这个对象（没有该键时是 undefined），**取内容要 .value**。直接把返回值当数据用会拿到一个对象。" },
  { api: "GameDataStorage", src: "api/GameDataStorage/getSpace.md:38-113", rule: "存储名必须全英文且不超过 50 字符；getDataStorage 是【单地图】隔离（副图读不到），getGroupStorage 才是主副图共用。写配额约 (60+玩家数*10)/分钟，超了会 429 REQUEST_THROTTLED。" },
  { api: "global:require", src: "api/notice/exportAndImport.md", rule: "官方 Arena 服务端脚本是 **CommonJS**：跨文件复用用 require(\"./x.js\") 取、module.exports 交。不要写 ES module 的 import/export。" },
  { api: "global:getEntityBounds", src: "api/GameWorld/querySelectorEntity.md:206 区段", rule: "getEntityBounds(entity) 返回的是「中心 ± 半径」，中心 = position + anchorOffset，不是把 position 当角点。" },
  { api: "UiText.richText", src: "api/ClientUI/RichText.md", rule: "富文本只放行 <font size color> 与 <stroke ...> 这类白名单标签，不要生成任意 HTML——既渲染不出来也是注入面。" },
  { api: "GameWorld.projectName", src: "api/GameWorld/mapInfo.md", rule: "world.projectName 只读，不要赋值。" },
  // ↓↓↓ 这些不是官方语义，是我们自己实现的行为。标 ours，别混进"官方规矩"。
  { api: "GameWorld.searchBox", src: "ours", rule: "【本实现行为】searchBox 要求实体**完全包含**在框内才算命中（不是相交）。要「碰到就算」请用 getEntityBounds 自己判 intersects。" },
  { api: "global:selectorSyntax", src: "ours", rule: "【本实现行为】实体选择器支持 '#名字'、'.标签'、'*'、'player' 以及 '.a .b' 这种多标签与；新建地图里的实体若要被脚本按顺序取用，名字必须自带序号（检查点-0、检查点-1 …）。" },
];

/** 写法规范：与本项目运行方式直接相关，不是通用编程常识。 */
const TPS = 1000 / TICK_MS;
function styleRules(side) {
  return [
    // TPS 由 TICK_MS 现算。原先这里写死"20 TPS"，于是整句话自相矛盾：
    // "固定 64ms 一个 tick（20 TPS）"——20 是官方文档里 **Minecraft 那一套**的口径
    // （mc-api 说每秒 20 次），DAO3 是 15.625。写死数字的话下一个 TICK_MS 改动
    // 又会把这句变成谎话。
    `- 引擎固定 ${TICK_MS}ms 一个 tick（即 ${TPS.toFixed(3)} TPS）。计时优先用 await sleep(毫秒) 与 setInterval/setTimeout（引擎托管，退出运行自动清理），不要自己造 requestAnimationFrame 循环。`,
    `- 坐标单位是「格」，1 格 = 1 个方块；世界坐标为整数格，实体坐标为浮点。`,
    // 这条原先写"角度一律用弧度"，而官方 UI 的 rotation 是**角度** −179..180
    // （api/ClientUI/UiRenderable.md:35-39）。一句话把客户端脚本全带偏。
    `- 角度：world / entity 用**弧度**；但客户端 UI 的 rotation 用**角度**（-179..180）。`,
    `- 实体总数上限 ${ENTITY_QUOTA}；createEntity 到达上限时返回 null（不是抛错），要用就要判空。`,
    `- 方块旋转码 rot 只有 0/1/2/3 四个值（0=北 -z、1=东 +x、2=南 +z），与运行期数值 id 里那个 16384 的旋转码是两回事，不要混。`,
    `- 实体选择：'#名字' 与 '.标签'。**entity.id 暴露的是实体名字**（如 "检查点-0"），要序号就从名字里取数字，不要假设 id 是数字。`,
    `- 新建地图里的实体若需要被脚本按顺序取用，名字必须自带序号（检查点-0、检查点-1 …），否则按序号排序的写法会全部拿到同一个 index。`,
    `- 物理默认值（不要自己编数字，需要改就显式赋值）：walkSpeed ${PLAYER_DEFAULTS.walkSpeed}、runSpeed ${PLAYER_DEFAULTS.runSpeed}、crouchSpeed ${PLAYER_DEFAULTS.crouchSpeed}、jumpPower ${PLAYER_DEFAULTS.jumpPower}、gravity ${WORLD_DEFAULTS.gravity} 格/tick²、自动踏步高度 ${STEP_UP} 格。`,
    `- 速度单位是「格/tick」，不是「格/秒」。换算关系是 ×${TPS.toFixed(3)}。`,
    side === "client"
      ? `- 这是客户端脚本：只跑在**本地那一个玩家**的浏览器里，没有 world.entities 的服务端权威状态；客户端的 world 只有 rendering3d 等极少成员，UI 用 UiBox.create() / UiText.create() 等工厂构造。`
      : `- 这是服务端脚本：只有它能看到全部玩家与世界状态；要给客户端下发 UI 或数据，用 remoteChannel 的 sendClientEvent / broadcastClientEvent（只允许可序列化的值），不要直接 new UiBox()。`,
    // 原先这句是"不要 import / require / 访问 DOM"——但官方 Arena 服务端规范就是
    // CommonJS（api/notice/exportAndImport.md），禁掉 require 等于禁掉官方唯一的多文件复用手段。
    `- 跨文件复用用 CommonJS：require("./x.js") 取、module.exports 交；**不要**写 ES module 的 import/export，本实现不支持。脚本碰不到 DOM、localStorage、网络文件系统。`,
    `- 玩家可能中途加入或离开，遍历后使用前先判空；不要用固定索引取玩家。`,
  ].join("\n");
}

/**
 * 组装交给模型的规范正文。
 * @param {string} side "server" | "client" | "sandbox"
 * @param {{api?: string, forbidden?: string[], names?: string}} parts 由 ai-script.js 备好的片段
 */
export function specBrief(side, parts = {}) {
  if (side === "sandbox") return SANDBOX_BRIEF + (parts.names ? `\n可用方块名（按类别）：${parts.names}` : "");
  const forbid = (parts.forbidden || []).length
    ? `\n【官方有、但本实现还没有的成员——绝对不要用，用了就是 undefined】\n${parts.forbidden.map((f) => "  ✗ " + f).join("\n")}`
    : "";
  return [
    `【目标端】${side === "client" ? "客户端脚本（文件名含 client）" : "服务端脚本"}`,
    `\n【计时与单位】\n${styleRules(side)}`,
    `\n【与常识相反的官方语义——这部分最重要，写错不会报错只会行为不对】`,
    PITFALLS.map((p) => "  · " + p.rule).join("\n"),
    forbid,
    `\n【可用 API 面】（格式：类.成员(签名) — 官方中文说明；标注 [端] 的只在对应端可用）`,
    parts.api || "（清单未取到，只写最基础的 world / entity / player 调用）",
  ].join("\n");
}

/** 方块沙箱：只有 sb.*，与官方 GameAPI 是两套东西，必须分开说明。 */
export const SANDBOX_BRIEF = `【目标端】方块沙箱脚本——由编辑器的「运行」按钮执行，只改当前世界的体素。
这里**没有** world / entity / player 等官方全局，全局只有 sb、Math、console 三个。
可用成员（就这些，别的一个都没有）：
  sb.set(x, y, z, block)            在整数格坐标放一个方块；block 可传方块名或数字 id
  sb.del(x, y, z)                   删除该格
  sb.block(name)                    方块名 → 数字 id（名字不存在时返回 0）
  sb.box([x0,y0,z0], [x1,y1,z1], block, shell?)   填一个长方体；shell=true 只留外壳
  sb.sphere([x,y,z], r, block)      填一个球
  sb.clear()                        清空整个世界的方块（谨慎：会清掉玩家已有建筑）
  sb.count()                        当前世界方块总数
  sb.size()                         世界尺寸 [X, Y, Z]
  sb.log(msg)                       把结果显示到控制台
规则：
  · 坐标必须是整数格，且落在 0 ≤ 坐标 < 该轴尺寸内；越界会被静默丢弃，所以先用 sb.size() 探边界。
  · 不要调用官方 API（world / entity / storage / http 等在这里都不存在）。
  · 一次运行只提交一批改动，可以撤销；不要写无限循环。
  · 要造复杂形状就用 box/sphere 组合，别逐格 set 上千次。`;
