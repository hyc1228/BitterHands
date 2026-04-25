import type { Lang } from "./party/protocol";

export interface Question {
  id: "q1" | "q2" | "q3";
  text: string;
  A: string;
  B: string;
  C: string;
}

interface Dict {
  appTitle: string;
  joinRoom: string;
  roomLabel: string;
  roomPlaceholder: string;
  nameLabel: string;
  namePlaceholder: string;
  joinBtn: string;
  joining: string;
  permTitle: string;
  permIntro: string;
  permCamera: string;
  permCameraHint: string;
  permMic: string;
  permMicHint: string;
  permContinue: string;
  permLater: string;
  profileTitle: string;
  profileHint: string;
  takePhoto: string;
  retake: string;
  submitProfile: string;
  quizTitle: string;
  analyzing: string;
  revealHeader: (emoji: string, animal: string) => string;
  revealVerdictDefault: string;
  goToGame: string;
  rulesCardTitle: string;
  ruleLabel: string;
  winLabel: string;
  teammatesLabel: string;
  noTeammates: string;
  chatTitle: string;
  chatPlaceholder: string;
  send: string;
  log: string;
  players: string;
  detectionTitle: string;
  cameraStart: string;
  cameraStop: string;
  startGame: string;
  ownAnimalUnknown: string;
  detOff: string;
  obTitle: string;
  cameras: string;
  events: string;
  questions: Question[];
}

const en: Dict = {
  appTitle: "Nocturne Zoo",
  joinRoom: "Join room",
  roomLabel: "Room",
  roomPlaceholder: "e.g. my-room",
  nameLabel: "Name",
  namePlaceholder: "e.g. Alice",
  joinBtn: "Join",
  joining: "Joining…",
  permTitle: "Before you enter",
  permIntro:
    "We use your camera/microphone locally for character creation and rule detection. No video or audio is uploaded.",
  permCamera: "Camera",
  permCameraHint: "Used for the photo and gameplay detection",
  permMic: "Microphone",
  permMicHint: "Used for the White Lion's roar (later)",
  permContinue: "Continue",
  permLater: "Not now",
  profileTitle: "Identify player",
  profileHint: "Center your face inside the circle.",
  takePhoto: "Take photo",
  retake: "Retake",
  submitProfile: "Next",
  quizTitle: "Questionnaire",
  analyzing: "Analyzing…",
  revealHeader: (emoji, animal) => `${emoji} You are «${animal}»`,
  revealVerdictDefault: "(verdict: coming soon)",
  goToGame: "Enter the zoo",
  rulesCardTitle: "Rules card",
  ruleLabel: "Rule",
  winLabel: "Win condition",
  teammatesLabel: "Teammates",
  noTeammates: "(none — observe alone)",
  chatTitle: "Chat",
  chatPlaceholder: "Say something…",
  send: "Send",
  log: "Event log",
  players: "Players",
  detectionTitle: "Detection",
  cameraStart: "Enable camera",
  cameraStop: "Disable",
  startGame: "Start game",
  ownAnimalUnknown: "Unassigned",
  detOff: "Off",
  obTitle: "Nocturne Zoo · OB",
  cameras: "CAMERAS",
  events: "ZOO KEEPER LOG",
  questions: [
    {
      id: "q1",
      text: "Late at night, you're walking alone through the zoo when every light cuts out. Your first reaction?",
      A: "Stand still, let your eyes adjust to the dark, observe.",
      B: "Shout out loud — let anyone nearby know you're here.",
      C: "Keep walking. The dark doesn't scare you."
    },
    {
      id: "q2",
      text: "You find a note that reads: «Do not trust the elephant you see.» What do you do?",
      A: "Pocket the note, keep it to yourself, watch quietly.",
      B: "Tell everyone immediately, put the group on alert.",
      C: "Glance at the elephant, decide it's fine, toss the note."
    },
    {
      id: "q3",
      text: "Your companions' eyes start looking strange — you suspect they aren't themselves anymore. You…",
      A: "Say nothing. Keep watching for more evidence.",
      B: "Confront them directly: «Who are you?»",
      C: "Quietly move closer to them — safer in numbers."
    }
  ]
};

const zh: Dict = {
  appTitle: "深夜动物园",
  joinRoom: "加入房间",
  roomLabel: "房间号",
  roomPlaceholder: "例如：my-room",
  nameLabel: "名字",
  namePlaceholder: "例如：Alice",
  joinBtn: "加入",
  joining: "加入中…",
  permTitle: "进入前确认",
  permIntro: "摄像头/麦克风仅在本地用于「创建角色」和守则检测，不会上传视频或音频。",
  permCamera: "摄像头",
  permCameraHint: "用于拍照与游戏内检测",
  permMic: "麦克风",
  permMicHint: "白狮子低吼（后续启用）",
  permContinue: "继续",
  permLater: "暂不",
  profileTitle: "识别玩家",
  profileHint: "把脸放进圆圈里，尽量保持正对镜头。",
  takePhoto: "拍照",
  retake: "重拍",
  submitProfile: "提交",
  quizTitle: "问卷",
  analyzing: "正在分析你…",
  revealHeader: (emoji, animal) => `${emoji} 你被判定为「${animal}」`,
  revealVerdictDefault: "（判定语：待接入）",
  goToGame: "进入动物园",
  rulesCardTitle: "守则卡",
  ruleLabel: "守则",
  winLabel: "胜利条件",
  teammatesLabel: "同阵营",
  noTeammates: "（无 — 你独自观察）",
  chatTitle: "聊天",
  chatPlaceholder: "说点什么…",
  send: "发送",
  log: "事件日志",
  players: "玩家",
  detectionTitle: "检测",
  cameraStart: "开启摄像头",
  cameraStop: "关闭",
  startGame: "开始",
  ownAnimalUnknown: "未分配",
  detOff: "未开启",
  obTitle: "深夜动物园 · OB",
  cameras: "摄像头",
  events: "ZOO KEEPER LOG",
  questions: [
    {
      id: "q1",
      text: "深夜，你一个人走在动物园里，发现园区的灯全灭了。你的第一反应是？",
      A: "站在原地，等眼睛适应黑暗，观察四周",
      B: "大声喊出来，告诉任何可能在附近的人你在这里",
      C: "继续往前走，感觉黑暗没什么好怕的"
    },
    {
      id: "q2",
      text: "你捡到一张纸条，上面写着「不要相信你看到的大象」。你会怎么做？",
      A: "把纸条收好，悄悄记在心里，继续观察",
      B: "立刻告诉所有人，让大家一起警惕",
      C: "看了看大象，觉得没问题，把纸条扔掉"
    },
    {
      id: "q3",
      text: "你发现同行的人眼神开始变得奇怪，你认为他们不再是原来的人了。你选择？",
      A: "什么都不说，继续观察，等待更多证据",
      B: "直接质问他们，你是谁",
      C: "默默靠近他们，感觉和他们在一起更安全"
    }
  ]
};

export function dict(lang: Lang): Dict {
  return lang === "zh" ? zh : en;
}

export const animalLocalized: Record<Lang, Record<string, string>> = {
  en: { 白狮子: "White Lion", 猫头鹰: "Owl", 长颈鹿: "Giraffe" },
  zh: { 白狮子: "白狮子", 猫头鹰: "猫头鹰", 长颈鹿: "长颈鹿" }
};
