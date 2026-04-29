import type { Lang } from "../party/protocol";

/**
 * Onboarding personality quiz.
 *
 * The earlier catalogue was atmospheric flavour ("the lights die — what do you
 * do?") that made for fun reading but didn't actually measure anything, so a
 * lot of players were left feeling like the quiz was decorative.  This rewrite
 * grounds every item in a small set of established personality frameworks so
 * the assigned animal feels like a real read on the player:
 *
 *   - Karen Horney's three interpersonal orientations (1945) — Moving AWAY
 *     (detached / observant), Moving AGAINST (assertive / dominant), and
 *     Moving TOWARD (affiliative / harmonising). These map 1:1 to the game's
 *     three animals (Owl / Lion / Giraffe), which is why we picked Horney
 *     rather than Big Five (5 dims) or MBTI (16 types).
 *   - Big Five facets (Goldberg's IPIP, Gosling's TIPI) — Extraversion,
 *     Agreeableness, Conscientiousness, Openness, Neuroticism. Items 4, 7,
 *     11, 14 borrow framings from short-form Big Five inventories so the
 *     three orientations get expressed across different life domains
 *     (conflict, work, leisure, decisions) instead of all being interpersonal.
 *   - Coping-style items (Lazarus & Folkman 1984; Carver's Brief COPE) —
 *     items 9 and 15 reflect problem-focused vs. emotion-focused vs.
 *     social-support coping, which broadly track the same three styles.
 *
 * Answer → animal mapping (matches `_fallbackAnimalFromAnswers` on the
 * server):
 *   A → OWL    (Moving away — observe, withdraw, analyse)
 *   B → LION   (Moving against — assert, drive, confront)
 *   C → GIRAFFE (Moving toward — affiliate, soothe, harmonise)
 *
 * The intent is that *most* players see at least one item from a
 * different framework when they take the quiz, so the animal feels
 * earned across multiple traits rather than from a single archetype check.
 *
 * Item-writing rules of thumb (kept the originals' voice without the horror):
 *   - Real-life situation, not zoo flavour. Player has to picture themself.
 *   - Each option is a recognisable action, not an abstract trait label.
 *   - Options are roughly equal in social desirability so players don't
 *     gravitate to a "right" answer.
 *   - en + zh are translations of the same intent, not literal word swaps.
 */

export interface Question {
  id: string;
  text: string;
  A: string;
  B: string;
  C: string;
}

type Row = {
  id: string;
  /** Short tag noting which framework / construct each item draws from.
   *  Not surfaced to players — kept here so future tweaks can preserve
   *  trait coverage instead of accidentally drawing 3 conflict-style
   *  items in a row. */
  trait:
    | "interpersonal-approach"
    | "conflict-style"
    | "recharge-style"
    | "openness"
    | "risk"
    | "self-disclosure"
    | "authority"
    | "self-image-praise"
    | "stress-coping"
    | "trust"
    | "self-image"
    | "leadership"
    | "boundaries"
    | "decision-style"
    | "crisis";
  en: Omit<Question, "id">;
  zh: Omit<Question, "id">;
};

const CATALOG: Row[] = [
  {
    id: "qz_01",
    trait: "interpersonal-approach",
    en: {
      text: "You walk into a room of strangers. What do you usually do first?",
      A: "Hang back, scan the room, decide who's worth talking to.",
      B: "Walk up to whoever looks most interesting and start a conversation.",
      C: "Find a friendly face and join whatever they're doing."
    },
    zh: {
      text: "你走进一屋子陌生人。通常第一件事是？",
      A: "先在边上观察一下，看清谁值得搭话",
      B: "直接走向看着最有意思的那个人，主动开聊",
      C: "找一张友善的脸，加入 TA 们在聊的话题"
    }
  },
  {
    id: "qz_02",
    trait: "conflict-style",
    en: {
      text: "Someone you respect criticises your work in front of others. Your first reaction?",
      A: "Stay quiet, replay it later in your head, then decide.",
      B: "Push back on the spot — you don't let it sit.",
      C: "Acknowledge what's fair, look for common ground, keep it low-temperature."
    },
    zh: {
      text: "一个你尊敬的人当众挑你工作的毛病。你下意识反应？",
      A: "先沉默，回去反复想，再准备回应",
      B: "当场反击——这话不能让它落地",
      C: "先承认对的部分，找共识，把温度压下来"
    }
  },
  {
    id: "qz_03",
    trait: "recharge-style",
    en: {
      text: "An exhausting week ends. What recharges you?",
      A: "Solo time. A book, a walk, no one to talk to.",
      B: "Something physical or competitive — gym, climb, hard run.",
      C: "Dinner with people who get you, no agenda."
    },
    zh: {
      text: "累瘫的一周结束了。怎么充电？",
      A: "一个人独处。看书、走路、不说话",
      B: "做点对抗性强的——撸铁、跑步、登山",
      C: "和懂你的人吃一顿饭，不带目的"
    }
  },
  {
    id: "qz_04",
    trait: "openness",
    en: {
      text: "A problem you've never seen before lands on you. You usually:",
      A: "Sit with it. Look at it from every angle before doing anything.",
      B: "Try the boldest fix that comes to mind — speed beats perfection.",
      C: "Ask people who've seen it before; you trust experience."
    },
    zh: {
      text: "一个你从没碰过的问题摆在面前。你通常？",
      A: "先慢慢琢磨，从每个角度看一遍再动手",
      B: "试最大胆的那一种解法——速度比完美重要",
      C: "问问见过的人，你相信经验"
    }
  },
  {
    id: "qz_05",
    trait: "risk",
    en: {
      text: "A risky opportunity comes up — high upside, real downside. You:",
      A: "Run the numbers privately. You'll take risks, but only after the homework.",
      B: "Take it. You'd rather act and adjust than wait and lose it.",
      C: "Talk to the people who'd be affected before deciding."
    },
    zh: {
      text: "一个高收益高风险的机会摆在你面前。你？",
      A: "自己跑一遍数据——可以冒险，但要先做功课",
      B: "接，行动中调整远比等着错过强",
      C: "先问问会被影响到的人，再决定"
    }
  },
  {
    id: "qz_06",
    trait: "self-disclosure",
    en: {
      text: "Things are quietly going wrong for you. Who do you tell first?",
      A: "No one yet. You handle it alone until you've understood it.",
      B: "Whoever has the power to fix it — direct, no hedge.",
      C: "Someone who'll listen — you process out loud with them."
    },
    zh: {
      text: "事情悄悄出岔子了。你最先告诉谁？",
      A: "暂时不说——先一个人弄清楚再讲",
      B: "能解决的人——直接，不绕弯",
      C: "愿意听你讲的人——你边说边理思路"
    }
  },
  {
    id: "qz_07",
    trait: "authority",
    en: {
      text: "Your boss asks you to do something you think is mistaken. You:",
      A: "Quietly do it your way, present the result, let the work speak.",
      B: "Tell them straight — and propose what you'd do instead.",
      C: "Ask questions to understand their reasoning before pushing back."
    },
    zh: {
      text: "老板让你做一件你觉得不对的事。你？",
      A: "默默按自己的方式做，用结果说话",
      B: "当面提出来，再给 TA 一个你的方案",
      C: "先问清楚 TA 的逻辑，再决定要不要推回去"
    }
  },
  {
    id: "qz_08",
    trait: "self-image-praise",
    en: {
      text: "Compliments feel best when they're for…",
      A: "Being insightful or seeing what others missed.",
      B: "Being decisive or making something actually happen.",
      C: "Being kind, or making someone else feel okay."
    },
    zh: {
      text: "哪一类称赞最让你舒服？",
      A: "有洞察力——看到了别人没看到的",
      B: "有决断力——把事情真的推动了",
      C: "有温度——让别人觉得被照顾到了"
    }
  },
  {
    id: "qz_09",
    trait: "stress-coping",
    en: {
      text: "You're overwhelmed and the day isn't done. What helps?",
      A: "Turn everything off and be alone for an hour.",
      B: "Do the hardest task first — momentum kills the dread.",
      C: "Talk to someone you trust about all of it."
    },
    zh: {
      text: "焦头烂额，一天还没完。怎么撑过去？",
      A: "把一切关掉，一个人呆一小时",
      B: "先干最难那一件——动起来就不怕了",
      C: "找信任的人聊一聊，全部说出来"
    }
  },
  {
    id: "qz_10",
    trait: "trust",
    en: {
      text: "How do you trust new people?",
      A: "Slowly. You watch how they behave before deciding.",
      B: "Quickly, but with a hard line — break my trust, lose it for good.",
      C: "Easily. Most people deserve the benefit of the doubt."
    },
    zh: {
      text: "对新认识的人，你的信任态度？",
      A: "慢——先观察一段时间再决定",
      B: "快，但有底线——一旦失信就再也回不去",
      C: "容易——大多数人值得先给一点信任"
    }
  },
  {
    id: "qz_11",
    trait: "self-image",
    en: {
      text: "Friends would describe you as…",
      A: "Sharp, low-key, the one who notices everything.",
      B: "Bold, decisive, the one who pushes things forward.",
      C: "Warm, dependable, the one who holds the group together."
    },
    zh: {
      text: "朋友会怎么形容你？",
      A: "敏锐、低调，什么都看在眼里",
      B: "果断、有冲劲，推动事情往前的那种",
      C: "温和、靠谱，把一群人黏在一起的那种"
    }
  },
  {
    id: "qz_12",
    trait: "leadership",
    en: {
      text: "When a project is yours to run, you:",
      A: "Plan in detail, then move. You don't like surprises.",
      B: "Set a clear direction and pull people along with you.",
      C: "Build buy-in first — the team has to believe in it."
    },
    zh: {
      text: "一个项目交给你来主导。你？",
      A: "先把细节排清楚再动——不喜欢意外",
      B: "给方向，把人带起来",
      C: "先建立共识——团队得相信这件事才能走"
    }
  },
  {
    id: "qz_13",
    trait: "boundaries",
    en: {
      text: "Someone keeps overstepping with you. You:",
      A: "Pull back. Less access means less damage.",
      B: "Call it out clearly. They learn, or they lose you.",
      C: "Have a direct but warm conversation — you'd rather repair than break."
    },
    zh: {
      text: "有人一再越界。你？",
      A: "后退——距离越远，伤害越小",
      B: "直说——TA 学会就留下，学不会就走",
      C: "直接但温和地谈一次——你更想修复，不想断开"
    }
  },
  {
    id: "qz_14",
    trait: "decision-style",
    en: {
      text: "Big decision, deadline soon. You:",
      A: "Make a list. Pros, cons, scenarios. Decide on paper.",
      B: "Trust your gut — you've earned it.",
      C: "Talk it through with two or three people you trust, then choose."
    },
    zh: {
      text: "关键决定，时间紧。你？",
      A: "列清单——利弊推演，把它落到纸上",
      B: "跟直觉走——你的直觉是练出来的",
      C: "找两三个信得过的人聊一聊，再选"
    }
  },
  {
    id: "qz_15",
    trait: "crisis",
    en: {
      text: "Real emergency. Your instinct is to:",
      A: "Get clarity first — what's happening, who's safe, what's next.",
      B: "Take charge. Someone has to call the shots.",
      C: "Make sure the most vulnerable person is okay before anything else."
    },
    zh: {
      text: "真正的紧急情况。你的本能？",
      A: "先弄清楚——发生了什么、谁安全、下一步",
      B: "接管——总得有人拍板",
      C: "先看看最弱的那个人，确保 TA 没事再说"
    }
  }
];

function shuffleInPlace<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
}

const QUIZ_COUNT = 3;

/** Randomly draw `count` (default 3) questions in the current UI language.
 *  We DON'T re-balance by trait per draw — three random items still gives
 *  a usable signal because every option is animal-tagged the same way
 *  (A→Owl, B→Lion, C→Giraffe), and the catalogue is intentionally larger
 *  than `QUIZ_COUNT` so two players in the same room rarely see the same
 *  three-question set. */
export function getRandomQuestions(lang: Lang, count: number = QUIZ_COUNT): Question[] {
  const list = CATALOG.map((row) => {
    const part = lang === "zh" ? row.zh : row.en;
    return { id: row.id, text: part.text, A: part.A, B: part.B, C: part.C } satisfies Question;
  });
  const copy = [...list];
  shuffleInPlace(copy);
  return copy.slice(0, Math.min(count, copy.length));
}
