# 卫戍协议：狩猎模拟 · Stronghold Protocol: Hunt Simulation

**版本 `V0.0.1（0.3.1）`** · 基于 [sganggs/Stronghold-Protocol](https://github.com/sganggs/Stronghold-Protocol) **v0.3.1** 的**非官方 2V2 衍生版**。它保留 1–4 人合作，浏览器即开即玩，并把「狩猎」做成核心玩法：休整期布阵，**狩猎期**给对面（或由系统给你）派猎物，击杀拿**赏金**，找商人**坎诺特**把赏金按比率换成金币，最后在 **R13 最终狩猎 → R14 最终攻势 → R15 隐秘核心**里决出胜负。

> **非官方、非商业、不含游戏素材。** 本仓库与鹰角网络、Yostar 及其关联方没有任何关系；《明日方舟》相关素材版权归原权利人所有，不适用本项目的 GPL。仅供学习交流与个人非商业使用，详见下方[声明](#声明)与 [NOTICE.md](NOTICE.md)。

![version](https://img.shields.io/badge/version-0.3.1-2ea44f)
![fork](https://img.shields.io/badge/fork-V0.0.1（0.3.1）-8957e5)
![license](https://img.shields.io/badge/code%20license-GPL--3.0--or--later-blue)
![node](https://img.shields.io/badge/node-22%20%7C%2024-339933)

## 声明

> [!IMPORTANT]
> - 本项目是玩家自制的**非官方同人作品**，与上海鹰角网络科技有限公司（Hypergryph）、Yostar 及其关联方**没有任何关系**，未获其授权或认可。
> - 《明日方舟》及「卫戍协议」相关的名称、角色、美术、音乐、音效、文本与数据等素材，版权归原权利人所有。这些素材**不适用**本项目的 GPL-3.0 许可证；GPL 只覆盖本项目自己编写的代码。
> - 仅供学习交流与个人非商业使用。**严禁任何形式的盈利**，包括但不限于：售卖本项目或整合包、付费下载或付费分发、收费服务器或收费代开、广告 / 打赏 / 会员等变现方式，以及其他任何商业用途。
> - 仓库源码不包含游戏的美术与音频素材（只有由官方数据表生成的数据和几张游戏截图，同样不适用 GPL）；[Releases](../../releases/latest) 中的完整包为了方便玩家附带了素材（精简包不带，首次启动时从公开镜像下载），下载即视为同意本声明。请勿将素材用于本项目以外的用途或单独再分发。完整条款见 [NOTICE.md](NOTICE.md)。
> - 权利人如认为本项目侵犯其权益，请通过 Issue 联系，我们会**立即删除**相关内容。
> - 本项目按「现状」提供，**不提供任何担保**，使用风险自负。

English summary: [below](#english).

## 原项目与原作者（请先支持上游）

本仓库是 **[sganggs/Stronghold-Protocol](https://github.com/sganggs/Stronghold-Protocol)** 的 **2V2 衍生版**。原版的完整合作玩法、规则复刻、战斗模拟、素材工具与全部文档，都出自原作者 **[@sganggs](https://github.com/sganggs)** 与上游贡献者；**没有原项目就没有本衍生版**。本仓库只在上游之上增加了「狩猎」玩法（2V2 狩猎模拟、同盟狩猎）、事件期与一批局内能力，其余内容与上游一致。

👉 **请优先 Star、关注并使用原项目，把支持给到原作者：**

| 入口 | 链接 |
|---|---|
| ⭐ 原仓库（**Star 请点这里**） | https://github.com/sganggs/Stronghold-Protocol |
| 👤 原作者 | https://github.com/sganggs |
| 📦 原版整合包 / Releases | https://github.com/sganggs/Hunt-Simulation/releases |
| 📖 原版玩法指南 | https://github.com/sganggs/Hunt-Simulation/blob/master/docs/PLAYING.md |
| 🐞 上游问题反馈 | https://github.com/sganggs/Hunt-Simulation/issues |

> 只想体验原版的话，请直接使用上面的原仓库；本衍生版仅在你需要「狩猎」玩法时使用。本衍生版源码仓库：<https://github.com/T1113047/Stronghold-Protocol-Hunt-Simulation>。

| 同盟房间 | 策略轮选 | 休整期（商店 / 盟约） |
|---|---|---|
| ![房间](docs/img/room.jpg) | ![策略](docs/img/band-draft.jpg) | ![休整期](docs/img/prep.jpg) |
| **部署方向轮盘** | **作战** | **最终攻势** |
| ![方向](docs/img/facing-wheel.jpg) | ![作战](docs/img/combat.jpg) | ![最终攻势](docs/img/final-assault.jpg) |

## 目录

- [声明](#声明) · [原项目与原作者](#原项目与原作者请先支持上游)
- [什么是「狩猎」](#什么是狩猎) · [核心玩法](#核心玩法重点) · [相对原版的价值](#相对原版的价值)
- [功能一览](#功能一览) · [下载](#下载) · [快速开始](#快速开始) · [插件](#插件) · [联机方式](#联机方式) · [操作](#操作)
- [文档](#文档) · [开发与测试](#开发与测试) · [项目结构](#项目结构)
- [许可证](#许可证) · [致谢与数据来源](#致谢与数据来源) · [贡献](#贡献) · [English](#english)

## 什么是「狩猎」

一局仍从**休整期**开始：招募干员、摆阵、配装备。休整期结束后进入**狩猎期**：双方各给对方派一份猎物，猎物会插进对方下一场作战的波次里。击杀对面投放的怪才有**赏金**；赏金**不直接进金币**，而是记在商人**坎诺特**的账上，休整期再按当回合的比率取钱。狩猎从抽到的 **R4 / R5 / R6** 开始，**R13 是最终狩猎**（比例固定 50%、固定 25 赏金）；随后 **R14 最终攻势 → R15 隐秘核心**，两队各打各的领袖，先比两场领袖战的**剩余时间**，再比共享生命池。

**一局的核心循环：**

> 休整期布阵 → 狩猎期派猎物 → 击杀得赏金 → 坎诺特按比率取钱 → R13 最终狩猎 → R14 最终攻势 → R15 隐秘核心 → 结算

**猎物的漏与杀是两套规则**：投放的怪漏进保护目标点**不扣目标生命值、也不破坏「完美作战」**；只有**击杀**对面投放的怪才结算赏金。于是「派什么、派给谁、什么时候清」本身就是一个节奏决策，而不只是多打几只怪。

规则与数值尽量对照官方数据表与 PRTS 核对；仍有少数地方按推断实现，与官方不一致之处欢迎在 Issue 里反馈。

## 核心玩法（重点）

以下先讲 **2V2「狩猎模拟」**；4 人合作的**同盟狩猎**在同一套规则上由系统投放猎物，差异见本节最后。

### 狩猎期：把猎物送到对面

**两支双人小队。** 4 个座位固定分成两队：座位 0 / 1 为一队，2 / 3 为另一队；房主可以在等待室交换座位，**换座位就是换队伍**。每队只有**一条共享生命池**（两名队员所选策略的初始生命值之和），两人同生共死。空位由 AI 队友补上；中途退出或「暂离」交给 AI 托管，**不按淘汰处理**，席位保持满员，一对一配对不受影响。

**什么时候开始。** 每局从 **R4 / R5 / R6** 里随机抽一个**狩猎起始回合**（由服务器抽定）。从该回合起，每个**非首领回合**的休整期结束后、作战开始前进入狩猎期。狩猎期分两步：

1. **选目标（10 秒）**：每人指定一名对手。队内**先选先得**——你锁定的对手，队友就拿剩下的那一个，于是四人**一对一配对**，每个人都既打别人也被别人打。全员选好即提前结束。
2. **定制怪物**：把这一份**价值预算**填满。窗口就是本轮休整期的时间，**全员提交即立刻结束**；超时由 **AI 自动投放**（默认「靠中」、按价值从大到小尽量塞满）。

**投放规则：**

- **替换比例**：起始回合 **5%**，之后每回合 **+2 个百分点**，上限 **15%**；**R13 最终狩猎固定 50%**（面板会标明）。
- **每人预算**：本回合波次总价值 × 替换比例 × **2**，每人各算各的。比例同时决定预算与被替换掉的原怪份额。
- **7 类「特训敌人」**：特异 / 飞行 / 频次 / 元素 / 持续 / 隐匿 / 折射，用官方的中文名与图标。类型只是「口味」，**可以跨类型混搭**，只受**总价值**约束，合计不超预算即可。
- **价值表**：按属性打分（生命为主，攻击 / 防御 ×2，法抗 ×15，首领加成、每阻挡 60，飞行按 2 阻挡；**远程怪整只 ×1.5**），再加上**特性分档**（1 / 2 / 3 档：纯数值 / 真机制 / 改变战局）；特性部分**恰好占整张价值表的 30%**。
- **出怪位置与门**：全部怪一起插在本轮波次的**靠前 / 靠中 / 靠后**（本轮怪物数的 **25% / 50% / 75%**）；每只怪单独选**上路 / 下路**，按它自己的移动方式走对应路线。队列里的怪**默认下路**，点一下换门，长按拖动排序。
- **只落在你选定的对手身上**：你投放的怪只会出现在**你锁定的那名对手**的下一场作战里，替换掉对方波次里价值对等的一部分原怪（误差在 2% 以内）。
- **漏过不扣血**：被投放的怪漏进保护目标点**不扣**对方的共享生命池，也**不算**对方的漏怪、不破坏「完美作战」——**只有击杀才有收益**。
- **看得见来源**：对面投放给你的怪带一圈**淡红描边**，脚下标出 `P<n>` **来源小字**（只作显示，不改归属、不参与扣血计算）。
- **5 秒名单公示**：狩猎期一结束（双方都锁定、即将开战），会弹出**双方名单**——逐条列出「谁 → 派了什么 → 打谁 → 赏金 +N」，在屏幕上停留 **5 秒**后自动消失。这是除最终攻势之外唯一能看到对手阵容的时刻。

**操作辅助**：「**沿用上轮**」把上一轮提交过的编队按本轮预算重新装填；「**自动选择**」按价值贪心填满预算、之后仍可手改。

### 赏金经济：坎诺特账本

**只有「对面投放的怪」被击杀才结算赏金**，普通波次怪不计。赏金按**击杀比例**折算，全程**向下取整**，没有「每只至少 1 金」的保底：

| 第几次狩猎期 | 赏金 |
|---|---|
| 第 1–4 次 | 固定 **1 / 1 / 2 / 2 金**（按被清投放怪的比例折算） |
| 第 5 次起 | 被清投放怪的价值 ÷ 本回合波次总价值 × **本轮收入**，实时结算、不封顶 |
| **R13 最终狩猎** | 固定 **25 金**（全清 25、杀一半 12） |

「第几次」从抽到的狩猎起始回合开始数，不是绝对回合。分母只算**投给这名玩家的投放怪**；如果没人能算作击杀（地形烫死、自己掉血等），赏金归**被投放的那一方**。

**赏金 ≠ 金币。** 投放怪的赏金**不进金币**，而是记在**商人「坎诺特」**的账上（每名玩家一份、**跨回合留存**、重连不丢）。休整期在**金币卡上方的坎诺特头像**处取钱，是赏金变成金币的**唯一**通道：

| 回合 | 比率 | 每回合上限 |
|---|---|---|
| R1–R8 | **20%** | 4 金 |
| R9 | **30%** | 4 金 |
| R10–R14 | **35 / 40 / 45 / 50 / 55%**（每回合 +5） | 4 金 |
| R15 隐秘核心 | **100%** | 不限 |

- 成本 = 取出的金币 ÷ 比率；**每回合第一次取款向上取整（ceil），之后向下取整（floor）**，计数器每回合重置。
- 面板给 **1 / 2 / 4 / 全部** 四档，每档都写明要消耗多少赏金；余额不足、超过本回合上限、或不在休整期，服务器都会拒绝。
- 官方的「悬赏」卡赏金不受影响，仍**直接进金币**；这套银行只处理**投放怪**的赏金。

**为什么这样设计**：击杀不会立刻变成可花的钱，而是先存进坎诺特；越早取越贵（20% 比率意味着取 1 金要花 5 赏金），越晚取越划算，但每回合最多取 4 金、R15 才 1:1。于是「这回合取不取、取多少」本身就是一个和布阵抢资源的**节奏决策**，也天然抑制了击杀收益带来的通胀。

### 事件期：一局三次的构筑博弈

**一局 3 次**，与狩猎期节奏对齐，都在该轮**休整期开始之前**触发：

- **E1** = 本局抽到的首个狩猎期轮次（R4 / R5 / R6）；
- **E2** = E1 + **4** 轮（R8 / R9 / R10）；
- **E3** = **R13 最终狩猎**。

每次事件抽**两条**：一条**我方词条**（四选一决定给谁），一条**怪物词条**（独立抽取，与目标无关）。

**我方词条持续 4 回合**：在抽中的回合生效，并在之后 3 个回合继续生效（`picked … picked+3`），到 `picked+4` **自动失效**，属性 / 经济效果都回到基线；历史与公示仍显示全部 3 次选择，只有「当前生效」按这个窗口过滤。怪物词条与强力属性本来就只作用于当回合，不受影响。

**我方词条（24 条，局内不重复）**：每次在**对面 A / 对面 B / 队友 / 自己**里四选一；**同一个目标一局只能用一次**，所以三次事件必然落在三个不同的目标上。选**自己**时幅度 **×2**——吃到增益最爽，吃到减益也最疼。词条分输出 / 生存 / 技力 / 经济·机制四类，既有纯增益、纯减益，也有「攻击换攻速」「生命换攻击」这类**交换型中性**。类型概率随事件次序递进（减益 / 中性 / 增益）：

| 次序 | 我方词条概率 | 怪物词条概率（削弱 / 中性 / 强化） | 强力属性比例 |
|---|---|---|---|
| **E1** | **15 / 45 / 40** | **35 / 40 / 25** | **10–15%** |
| **E2** | **30 / 40 / 30** | **25 / 40 / 35** | **15–20%** |
| **E3** | **45 / 30 / 25** | **20 / 35 / 45** | **20–25%** |

**怪物词条（12 条，局内不重复）**：只改本回合敌人的攻击 / 生命 / 护甲 / 移速 / 数量，**不进入玩家属性，也绝不重算赏金**——`bounty.coins` 在投放时定死，词条与强力属性只改敌人面板。

**强力属性**：每次事件还会强制给本回合的普通怪与**赏金怪**附加一种强力属性——**獠牙** 攻击 +25% / **厚皮** 生命 +30% / **坚壳** 护甲 +25% / **疾行** 移速 +20%；比例从该次序的区间按种子抽取。它与怪物词条**乘法叠加**，赏金金额不变。

**环境 buff 乘区**：事件词条的百分比走一个**只属于事件期**的乘区——每个来源各自乘一次（两条 +20% 是 **1.20 × 1.20 = 1.44**，不是 1.40）；攻速 / 技力 / 技能消耗等**加减值最高优先级，先加到角色面板**，不被乘区缩放；这个乘区不与盟约 / 装备 / 技能 / 机变的加法池混用，既有系统仍用原来的算法。

事件词条对**双方都公开**：谁拿了哪一条、加在谁身上，场上都看得到——它不和「对手在 R14 前不可见」叠成信息差。

### 同盟狩猎：合作版

**同盟狩猎**是同一套狩猎规则的合作版：**1–4 人一队**、共享一条生命池、**没有对手**。

- **系统投放**：从抽到的狩猎起始回合起，服务器按本回合的比例与价值预算，从官方 7 类「特训敌人」里给**每名存活玩家各配一份**猎物，**直接插入各自的波次**（不替换原怪），所以每个人都会遇到自己那一份；各份的**总价值两两不同**，避免四个人的投放完全雷同。
- **同样的狩猎经济**：漏过不扣血、不破坏完美作战；击杀同样只进**坎诺特**，按同样的比率、首取 ceil / 后续 floor、每回合 4 金上限（R15 不限）取钱。
- **同样的事件期与公示**：一局 3 次事件期照常出现；休整期结束后同样有 **5 秒本回合投放公示**，让全队先看清这一轮会多出什么。
- **同样的终局**：难度、回合数、机变、R14 最终攻势与 R15 隐秘核心都沿用同盟的参数。

### 怎么算赢

- **每队一条共享生命池**（两名队员共用），**生命池归零 = 该队败**，另一队直接获胜；
- 双方都活到终局（R15 打完，或未达 R15 门槛时 R14 打完）→ 按下一节的 **4:5 时间判定**分胜负；
- **首领轮**：清空本方领袖血池 = 该轮胜利；两队都没打通 = **双败**；
- 胜负按**队**判定：同队两人一起记胜/败。

### 终局结算：用时间分胜负

- **R14 最终攻势**：**同队的两人**配对（配对本局固定，隐秘核心沿用），共享一个关底战场，一人守左半边、一人守右半边（右侧玩家棋盘左右镜像），共同削**本队的一条领袖血条**。**两队各打各的 Boss**，一队的进度不影响另一队。顶部 120 秒倒计时结束后战斗**继续**；超过开战 120 秒后（实际秒数），本队每秒扣 1 点共享生命值。
- **R15 隐秘核心**（仅险境及以上）：至少一队达到门槛即可进入，两队继续各打各的强化领袖。2V2 按**队**判定：本队存活成员的激活层数总和 **> 600**，且共享生命池 > 1。Boss 链止于 R15，隐秘核心清完即整局结算（没有第 16 回合）。
- **胜负判定（4:5 时间分）**：先比较两队在**两场领袖战**里的**剩余时间占比**——R14 最终攻势按 **4** 份、R15 隐秘核心按 **5** 份，`4 × R14 剩余 ÷ R14 时限 + 5 × R15 剩余 ÷ R15 时限`（按各轮自己的倒计时折算，**没打到的回合按 0 计**）。时间分相同再比**共享生命池**，仍相同才用「打掉自己领袖血条的比例 → 剩余生命池 × 2 秒 + 剩余时间」的折算分；结算页会注明「**时间同分**」。
- **双败**：一队在最终攻势前被全灭，两队都不通关；胜利按队判定，同队两人一起记为通关。
- **结算统计**：结算页同时给出本局**赏金收入 / 坎诺特取钱**统计，以及伤害、治疗、领袖伤害等数据。

### 信息与观战

- **对手在 R13 结束前不可见**：从开局到 **R13 最终狩猎**结束前，对手的头像是灰的，只能看到对方队伍的**共享生命池**；**R14 最终攻势起公开**——对方成员的行、等级与上场数、他们的战场都能查看。
- **观战席看得见所有人**：每个房间另有 **2 个观战席**，**从第一回合起**就能看任何人的阵地与战场，不受「对手在 R14 前不可见」的限制；观战只读，不能购买、部署或准备。
- **局内交流与信息**：左下角文字聊天（**Enter 发送**、2 秒冷却、单条上限 80 字，服务端清洗与违禁词过滤）、顶部全服通知横幅（20 秒自清、可关闭）、**伤害 / 治疗统计板**（回血按来源速率归给提供者）、**队友概览**（生命 / 等级 / 上场）。
- **快速匹配**：房主「开放匹配」后，其他博士可在大厅一键加入**同难度、未开局、有空座**的房间（合作与 2V2 都支持，单人房不能开放）。

## 相对原版的价值

上游 0.2.6 是一套很完整的 **1–4 人纯合作**玩法。本作在不动这套底子的前提下，主要给玩家多加了下面几件事：

1. **两种狩猎，不再只有纯合作。** 想和朋友一起打，就开**同盟狩猎**：最多四个人共享生命池，系统按比例往每个人的波次里投放猎物。想互相较劲，就开 **2V2 狩猎模拟**：两队互派猎物、共享生命池、各打各的 Boss。同一套游戏、两种完全不同的社交体验。
2. **每局都能换 build。** 事件期一局 3 次，每次在「对面 A / 对面 B / 队友 / 自己」里四选一，配 24 条我方词条与 12 条怪物词条。它不是单纯的抽卡运气——**把词条给谁**才是决策：给对面可能养肥对手，给队友是稳，给自己是 ×2 的高方差赌博；2V2 里三次目标还不能重复。
3. **把击杀收益变成节奏决策。** 赏金不直接进金币，而是存在坎诺特那里，按回合比率折价取钱。早取更贵、晚取更划算，但普通回合最多取 4 金，R15 才 1:1 且不限。你必须在「现在补强」和「再等等」之间做选择，击杀收益不再是无脑通胀。
4. **信息差与时间胜负。** 对手从开局一直隐藏到 R13，最终攻势起才公开；结算先比两场领袖战的**剩余时间占比（4:5）**，而不是只比谁血多。藏阵容、抢时间、在最终攻势里冒险，都有了意义。
5. **轻量运维。** 仍然是**单个 Node.js 进程 + WebSocket**，战斗在各玩家浏览器里模拟；一台低功耗小主机就能开服。
6. **手机与低配友好。** 手机横屏优先，结算页分两栏；界面字号跟随设置里的「文字大小」；可切**简化平面 / 2D 棋盘**、关闭角色模型；核显 / 软件渲染会按 GPU 自动降档，玩家显式选择优先。

**上游 0.3.1 带来的内容**：Forge 工坊包导入大幅补齐（主题变量、公告、行为开关、新的盟约 / 装备 / 召唤物 / 驻守与池外官方干员、面板兼容层、特效、皮肤），插件工作台为这些新功能加了图形化模板；设置新增「素材存储」（申请持久保存、清理旧版本素材）与「异形屏适配」；修复余、野鬃、缪尔赛思、瑕光等干员的官方特效和动作，琳琅诗怀雅三技能改为官方的不自动关闭，详见 [CHANGELOG.md](CHANGELOG.md)。

## 功能一览

- **完整的一局**：确认本局信息 → 策略轮选（40 名策略）→ 14 回合 → 结算称号；险境及以上满足条件时进入第 15 回合「隐秘核心」。
- **4 种难度**：标准 / 险境 / 绝境 / 终极，独立与同盟各一套参数，均取自官方数据；2V2 沿用同盟的难度参数，差异由代码叠加。
- **狩猎模拟（2V2）与狩猎期**：两支双人小队、每队共享生命池、按轮给对面派怪、击杀得赏金、5 秒悬赏名单公示；R14 / R15 两人共享战场。
- **同盟狩猎**：1–4 人合作，系统按比例给每人投放一份猎物，同样有坎诺特、事件期与 5 秒投放公示。
- **最终狩猎（R13）**：替换比例固定 **50%**，赏金固定 **25**（按击杀比例折算），全场的投放都要在这一轮打出价值。
- **事件期（狩猎词条）**：一局 3 次、四选一目标、2V2 中目标不可重复；24 条我方词条 + 12 条怪物词条；每次另给 10–25% 的普通怪与赏金怪附加一种强力属性；环境 buff 乘区独立相乘。
- **商人「坎诺特」**：赏金不进金币，休整期在金币卡上方的头像处按比率取钱；首取 ceil、之后 floor，每回合 4 金上限、R15 不限。
- **对面视角**：对手在 R13 最终狩猎之后（R14 最终攻势起）公开；**观战席从第一回合起就能看所有人**。
- **快速匹配**：房主开放匹配后，其他博士一键加入同难度、未开局、有空座的房间。
- **插件（0.3.0 起）**：外观 / 界面 / 玩法插件；房主在房间顶部为全房间开启，玩家也可以在「设置」里只给自己开外观与界面插件。插件工作台 `/studio/` 可选模板、按官方名称选目标、试一场并打包。
- **干员皮肤与官方特效**：每个座位可以给自己的干员选一套皮肤（设置里「显示其他玩家的皮肤」默认打开）；服主提取过官方战斗特效时，设置里可选「官方特效」关 / 精简 / 完整。
- **局内文字聊天**：左下角聊天框，**Enter 发送**（2 秒冷却、单条上限 80 字）；观战只读；聊天气泡、未读红点。
- **违禁词过滤**：服务端权威，命中后替换为等长 `*`；词库从服务端配置读取，本仓库只带**示例占位词表**。
- **对局记录落盘**：每局一份，含参与者与结果，默认保留 **7 天**。
- **全服通知横幅**：顶部一条醒目横幅，**20 秒自清**、可点击关闭。
- **伤害 / 治疗统计板**：显示本场战斗累计的伤害（黄）与治疗（蓝），**回血按来源速率归给提供者**。
- **队友概览**：观战 / 查看阵地时显示该干员的**生命 / 等级 / 上场**。
- **干员素材预取**：抓到干员的当下就预取头像与战斗模型，减少战斗首帧加载。
- **画面自动调节**：设置 →「画面质量」里默认开启；关掉后可分别选 **2D 棋盘（简化平面）/ 3D 棋盘**与**加载 / 不加载角色模型**，立即生效。
- **按 GPU 自动降档**：核显 / 软件渲染的机器默认「中」画质 + 2D，玩家显式选择优先。
- **文字大小**：设置 →「文字大小」只放大界面文字，不移动棋盘与 HUD。
- **过场延迟可调**：回合间等过场停顿可用环境变量调整，默认比上游更短（例如回合间由 2000 ms 降到 1000 ms）。
- **休整期**：招募、刷新、冻结、升级调度中心；整备区与临时整备区；从整备区拖到棋盘部署，用**方向轮盘**选择朝向。合作与 2V2 的卡池共用。
- **晋升精锐**：3 名同名干员自动合成精锐，并获得一次高一阶的免费招募。
- **干员与调配**：112 名可招募干员（+ 精锐）及其技能、天赋和特质；开局前可以为每名干员选择携带的技能（283 个技能全部手工实现）和精锐的模组。
- **盟约与层数**：23 个盟约（8 个势力核心盟约 + 附加盟约），层数整局保留，每个盟约最多 999 层。
- **装备与机变**：装备与法术，同名装备合成、特定组合赋予盟约效果；已配发的装备锁定在干员身上；部分回合开始前有机变选卡。
- **自动作战**：技能按官方「技能策略」自动释放；按接触半径阻挡，阻挡者倒下时由接触的干员接替；元素损伤与元素爆发；召唤物由玩家手动摆放；推开 / 拉拽按力度与重量计算。
- **地形与敌人**：阻隔工事、射击台、源石流吹风机、沼泽、排气格栅、涨潮等地形装置；空中与近地悬浮敌人、悬赏敌人。
- **联防**：有人漏怪、又有人完美作战时，完美作战的队友带着阵容帮忙拦截漏掉的敌人。
- **最终攻势与隐秘核心**：同队两人共享一个关底战场，共同削减同一条领袖血条（2V2 两队各打各的）；10 个敌方领袖，巨型领袖约 5×3 格的受击范围，以及官方的限伤规则。
- **结算**：官方样式的个人战报和同盟结算页，卫戍认证等级（官方 60 级、每日防卫目标，按本机记录计算）；卫戍之星、不朽盟约、坚若磐石等 6 个结算称号。
- **断线重连**：断线后座位保留，合作与 2V2 在 10 分钟内、独立狩猎在 24 小时内重新打开页面即可回到原座位；掉线期间作战按原编队由服务器接管，中途退出或「暂离」才交给 AI 托管。
- **交互细节**：漏怪时顶栏用红字 + 「−N」标记待扣的目标生命值（结算时才扣除）；点选、拖放和配发装备都按地上的方格；购买、升级和机变选卡都需要点两次确认；只有一名玩家时除作战与事件期外不计时（事件期照常计 20 秒）。
- **画面与声音**：真实 Spine 小人、官方 BGM 与音效、表情（6 套 × 6 个）、作战特效；可选的官方 3D 棋盘（需要从本机客户端提取贴图）。
- **手机与电脑**：触摸拖拽、长按查看详情，推荐横屏；设置里可以调低画质、选文字大小。

## 下载

[Releases](../../releases/latest) 里有两种包，按自己的网络情况选一种：

- **完整包**：附带全部美术 / 音频素材，体积大（约 800 MB，解压后约 1.16 GB），解压就能玩，不需要再下载任何东西。
- **精简包** `Hunt-Simulation-v0.0.1-lite.zip`（约 25 MB）：不含素材，第一次启动时自动从公开镜像下载约 550 MB，可中断，再次启动会续传。

版本 `V0.0.1（0.3.1）`；解压后按 `scripts/start-windows.bat`（Windows）或 `./scripts/start.sh`（macOS / Linux）启动。

## 快速开始

### 方式一：整合包（推荐）

[Releases](../../releases/latest) 里有几种整合包，代码和运行依赖完全相同，按需二选一；已经装好旧版本的，升级时只下载更新包即可：

- **完整包** `…-v<版本>.zip`（约 800 MB，解压后约 1.16 GB）：附带全部美术 / 音频（含中文、日文、英文、韩文和本土语言的干员语音、官方 3D 棋盘贴图、各战场的官方场景和官方战斗特效），解压就能玩，不需要再下载任何东西。**推荐。**
- **精简包** `…-v<版本>-lite.zip`（约 25 MB）：不带素材，第一次启动时自动从公开镜像下载美术、Spine 模型、音频、字体、表情和「玩法说明」教程图（约 720 MB，可中断，再次启动会续传）；官方 3D 棋盘等本地客户端素材不在其中（见下面的「本地客户端素材」；各战场的官方场景可以用 `node tools/setup.mjs --scenes` 在本机下载并提取）。适合下载大文件不方便的情况。
- **更新包** `…-v<版本>-update.zip`（大小看改动多少，通常只有几 MB）：只含比之前的版本改动过的文件，用来把已经装好的旧版本升级到新版本，不用重新下载整个包。用法：先停止服务器（关掉窗口；装了开机自启的运行 `scripts\install-service-windows.ps1 -Stop`），把 zip 里程序文件夹的全部内容合并到安装文件夹、覆盖同名文件（Windows 资源管理器里复制粘贴即可；macOS 不要用访达拖放，它会整个替换文件夹，请用 `unzip -o`，见 [docs/DEPLOY.md](docs/DEPLOY.md) 第 1.5 节），再照常启动。启动时会先核对全部程序文件、删除新版本不再用的旧文件，然后正常运行；如果这个文件夹不是更新包对应的版本（或者程序文件被改过），会提示下载完整包，服务器不启动。全新安装请用完整包或精简包。

两种包都只含运行和部署需要的文件（服务器、客户端、数据、启动脚本、setup / doctor / 素材下载工具、许可证与说明、[docs/PLAYING.md](docs/PLAYING.md) 和 [docs/DEPLOY.md](docs/DEPLOY.md)）；测试、开发工具和设计文档只在源码仓库里。

1. **安装 Node.js 22 或 24（LTS）**
   - Windows：在 PowerShell 里运行 `winget install OpenJS.NodeJS.LTS`，或到 <https://nodejs.org/zh-cn/download> 下载安装包。
   - macOS：`brew install node@22`，或到官网下载安装包。
   - Linux：发行版的包管理器、nvm 或 fnm。
2. **下载**：在 [Releases](../../releases/latest) 页面下载最新版本的完整包（或精简包），解压到一个路径较短的文件夹（Windows 上建议不要放在 OneDrive 同步的目录里）。
3. **启动**
   - Windows：双击 **`scripts\start-windows.bat`**。如果弹出「安全警告」，点「运行」；Windows 防火墙弹窗请勾选「专用网络」并允许。
   - macOS / Linux：在解压出的文件夹里运行 `./scripts/start.sh`（或 `bash scripts/start.sh`）。
4. 浏览器会自动打开 `http://localhost:3000`。窗口里列出的局域网地址可以直接发给同一网络的朋友。关闭窗口（或按 `Ctrl+C`）即停止服务器。

### 方式二：从源码运行

```bash
git clone https://github.com/T1113047/Stronghold-Protocol-Hunt-Simulation.git
cd Stronghold-Protocol-Hunt-Simulation
npm install        # 安装依赖（postinstall 会把 pixi / preact / three 复制到 public/vendor）
npm run setup      # 检查环境，并从公开镜像下载约 550 MB 美术 / 音频（可中断，再次运行会续传）
npm start          # 启动服务器：http://localhost:3000
```

也可以直接运行启动脚本（Windows `scripts\start-windows.bat`，macOS / Linux `scripts/start.sh`）：首次会自动安装依赖、下载素材，然后启动服务器并打开浏览器。

- **本地客户端素材（可选）**：官方 3D 棋盘、部分官方界面图标（交流按钮与表情面板的边框、模组类型图标等）、灼热 / 炽焰源石虫和 39 个召唤物（多数自选召唤物）的官方模型需要从本机的《明日方舟》PC 客户端提取（Windows 原生客户端、macOS 的 CrossOver 或 PlayCover）。`npm run setup` 检测到客户端时会询问是否提取（需要 Python 3.8+，依赖装在项目内的 `.venv-extract`，不影响系统）；之后可以用 `node tools/setup.mjs --local` 重新提取，或用 `--game "<…/StreamingAssets/AB/Windows>"` 指定路径。没有客户端时游戏照常运行，这几样换成替代样式：2D 棋盘、样式相近的图标、染色的普通源石虫、召唤物头像。表情和「玩法说明」的教程图随上面的素材一起从公开镜像下载，不需要客户端。没有客户端的服务器（例如 Linux VPS）也可以从**同一版本**的整合包（完整包；精简包没有）里复制 `public/assets/local/` 和 `data/local-assets.json`，见 [docs/DEPLOY.md](docs/DEPLOY.md) 的「本地客户端素材」。
- 素材下载优先使用 GitHub，失败时自动改用 jsDelivr 镜像。
- `npm run doctor`（即 `node tools/doctor.mjs`）可以随时诊断：Node 版本、素材是否完整、端口占用、局域网地址和防火墙。

### 系统要求

| 项目 | 要求 |
|---|---|
| 开服的电脑 | Windows / macOS / Linux，Node.js 22 或 24（LTS）；磁盘约 700–850 MB（素材、依赖与本地提取贴图：完整包解压后约 790 MB）；内存空闲约 100 MB，每局再加几 MB |
| 玩家 | 支持 WebGL 的现代浏览器（Chrome / Edge / Firefox / Safari 最新版），电脑、手机或平板（横屏） |
| 网络 | 首次进入游戏时，每位玩家要从开服的电脑下载几十 MB 素材（之后走浏览器缓存）；对局中流量很小 |

显卡较弱时可以在「设置 → 画面质量」里调低画质（含「画面自动调节」开关），或在网址后加 `?board=2d|3d`（强制 2D / 3D 棋盘）/ `?render=fallback|engine`（强制使用 / 不使用简化的 DOM 画面）。3D 棋盘起不来时会**自动回落 2D 并提示**。

### 端口与配置

默认监听 **TCP 3000**。换端口：启动脚本加 `--port 3001`，或设置环境变量 `PORT`。

| 环境变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | `3000` | 监听端口 |
| `HOST` | `::` | 监听地址。默认 `::` 是双栈：同一个端口同时接受 IPv6 和 IPv4；`0.0.0.0` = 只 IPv4；`127.0.0.1` = 只允许本机，放在反向代理后面时使用 |
| `SP_COMBAT` | `client` | `client`：各玩家浏览器模拟自己的战斗（服务器负载极低）；`server`：由服务器模拟并推流 |
| `SP_VERIFY` | `off` | 服务器复算客户端上报的战斗结果：`off` / `sample`（约 1/8 抽查）/ `all`（全部复算，更耗 CPU） |
| `TRUST_PROXY` | `auto` | 是否信任 `X-Forwarded-For` 等转发头：`auto` 只信任来自本机 / 内网的代理；`1` 总是；`0` 从不 |
| `DEBUG` | 空 | 设为任意值输出详细日志 |
| `SP_NO_BROWSER` | 空 | 设为 `1` 时启动脚本不自动打开浏览器 |
| `SP_BOT_EMOTES` | 空 | AI 队友的对局表情回应（战斗、整备、合成、联防、收礼时即刻的 `m.emote` 广播）；设为 `0` 时整体关闭 |
| `SP_ASSET_INDEX` | 空 | 素材地址带内容哈希、浏览器长期缓存（默认开启，哈希存在 `.cache/asset-hashes.json`）；设为 `0` 时关闭，素材清单原样下发 |
| `SP_DELAY_*` | 见下 | 过场停顿（毫秒）可调：`SP_DELAY_ROUND_START`（默认 1000，上游为 2000）、`SP_DELAY_COMBAT_END`、`SP_DELAY_SETTLE`、`SP_DELAY_BOT_ACTION`、`SP_DELAY_BOT_STAGGER`、`SP_DELAY_PUBLIC_THROTTLE` |

设置方式：macOS / Linux `PORT=8080 npm start`；PowerShell `$env:PORT=8080; npm start`；cmd `set "PORT=8080" && npm start`。健康检查：`GET /healthz`。

### 和朋友一起玩（局域网）

1. 打开页面 → 输入昵称 → 选择 **狩猎模拟（2V2）** 或 **同盟狩猎** → 创建房间。房主选择难度，可以添加 / 移除 AI 队友；开始前也可以把其他博士移出房间（对方可凭密钥重新加入）。想让陌生人一键加入，房主可以打开「**开放匹配**」。
2. 把 4 位字母的**房间密钥**，或「复制链接」得到的 `http://<地址>:3000/?room=密钥` 发给朋友；也可以让对方在大厅点「快速匹配」。
3. 所有人点「准备就绪」后房主开始。
4. 同一 Wi-Fi / 路由器下的朋友打开启动窗口里列出的地址（形如 `http://192.168.x.x:3000`）即可。打不开时多半是防火墙：Windows 首次启动时在弹窗中允许「专用网络」，或运行 `npm run doctor` 查看具体命令；访客 Wi-Fi 常开启「AP 隔离」，也会导致连不上。

刷新页面或断线后，合作与 2V2 在 10 分钟内、独立狩猎在 24 小时内重新打开即可回到原座位。服务器把房间和对局都保存在内存里，**重启服务器会结束所有对局**。

## 插件

0.3.0 起支持插件；不开插件时按原版游玩。

- **服主安装**：将插件文件夹放进服务器的 `plugins/`，或用 `node tools/plugin.mjs install <zip路径或HTTPS地址>` 安装；远程地址需要 `--sha256`。工作台也支持从社区目录安装和导入 Forge 工坊包。服主可用 `plugins/config.json` 限定可用插件。
- **房主开启**：在房间顶部的「原版 / 插件 ×N」面板里选外观或玩法插件、修改插件设置、选择插件模式。玩法插件的内容会由所有玩家下载并校验，房间标为「非官方」，统计总览默认不计入。
- **玩家个人设置**：「设置 → 外观插件 / 界面插件」只影响自己的浏览器；个人不能另装玩法插件改变房间规则。外观插件只换画面与声音，界面插件只读允许的对局信息。
- **自己制作**：打开启动窗口 `Studio:` 行的地址，使用 `/studio/` 插件工作台选模板、按官方名称选目标、拖放素材、实时预览、试一场并回放，最后打包分享。工作台限本机和局域网，修改需要钥匙。

脚本执行默认关闭。服主可以用 `SP_PLUGIN_SCRIPTS=sandbox` 开启沙箱脚本（或启动时加 `--scripts sandbox`；Windows 双击 `scripts\start-windows-sandbox.bat`）；原生受信任模式还需审查、固定锁文件哈希和玩家同意，公网部署需 `trusted-force`。开服设置见 [部署指南](docs/DEPLOY.md)，作者从[插件新手指南](docs/PLUGIN-GUIDE.md)开始，格式与限制见[插件参考](docs/PLUGINS.md)，接口列表见[插件 API 表](docs/PLUGIN-API.md)。

## 联机方式

朋友不在同一个局域网时，下面是几类常见做法，按自己的情况选一种即可。这里只做简单介绍，提到的工具和服务只是举例，本项目与它们没有任何关系，也不做推荐；具体的安装、费用和使用规则请以各自的官方说明为准。部署细节（防火墙、开机自启、反向代理与 HTTPS、Docker）见 **[docs/DEPLOY.md](docs/DEPLOY.md)**。

| 方式 | 怎么做 | 适合 |
|---|---|---|
| **同一局域网直连** | 把启动窗口里的局域网地址发给朋友 | 同一个家、宿舍或网吧 |
| **组网工具（虚拟局域网）** | 例如 Tailscale、ZeroTier、EasyTier、蒲公英：开服的人和朋友都安装同一个工具并加入同一个网络，朋友用开服电脑的虚拟 IP 访问 `http://<虚拟 IP>:3000` | 固定的几个熟人；不暴露到公网。朋友也要装客户端，部分工具需要注册账户；跨地区时可能走中继而变慢 |
| **内网穿透 / 隧道** | 只有开服的人运行客户端，朋友直接打开网址。例如自建的 frp（需要一台有公网 IP 的服务器）、Cloudflare 的 `cloudflared tunnel --url http://localhost:3000`（临时地址，每次启动都会变；国内访问延迟可能较高）、国内的樱花 frp 一类公共穿透服务（通常需要实名，大陆节点承载网页可能有备案要求） | 不想改路由器、没有公网 IP；免费线路带宽小时，首次加载素材会慢一些 |
| **云服务器 / VPS 直接部署** | 在 VPS 上运行整合包，或用仓库自带的 `Dockerfile`；用 Caddy / Nginx 加上 HTTPS。选离玩家近、线路好的地区（面向大陆玩家时，境外机房要关注回程线路，否则晚高峰延迟可能很高；大陆服务器绑定域名需要 ICP 备案） | 想长期开服、玩家分布在不同地区 |

通用注意事项：

- 游戏是**单个常驻 Node.js 进程 + WebSocket**（路径 `/ws`），只能跑一个实例，必须部署在域名根路径；Vercel 之类的 Serverless 平台和 GitHub Pages 之类的静态托管都不适用。反向代理要转发 WebSocket 升级。
- 从 CDN 节点打开时，游戏 WebSocket 会**直连源站**，绕开「玩家 → CDN → 源站」的中转（页面由源站直接打开时仍走同源）。
- **知道地址的人都能进来**。请只把地址发给朋友，不要公开发布，也不要搭建公开大厅；这同时能降低素材版权方面的风险。
- 有公网 IPv4 时也可以在路由器上做端口转发，但这会把家里的电脑直接暴露在公网上，优先考虑上面的方式。

## 操作

| 操作 | 方法 |
|---|---|
| 购买 / 升级调度中心 / 机变选卡 | 点一次选中，再点一次确认（`D` 升级） |
| 部署 / 移动干员 | 从整备区拖到棋盘格 → 出现方向轮盘 → 往上 / 右 / 下 / 左滑动选择朝向后松手；松在中心或点「✕ 点击取消」取消。拖动时指针 / 手指所在的格子就是落点，能放下时模型直接站在这一格上（不能放下时跟在指针下） |
| 调整朝向 | 把干员拖回它自己的格子，再选方向 |
| 出售 / 撤退 / 销毁装备 | 点击单位所在的格子 → 底部按钮「出售 +1」「撤退」；也可以把棋盘上的干员拖回整备区撤退。整备区里的装备与法术只能「销毁」，已配发的装备锁定在干员身上（干员出售或合成精锐时退回整备区） |
| 装备 | 把装备拖到干员所在的格子上（每人 2 件；满了会弹出替换窗口，被替换的一件会被销毁）；法术拖到地块上并选方向 |
| 查看详情 | 右键或长按单位 / 卡牌（属性为实时数值，高于基础值为绿色、低于为红色） |
| 快捷键 | `W` 购买鼠标指向的商品（无需点击） · `R` 刷新 · `F` 冻结 · `D` 升级 · `Q` 撤退 / `X` 出售选中的干员 · `Space` 准备就绪 · `Esc` 取消 / 关闭；除 `Esc` 外都可以在「设置 → 快捷键」里改成别的键（[玩法指南 §11](docs/PLAYING.md#11-快捷键)） |
| 方向轮盘键盘操作 | 方向键预览 · `Enter` 确认 · `Esc` 取消 |
| 狩猎期（2V2） | 第 1 步点一名对手（10 秒，队内先到先得）；第 2 步点怪加入队列，**点一下这一行切换上路 / 下路**，**长按拖动**排序；「自动选择」按价值贪心填满预算，「沿用上轮」按本回合预算重新装填 |
| 坎诺特取钱 | 休整期点金币卡上方的商人头像；面板给 1 / 2 / 4 / 全部四档，每档写明要花多少赏金，点两次确认 |
| 事件期 | 2V2 面板里四选一（对面 A / 对面 B / 队友 / 自己），同一个目标一局只能用一次，已用过的目标会置灰；同盟狩猎只有自己 / 队友两个目标 |
| 局内聊天 | 左下角聊天框输入文字，按 **`Enter` 发送**（2 秒冷却、单条最多 80 字；观战只读）；点左上角图标可收起 / 展开，收起时有未读红点 |
| 快速匹配 / 开放匹配 | 大厅点「快速匹配」加入同难度、未开局、有空座且已**开放匹配**的房间；房主在房间里用「开放匹配」开关（单人房不能开放） |
| 查看队友概览 | 观战或准备期查看队友阵地时，底部条显示该干员的**生命 / 等级 / 上场** |
| 文字大小 | 设置 →「文字大小」：只放大界面文字，棋盘和 HUD 的位置不变 |
| 画面自动调节 | 设置 →「画面质量」：默认开启；关掉后可分别选 **2D 棋盘（简化平面）/ 3D 棋盘**与**加载 / 不加载角色模型**，立即生效（也可用网址参数 `?board=2d\|3d`、`?render=fallback\|engine`） |
| 插件（0.3.0 起） | 房主点房间顶部的「原版」→ 选插件、改设置、选插件模式，变成「插件 ×N」；玩家在「设置 → 外观插件 / 界面插件」里可以只给自己开（[插件一节](#插件)） |
| 干员皮肤 / 官方特效 | 「干员调配」的详情里选皮肤（队友看得到，可在设置里关掉「显示其他玩家的皮肤」）；服主提取过官方特效时，设置 →「官方特效」选关 / 精简 / 完整 |
| 暂停（独立狩猎） | 作战中（含最终攻势 / 隐秘核心）点顶栏的「暂停」或按 `Space`，再点「继续作战」（或 `Space`）继续；合作与 2V2 的作战不能暂停 |
| 表情 | 左下角「交流」，左右滑动（或方向键）换主题，冷却 1 秒 |
| 观战 | 自己的作战结束后（或休整期）点左侧队友头像 →「前往查看」；不参战的朋友可以在大厅输入房间密钥点「观战」（每个房间最多 2 名观战者，本作新增） |
| 统计（本机） | 标题画面右上角、大厅、等待室的「统计」：胜率、策略通过率、称号、战斗累计和对局记录（点一行回看结算页）；只存在本机浏览器里，可以导出 / 导入，没清完第一个回合就退出的对局不计入统计（[玩法指南 §12](docs/PLAYING.md#13-统计本机)） |

完整的规则、数值和小技巧见 **[docs/PLAYING.md](docs/PLAYING.md)**（游戏内左下角也有「玩法说明」）。

## 文档

| 文档 | 内容 |
|---|---|
| [CHANGELOG.md](CHANGELOG.md) | 更新记录：每个版本修复了什么、哪些反馈经核实不是问题 |
| [docs/PLAYING.md](docs/PLAYING.md) | 玩法指南：流程、经济、招募与晋升、摆阵、联防、盟约、最终攻势、2V2 狩猎模拟与同盟狩猎 |
| [docs/PLUGINS.md](docs/PLUGINS.md) · [docs/PLUGIN-GUIDE.md](docs/PLUGIN-GUIDE.md) | 插件格式、安装与服主策略；中文工作台入门、DSL 和对战试验 |
| [docs/DEPLOY.md](docs/DEPLOY.md) | 部署指南：Windows 开服与开机自启、防火墙、组网 / 隧道、反向代理与 HTTPS、Docker、systemd、排错 |
| [docs/WINDOWS.md](docs/WINDOWS.md) | Windows 便携包：怎么打一份「零安装」包（`scripts/make-windows-bundle.mjs`）、包里放了什么、授权注意事项 |
| [docs/DESIGN.md](docs/DESIGN.md) | 架构与契约（英文）：索引，按章节号找到文件；现行规则在 `docs/design/`（范围与目录分工、坐标与时间、战斗引擎、对局、网络协议、渲染与 UI），各次试玩和各版本的规则修订与依据在 `docs/history/` |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 代码地图（英文）：服务器、联机协议和前后端共用的战斗模拟，0.2.0 重构后的目录，数据流，黄金结果与导入边界，常见改动从哪里入手 |
| [CONTRIBUTING.md](CONTRIBUTING.md) | 参与贡献：准备环境、运行测试、忠实原则、提交与 PR 约定、怎样添加自选干员（中文，末尾附英文摘要） |
| [docs/SIM.md](docs/SIM.md) | 战斗模拟引擎参考（英文）：钩子、技能描述格式、职业默认行为 |
| [docs/META.md](docs/META.md) | 对局与经济引擎（英文）：回合流程、商店、联防、最终攻势的实现细节 |
| [docs/DATA.md](docs/DATA.md) | 由官方数据表生成的游戏数据（英文） |
| [docs/ASSETS.md](docs/ASSETS.md) | 素材来源、目录结构与清单（英文） |
| [docs/I18N.md](docs/I18N.md) | 界面语言（英文）：界面文字、游戏文本与服务器消息怎样翻译，覆盖范围；**添加一种语言只需在 `public/i18n/` 放一个语言文件**（社区翻译步骤见「Adding a language」，内容包格式见 [docs/PACKS.md](docs/PACKS.md)） |
| [docs/BALANCE.md](docs/BALANCE.md) | 难度模型与测量（英文） |
| [docs/research/](docs/research/00-INDEX.md) | 官方规则、数据与界面的调研记录 |

## 开发与测试

```bash
npm run dev                 # node --watch：改动服务器代码后自动重启
node --test                 # 单元 + 集成测试（约 3170 项；缺少素材 / 浏览器的用例会自动跳过）
SP_E2E=1 node --test test/ui/mock.e2e.test.js        # 浏览器端到端测试，需要本机 Chrome（CHROME_PATH 可指定路径）
SP_REAL_E2E=1 node --test test/ui/real.e2e.test.js   # 需要 Chrome + 已下载的素材
RENDER_E2E=1 node --test 'test/render/*.browser.test.js'   # 渲染测试，部分需要本地提取的棋盘贴图
GOLDEN_FULL=1 node --test test/golden.test.js           # 黄金结果：固定种子的整套战斗与人机对局摘要（默认只跑快速子集）
node tools/perfbench.mjs --cpu 1,4,6 --profile             # 真实战斗的帧耗时基准（Chrome 降速 CPU 近似中低端手机），需要 Chrome + 已下载的素材
```

- 游戏数据由 `npm run build-data`（`tools/build-data.mjs`）从官方数据表生成，不要手工修改 `data/*.json`。
- 性能测试：`/dev/battle-perf.html` 在浏览器里跑一场真实战斗（对局用的战斗运行器、模拟和渲染），实时显示帧率与逐帧耗时；在手机上打开后点击「开始测量（10 秒）」，生成的报告可以复制后附在反馈中。用到的战斗来自 `node tools/capture-specs.mjs` 从固定种子的机器人对局里截取的数据（`public/dev/perf/`）。
- 「设置」里的问题反馈会附带实时性能读数（帧率、逐帧耗时、GPU 与设备信息），方便排查卡顿。
- 只重构、不改玩法的提交不能改变 `test/golden/*.json`；有意改变玩法时运行 `npm run golden:update`，检查差异后随改动一起提交（见 [test/golden/README.md](test/golden/README.md)）。
- GitHub Actions（[.github/workflows/ci.yml](.github/workflows/ci.yml)）在 Ubuntu 与 Windows、Node 22 / 24 上运行 `npm ci`、`node --test` 和服务器冒烟测试。
- 代码怎么分层、改某个规则该从哪个文件入手，见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 项目结构

| 路径 | 内容 |
|---|---|
| `server/` | 入口 `index.js`；Node HTTP 静态服务 + WebSocket（`/ws`，代码在 `http/`）、大厅、对局引擎（`match/`）、战斗模拟（`sim/`，浏览器与服务器共用） |
| `shared/` | 前后端共用的常量与网络协议 |
| `public/` | 浏览器客户端（原生 ES 模块，PixiJS + pixi-spine、three.js 3D 棋盘、Preact + htm UI） |
| `data/` | 由官方数据表生成的游戏数据与素材清单 `assets.json` |
| `tools/` | `setup.mjs` / `doctor.mjs`、素材下载 `fetch-assets.mjs`、数据构建、本地提取 `local-extract/` |
| `scripts/` | 启动脚本（Windows / macOS / Linux）、Windows 开机自启 |
| `docs/` | 文档与调研 |
| `test/` | `node:test` 测试 |

## 许可证

- **代码**：本项目自己编写的代码以 **GPL-3.0-or-later** 发布，全文见 [LICENSE](LICENSE)；另附一条 GPL 第 7 条的附加许可，允许与 pixi-spine 中的 Spine Runtimes 组合分发（见 [NOTICE.md](NOTICE.md)）。
- **游戏素材不在许可范围内**：《明日方舟》相关的美术、音乐、音效、文本与数据等版权归原权利人所有，不适用 GPL，使用限制见上方的[声明](#声明)和 [NOTICE.md](NOTICE.md)。
- **第三方组件**各自遵循其许可证：通过 npm 安装的库（整合包的 `node_modules` 中附带各自的许可证文件）、`tools/local-extract/aklz4.py` 的算法（BSD-3-Clause），以及字体等，清单与许可证全文见 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)。

## 致谢与数据来源

- 游戏数据：[Kengxxiao/ArknightsGameData](https://github.com/Kengxxiao/ArknightsGameData)。
- 素材来源：[yuanyan3060/ArknightsGameResource](https://github.com/yuanyan3060/ArknightsGameResource)、[fexli/ArknightsResource](https://github.com/fexli/ArknightsResource)、[isHarryh/Ark-Models](https://github.com/isHarryh/Ark-Models)、[ArknightsAssets/ArknightsAssets2](https://github.com/ArknightsAssets/ArknightsAssets2)；字体来自 [TimWangZi/The-font-of-Arknights](https://github.com/TimWangZi/The-font-of-Arknights) 与 Google Fonts（Noto Sans SC）。详见 [docs/ASSETS.md](docs/ASSETS.md)。
- 规则核对参考：[PRTS 明日方舟中文 Wiki](https://prts.wiki/)。
- LZ4AK 解包：`tools/local-extract/aklz4.py` 的算法来自 [isHarryh/Ark-Unpacker](https://github.com/isHarryh/Ark-Unpacker)（BSD-3-Clause，经 MooncellWiki/UnityPy）；解析 Unity 资源使用 [UnityPy](https://github.com/K0lb3/UnityPy)（MIT）。
- 库：[PixiJS](https://pixijs.com/)（MIT）、[pixi-spine](https://github.com/pixijs/spine)（MIT；其中包含的 Spine Runtime 另受 [Spine Runtimes License](https://esotericsoftware.com/spine-runtimes-license) 约束）、[three.js](https://threejs.org/)（MIT）、[Preact](https://preactjs.com/) + [htm](https://github.com/developit/htm)（MIT）、[ws](https://github.com/websockets/ws)（MIT）。

感谢以上项目的作者与维护者，以及鹰角网络带来的这款游戏。

## 贡献

欢迎提 Issue 反馈 bug、与官方规则不一致的地方或改进建议，也欢迎提交 Pull Request：

- 准备环境、运行测试、忠实原则和提交约定见 [CONTRIBUTING.md](CONTRIBUTING.md)。
- 提交前请运行 `node --test`，并同步更新相关文档；文档使用简体中文，代码与注释使用英文。
- 提交的代码将以 GPL-3.0-or-later 发布。
- 请不要提交任何游戏素材文件（`public/assets/` 等目录已被 `.gitignore` 排除）。
- 本项目坚持非商业：请不要提交广告、付费、打赏等任何形式的变现功能。

---

## English

An **unofficial, non-commercial fan remake** of Arknights' seasonal auto-chess tower-defense **mode *Stronghold Protocol: Alliance***, played in the browser. This fork — **Stronghold Protocol: Hunt Simulation** (`V0.0.1`, built on upstream 0.2.6) — keeps the 1–4 player co-op and makes **the hunt** its core gameplay. In a match, you build during the Rest Phase, then a **Hunting Phase** hands out prey: in **2V2 Hunt Simulation** the four seats form two duos (0/1 vs 2/3) that share one HP pool and place monsters into the opposing team's wave; in **Alliance Hunt** (1–4 player co-op) the server instead gives every living player their own share, with pairwise-distinct totals. Prey that leaks costs no target HP and breaks no perfect-clear; only kills pay.

- **The hunt loop:** deploy in the Rest Phase → place prey in the Hunting Phase → kill the opponent's monsters for **bounty** → withdraw bounty from the merchant **Cannot** at the round's rate → the **R13 Final Hunt** (50% ratio, up to 25 bounty, scaled by the kill ratio) → the **R14 Final Assault** → the **R15 Hidden Core**. When a Hunting Phase closes, both teams' lists — who placed what at whom, and the bounty — stay on screen for **5 seconds**.
- **Bounty is not gold.** Placement bounties are banked with Cannot (per player, kept across rounds). Withdrawal is the only way to turn them into gold: 20% through R8, 30% at R9, +5% per round from R10, 100% at R15; cost = gold ÷ rate, the first withdrawal of a round rounds up and later ones down, at most 4 gold per round (unlimited at R15). Official bounty cards still pay gold directly.
- **Three event periods per match** (the drawn start round, +4, and R13): each draws an ally entry — in 2V2, four targets (opponent A / opponent B / teammate / yourself, no target twice in a match) from 24 entries, with E1/E2/E3 odds of 15/45/40, 30/40/30 and 45/30/25 and double magnitude on yourself — plus one of 12 monster entries (35/40/25, 25/40/35, 20/35/45) and a 10–25% elite-attribute subset. Percentages use an event-only multiplicative bucket; flat aspd / SP values go onto the panel first.
- **Endgame by time:** the two duos share a boss battlefield in R14, each team fights its own leader, and the result is decided by the **4:5 time score** (R14 and R15 remaining-time shares) before shared HP. The R15 Hidden Core threshold is **> 600 layers per team** (2V2). Opponents stay hidden through R13 and are revealed from R14; spectators see everyone from round 1.
- **Also built in:** in-match text chat with **server-side banned-word filtering**, per-match logs on disk (7-day retention), a **server-wide notice banner**, a **damage / healing board** (healing credited to whoever granted it), a **teammate overview** (HP / level / deployed), **operator asset prefetch**, **quick match**, a **text-size setting**, and a **graphics auto-adjust** mode (2D/3D board + a character-model toggle, with GPU-based auto-downgrade).
- **Plugins (0.3.0+):** the server owner drops a plugin into `plugins/`; the host opens it for the room from the "原版 / 插件 ×N" panel, while cosmetic and UI plugins can also be enabled per player in Settings. Plugins come from the community or from the built-in studio at `/studio/`.
- **Run:** download the full bundle `…-v<version>.zip` (~800 MB, all the art inside, the Chinese, Japanese, English, Korean and own-language operator voices, the official battlefield scenes and the official battle effects included) from [Releases](../../releases/latest) — or the lite one, `…-v<version>-lite.zip` (~25 MB), which downloads the art (~720 MB) on its first start; the update bundle `…-v<version>-update.zip` holds only the files changed since the earlier releases: stop the server, extract it over an existing install and start again — install Node.js 22 or 24, then double-click `scripts\start-windows.bat` (Windows) or run `./scripts/start.sh` (macOS / Linux) and open <http://localhost:3000>. From source: `git clone https://github.com/T1113047/Stronghold-Protocol-Hunt-Simulation.git`, then `npm install && npm run setup && npm start` (setup downloads ~550 MB of art from public mirrors; the official 3D board and some HUD art come from a local Arknights client — without one the game uses the 2D board and look-alike stand-ins).
- **Languages:** Chinese (the default), English, 日本語, 한국어 and 繁體中文 — switch on the title screen or in Settings. Game texts come from the official clients; the Japanese, Korean and Traditional Chinese interface strings are machine translations (corrections welcome: [docs/I18N.md](docs/I18N.md)).
- **Play with friends:** create a room and share the 4-letter key or the `?room=KEY` link, or open the room to **quick match** so anyone can join a same-difficulty room in one click. On a LAN, use the address printed at start; otherwise use a virtual-LAN tool, a tunnel or a VPS — see [docs/DEPLOY.md](docs/DEPLOY.md).
- **Disclaimer:** not affiliated with or endorsed by Hypergryph or Yostar. All Arknights names, art, audio, text and data are © their respective owners and are **not** covered by this project's GPL licence. For study and personal non-commercial use only — no selling, paid distribution, paid servers or monetisation of any kind. Content will be removed on request of the rights holders. Provided "as is", without warranty.
- **License:** code GPL-3.0-or-later ([LICENSE](LICENSE)); game assets excluded.
- **Contributing:** [CONTRIBUTING.md](CONTRIBUTING.md) (an English summary at its end); the code map is [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
