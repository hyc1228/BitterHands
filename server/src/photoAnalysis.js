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

// Mock-clinical "booth notes" — the Monitor pretending to file an
// aesthetic evaluation of your face. Bureaucratic, deadpan, vaguely
// kind. Always references body parts / expressions / lighting so it
// reads as commentary on your appearance, even though we don't run
// real CV. Keep each line ≤ 18 words.
const ROASTS_EN = [
  "Lighting committee approves the soft fill. Just barely. Please don't make us regret it.",
  "Symmetry: adequate. Confidence: on probation. Charm filed under «miscellaneous, see Tuesday».",
  "Booth detects one face, one opinion, and one quiet suspicion of the camera.",
  "Eyes report mild surveillance fatigue. Within normal range. Please continue breathing.",
  "Posture above zoo average. Jaw within tolerance. Eyebrows have yet to file a statement.",
  "Cheekbones cooperated. Hair did not. We are choosing to allow it.",
  "Skin tone reads «slept once this week». The Monitor is, frankly, moved by the effort.",
  "Mood scan: 30% defiance, 30% caffeine, 40% «who agreed to this». Logged.",
  "Face holds shape under stress. Structural integrity rated above premium plush toy.",
  "Subject smiles approximately 1.4 times above the admission threshold. Welcome.",
  "Brow in active negotiation with mouth. Committee has adjourned for snacks.",
  "You photograph like someone who has, on at least one occasion, out-argued a fridge.",
  "Filed under «low maintenance, high theatre». No further notes required.",
  "The webcam recommends slightly fewer existential thoughts before the shutter."
];

const ROASTS_ZH = [
  "灯光评议组：柔光给你刚刚够用，勉强通过。请别让我们后悔。",
  "对称尚可，自信处于试用期，魅力暂归入「其他，详见周二」。",
  "本展柜检测到一张脸、一种意见，以及对镜头的一份微妙怀疑。",
  "眼神显示轻度监控疲劳，属正常范围，请继续呼吸。",
  "姿态高于园区均值，下颌符合公差，眉毛暂未出具书面意见。",
  "颧骨配合良好，发型未配合，本园决定姑且通过。",
  "肤色读数：本周睡过一次。监管者对这份努力深感动容。",
  "情绪扫描：30% 抗议、30% 咖啡因、40%「谁同意的」。已存档。",
  "压力下脸型保持稳定，结构稳定性高于高级毛绒玩具级别。",
  "微笑指数超过入园阈值约 1.4 倍。欢迎光临。",
  "眉毛与嘴部仍在协商，评审会已暂停去吃点心。",
  "你这张脸像那种至少有一次跟冰箱吵架占过上风的人。",
  "归类为「低维护、高戏剧性」。其余无补充。",
  "镜头建议拍照前少做一点存在主义思考，仅此而已。"
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
