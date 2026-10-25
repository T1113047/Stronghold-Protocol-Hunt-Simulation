# 卫戍协议：盟约 — Web Remake · Architecture & Contracts (DESIGN.md)

This is the **single source of truth** for every implementer. Research lives in `docs/research/` (start with `00-INDEX.md`; where a research file's body and its "Addendum (critic)" disagree, the addendum wins). When this document and research disagree, **this document wins**; when this document is silent, follow research; when both are silent, choose the simplest faithful behaviour and write it down in the module's header comment.

Language: player-facing text is **Simplified Chinese** by default, with an English switch since 0.2.0 (§25.2, docs/I18N.md: UI strings through `t('中文')`, game texts from the official Chinese data or the official EN client's). Code, comments and identifiers are English.

Versions: the first public release was **0.1.0** (2026-10-02, the state of §0–§20.15); the releases after it add the player feedback and GitHub reports — 0.1.1 §21, 0.1.2 §22, 0.1.3 §23, 0.1.4 §24 — and **0.2.0** (2026-10-07; `CHANGELOG.md`) the maintainability refactor, two languages, 补位, 自选编队 and their fidelity work — §25 — **0.2.1** (2026-10-07) the 联防 battlefield restored, full potential and the GitHub fixes after it — §26 — and **0.2.2** (2026-10-09) per-operator 潜能 / 练度, Japanese voices, the statistics page, 失衡, whole-frame attack timing and the GitHub fixes after 0.2.1 — §27. **0.2.3** (2026-10-10; `package.json`, `shared/constants.js APP_VERSION`) 克莱门莎 and new modules, community fixes, text size, per-operator voices, installation, the opening reroll and local match recovery — §28. **0.2.4** (2026-10-11) the official shared card pool and item stock, Raid revival and #475, and the community fixes after 0.2.3 — §29. **0.2.5** (2026-10-12) fixed gifts and already displayed operator offers under the shared stock, random boss pairing, the official battlefield scenes on the 3D board (optional local art: the full bundle includes them when extracted, a missing scene keeps the metal board; §15, §30.21), the official damage-number option, the 驭械术师 / hit-tile / bot ports and the community fixes after 0.2.4 — §30; its rules supersede the corresponding 0.2.4 ones. **0.2.6** (2026-10-13) the host-bandwidth layers 0 and 1 (no BGM download while the music is silent, WebSocket compression, content-hashed asset URLs with long caching, brotli, WebP guide pages), the official scene light gains, the impostor bounds, the deploy-animation replays, the optional ammo count and the community fixes after 0.2.5 — §31; its rules supersede the corresponding 0.2.5 ones. **0.3.0** (2026-10-14) the plugin system (插件) and the fixes after 0.2.6 — §32; **0.3.1** (2026-10-18) the Forge-pack additions, the studio templates and the fixes after 0.3.0 — §34, the state this document describes. The labels v1 / v2 / v2.1–v2.5.2 in §0, §14–§20 and in the BALANCE / SIM comparisons name the design generations and the private playtest builds that came before it; they are kept as history. **This fork** — 《卫戍协议：狩猎模拟》, its own build label `V0.0.5` on top of the 0.3.1 release (`FORK_VERSION` / `FORK_LABEL` / `FORK_NAME`, `shared/constants.js`) — adds the 2V2 狩猎模拟 mode (two teams of two, per-team HP pools and setup, the 狩猎期, per-team boss fights) and a set of client / server conveniences; §35 records them.

---

The 0.3.1 Forge integration/browser polish is [§34.27](history/0.3.1.md#3427-plugin-polish-after-the-end-to-end-checks):
companion cosmetic hints, accurate import reports, record DSL permission checks and usable result panels (§32.8/§32.12).

Studio presentation authoring extends §32.9 in [§34.30](history/0.3.1.md#3430-studio-templates-for-the-031-presentation-features): theme, notices, fx and skins forms reuse the existing validators, slots and trial routes.

Blemishine S2 attack clips extend §9 in [§34.31](history/0.3.1.md#3431-official-effects-and-a-skill-clip-the-maintainer-reported-after-030):
a verified mode mapping for 瑕光 S2 only, with or without the effects index; held skill loops and every other skill keep their roles.

The 0.3.1 sim investigation and rule correction are [§34.32](history/0.3.1.md#3432-瑕光-attacks-the-enemies-she-put-to-sleep-琳琅诗怀雅s-s3-keeps-its-coins):
瑕光 S2 retains sleeper targeting and attack replay events; 琳琅诗怀雅 S3 keeps double attacks and coins at the cap,
following the official mode's no-auto-close rule. Current contracts: [design/engine.md](design/engine.md).

## Where each section lives

Studio §32.9 gains five graphical gameplay templates and isolated Match exercises in
[§34.29](history/0.3.1.md#3429-studio-templates-for-the-031-gameplay-features); the current UI contract is in
[design/client.md](design/client.md#plugin-studio-gameplay-previews-3291).

Section numbers are global and never change: code, tests and the other documents cite them as "DESIGN §N". The
current rules by area are in `docs/design/`, the per-release revisions (the evidence behind each rule) in
`docs/history/`. When a revision changes a rule, the rule in `docs/design/` is rewritten too (the revision lists the
normative lines it rewrote).

Optional official art for plugin operators outside the roster is specified in [§34.28](history/0.3.1.md#3428-official-art-for-plugin-operators-outside-the-roster), updating §32.3's installation-manifest composition.
Its review fixes keep §32.3 permission classification on the original manifest while references use merged art;
discovery requires official-table membership, caps distinct operators, and full extraction uses explicit art consent.

Official tables for out-of-roster plugin operators are downloaded on demand during Forge import and setup's
startup/update gap preparation, per the maintainer's 2026-10-17 decision in
[§34.33](history/0.3.1.md#3433-official-tables-for-plugin-operators-outside-the-roster-downloaded-when-needed).
Offline checks and game runtime never fetch them; derived records and the plugin format are unchanged.

| sections | file | content |
|---|---|---|
| §0, §1, §2, §11, §12 | [design/overview.md](design/overview.md) | Scope, stack, repository layout, quality bar |
| §3, §4 | [design/geometry-time.md](design/geometry-time.md) | Coordinates, fields, geometry and time |
| §5, §7 | [design/engine.md](design/engine.md) | The battle engine (server/sim) and content modules |
| §6, §16 | [design/match.md](design/match.md) | The match and meta engine (server/match), operator loadouts |
| §8, §14 | [design/network.md](design/network.md) | The network protocol and client-side combat |
| §9, §10, §13, §15 | [design/client.md](design/client.md) | Rendering, UI, local-client art, the 3D board |
| §17 | [history/v2.2-playtest3.md](history/v2.2-playtest3.md) | User playtest #3 (v2.2) |
| §18 | [history/v2.3-playtest4.md](history/v2.3-playtest4.md) | User playtest #4 (v2.3) |
| §19 | [history/v2.4-playtest5.md](history/v2.4-playtest5.md) | User playtest #5 (v2.4) |
| §20 | [history/v2.5-playtest6.md](history/v2.5-playtest6.md) | User playtest #6 (v2.5) and its follow-ups, up to 0.1.0 |
| §21 | [history/0.1.1.md](history/0.1.1.md) | 0.1.1 — player feedback after 0.1.0 |
| §22 | [history/0.1.2.md](history/0.1.2.md) | 0.1.2 — GitHub issues after 0.1.1 |
| §23 | [history/0.1.3.md](history/0.1.3.md) | 0.1.3 — community reports after 0.1.2 |
| §24 | [history/0.1.4.md](history/0.1.4.md) | 0.1.4 — community reports after 0.1.3 |
| §25 | [history/0.2.0.md](history/0.2.0.md) | 0.2.0 |
| §26 | [history/0.2.1.md](history/0.2.1.md) | 0.2.1 — after the 0.2.0 release |
| §27 | [history/0.2.2.md](history/0.2.2.md) | 0.2.2 — after the 0.2.1 release (2026-10-09) |
| §28 | [history/0.2.3.md](history/0.2.3.md) | 0.2.3 — after the 0.2.2 release (2026-10-10) |
| §29 | [history/0.2.4.md](history/0.2.4.md) | 0.2.4 — after the 0.2.3 release (2026-10-11) |
| §30 | [history/0.2.5.md](history/0.2.5.md) | 0.2.5 — after the 0.2.4 release (2026-10-12) |
| §31 | [history/0.2.6.md](history/0.2.6.md) | 0.2.6 — after the 0.2.5 release (2026-10-13) |
| §32 | [history/0.3.0.md](history/0.3.0.md) | 0.3.0 — the plugin system (插件) and the fixes after 0.2.6 (2026-10-14) |
| §33 | [design/vfx-format.md](design/vfx-format.md) | Official battle effects (特效): the extracted format the runtime reads |
| §34 | [history/0.3.1.md](history/0.3.1.md) | 0.3.1 — released 2026-10-18, after the 0.3.0 release (2026-10-16): the effects audit's R18–R21, Forge import U1–U6, settings, Spine skill loops, lingering areas and standing effects under the official effects, 阻隔工事's client model (#663), the test console, 高台 placement in every language (#676), skill attack sounds by mode (#679), local-extract checks (#665), lossless scene maps and emission (#658), theme variables and announcements (§34.14), four plugin rule switches (§34.15), new gameplay records and official operators outside the roster (§34.16), a Forge panel compatibility layer (§34.17), plugin operator effects (§34.18), the 联防 billing of the escaped wave only (§34.19, #675), plugin interaction windows (§34.20, #682), the boss centre-column check warning (§34.21, #659), 凯瑟琳's 突变细胞 once per player per match (§34.22, #677), operator skins (§34.23, #685 / #686), exactly duplicated scene renderers dropped (§34.24, #684), attack / hit sounds by the official audio pools (§34.25, #680), custom operator traits (§34.26, #671), plugin polish after the end-to-end checks (§34.27), official art for plugin operators outside the roster (§34.28), studio templates for the gameplay features (§34.29), studio templates for the presentation features (§34.30), reported effects and 瑕光's skill clip (§34.31), 瑕光's sleepers and 琳琅诗怀雅's coins (§34.32), official tables when needed (§34.33), the split of the old UI PR #643 (§34.34) |
| §35 | [history/0.0.1.md](history/0.0.1.md) | 0.0.1（2V2 狩猎模拟）— 本 fork 首个公开测试版；V0.0.5 的规则修订记录见文末「V0.0.5 的规则修订」 |

## V0.0.5 的规则修订（本 fork，§35）

口径来源：**维护者 2026-10-24**（0.0.5 开发规格逐条拍板）。以下条目改写 DESIGN §35.2 / DESIGN §35.13 的规范行（`docs/history/0.0.1.md` 的相应小节与本记录不一致时，以本记录为准）；玩家口径见 `docs/PLAYING.md` §14.3 / §15，条目草稿见 `CHANGELOG.md` 的 V0.0.5。

- **事件期改为按「被选择次数」发包**（DESIGN §35.13）：取消三张次序概率表（E1 / E2 / E3 的减益 / 中性 / 增益概率作废，**三个事件期规则完全相同**）、「选自己幅度 ×2」（`EVENT_SELF_MUL` 删除，卡数值恒为基值）与「同一目标一局只能用一次」（同一目标可反复选）。每次事件每人选 1 个目标（20 秒，`g.event.pick { target }` 不变），随后按被选择的次数发包：被选为**对面**1 次收 1 个「**对面包**」（1 减益 + 2 中性）、被选为**我方**1 次收 1 个「**我方包**」（1 增益 + 2 中性）、被选中 N 次收 N 个包（对面 + 我方混合被选 = 两类包都收）、一次也没被选收 1 个「**默认包**」（3 中性，每人每事件保底）；包内卡片从 24 条词条的 kind 池（down 5 / mid 7 / up 12）抽取。重复规则（**维护者 2026-10-25 定为「真·全局限一份」**）：**整池 24 条用尽前绝不重复**——同类内优先取同类未用过的，同类用尽而整池仍有未用过的则跨类借一张（包的 3 条构成不变，只是那一条槽位换了类型），整池用尽后才回到原类内重复；已用池**全局限一份**（跨玩家、跨事件共享）。保留不变：词条持续 4 回合（`picked … picked+3`）与经济类 1 回合例外、怪物词条局内不重复且只改当回合波次、**赏金金额不重算**、词条对双方公开。`m.public.event` 增加「本次事件谁被选了几次、各收什么包」的公示数据；AI / 超时先按 `EVENT_AI_OPP_CHANCE`（60%）决定这一票打**对面**还是打**我方**（全打对面会让纯 bot / 全超时房只收减益包、增益池永不出现），再在同侧内优先选本轮尚未被选过的座位，全部被选过则落回自己，发包不打折。
- **怪物词条通道保留、概率统一**（DESIGN §35.13）：删除次序递进，统一为基准行 **foeOdds 25/40/35、强力属性 15%~20%**（原 E2 行）。
- **词条文案显式写作用对象**（DESIGN §35.13）：效果文案统一为「**目标玩家的干员**」（收到词条的玩家的干员）、「**目标玩家的敌人**」（他面对的敌人，如陷足）、「**双方战场的敌人**」（怪物词条与强力属性）；详情弹窗标注「归属：我方包 / 对面包 / 默认包」与「作用对象」。落点 `public/js/ui/entryDetail.js`（文案模板与标签）、`public/js/ui/eventOverlay.js`（名称表 / 面板）与 `public/i18n/` 四语言包。
- **鸭爵特殊怪**（事件期对应回合的战斗，§35.2 的狩猎投放之外新增）：R4 / R8 / R13 战斗中**每名玩家**的波次夹杂 **1 只**系统随机的鸭家族特殊怪（鸭爵 / 高普尼克 / 流泪小子 / 圆仔，`server/sim/content/bands/meta.js` 的 `ducks` 池，与策略「鸭爵」同一随机方式）。数值语义完全照鸭爵策略：击倒者 **+1 资金**（联防队友击杀也算）、漏进保护目标点 **−1 点目标生命值**（真实漏怪语义，照常破坏完美作战），**无额外调整**；与 boss 格、狩猎投放互不影响，2V2 与同盟狩猎都有。注入落点 `server/match/match/combat.js`（战斗组装处）；新模块按 0.0.5 分工落在 `server/match/match/duckSpawns.js`，击杀 / 漏过语义参考 `server/sim/content/bands/meta.js` 的 `duckReplace`。
- **猎手 AI（AI 狩猎模式，DESIGN §35.15）**：2V2 中 `botControlled` 座位的狩猎投放改为**回应被投放方已上场的阵容**——选打谁、选什么怪（特性↔短板反制性价比）、选上下门与插入时点（`front` 25 % / `back` 75 %）、仅最高强度档用事件期 boss 格。强度绑难度（FUNNY 关 / NORMAL 弱 / HARD 中 / ABYSS 强），旋钮是「从反制排名前 `width` 名里随机」。**只改选择不改资源**：同一 `confrontBudget()` / 同一 `confrontGroups()` 池 / 同一 `maxPicks` 与 `confrontBossCap()`，方案必须过真人 `g.confront` 的同一道 `_confrontMember` 校验，被拒则退回 0.0.4 的贪心填充；判读只取目标 board（手牌 / 商店 / 资金 / 坎诺特余额不在 `boardReadout` 签名里）。落点新模块 `server/match/match/aiHunter.js`（不写进 `bot.js`），数值集中在 `shared/constants.js` 的 `AI_HUNT`（全部 [ASSUMED]，待试玩定档），新种子流 `ai-hunt`。同批把 2V2 第一次建成 golden 家族（`tools/golden.mjs` 13 局 versus 场景 + `runMatch` 座位补齐 `team`）并把摘要的随机流计数补全 —— `versus-FUNNY-21/22` 逐字节不动即「FUNNY 不启用」的证明。
