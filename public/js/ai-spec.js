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
export const PITFALLS = [
  { api: "GameWorld.sunPhase", rule: "sunPhase 是 0..1 的相位，不是小时数：0=06:00、0.25=12:00、0.5=18:00、0.75=午夜。当 0..24 用会让正午永远是黄昏。" },
  { api: "GameRGBColor", rule: "服务端颜色（GameRGBColor / GameRGBAColor）分量取值 **0..1**；而客户端 UI 的 Vec3 颜色分量取值 **0..255**。两边混用会让 UI 颜色全黑。" },
  { api: "GameWorld.say", rule: "world.say() 只在玩家头顶出气泡，**不会**进聊天频道；要发聊天得用玩家自己的 say。" },
  { api: "GameWorld.searchBox", rule: "searchBox 要求实体**完全包含**在框内才算命中，不是相交判定。要「碰到就算」请用 getEntityBounds 自己判 intersects。" },
  { api: "global:getEntityBounds", rule: "getEntityBounds(entity) 返回的是「中心 ± 半径」，中心 = position + anchorOffset，不是把 position 当角点。" },
  { api: "UiText.richText", rule: "富文本只放行 <font size color> 与 <stroke ...> 这类白名单标签，不要生成任意 HTML——既渲染不出来也是注入面。" },
  { api: "GameWorld.projectName", rule: "world.projectName 只读，不要赋值。" },
  { api: "GamePlayer.movementBounds", rule: "movementBounds 越界时会把实体**夹回**边界并清掉朝外的速度，不是扔回出生点。" },
  { api: "GameEntity.enableInteract", rule: "交互提示走 enableInteract + onInteract，其中 distance / displayText / buttonType / buttonKey 四个都得设；buttonType 用 GameButtonType 枚举，默认是 INTERACT。" },
  { api: "GameAssetListEntry.type", rule: "scriptAssets 里的 entity.type 是**数字**：1=服务端、7=客户端。写成 \"server\"/\"client\" 不生效。" },
];

/** 写法规范：与本项目运行方式直接相关，不是通用编程常识。 */
function styleRules(side) {
  return [
    `- 引擎固定 ${TICK_MS}ms 一个 tick（20 TPS）。所有计时按 tick 算，不要用 setInterval/requestAnimationFrame，也没有 sleep()。`,
    `- 坐标单位是「格」，1 格 = 1 个方块；世界坐标为整数格，实体坐标为浮点。角度一律用弧度。`,
    `- 实体总数上限 ${ENTITY_QUOTA}。`,
    `- 方块旋转码 rot 只有 0/1/2/3 四个值，与运行期数值 id 里那个 16384 的旋转码是两回事，不要混。`,
    `- 实体选择：'#名字' 与 '.标签'。**entity.id 暴露的是实体名字**（如 "检查点-0"），要序号就从名字里取数字，不要假设 id 是数字。`,
    `- 新建地图里的实体若需要被脚本按顺序取用，名字必须自带序号（检查点-0、检查点-1 …），否则按序号排序的写法会全部拿到同一个 index。`,
    `- 物理默认值（不要自己编数字，需要改就显式赋值）：walkSpeed ${PLAYER_DEFAULTS.walkSpeed}、runSpeed ${PLAYER_DEFAULTS.runSpeed}、crouchSpeed ${PLAYER_DEFAULTS.crouchSpeed}、jumpPower ${PLAYER_DEFAULTS.jumpPower}、gravity ${WORLD_DEFAULTS.gravity} 格/tick²、自动踏步高度 ${STEP_UP} 格。`,
    `- 速度单位是「格/tick」，不是「格/秒」。换算关系是 ×${(1000 / TICK_MS).toFixed(3)}。`,
    side === "client"
      ? `- 这是客户端脚本：只跑在**本地那一个玩家**的浏览器里，没有 world.entities 的服务端权威状态；UI 用 ui / UiBox / UiText 等构造。`
      : `- 这是服务端脚本：只有它能看到全部玩家与世界状态；UI 要下发给客户端请用 world.gui() 或实体交互，不要直接 new UiBox()。`,
    `- 不要 import / require / 访问 DOM / 读 localStorage；脚本能碰到的只有注入的全局。`,
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
