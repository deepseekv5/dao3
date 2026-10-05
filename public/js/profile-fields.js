// profile-fields.js — 用户资料里那几档"枚举型"字段的唯一口径。
//
// 为什么放 public/js 而不是 server 里：服务端要校验（只认列出来的 id），前端要渲染
// （要把 id 翻成中文标签、要摆选择器）。抄两份的话，加一个地区就会两边飘——
// 前端能选、后端报"值不在允许范围内"，这种 bug 最难查。
// server/community.mjs 直接 import 这个文件（它已经 import 过 public/js/diff.js）。
//
// 所以这个文件必须保持纯数据：不引依赖、不碰 DOM。

/** 性别：只这四档，"" 表示不展示（不给默认值，默认"男"是一种替别人做决定）。 */
export const GENDERS = [
  { id: "m", label: "男" },
  { id: "f", label: "女" },
  { id: "other", label: "其他" },
  { id: "", label: "不展示" },
];

/** 地区：省级 + 港澳台 + 海外。自由文本会被写成"家里"或者一串广告，所以只让选。 */
export const REGIONS = [
  "北京", "天津", "上海", "重庆", "河北", "山西", "辽宁", "吉林", "黑龙江",
  "江苏", "浙江", "安徽", "福建", "江西", "山东", "河南", "湖北", "湖南",
  "广东", "广西", "海南", "四川", "贵州", "云南", "西藏", "陕西", "甘肃",
  "青海", "宁夏", "新疆", "内蒙古", "香港", "澳门", "台湾", "海外",
];

/** 性格标签：12 个，最多挑 6 个。词刻意是"一起玩游戏时会在意的那种"，不是 HR 词汇。 */
export const PERSONA = [
  { id: "lively", label: "开朗" },
  { id: "calm", label: "安静" },
  { id: "social", label: "社牛" },
  { id: "shy", label: "慢热" },
  { id: "funny", label: "搞笑" },
  { id: "serious", label: "认真" },
  { id: "chill", label: "佛系" },
  { id: "drive", label: "行动派" },
  { id: "kind", label: "热心" },
  { id: "nerd", label: "钻研" },
  { id: "bold", label: "敢冲" },
  { id: "craft", label: "爱建" },
];
export const MAX_PERSONA = 6;

/** 扩列状态：决定这个人在"扩列"列表里被谁搜到、卡片上那枚标签写什么。 */
export const LOOKING = [
  { id: "open", label: "欢迎扩列" },
  { id: "team", label: "找固定队友" },
  { id: "chat", label: "只聊天" },
  { id: "none", label: "不扩列" },
];

export const genderLabel = (id) => (GENDERS.find((g) => g.id === id) || { label: "" }).label;
export const personaLabel = (id) => (PERSONA.find((p) => p.id === id) || { label: id }).label;
export const lookingLabel = (id) => (LOOKING.find((l) => l.id === id) || { label: "" }).label;
