import type { Lang } from "./party/protocol";

interface Dict {
  appTitle: string;
  joinRoom: string;
  roomLabel: string;
  roomPlaceholder: string;
  nameLabel: string;
  namePlaceholder: string;
  joinBtn: string;
  joining: string;
  /** Shown when server rejects JOIN (room_full) */
  roomFull: string;
  permTitle: string;
  permIntro: string;
  permCamera: string;
  permCameraHint: string;
  permMic: string;
  permMicHint: string;
  permContinue: string;
  permLater: string;
  /** http://LAN-IP: camera API unavailable */
  permInsecureContext: string;
  permMediaUnavailable: string;
  profileTitle: string;
  profileHint: string;
  takePhoto: string;
  retake: string;
  submitProfile: string;
  quizTitle: string;
  analyzing: string;
  /** Shown if rules card is slow; offers manual resubmit */
  analyzingSlow: string;
  retrySubmit: string;
  revealHeader: (emoji: string, animal: string) => string;
  revealVerdictDefault: string;
  /** e.g. Resemblance to «White Lion»: 85% */
  revealSimilarity: (animal: string, pct: number) => string;
  /** Subheading above the meme roast on reveal */
  revealRoastLabel: string;
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
  /** Determination mini-detectors (from `determination/index.html` port) */
  detShake: string;
  detMouth: string;
  detBlink: string;
  detDone: string;
  detShakeWait: string;
  detShakeProgress: (shakes: number, target: number) => string;
  detMouthWait: string;
  detMouthOpen: string;
  detBlinkReset: string;
  detBlinkHold: (secondsLeft: string) => string;
  detVisionLoading: string;
  detVisionError: (detail: string) => string;
  cameraStart: string;
  cameraStop: string;
  startGame: string;
  ownAnimalUnknown: string;
  detOff: string;
  obTitle: string;
  /** Subtitle on OB panel: main scene + face wall */
  obMainSceneLabel: string;
  /** Accessible name for the floating language control */
  langAria: string;
  cameras: string;
  events: string;
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
  roomFull: "This room already has the maximum of 10 players. Try another room or wait.",
  permTitle: "Before you enter",
  permIntro:
    "We use your camera/microphone locally for character creation and rule detection. No video or audio is uploaded.",
  permCamera: "Camera",
  permCameraHint: "Used for the photo and gameplay detection",
  permMic: "Microphone",
  permMicHint: "Used for the White Lion's roar (later)",
  permContinue: "Continue",
  permLater: "Not now",
  permInsecureContext:
    "Camera/mic need HTTPS on this device (or localhost). Opening http://<your-LAN-IP> blocks them. Use https://, ngrok, or run PartyKit with HTTPS (see server/README).",
  permMediaUnavailable: "This browser does not expose the camera or microphone (blocked or not supported).",
  profileTitle: "Identify player",
  profileHint: "Center your face inside the circle.",
  takePhoto: "Take photo",
  retake: "Retake",
  submitProfile: "Next",
  quizTitle: "Questionnaire",
  analyzing: "Analyzing…",
  analyzingSlow: "Taking longer than usual… you can resend your answers.",
  retrySubmit: "Resend",
  revealHeader: (emoji, animal) => `${emoji} You are «${animal}»`,
  revealVerdictDefault: "(verdict: coming soon)",
  revealSimilarity: (animal, pct) => `Resemblance to «${animal}»: ${pct}%`,
  revealRoastLabel: "Booth notes (for fun)",
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
  detShake: "Head shake",
  detMouth: "Open mouth",
  detBlink: "5s no blink",
  detDone: "Done",
  detShakeWait: "Waiting…",
  detShakeProgress: (n, t) => `Shake ${n}/${t}…`,
  detMouthWait: "Open your mouth…",
  detMouthOpen: "Holding open…",
  detBlinkReset: "Blink — timer reset",
  detBlinkHold: (s) => `Hold open ${s}s more`,
  detVisionLoading: "Loading face mesh…",
  detVisionError: (d) => `Vision: ${d.slice(0, 80)}`,
  cameraStart: "Enable camera",
  cameraStop: "Disable",
  startGame: "Start game",
  ownAnimalUnknown: "Unassigned",
  detOff: "Off",
  obTitle: "Nocturne Zoo · OB",
  obMainSceneLabel: "Center = live playfield · side rings = player faces",
  langAria: "Language",
  cameras: "CAMERAS",
  events: "ZOO KEEPER LOG"
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
  roomFull: "本房间人数已满（最多 10 人）。请换房间或稍后再试。",
  permTitle: "进入前确认",
  permIntro: "摄像头/麦克风仅在本地用于「创建角色」和守则检测，不会上传视频或音频。",
  permCamera: "摄像头",
  permCameraHint: "用于拍照与游戏内检测",
  permMic: "麦克风",
  permMicHint: "白狮子低吼（后续启用）",
  permContinue: "继续",
  permLater: "暂不",
  permInsecureContext:
    "通过局域网 http://IP 访问时浏览器不会开放摄像头/麦克风。请改用 https:// 打开本页，或用 ngrok 等；开发可在 server 为 PartyKit 配 HTTPS（见 server/README）。",
  permMediaUnavailable: "当前浏览器未提供摄像头/麦克风能力（被禁用或不支持）。",
  profileTitle: "识别玩家",
  profileHint: "把脸放进圆圈里，尽量保持正对镜头。",
  takePhoto: "拍照",
  retake: "重拍",
  submitProfile: "提交",
  quizTitle: "问卷",
  analyzing: "正在分析你…",
  analyzingSlow: "比平常久…可尝试重新提交答案。",
  retrySubmit: "重新提交",
  revealHeader: (emoji, animal) => `${emoji} 你被判定为「${animal}」`,
  revealVerdictDefault: "（判定语：待接入）",
  revealSimilarity: (animal, pct) => `与「${animal}」的相似度：${pct}%`,
  revealRoastLabel: "展柜旁白（玩梗向）",
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
  detShake: "摇头晃脑",
  detMouth: "张嘴",
  detBlink: "5 秒不眨眼",
  detDone: "完成",
  detShakeWait: "等待…",
  detShakeProgress: (n, t) => `摇头 ${n}/${t}…`,
  detMouthWait: "请张嘴…",
  detMouthOpen: "保持张嘴…",
  detBlinkReset: "眨眼了，重新计时",
  detBlinkHold: (s) => `再保持 ${s} 秒…`,
  detVisionLoading: "正在加载面部网格…",
  detVisionError: (d) => `识别引擎：${d.slice(0, 80)}`,
  cameraStart: "开启摄像头",
  cameraStop: "关闭",
  startGame: "开始",
  ownAnimalUnknown: "未分配",
  detOff: "未开启",
  obTitle: "深夜动物园 · OB",
  obMainSceneLabel: "中间为对局主场景 · 两侧圆环为玩家面部画面",
  langAria: "界面语言",
  cameras: "摄像头",
  events: "ZOO KEEPER LOG"
};

export function dict(lang: Lang): Dict {
  return lang === "zh" ? zh : en;
}

export const animalLocalized: Record<Lang, Record<string, string>> = {
  en: { 白狮子: "White Lion", 猫头鹰: "Owl", 长颈鹿: "Giraffe" },
  zh: { 白狮子: "白狮子", 猫头鹰: "猫头鹰", 长颈鹿: "长颈鹿" }
};
