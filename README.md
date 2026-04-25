# Nocturne Zoo / 深夜动物园

AI 规则怪谈社交游戏（Hackathon Edition, GDD v0.7 / April 2026）。

## TL;DR

- **人数**：5–10 人
- **时长**：3 分钟/局（含入场分配）
- **核心机制**：摄像头拍脸 + 2–3 道怪谈氛围选择题 → AI 分配三种动物身份（阵营）→ 玩家遵循通用规则 + AI 监管者实时注视玩家触发角色规则 → 遵循守则存活 → 生命值最高者胜
- **技术栈**：PartyKit + **Vite / React / TypeScript 客户端** +（规划中）Claude API + MediaPipe + Web Audio API

## 一句话说清楚

进入游戏先对着摄像头拍一张脸，再回答 2–3 个充满怪谈氛围的问题。**GDD 目标**是 AI 综合外貌与选项分配身份；**当前实装**为服务器按选项倾向做规则分配，并附一句**判定语**，详情见下节「创建角色后」。

- 🦁 **白狮子**
- 🦉 **猫头鹰**
- 🦒 **长颈鹿**

游戏中你需要同时应对每 15 秒触发一次的通用规则，以及 AI 监管者注视你时触发的角色专属守则。3 分钟内存活，生命值最高者获胜。

## 游戏流程（v0.7）

### ① 入场分配（60–90s）

- **拍照**：玩家手动在圆镜头内完成自拍并**提交**（当前不强制「3 秒倒计时自动上传」；外貌侧写管线尚为占位）。
- **答题**：依次显示 **2–3** 道单选题并提交。
- **分配**（GDD 规划为 Claude 综合外貌+选项；**当前实装**为：服务器按各题选项的 **A / B / C 多数倾向** 做确定性回退，生成动物身份 + 一句**判定语** `verdict`）。
- **分析**：短暂「正在分析你…」过渡。
- **揭晓**（`#/onboard`）：只展示 **emoji、动物名、判定语**；不在这里展开完整规则正文。
- **创建角色后，玩家会额外收到**（经 WebSocket **私信**，仅本人可见，协议事件见 `server/src/protocol.js`）：
  - **`private_rules_card`（守则卡数据）**  
    - 动物、emoji、**判定语** `verdict`（与揭晓一致）  
    - **本角色的守则说明** `rule`（长文本，含实装中的周期间隔与动作要求）  
    - **本阵营胜利条件** `win`  
    - **同阵营玩家列表** `teammates`（**猫头鹰**在卡上队友为空串，因另有单独名册，见下）
  - **`private_owl_roster`（仅猫头鹰）**：当前已分配过身份的全员 **姓名 + 动物** 列表，供其推理身份（GDD 中「不可见其他猫头鹰」等细则仍可在本协议上迭代）。

公开侧只会广播一条**不含守则正文**的系统消息，例如：「某某已进入 🦁 / 🦉 / 🦒 区域」。

- **主界面**（`#/game`）上，上述守则卡以「Rules card / 守则卡」区块**完整展示**；入口揭晓页不重复长文。

### ② 阅读守则，安全时间（10s，GDD）

进入对战页后先阅读**私信守则卡**上的全文。当前 Web 客户端在 `#/game` 卡片中直接展示；**独立「10s 只读安全时间」的 UI 若有需要可再加**（策划节奏不变）。

### ③ 游戏中（3min）

实时检测身体守则执行状态。通用规则每 15 秒触发一次；角色规则由监管者注视触发。违规扣 1 点生命值；生命值归零出局。

### ④ 结算

3 分钟时间到，存活玩家中生命值最高者获胜。

## 规则体系

> **与守则卡 `rule` / `win` 的关系**：下表为 GDD 概述；**客户端收到的私有守则卡**里 `rule`（周期、动作、胜利目标）以 `server/src/server.js` 中 `_rulesCardFor` 的**中英成稿**为准，会随实装修订。

### 通用规则（所有玩家）

每 **15 秒**触发一次，随机选择以下其中一项：

- 3 秒内不能眨眼
- 发出声音持续 3 秒
- 

### 角色规则（各角色专属）

**触发机制**：当 AI 监管者注视某名玩家时，该玩家必须立即执行自己角色的守则动作。被注视期间**可以移动**，但必须同时完成指定动作。


| 动物     | 守则动作（检测方式）         |
| ------ | ------------------ |
| 🦁 白狮子 | 低吼 ≥2 秒（Web Audio） |
| 🦉 猫头鹰 | 5 秒内不能眨眼（FaceMesh） |
| 🦒 长颈鹿 | 摇头晃脑（FaceMesh）     |


## 监管者（AI）行为

- 游戏进行中，监管者不定时将视线锁定在某名玩家身上
- 视线跟随被锁定玩家移动
- 当监管者视线范围内同时有多名玩家时，随机选择一人进行注视

## 监管者播报（AI Voice）

> **状态**：MVP 已实装（英文版）。代码见 `server/src/voice.js` / `server/src/monitorLines.js` / `server/app/src/hooks/useMonitorVoice.ts`。中文版后接。

**目标**：让监管者从「沉默的注视」升级为「会说话的怪园广播」。语气参考《双点医院》PA：冷静、官腔、黑色幽默——用物业 / HR / 客服的措辞讲恐怖事件，节目效果＞恐吓。Monitor 是夜班保安兼后勤主管的合体，不是吉祥物也不是魔王。

### 风格定位

- **Voice**：英式播音腔，中性偏冷的中年男声或女声皆可；先用 ElevenLabs 预设 voice，后续视效果换克隆。
- **样本**（即未来 ambient / event 的目标质感）：
  - "Welcome back, residents. The night shift has begun."
  - "Reminder: blinking is a privilege, not a right. Please surrender your eyelids for the next three seconds."
  - "Alice has acquired one (1) unit of joy. Productivity is up zero point three percent."
  - "Bob has triggered an alarm clock. The Monitor would like a word."
  - "Unfortunately, Carol has failed to comply. Please apologize to the camera."
  - "Dave has been promoted to compost. Please congratulate Dave."
  - "Two minutes remain. Please continue to be quietly terrified."

### 播报内容（按事件分桶）

| 触发                       | 优先级 | 例句模板                                                            |
| ------------------------ | --- | --------------------------------------------------------------- |
| 局开始                      | 高   | "Welcome back, residents. The night shift has begun."           |
| 通用规则触发（每 15s）            | 中   | "Reminder: …" / "All residents will now …"                      |
| Monitor 锁定某玩家            | 高   | "The Monitor has noticed {name}. {name}, please {action}."      |
| 玩家拾取 ❤️                  | 低   | "{name} has acquired one (1) unit of joy."                      |
| 玩家撞上 ⏰                   | 高   | "{name} has triggered an alarm. The Monitor would like a word." |
| 违规扣血                     | 高   | "Unfortunately, {name} has failed to comply."                   |
| 玩家出局                     | 最高  | "{name} has been promoted to compost."                          |
| 剩余时间（2:00 / 1:00 / 0:30） | 中   | "Two minutes remain. Please continue to be quietly terrified."  |
| 局结束 / 胜者                  | 最高  | "Congratulations, {winner}. You may now go home."               |
| Ambient（无事件 ~30s）        | 最低  | "All systems nominal. Probably."                                |

### 调度规则

- **单声道队列**：同一时刻只播一条；新事件按优先级抢占低优先级（被抢占的句子直接丢弃，不补播）。
- **冷却**：相邻两条最短间隔 ~3s，避免连珠炮。
- **去重 / 合并**：同一类事件 10s 内最多一条；连续多人拾取/扣血时合并为「{n} residents have collectively…」。
- **静音窗**：通用规则执行期间（如「3 秒内不能眨眼」），暂停 ambient/低优先级，避免干扰玩家执行动作。

### 技术方案（ElevenLabs）

- **生成**：
  - **静态库**（开局、结束、ambient、通用规则提示，约 30 条）→ 预生成 mp3 缓存到 `server/public/voice/` 或 CDN，按 ID 直接播，零运行时成本。
  - **动态台词**（含玩家名 / 数字）→ Claude 出词 + ElevenLabs **streaming TTS**，**服务器侧合成**后下发 URL 或 base64。
  - **名字片段优化**：玩家进房时预合成 `voice/name/{playerId}.mp3`（每人 1 次），主体句用句库模板拼接，省字符费。
- **传输**：在 `server/src/protocol.js` 新增事件 `monitor_voice`：`{ id, priority, url, captions, ttlMs }`。客户端单 `<audio>` 元素 + 优先级队列消费。
  - **不**走「客户端各自请求 ElevenLabs」：会暴露 API key 且每端重复合成，浪费配额。
- **字幕**：`captions` 字段同步显示文本，便于无障碍 / 静音观战 / OB 端展示。
- **观战端**：OB 视图作为主声道（最适合直播喊话效果）；玩家端可单独静音。

### 与 Claude 的分工

- 现有「违规叙事」prompt 改写为 Two Point 腔英文版，硬约束 ≤ 18 词，禁止直说"die / dead"。
- 新增 prompt `monitor_lines`：输入事件 JSON（事件类型、玩家名、上下文），输出 1 条 ≤ 12 词的英文台词；带温度抖动避免重复。
- **兜底**：Claude 失败 / 超时 → 回落到本地静态模板（每类事件 3–5 句轮换）。

### 当前实装（方案 A · 预录 mp3）

> 受限于 hackathon 期间没有 ElevenLabs API key 直连权限，**所有音频走静态 mp3**：在 ElevenLabs 网页里手动用同一把声音录 24 条通用台词（不出现玩家名）放进 `server/public/voice/`。**玩家名在字幕里**实时插值，体验一致但运行时 0 API 调用。

- **触发**：`game_started` / `pickup_heart` / `pickup_alarm` / `violation` / `eliminated` / `winner` / `game_ended` 已在 `server/src/server.js` 接好。新加事件调 `this._dispatchMonitorLine({ kind, params, priority })`，模板在 `monitorLines.js`。
- **服务端**：`monitorLines.js` 现在每个 kind 维护 `audio[]`（通用，无姓名）+ `caption[]`（带 `{name}`）平行数组；`server.js` 默认广播 `/voice/<kind>_<idx>.mp3` 静态路径。
- **协议**：`MONITOR_VOICE` 事件下发 `{ id, kind, priority, audioUrl, captions, ttlMs, source }`。
- **客户端**：`useMonitorVoice` 钩子负责单 `<audio>` 播放、优先级抢占、3s 冷却、10s 同 kind 去重；字幕由 `MonitorCaption` 挂在 `Layout`。
- **降级**：mp3 文件缺失时浏览器播放报错被静默吃掉，字幕仍然显示。
- **可选直连 API**：若同时配置了 `ELEVENLABS_API_KEY` + `ELEVENLABS_VOICE_ID`，dispatcher 会改走实时合成（A/B 试音色用），不需要时不必设。

### 录音清单 & 操作

24 条台词 + 文件命名规则 + 录音建议（一把声音、稳定度参数等）见 [`server/public/voice/README.md`](server/public/voice/README.md)。在 ElevenLabs 网页（或 Scenario 的 ElevenLabs 面板）里依清单逐条生成、下载、按 `<kind>_<idx>.mp3` 命名拖进 `server/public/voice/` 即可。

### 测试

打开 `server/public/voice-test.html`（本地双击或 `http://127.0.0.1:1999/voice-test.html`）：
- **Static MP3** 模式（默认）：从 `./voice/<kind>_<idx>.mp3` 读，本地试听整条管线
- **Live ElevenLabs** 模式：临时贴 API key 直接调 API 试音色
- **Captions only** 模式：只看字幕节奏，不放音频

### 待办

- 监管者锁定玩家 / 15s 通用规则提示尚未在服务端发事件，模板已就绪
- ambient 周期播报
- 中文版：复用调度，换一套 zh 录音 + 中文 caption 模板

## 道具

游戏空间内随机散布 **1–3 个**以下两种道具：


| 道具   | 效果                 |
| ---- | ------------------ |
| ❤️桃心 | 接触后补充 1 点生命值（上限 3） |
| ⏰ 闹铃 | 接触后立即引来监管者注视       |


## 生命值与胜利条件

- 每名玩家初始 **3 点生命值**
- 未履行规则时扣 **1 点生命值**，归零则出局
- 游戏时长 **3 分钟**，时间到时存活玩家中**生命值最高者获胜**

## Claude Prompt（摘要）

入场分配建议拆 2 次调用（Vision 外貌印象先跑，答题时后台执行，减少等待）：

- **外貌分析（Vision）**：输出 2–3 句气质印象，不提具体五官/不提动物
- **综合判定**：结合外貌印象 + 题目选项，返回 JSON：`{ “animal”: “...”, “verdict”: “...” }`
- **违规叙事**：违规时生成 2 句克制、暗示的怪谈叙事，不直说死亡

## 技术实现（当前仓库）

- `server/src/server.js`：PartyKit 房间状态、入场上传照片（占位 `impression`）、收卷分配动物、`private_rules_card` / `private_owl_roster` 私信、断线/广播、违规与快照等。
- `server/app/`：**Vite + React + TypeScript** 主客户端源码（`#/` 加入与房间名 → `#/onboard` 入场 → `#/game` 对战；`#/ob` 观战等）。
- `server/public/`：由 `server/app` 执行 `npm run build` 产出 SPA（`index.html` + `assets/*`），`npm run dev`（在 `server/`）下由 PartyKit 对外提供；不再维护一份与 SPA 平行的整页 `ob.html` 流程。
- 本机/局域网检测、摄像头上屏：React 里集成 MediaPipe 等，详见 `server/app/README.md`。

## 本地/局域网运行

```bash
cd server
npm install
npm run dev -- --port 0
```

启动后会打印 `127.0.0.1`（本机）和你的 **LAN IP**（同 Wi‑Fi 设备访问）。

---

来源：`docs/NocturneZoo-GDD-v0.7.md`（从原始策划文档整理）