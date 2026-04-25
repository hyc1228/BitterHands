import type { Lang } from "../party/protocol";

export interface Question {
  id: string;
  text: string;
  A: string;
  B: string;
  C: string;
}

type Row = {
  id: string;
  en: Omit<Question, "id">;
  zh: Omit<Question, "id">;
};

const CATALOG: Row[] = [
  {
    id: "qz_01",
    en: {
      text: "Every light in the zoo dies at once. You’re alone. Your first move?",
      A: "Stand still, breathe, and scan the shadows.",
      B: "Yell to announce you’re not prey.",
      C: "Move forward before fear catches up."
    },
    zh: {
      text: "动物园的灯一瞬全灭。你一个人。你最先会？",
      A: "站定，先呼吸，再观察黑暗",
      B: "大喊「我在这里」壮胆",
      C: "赶紧往前走，怕停下来就被盯上"
    }
  },
  {
    id: "qz_02",
    en: {
      text: "A sign reads: «Do not make eye contact with the tall silhouettes.» You…",
      A: "Pretend you didn’t read it, but remember.",
      B: "Tell the group at once, loudly.",
      C: "Stare, just once, to know what the rule fears."
    },
    zh: {
      text: "告示：「别和高大的影子对视。」你会？",
      A: "装作没看见，但记在心里",
      B: "立刻公开给大家听",
      C: "偏要看一眼，搞清楚怕的是什么"
    }
  },
  {
    id: "qz_03",
    en: {
      text: "Your friend’s voice sounds *almost* like them. Something’s wrong. You…",
      A: "Nod, smile, and look for a tell.",
      B: "Ask a question only the real one would get.",
      C: "Step closer. Alone is worse than unknown."
    },
    zh: {
      text: "朋友的声音像 TA，又不太像。你？",
      A: "先点头，暗中找破绽",
      B: "问一个只有真人才知道答案的问题",
      C: "靠近他——一个人更危险"
    }
  },
  {
    id: "qz_04",
    en: {
      text: "You find a map with your name crossed out. Addendum: «Or maybe not.»",
      A: "Burn it mentally, keep a blank face.",
      B: "Show everyone, demand an explanation.",
      C: "Flip it over. Maybe the back is the truth."
    },
    zh: {
      text: "你捡到一张写着你名字被划掉的图，旁注：「也许没划。」你？",
      A: "心里烧掉，脸上不露",
      B: "摊给大家，要个说法",
      C: "翻过去——也许背面才是真的"
    }
  },
  {
    id: "qz_05",
    en: {
      text: "A speaker crackles: «Visitors must laugh once per minute.» Haha—or else?",
      A: "Fake a dry laugh, track time.",
      B: "Refuse. Rules this absurd are traps.",
      C: "Laugh with the group; rhythm beats logic."
    },
    zh: {
      text: "广播：「游客每分钟要笑一次。」否则？",
      A: "干笑，默默计时",
      B: "拒绝，荒唐规则必有诈",
      C: "跟着众人笑，气氛优先"
    }
  },
  {
    id: "qz_06",
    en: {
      text: "Cages are open. The animals watch you pass. You…",
      A: "Walk the center, slow and uninteresting.",
      B: "Sprint. Exit signs don’t wait.",
      C: "Offer food you don’t have. Bluffs buy seconds."
    },
    zh: {
      text: "笼门都开了。动物盯着你。你？",
      A: "走正中间，又慢又不起眼",
      B: "冲刺，别管别的",
      C: "假装投喂——骗一秒是一秒"
    }
  },
  {
    id: "qz_07",
    en: {
      text: "Security footage shows you in two places. You only remember one.",
      A: "Trust the one that feels like memory.",
      B: "Trust the tape. You’re the glitch.",
      C: "Neither. Someone edits reality."
    },
    zh: {
      text: "监控里你同时出现在两处，你却只记得一个。你信？",
      A: "信脑子里的那份",
      B: "信录像——我才是 bug",
      C: "都不信，有东西在剪片"
    }
  },
  {
    id: "qz_08",
    en: {
      text: "A child points at you and whispers, «That one’s not wet enough.» It’s not raining.",
      A: "Check your own reflection in glass.",
      B: "Give the child candy you don’t carry.",
      C: "Walk faster. Kids see stains adults miss."
    },
    zh: {
      text: "小孩指着你小声说：「他不够湿。」没下雨。你？",
      A: "看玻璃里自己的影",
      B: "掏一颗并不存在的糖",
      C: "加快脚步，小孩比大人看得多"
    }
  },
  {
    id: "qz_09",
    en: {
      text: "The ticket says «Valid only if you believe it.»",
      A: "Fold it, carry doubt like a tool.",
      B: "Burn it, belief is a liability here.",
      C: "Believe hard, maybe doors agree."
    },
    zh: {
      text: "票上写：「只有相信才作数。」你？",
      A: "折好收着，怀疑当工具",
      B: "撕了，在这里信太危险",
      C: "用力相信，也许门会认"
    }
  },
  {
    id: "qz_10",
    en: {
      text: "You must choose a partner who might not be human. You pick…",
      A: "The one who flinches at steel.",
      B: "The one who blinks in prime numbers.",
      C: "The quietest. Noise attracts rules."
    },
    zh: {
      text: "你要选一个「可能不是人」的同伴。你选？",
      A: "听见金属就缩的那位",
      B: "眨眼节奏很奇怪的那位",
      C: "最安静的那位——发声会引来规则"
    }
  },
  {
    id: "qz_11",
    en: {
      text: "The PA plays a lullaby in reverse. Everyone else sways. You…",
      A: "Sway a little, not enough to mean it.",
      B: "Cover ears. Sleepwalkers are contagious.",
      C: "Hum forward to cancel the spell."
    },
    zh: {
      text: "广播在倒放摇篮曲。众人跟着晃。你？",
      A: "也晃，但只晃一点点",
      B: "捂耳，梦游会传染",
      C: "自己哼正向旋律对冲"
    }
  },
  {
    id: "qz_12",
    en: {
      text: "A keeper tips their hat. Under it: no face, only stars.",
      A: "Tip yours back, empty as courtesy.",
      B: "Ask for a schedule. Even stars clock in.",
      C: "Look away. Politeness is a contract."
    },
    zh: {
      text: "饲养员脱帽，帽下没脸，只有星。你？",
      A: "也脱帽回礼，空也是礼",
      B: "问排班，星星也要上班",
      C: "移开眼，礼貌是交易"
    }
  },
  {
    id: "qz_13",
    en: {
      text: "Graffiti: «The giraffe is the door.» You see only trees.",
      A: "Measure sky between branches. Doors are vertical.",
      B: "Chop a branch. If it bleeds, wrong door.",
      C: "Wait. Doors open when the joke lands."
    },
    zh: {
      text: "涂鸦写：「长颈鹿是门。」你只见树。你？",
      A: "看树缝里的天，门总是竖的",
      B: "折枝，会流血就错了",
      C: "等，门会在笑话落地时开"
    }
  },
  {
    id: "qz_14",
    en: {
      text: "Time stamps on your phone jump backward. Battery 100% forever.",
      A: "Trust the light, not the numbers.",
      B: "Turn it off. Time is a suggestion.",
      C: "Take a picture. Proof tethers you."
    },
    zh: {
      text: "手机时间倒走，电量永远 100%。你？",
      A: "信光，别信数",
      B: "关机，时间只是建议",
      C: "拍照，证据把人拴住"
    }
  },
  {
    id: "qz_15",
    en: {
      text: "You must name your fear. If you lie, the zoo keeps it.",
      A: "Name something small, keep the big one.",
      B: "Name the truth, maybe it’s bored of you.",
      C: "Name nothing. Silence is a name too."
    },
    zh: {
      text: "你必须说出你的恐惧。说谎的话动物园会收走。你？",
      A: "说个小恐惧，大恐惧留着",
      B: "直说，也许它早厌了",
      C: "不说，沉默也算名字"
    }
  },
  {
    id: "qz_16",
    en: {
      text: "A lion’s roar has subtitles you didn’t enable.",
      A: "Read them anyway. Leaks are messages.",
      B: "Close captions. You’re not a screen.",
      C: "Roar back with grammar mistakes."
    },
    zh: {
      text: "狮吼自带字幕。你？",
      A: "看，泄露即信息",
      B: "关字幕，我不是屏幕",
      C: "吼回去，故意语病"
    }
  },
  {
    id: "qz_17",
    en: {
      text: "Your shadow arrives early. It waves.",
      A: "Wave with the wrong hand, assert dominance.",
      B: "Step into light, kill it for a second.",
      C: "Bow. Maybe it’s senior staff."
    },
    zh: {
      text: "影子先到了，在招手。你？",
      A: "用非惯用手回招，装老大",
      B: "走进光里，让影子断一秒",
      C: "鞠躬，也许是前辈"
    }
  },
  {
    id: "qz_18",
    en: {
      text: "A quiz booth offers «Exit» if you score 0%. Tempting?",
      A: "Score perfectly wrong on purpose. Rules love irony.",
      B: "Walk past. Exits with queues aren’t.",
      C: "Take it dead serious, fail honestly."
    },
    zh: {
      text: "摊位写：0 分能换「出口」。你？",
      A: "故意全错，规则爱反讽",
      B: "不去，有排队的口不像出口",
      C: "认真答，真失败"
    }
  },
  {
    id: "qz_19",
    en: {
      text: "Owl eyes reflect your face from ten years ago.",
      A: "Ask what interest rate the past charges.",
      B: "Break contact. Nostalgia charges fees.",
      C: "Smile, you looked braver then."
    },
    zh: {
      text: "猫头鹰眼里映出你十年前的脸。你？",
      A: "问过去收多少利息",
      B: "移开眼，怀旧也收费",
      C: "笑，你那时更敢"
    }
  },
  {
    id: "qz_20",
    en: {
      text: "The vending machine only sells «tomorrow.»",
      A: "Buy with coins from yesterday’s pocket.",
      B: "Kick it. Tomorrow might jam.",
      C: "Insert hope, hope isn’t legal tender."
    },
    zh: {
      text: "贩卖机只卖「明天」。你？",
      A: "用昨天口袋的硬币",
      B: "踹一脚，也许明天会卡",
      C: "投希望，但希望不是法币"
    }
  },
  {
    id: "qz_21",
    en: {
      text: "A rope ladder leads up into fog. Rung one is missing.",
      A: "Jump the gap, faith is a muscle.",
      B: "Tie a knot from your own sleeve.",
      C: "Go around. Ladders that skip are memes."
    },
    zh: {
      text: "绳梯进雾，第一级没了。你？",
      A: "跳，信念是肌肉",
      B: "用袖子打结补一级",
      C: "绕路，会跳级的梯是梗"
    }
  },
  {
    id: "qz_22",
    en: {
      text: "The zoo’s closing announcement ends mid-word. The word was…",
      A: "«—» (silence). You know how it ends.",
      B: "Your name, mispronounced on purpose.",
      C: "«Please», which is never a guarantee."
    },
    zh: {
      text: "闭园广播说到一半就断。断在？",
      A: "空白——你知道下一句",
      B: "你的名字，被故意念错",
      C: "「请」字，从不保证"
    }
  },
  {
    id: "qz_23",
    en: {
      text: "To leave, you must write one sentence the zoo can’t use against you.",
      A: "«I was never here, except for the camera.»",
      B: "«I consent to nothing, including this pen.»",
      C: "A blank line. Or a doodle. Ambiguity is armor."
    },
    zh: {
      text: "离开前要写一句动物园无法反咬你的话。你写？",
      A: "「我从未来过，除了镜头。」",
      B: "「我同意无物，含这支笔。」",
      C: "留空，或乱画，含糊是甲"
    }
  },
  {
    id: "qz_24",
    en: {
      text: "Dawn is a rumor. The sky stays ink. You have one move left. You…",
      A: "Invent a small dawn in your head.",
      B: "Sleep. Maybe night is the exit.",
      C: "Run until the story gets tired of you."
    },
    zh: {
      text: "天亮像谣言，天还是墨的。你只剩一手。你？",
      A: "在脑子里发明一小片黎明",
      B: "睡，也许夜才是出口",
      C: "跑到故事烦你为止"
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

/** Randomly draw `count` (default 3) questions in the current UI language. */
export function getRandomQuestions(lang: Lang, count: number = QUIZ_COUNT): Question[] {
  const list = CATALOG.map((row) => {
    const part = lang === "zh" ? row.zh : row.en;
    return { id: row.id, text: part.text, A: part.A, B: part.B, C: part.C } satisfies Question;
  });
  const copy = [...list];
  shuffleInPlace(copy);
  return copy.slice(0, Math.min(count, copy.length));
}
