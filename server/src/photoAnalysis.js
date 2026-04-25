/**
 * Local pseudo-analysis from photo + player id: stable seed → roast lines + similarity %.
 * Replace with real vision/LLM when wired; keep exports stable.
 */

const FNV32_OFFSET = 2166136261;

/** @param {string} s */
export function fnv1a32(s) {
  let h = FNV32_OFFSET >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const ROASTS_EN = [
  "Museum lighting called — you're giving «main character but the script is still loading» energy.",
  "The pixels held a focus group. Verdict: certified 3 a.m. face, but the vibes IPO anyway.",
  "If your aura was a stock, it would be memed, volatile, and somehow still a buy rating.",
  "Low-res myth, high-res commitment. The zoo's CV pipeline respects the contrast.",
  "You look like the tutorial was skipped and you 100% cleared the boss by accident.",
  "Face: buffering. Charisma: 4K stream. Shame: optional DLC, not installed.",
  "The camera did math, gave up, and graded you on narrativity instead. A+ on plot holes.",
  "Somewhere a JPEG ghost adopted you. It refuses to be compressed any further, respect.",
  "Derm optional. Drip: still indexing. ETA: whenever the room stops roasting itself.",
  "«Maintenance mode» if it were a look — and you still shipped hotfix Friday night."
];

const ROASTS_ZH = [
  "相机会议结论：你散发着「主舞台打光找错人」的松弛与自信。",
  "像素们加班算了三遍，只得出「深夜氛围感」这条 KPI，还超额完成。",
  "如果气质能上市，你这支波动大但梗图多，机构评级：梗民自理。",
  "长相像未保存文档 3:00 点提交，居然也按时过审，令人敬佩。",
  "五官开会说：我们各自有想法，但团建还算成功，暂不调岗。",
  "相机想给你磨皮，被你的叙事张力劝退，改发「生图直出，自带弹幕」。",
  "有人说你像高糊壁纸成精：糊的是分辨率，不糊的是现场梗密度。",
  "动物园审美服务器曾短暂 404，已切备用线路：土味与赛博冷笑话。",
  "这张脸走「先道歉再自曝」的搞笑叙事流，本园技术验收：通过。",
  "别问像不像样，问就是：评论区已自发产出表情包。",
  "如果长相能众筹，你已经筹到一群路人自愿当自来水。",
  "镜头语言翻译：不靠滤镜，靠把日常讲成 season finale。"
];

/**
 * @param {number} seed
 * @param {"en" | "zh"} lang
 */
export function pickLooksRoast(seed, lang) {
  const list = lang === "zh" ? ROASTS_ZH : ROASTS_EN;
  return list[seed % list.length] ?? list[0];
}

/**
 * @param {number} seed
 * @param {string} animal
 * @param {string} playerId
 * @returns {number} 55–99
 */
export function similarityPercentFor(seed, animal, playerId) {
  const h = fnv1a32(String(seed) + String(animal) + String(playerId));
  return 55 + (h % 45);
}
