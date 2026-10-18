// Result screen (research 06 §10.6): the ENDGAME settlement — victory / defeat, the highest round passed (up to the
// R15 隐秘核心), the squads' final shared HP and the leaders (最终攻势 / 隐秘核心), the 赏金 / 金币 statistics of
// 坎诺特 (2V2) and a card per player — band, final lineup with elite marks, stats, title (评语) with its icon — plus
// 返回同盟. Two layouts, from the payload: the 2V2 one (versus, two squads compared, per-member detail) and the
// solo / co-op one (a single squad).
//
// The screen is PHONE-LANDSCAPE FIRST: a header (verdict, highest round, leader medallions), then two columns
// (left = 队伍 / 排名 / 回合, right = 赏金与金币), then the per-player cards — every area scrolls inside itself and the
// screen itself never overflows. Text reads the text root `--t` (设置 →「文字大小」).
//
// The same view is the stats page's re-view of a stored match (screens/stats.js hands it the payload
// `recordToResult` rebuilt; `quiet`: no settlement jingle) and the 数据详情 under the settlement flow
// (screens/settle.js). `content`: the room's content (room.state.content, or a stats record's) — gameplay
// plugins mark the result unofficial (DESIGN §32.6). `slot`: the 结算 tab plugin slot (result.tab) — false
// where the page under it has one.
//
// Expected m.result (free-form in DESIGN §8.2; fields read tolerantly, see gameLogic.normalizeResult):
//   { victory, roundsPassed, lastRound?, hiddenReached?, hiddenCleared?, bossId?, hiddenBossId?, difficulty?, modeId?,
//     durationMs?, teamLp?, versus?: { winnerTeam, doubleLoss, timeTie?, timeWeights?: { r14, r15 },
//       teams: { [team]: { bossPct, score, lp, remainingTime, timeScore, timePct, time: { r14, r15 } } } },
//     players: [{ playerId, seat, name, isBot, alive, left, lp, bandId, team?, roundsPassed?,
//                 title: 'comment_1' | { id, name? } | null,
//                 bounty?: { earned /* 本局赏金收入 */, withdrawn /* 已取出金币 */, bank /* 剩余存款 */ },
//                 lineup: [{ id /* chessId, golden id if elite */, golden?, tier?, items?: [itemId],
//                            diy? /* 0.2.0 自选编队: a DIY slot's pick { charId, skillIndex, uniEquipId } — the card
//                                    draws the operator (gameLogic diyRecordFor) */,
//                            standInFor? /* 0.2.0 补位: the replaced operator's charId — the card draws the stand-in
//                                           with a small 「替补」 mark (gameLogic standInOf; the owner's recall, 2026-10-06) */ }],
//                 bonds?: [{ bondId, layers, active }],
//                 stats: { dmgDealt, kills, leaks, gold /* funds SPENT */, refreshes, merges, bossDamage?, itemsEquipped?,
//                          activatedLayers?, lpLost?, perfectRounds? } }] }
//
// The bounty figures come from PlayerState (server/match/results.js) in BOTH hunt modes — 2V2 and 同盟狩猎: `bounty.earned`
// = 本局赏金收入 (every 赏金 banked at 坎诺特 this match, PlayerState.bountyEarned), `bounty.withdrawn` = 已取出金币
// (PlayerState.withdrawnGold), `bounty.bank` = 剩余存款 (PlayerState.bountyBank). 赏金 ≠ 金币: only a prep withdrawal at
// 坎诺特 turns bounty into gold (ui/merchant.js). Solo has neither.
//
// The 2V2 verdict also shows the settlement's boss-time decision (user 2026-10-17): each squad's remaining countdown of
// the 最终攻势 (R14, weight 4) and the 隐秘核心 (R15, weight 5) as shares of their own limits decide first, then the
// shared LP, then the leader scoring — `versus.timeTie` says the time scores were equal. A squad's row shows
// `versus.teams[id].time = { r14, r15 }` (remain / limit), `timeScore` and `timePct`.

import { useEffect } from '../../vendor/hooks.module.js';
import { html, Button, Icon, MicroLabel, DifficultyTag } from '../ui/components.js';
import { useGameData, Img, UnitThumb, BandIcon, PlayerAvatar, BondGlyph, LpTower, Sprite, CoinGlyph } from '../ui/gameComponents.js';
import { normalizeResult, fmtNum, diyRecordFor, cardStandIn, standInForText } from '../ui/gameLogic.js';
import { data } from '../data.js';
import { enemyIconUrl, titleIconUrl, uiUrl } from '../ui/assetUrls.js';
import { audio } from '../audio.js';
import { sentText } from '../ui/lang.js';
import { store, useStore, emptyMatch } from '../store.js';
import { teamOfSeat } from '../../../shared/constants.js';
import { UnofficialMark } from '../ui/pluginTag.js';
import { TestMark } from '../ui/testConsole.js';
import { t, tParts, N_ } from '../../../shared/i18n.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const intOr = (v) => (Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : null);
const posIntOr = (v) => { const n = intOr(v); return n != null && n > 0 ? n : null; };
const sumOrNull = (xs) => {
  const ns = xs.filter((x) => typeof x === 'number' && Number.isFinite(x));
  return ns.length ? ns.reduce((a, b) => a + b, 0) : null;
};

// The first seven present are shown (+ remaining LP = a 4×2 grid); the title (评语) stats come first.
// `gold` is the funds a player SPENT (server/match/player/economy.js spend(); the 挥金如土 title stat).
const STAT_ROWS = [
  ['dmgDealt', N_('造成伤害')], ['kills', N_('击倒敌人')], ['bossDamage', N_('领袖伤害')], ['activatedLayers', N_('盟约层数')],
  ['merges', N_('晋升次数')], ['itemsEquipped', N_('配发装备')], ['gold', N_('消耗金币')], ['perfectRounds', N_('完美作战')],
  ['refreshes', N_('刷新次数')], ['leaks', N_('未击倒')], ['lpLost', N_('损失生命')],
];

/**
 * The bonds a result card lists (at most 6): the active ones and those holding layers, most layers first. A bond whose
 * layers the game never shows (bonds.json `noStack`: 调和 协防干员 独行 绝技 — PRTS 卫戍协议：盟约 下半/PRTS盟约记录 「部分盟约不会
 * 显示叠加层数，但是叠加层数的特质/策略/装备等效果仍然对其生效」) counts none for the order and carries no number
 * (`hideLayers`), as on the bond strip since 0.1.4 (PR #66) — the card printed them until 0.2.0 (community report
 * 「独行这种盟约是不能叠层的」).
 * @param {any[]} bonds m.result players[].bonds @param {(bondId: string) => any} bondRec bonds.json record lookup
 */
export function resultBonds(bonds, bondRec = () => null) {
  const list = (Array.isArray(bonds) ? bonds : []).filter((b) => b && typeof b.bondId === 'string')
    .map((b) => (bondRec(b.bondId)?.noStack ? { ...b, hideLayers: true } : b));
  const shown = (b) => (b.hideLayers ? 0 : b.layers || 0);
  return list.filter((b) => b.active || shown(b) > 0).sort((a, b) => shown(b) - shown(a)).slice(0, 6);
}

// ---- the endgame view model ---------------------------------------------------------------------------------------
// Pure helpers (unit-tested in test/ui/result-screen.test.js, no hooks): the frame, the round milestones, the squads,
// the 赏金 table and the ranking. The component below only lays them out.

/**
 * The endgame frame of one settlement: the mode's boss rounds, the highest round PASSED (capped at the last round of
 * the mode — R15 隐秘核心 where the mode has one), whether the payload carries the 2V2 per-squad scoring and whether
 * this mode runs the hunt economy (坎诺特 + 赏金): 2V2 AND 同盟狩猎, not solo. A backend `huntMode` / `merchant` flag
 * wins; otherwise a MULTI mode (`data/config.json` mode_multi_*) is a hunt.
 * @param {any} r normalized result (normalizeResult)
 * @param {any} [raw] the raw m.result payload (versus / team / huntMode / merchant)
 * @param {any} [modes] config.modes
 */
export function resultFrame(r, raw = null, modes = null) {
  const mode = isObj(modes) && r?.modeId ? modes[r.modeId] || null : null;
  const bossRound = posIntOr(mode?.bossRound) ?? posIntOr(r?.lastRound) ?? 14;
  const hiddenRound = posIntOr(mode?.hiddenRound);
  const versus = isObj(raw?.versus) ? raw.versus : null;
  const rows = [ ...(Array.isArray(r?.players) ? r.players : []), ...(Array.isArray(raw?.players) ? raw.players : []) ];
  const isVersus = !!versus || rows.some((p) => Number.isInteger(p?.team));
  const maxRound = hiddenRound ?? bossRound;
  const highest = Math.max(0, Math.min(intOr(r?.roundsPassed) ?? 0, maxRound));
  // the highest round actually PLAYED: the Hidden Core counts as reached even when it was not cleared (2V2 settles at
  // victory with roundsPassed = the boss round — the round was fought either way)
  const reached = Math.max(highest, r?.hiddenReached && hiddenRound ? hiddenRound : 0);
  // 坎诺特 / 赏金 exist in BOTH hunt modes (server/infra.js huntMode = isVersus || coopHuntOn): co-op hunts bank
  // bounty and withdraw it like 2V2 does. Prefer a backend flag when a newer payload sends one.
  const backendHunt = typeof raw?.huntMode === 'boolean' ? raw.huntMode
    : typeof raw?.merchant === 'boolean' ? raw.merchant : isObj(raw?.merchant) ? true : null;
  const huntMode = backendHunt != null ? backendHunt : (isVersus || mode?.type === 'MULTI');
  return { mode, bossRound, hiddenRound, maxRound, highest, reached, versus, isVersus, huntMode };
}

/**
 * The round milestones of the settlement, the 最高通过回合 made readable: the regular rounds (狩猎期 in 2V2), the
 * 最终攻势 and the 隐秘核心. state: 'done' (passed), 'now' (played but not passed) or 'off' (not reached).
 * @param {ReturnType<typeof resultFrame>} frame
 */
export function resultMilestones(frame) {
  const { highest, reached, bossRound, hiddenRound, isVersus } = frame;
  const out = [
    { key: 'regular', label: isVersus ? t('狩猎期') : t('常规回合'), rounds: `R1-R${Math.max(1, bossRound - 1)}`, from: 1, to: Math.max(1, bossRound - 1) },
    { key: 'boss', label: t('最终攻势'), rounds: `R${bossRound}`, from: bossRound, to: bossRound },
  ];
  if (hiddenRound != null) out.push({ key: 'hidden', label: t('隐秘核心'), rounds: `R${hiddenRound}`, from: hiddenRound, to: hiddenRound });
  return out.map((m) => ({ ...m, state: highest >= m.to ? 'done' : reached >= m.from ? 'now' : 'off' }));
}

/**
 * The leaders of the match and whether they were broken: 最终攻势 (always fought) and 隐秘核心 (only where the mode has
 * one). Solo / co-op read the match outcome; 2V2 reads the per-team scoring — the last leader fight's damage share of
 * a team that dealt 100 % means that leader fell (`versus.teams`, server/match/match/bossRounds.js _versusDecide).
 * @param {ReturnType<typeof resultFrame>} frame @param {any} r normalized result
 */
export function resultBosses(frame, r) {
  const teams = isObj(frame.versus?.teams) ? Object.values(frame.versus.teams) : [];
  const anyCleared = teams.some((x) => isObj(x) && Number.isFinite(x.bossPct) && x.bossPct >= 1);
  const bossCleared = frame.isVersus ? (!!r.hiddenReached || anyCleared) : !!r.victory;
  const hiddenCleared = frame.isVersus ? (!!r.hiddenReached && anyCleared) : !!r.hiddenCleared;
  const out = [{ key: 'boss', round: frame.bossRound, id: r.bossId ?? null, label: t('最终攻势'), cleared: bossCleared, reached: true }];
  if (frame.hiddenRound != null) {
    out.push({ key: 'hidden', round: frame.hiddenRound, id: r.hiddenBossId ?? null, label: t('隐秘核心'), cleared: hiddenCleared, reached: !!r.hiddenReached });
  }
  return out;
}

/**
 * One row per SQUAD: 2V2 → the two teams (per-team scoring: shared LP, leader damage, win), solo / co-op → the single
 * team. `win` is null on a 2V2 draw / double loss.
 * @param {ReturnType<typeof resultFrame>} frame @param {any} r normalized result @param {any[]} players enriched rows
 */
export function resultTeams(frame, r, players) {
  const teamOf = (p) => (Number.isInteger(p.team) ? p.team : (frame.isVersus ? teamOfSeat(p.seat) : null));
  const alive = (ms) => ms.filter((p) => p.alive !== false).length;
  if (!frame.isVersus) {
    const lp = Number.isFinite(r.teamLp) ? Math.max(0, Math.trunc(r.teamLp)) : players.reduce((n, p) => n + Math.max(0, Number(p.lp) || 0), 0);
    return [{
      id: null, isVersus: false, name: /_single_/.test(String(r.modeId || '')) ? t('独立狩猎') : t('同盟'),
      members: players, lp, bossPct: null, win: !!r.victory, alive: alive(players),
      time: null, timeScore: null, timePct: null,
    }];
  }
  const scoring = isObj(frame.versus?.teams) ? frame.versus.teams : {};
  const winner = Number.isInteger(frame.versus?.winnerTeam) ? frame.versus.winnerTeam : null;
  const ids = [...new Set(players.map(teamOf))].filter((x) => x != null).sort((a, b) => a - b);
  const teams = ids.map((id) => {
    const members = players.filter((p) => teamOf(p) === id);
    const sc = isObj(scoring[id]) ? scoring[id] : null;
    const lp = sc && Number.isFinite(sc.lp) ? Math.max(0, Math.trunc(sc.lp)) : members.reduce((n, p) => n + Math.max(0, Number(p.lp) || 0), 0);
    return {
      id, isVersus: true, name: t('第 {n} 小队', { n: id + 1 }), members, lp,
      bossPct: sc && Number.isFinite(sc.bossPct) ? sc.bossPct : null,
      win: winner == null ? null : winner === id,
      alive: alive(members),
      // the 4:5 boss-time scoring of the settlement (server/match/match/bossRounds.js _versusDecide): R14 / R15
      // remainders, the weighted score and its share — a record that never stored them simply has none
      time: sc && isObj(sc.time) ? sc.time : null,
      timeScore: sc && Number.isFinite(sc.timeScore) ? sc.timeScore : null,
      timePct: sc && Number.isFinite(sc.timePct) ? sc.timePct : null,
    };
  });
  // the winning / higher-time squad first (the settlement's own order); a tie keeps the team id order
  return teams.sort((a, b) => ((b.timeScore ?? 0) - (a.timeScore ?? 0)) || (b.lp - a.lp)
    || (a.win === b.win ? 0 : a.win ? -1 : 1) || (a.id - b.id));
}

/**
 * The 赏金 / 金币 table: one row per member (本局赏金收入 / 已取出金币 / 剩余存款); 2V2 adds one total row per squad,
 * 同盟狩猎 one total row for the single squad. Only solo has no 坎诺特 and no 赏金 (`huntMode: false`, the panel shows
 * 消耗金币 instead).
 * @param {any[]} players enriched rows @param {ReturnType<typeof resultFrame>} frame
 */
export function resultBounty(players, frame) {
  const teamOf = (p) => (Number.isInteger(p.team) ? p.team : (frame.isVersus ? teamOfSeat(p.seat) : null));
  const rows = players.map((p) => {
    const b = isObj(p.bounty) ? p.bounty : null;
    return {
      playerId: p.playerId, name: p.name, team: teamOf(p),
      earned: b?.earned ?? null, withdrawn: b?.withdrawn ?? null, bank: b?.bank ?? null,
      spent: Number.isFinite(p.stats?.gold) ? p.stats.gold : null,
    };
  });
  if (!frame.huntMode) return { merchant: false, rows, totals: [] };
  // 同盟狩猎: one team, so one total row (team: null — the BountyPanel's filter then keeps every member)
  if (!frame.isVersus) {
    return {
      merchant: true, rows,
      totals: [{
        team: null, name: t('同盟'),
        earned: sumOrNull(rows.map((m) => m.earned)), withdrawn: sumOrNull(rows.map((m) => m.withdrawn)), bank: sumOrNull(rows.map((m) => m.bank)),
      }],
    };
  }
  const ids = [...new Set(rows.map((x) => x.team))].filter((x) => x != null).sort((a, b) => a - b);
  const totals = ids.map((id) => {
    const ms = rows.filter((x) => x.team === id);
    return {
      team: id, name: t('第 {n} 小队', { n: id + 1 }),
      earned: sumOrNull(ms.map((m) => m.earned)), withdrawn: sumOrNull(ms.map((m) => m.withdrawn)), bank: sumOrNull(ms.map((m) => m.bank)),
    };
  });
  return { merchant: true, rows, totals };
}

/**
 * The ranking of the settlement: most rounds passed first, then damage dealt, then seat. Carries each player's 评语.
 * 2V2: `teams` (resultTeams' settlement order — the 4:5 time score first) puts the winning squad's members above the
 * other squad's.
 * @param {any[]} players enriched rows @param {any[]} titles localized config.titles @param {any[]|null} [teams]
 */
export function resultRanking(players, titles = [], teams = null) {
  const order = new Map((Array.isArray(teams) ? teams : []).map((x, i) => [x.id, i]));
  const rankOf = (p) => (order.has(p.team) ? order.get(p.team) : 99);
  const sorted = players.slice().sort((a, b) => (rankOf(a) - rankOf(b))
    || (Number(b.roundsPassed) || 0) - (Number(a.roundsPassed) || 0)
    || (Number(b.stats?.dmgDealt) || 0) - (Number(a.stats?.dmgDealt) || 0) || (a.seat - b.seat));
  return sorted.map((p, i) => ({
    rank: i + 1, playerId: p.playerId, name: p.name, team: Number.isInteger(p.team) ? p.team : null,
    rounds: Number(p.roundsPassed) || 0, titleName: resultTitleName(p, titles), alive: p.alive !== false,
  }));
}

/** The 评语 (title) a player earned, in the current language (server text → the localized config.titles record). */
export function resultTitleName(p, titles = []) {
  if (!p?.title) return null;
  const rec = titles.find((x) => x && x.id === p.title.id) || null;
  const raw = (data.getRaw('config')?.titles || []).find((x) => x && x.id === p.title.id) || null;
  return sentText(p.title.name, raw?.name, rec?.name) || rec?.name || null;
}

/**
 * The verdict of the settlement: for 2V2 the winning squad (or 平局 / 双方失利), for solo / co-op 模拟完成 / 模拟失败.
 * `mine`: whether the LOCAL player's squad won (null when unknown / no winner). `timeVerdict`: the 4:5 boss-time
 * outcome the settlement names (null outside 2V2 / on a double loss).
 * @param {ReturnType<typeof resultFrame>} frame @param {any} r normalized result @param {number|null} myTeam
 */
export function resultVerdict(frame, r, myTeam = null) {
  if (!frame.isVersus) {
    return {
      headline: r.victory ? t('模拟完成') : t('模拟失败'),
      sub: r.victory ? t('成功卫戍 · 敌方领袖已被击败') : t('防线已被突破'),
      tone: r.victory ? 'win' : 'lose', mine: null, timeTie: false, timeVerdict: null,
    };
  }
  const winner = Number.isInteger(frame.versus?.winnerTeam) ? frame.versus.winnerTeam : null;
  const doubleLoss = !!frame.versus?.doubleLoss;
  const timeTie = !!frame.versus?.timeTie;
  // the weight line only exists when R15 was actually played (标准 2V2 = FUNNY has R14 only: hiddenRound null)
  const weights = isObj(frame.versus?.timeWeights) ? frame.versus.timeWeights : null;
  const hasR15 = weights ? Number.isFinite(Number(weights.r15)) : frame.hiddenRound != null;
  // a time tie is decided by the shared LP; when that ties too, by the last leader fight's damage share
  const lps = isObj(frame.versus?.teams) ? Object.values(frame.versus.teams).map((x) => Number(x?.lp)).filter(Number.isFinite) : [];
  const lpTie = timeTie && lps.length >= 2 && lps.every((v) => v === lps[0]);
  const tieText = lpTie ? t('时间同分、生命持平，按领袖伤害判定') : t('时间同分，按共享生命判定');
  const headline = winner != null ? t('第 {n} 小队获胜', { n: winner + 1 }) : doubleLoss ? t('双方失利') : t('双方战平');
  const mine = Number.isInteger(myTeam) ? (winner == null ? null : winner === myTeam) : null;
  const sub = mine == null
    ? (timeTie ? tieText
      : hasR15 ? t('两队各自迎战领袖，先比较 R14 与 R15 剩余时间（4:5），再比共享生命')
        : t('两队各自迎战领袖，先比较 R14 剩余时间，再比共享生命'))
    : (mine ? t('你的小队获胜') : t('你的小队落败'));
  const timeVerdict = doubleLoss ? null
    : timeTie ? tieText
      : winner != null ? t('第 {n} 小队胜（时间）', { n: winner + 1 }) : t('时间同分');
  return { headline, sub, tone: mine === false ? 'lose' : 'win', mine, timeTie, timeVerdict };
}

/**
 * One unit of a final lineup: a 自选 piece draws its operator; a 补位 piece (`standInFor`) its stand-in, with the small
 * 「替补」 mark — the title names the chess it fielded for.
 */
export function LineupThumb({ u, gd }) {
  const chess = u.kind === 'token' ? null : gd.chess(u.id);
  const dr = u.diy && chess ? diyRecordFor(chess, u.diy, { chess: data.get('chess'), backups: data.get('backups') }) : null;
  const si = !dr && chess ? cardStandIn(chess, { unit: u, backups: gd.backups }) : null;
  return html`<${UnitThumb} kind=${u.kind === 'token' ? 'token' : 'chess'} id=${u.id} golden=${!!u.golden} tier=${u.tier} size="sm" rec=${dr || si}
    title=${si ? t('{name}（{note}）', { name: si.name, note: standInForText(chess.name) }) : undefined} />`;
}

function PlayerCard({ p, myId, titles, best, solo = false }) {
  const gd = useGameData();
  const titleRec = p.title ? titles.find((x) => x.id === p.title.id) || null : null;
  const titleName = resultTitleName(p, titles);
  const stats = STAT_ROWS.filter(([k]) => Number.isFinite(p.stats[k])).slice(0, 7);
  const band = p.bandId ? gd.band(p.bandId) : null;
  const lineup = p.lineup.slice(0, 10);
  const bonds = resultBonds(p.bonds, (id) => gd.bond(id));
  return html`<article class=${cx('rcard', p.playerId === myId && 'is-self', p.alive === false && 'is-dead')} data-testid="result-player-card">
    <header class="rcard__head">
      <${PlayerAvatar} player=${p} self=${p.playerId === myId} />
      <div class="rcard__who">
        <b class="rcard__name">${p.name}${p.isBot ? html`<span class="rcard__ai">AI</span>` : null}${p.playerId === myId ? html`<span class="rcard__you">${t('你')}</span>` : null}</b>
        <span class="rcard__band">${band ? html`<${BandIcon} bandId=${band.bandId} size="xs" />${band.name}` : '—'}</span>
      </div>
      <div class="rcard__mid">
        <div class="rcard__lineup">
          ${lineup.length ? lineup.map((u, i) => html`<${LineupThumb} key=${i} u=${u} gd=${gd} />`)
            : html`<span class="rcard__noinfo">${p.alive === false ? t('阵容已撤离') : 'NO INFO'}</span>`}
        </div>
        ${bonds.length ? html`<div class="rcard__bonds">${bonds.map((b) => html`<span key=${b.bondId} class=${cx('rbond', b.active && 'is-on')} title=${gd.bond(b.bondId)?.name || b.bondId}>
          <${BondGlyph} bondId=${b.bondId} />${b.hideLayers ? null : html`<b class="num">${b.layers ?? 0}</b>`}</span>`)}</div>` : null}
      </div>
      <div class="rcard__round"><${MicroLabel}>ROUNDS</${MicroLabel}><b class="num">${p.roundsPassed}</b>
        ${p.trophies > 0 || p.reward > 0 ? html`<span class="rcard__gain">${p.trophies > 0 ? html`<span title=${t('获得奖杯')}><${Icon} name="crown" /><b class="num">+${p.trophies}</b></span>` : null}${p.reward > 0 ? html`<span title=${t('卫戍认证')}><${Icon} name="shield" /><b class="num">+${p.reward}</b></span>` : null}</span>` : null}
      </div>
      ${titleName ? html`<div class="rcard__title" title=${titleRec?.text || p.title?.text || ''}>
        <${Img} src=${titleIconUrl(gd.m, titleRec?.picId || p.title?.picId || String(p.title.id || '').replace('comment_', 'comment_icon_'))} class="rcard__ticon" fallback=${html`<${Icon} name="crown" />`} />
        <span><${MicroLabel} tone="gold">${t('评语')}</${MicroLabel}><b>${titleName}</b></span>
      </div>` : html`<span class="rcard__title rcard__title--none" aria-hidden="true"></span>`}
    </header>
    <div class="rcard__stats">
      ${stats.map(([k, label]) => html`<div key=${k} class=${cx('rstat', best[k] === p.playerId && 'is-best')}><span>${t(label)}</span><b class="num">${fmtNum(p.stats[k])}</b></div>`)}
      ${Number.isFinite(p.lp) ? html`<div class="rstat" title=${p.lpShared && !solo ? t('最终攻势起全队共享目标生命值') : ''}><span>${p.lpShared && !solo ? t('同盟剩余生命') : t('剩余生命')}</span><${LpTower} value=${p.lp} size="sm" /></div>` : null}
    </div>
  </article>`;
}

/** One squad of the settlement: the shared LP, the highest round passed, the leaders it fought and its members. */
function SquadCard({ team, frame, bosses, myTeam, note }) {
  const highest = Math.min(team.members.reduce((n, p) => Math.max(n, Number(p.roundsPassed) || 0), 0), frame.maxRound);
  // 2V2: each squad fights its own leader — the Hidden Core's state is that squad's own last fight
  const clearedOf = (b) => (b.key === 'hidden' && team.isVersus
    ? b.reached && team.bossPct != null && team.bossPct >= 1
    : b.cleared);
  return html`<article class=${cx('squad', team.isVersus && `is-t${team.id}`, team.win === true && 'is-win', team.win === false && 'is-lose')}
      data-testid=${`result-team-${team.isVersus ? team.id : 'all'}`}>
    <header class="squad__head">
      <b class="squad__name">${team.name}</b>
      <span class=${cx('squad__verdict', team.win === true ? 'is-win' : team.win === false ? 'is-lose' : 'is-draw')} data-testid="result-team-verdict">
        ${team.isVersus ? (team.win == null ? t('平局') : team.win ? t('胜') : t('负')) : (team.win ? t('胜') : t('负'))}
      </span>
      ${myTeam != null && myTeam === team.id ? html`<span class="squad__you">${t('你')}</span>` : null}
      <span class="squad__alive num">${t('存活 {n}/{total}', { n: team.alive, total: team.members.length })}</span>
    </header>
    <div class="squad__row" data-testid="result-team-lp">
      <span class="squad__label">${team.isVersus ? t('最终共享生命') : t('同盟剩余生命')}</span>
      <${LpTower} value=${team.lp} size="sm" />
    </div>
    <div class="squad__row" data-testid="result-team-rounds">
      <span class="squad__label">${t('最高通过回合')}</span>
      <b class="num">${highest}<em>/${frame.maxRound}</em></b>
    </div>
    ${team.bossPct != null ? html`<div class="squad__row" data-testid="result-team-boss">
      <span class="squad__label">${t('最近领袖战')} <em class="num">R${latestBossRound(frame)}</em></span>
      <b class="num">${Math.round(team.bossPct * 100)}%</b>
    </div>` : null}
    ${bosses.map((b) => html`<div key=${b.key} class=${cx('squad__row', clearedOf(b) && 'is-done')} data-testid=${b.key === 'hidden' ? 'result-boss-hidden' : 'result-boss'}>
      <span class="squad__label">${b.label} <em class="num">R${b.round}</em></span>
      <span class="squad__state">${clearedOf(b) ? t('已击破') : b.reached ? t('未击破') : t('未到达')}</span>
    </div>`)}
    ${team.timeScore != null ? html`<div class="squad__times" data-testid="result-team-time">
      <div class="squad__row"><span class="squad__label">${t('时间占比')}</span><b class="num">${team.timePct == null ? '—' : `${Math.round(team.timePct)}%`}</b></div>
      ${team.time?.r14 ? html`<div class="squad__row" data-testid="result-time-r14">
        <span class="squad__label">${t('剩余时间')} <em>R${frame.bossRound}</em></span>
        <b class="num">${Math.round(team.time.r14.remain)}<em>/${Math.round(team.time.r14.limit)}</em></b>
      </div>` : null}
      ${team.time?.r15 ? html`<div class="squad__row" data-testid="result-time-r15">
        <span class="squad__label">${t('剩余时间')} <em>R${frame.hiddenRound}</em></span>
        <b class="num">${Math.round(team.time.r15.remain)}<em>/${Math.round(team.time.r15.limit)}</em></b>
      </div>` : null}
    </div>` : null}
    ${note ? html`<p class="squad__note">${note}</p>` : null}
  </article>`;
}

/** The round of the leader fight `versus.teams` scored: the 隐秘核心 once it was reached, the 最终攻势 otherwise. */
const latestBossRound = (frame) => (frame.hiddenRound != null && frame.reached >= frame.hiddenRound ? frame.hiddenRound : frame.bossRound);

/** The 赏金 / 金币 statistics: one row per member and a total per squad (2V2) or for the one co-op squad; 消耗金币 in solo. */
function BountyPanel({ players, frame }) {
  const bounty = resultBounty(players, frame);
  const cell = (v) => (Number.isFinite(v) ? fmtNum(v) : '—');
  if (!bounty.merchant) {
    return html`<div class="result__bounty" data-testid="result-gold">
      <div class="bbody">
        <div class="brow brow--head" aria-hidden="true"><span>${t('成员')}</span><span>${t('消耗金币')}</span></div>
        ${bounty.rows.map((x) => html`<div key=${x.playerId} class="brow brow--gold" data-testid="result-gold-row">
          <span class="brow__name" title=${x.name}>${x.name}</span><b class="num">${cell(x.spent)}</b>
        </div>`)}
      </div>
      <p class="result__note">${t('本模式没有赏金与商人。')}</p>
    </div>`;
  }
  const body = [];
  for (const tt of bounty.totals) {
    const key = tt.team == null ? 'all' : tt.team;
    body.push(html`<div key=${`t${key}`} class="brow brow--team" data-testid=${`result-bounty-team-${key}`}>
      <span class="brow__name">${tt.name}<em>${t('小队合计')}</em></span>
      <b class="num">${cell(tt.earned)}</b><b class="num">${cell(tt.withdrawn)}</b><b class="num">${cell(tt.bank)}</b>
    </div>`);
    for (const x of bounty.rows.filter((row) => tt.team == null || row.team === tt.team)) {
      body.push(html`<div key=${x.playerId} class="brow" data-testid="result-bounty-row">
        <span class="brow__name" title=${x.name}>${x.name}</span>
        <b class="num">${cell(x.earned)}</b><b class="num">${cell(x.withdrawn)}</b><b class="num">${cell(x.bank)}</b>
      </div>`);
    }
  }
  return html`<div class="result__bounty" data-testid="result-bounty">
    <div class="bbody">
      <div class="brow brow--head" aria-hidden="true">
        <span>${t('成员')}</span><span>${t('本局赏金收入')}</span><span>${t('已取出金币')}</span><span>${t('剩余存款')}</span>
      </div>
      ${body}
    </div>
    <p class="result__note"><${CoinGlyph} />${frame.isVersus
      ? t('击杀对面投放的怪才能获得赏金，且只能在坎诺特处换成金币。')
      : t('击杀狩猎期的投放怪才能获得赏金，且只能在坎诺特处换成金币。')}</p>
  </div>`;
}

/** RESULT screen of the match on screen: reads the store; 返回同盟 / 返回大厅 drops the match. */
export function ResultScreen() {
  const res = useStore((s) => s.match.result);
  const pub = useStore((s) => s.match.public);
  const myId = useStore((s) => s.me.playerId);
  const hasRoom = useStore((s) => !!s.room);
  const back = () => store.set({ match: emptyMatch() });
  return html`<${ResultView} res=${res} pub=${pub} myId=${myId} backLabel=${hasRoom ? t('返回同盟') : t('返回大厅')} onBack=${back} />`;
}

/**
 * The settlement view of one m.result payload — the live flow's 数据详情 (screens/settle.js), and the stats page's
 * re-view of a stored match (screens/stats.js, which hands it the payload recordToResult rebuilt; `quiet`: no settlement
 * jingle). `content`: the room's content (room.state.content, or a stats record's) — gameplay plugins mark the result
 * unofficial (DESIGN §32.6). `slot`: the 结算 tab plugin slot (result.tab) — false where the page under it has one.
 * @param {{ res: any, pub?: any, myId?: string|null, backLabel: string, onBack: () => void, quiet?: boolean, content?: any, slot?: boolean }} props
 */
export function ResultView({ res, pub = null, myId = null, backLabel, onBack, quiet = false, content = null, slot = true }) {
  const gd = useGameData();
  const r = normalizeResult(res, pub);
  const raw = isObj(res) ? res : {};
  const titles = Array.isArray(gd.config?.titles) ? gd.config.titles : [];
  const frame = resultFrame(r, raw, gd.config?.modes || null);
  const rawRows = Array.isArray(raw.players) ? raw.players.filter(isObj) : [];
  // normalizeResult drops 2V2 detail (team, the 坎诺特 counters): read it back from the raw rows, tolerantly.
  const players = r.players.map((p) => {
    const row = rawRows.find((x) => x.playerId === p.playerId) || {};
    const b = isObj(row.bounty) ? row.bounty : null;
    const hasBounty = !!b || [row.bountyEarned, row.bountyBank, row.withdrawnGold].some((v) => Number.isFinite(intOr(v)));
    const bounty = hasBounty
      ? { earned: intOr(b?.earned ?? row.bountyEarned), withdrawn: intOr(b?.withdrawn ?? row.withdrawnGold), bank: intOr(b?.bank ?? row.bountyBank) }
      : null;
    const ownLp = Number.isFinite(intOr(row.lp)) ? Math.max(0, intOr(row.lp)) : p.lp;
    return {
      ...p,
      team: Number.isInteger(row.team) ? row.team : (frame.isVersus ? teamOfSeat(p.seat) : null),
      bounty,
      // 2V2: a member's LP is its split of the squad pool — the pool itself shows on the squad card (normalizeResult
      // gives every member the whole scalar teamLp, which is the sum of BOTH squads)
      lp: frame.isVersus ? ownLp : p.lp,
      lpShared: frame.isVersus ? false : p.lpShared,
    };
  });
  const myTeam = players.find((p) => p.playerId === myId)?.team ?? null;
  const verdict = resultVerdict(frame, r, Number.isInteger(myTeam) ? myTeam : null);
  const teams = resultTeams(frame, r, players);
  const bosses = resultBosses(frame, r);
  const milestones = resultMilestones(frame);
  const ranking = resultRanking(players, titles, teams);
  // the 4:5 weights the server decided with (R14 : R15), for the settlement's time line. 标准 2V2 (FUNNY) has no R15,
  // so it shows no weight at all (a lone "4" would claim a two-round rule the mode never played).
  const weights = isObj(frame.versus?.timeWeights) ? frame.versus.timeWeights : null;
  const weightLabel = weights && Number.isFinite(Number(weights.r15))
    ? [weights.r14, weights.r15].filter((v) => Number.isFinite(Number(v))).join(' : ')
    : null;

  const best = {};
  for (const [k] of STAT_ROWS) {
    let top = null;
    for (const p of r.players) if (Number.isFinite(p.stats[k]) && p.stats[k] > 0 && (top == null || p.stats[k] > top.v)) top = { v: p.stats[k], id: p.playerId };
    if (top && r.players.length > 1) best[k] = top.id;
  }
  useEffect(() => { if (!quiet) audio.sfx(verdict.tone === 'lose' ? 'settlementFail' : 'settlementSucceed'); }, []);

  // the Hidden Core medal (and its corrupted leader) only once R15 was actually fought
  const hidden = r.hiddenBossId && frame.hiddenRound != null && r.hiddenReached ? gd.boss(r.hiddenBossId) : null;
  const bossRec = r.bossId ? gd.boss(r.bossId) : null;
  const bg = uiUrl(gd.m, verdict.tone === 'lose' ? 'settle/settlemen_teamshow_fail' : 'settle/settlemen_teamshow_success');
  const mins = r.durationMs ? Math.round(r.durationMs / 60000) : null;

  return html`<div class=${cx('screen', 'result', verdict.tone === 'lose' ? 'is-lose' : 'is-win')} data-testid="result-screen">
    <div class="result__bg" aria-hidden="true" style=${bg ? `--result-bg:url("${bg}")` : undefined}></div>
    <div class="result__grid" aria-hidden="true"></div>
    <main class="result__main">
      <header class="result__hero" data-testid="result-hero">
        <div class="result__brand">
          <div class="result__logo"><${Sprite} k="entry/season_logo_settle" class="result__logoimg" fallback=${html`<${MicroLabel} tone="mint">STRONGHOLD PROTOCOL</${MicroLabel}>`} /></div>
          ${r.difficulty ? html`<${DifficultyTag} difficulty=${r.difficulty} size="lg" />` : null}
          <${UnofficialMark} room=${content ? { content } : null} class="result__modmark" />
        </div>
        <div class="result__verdict">
          <h1 class="result__headline" data-testid="result-headline">${verdict.headline}</h1>
          ${res?.test === true ? html`<p class="result__test" data-testid="result-test"><${TestMark} /> ${t('测试对局')}${Number.isInteger(res.testActions) ? html` · ${t('测试指令 {n} 次', { n: res.testActions })}` : null}</p>
            <p class="t-dim">${t('本局为测试对局，不计入统计、成就、称号、徽章与卫戍认证。')}</p>` : null}
          <p class="result__sub" data-testid="result-verdict-sub">${verdict.sub}</p>
        </div>
        <div class="result__rounds" data-testid="result-rounds">
          <span class="result__rlabel">${t('最高通过回合')}</span>
          <b class="result__rnum num" data-testid="result-rounds-value">${frame.highest}</b>
          <span class="result__rof num">/R${frame.maxRound}</span>
        </div>
        <div class="result__milestones" data-testid="result-milestones">
          ${milestones.map((m) => html`<span key=${m.key} class=${cx('mile', `is-${m.state}`)} data-testid=${`result-milestone-${m.key}`} data-state=${m.state}>
            <b>${m.label}</b><em class="num">${m.rounds}</em>
          </span>`)}
        </div>
        <div class="result__medals">
          ${bossRec ? html`<div class=${cx('medal', bosses[0]?.cleared && 'is-done')} title=${bossRec.name}>
            <${Img} src=${enemyIconUrl(gd.m, bossRec.enemyKey)} /><span class="medal__check">${bosses[0]?.cleared ? html`<${Icon} name="check" />` : html`<${Icon} name="close" />`}</span>
            <span class="medal__label">${t('敌方领袖')}</span></div>` : null}
          ${hidden ? html`<div class=${cx('medal', 'medal--hidden', bosses.find((b) => b.key === 'hidden')?.cleared && 'is-done')} title=${hidden.name}>
            <${Img} src=${enemyIconUrl(gd.m, hidden.enemyKey)} /><span class="medal__check">${bosses.find((b) => b.key === 'hidden')?.cleared ? html`<${Icon} name="check" />` : html`<${Icon} name="close" />`}</span>
            <span class="medal__label">${t('隐秘核心')}</span></div>` : null}
          ${mins ? html`<p class="result__time t-lo">${tParts('本局耗时 {n} 分钟', { n: html`<b class="num">${mins}</b>`, mins })}</p>` : null}
        </div>
      </header>
      <div class="result__cols">
        <section class="result__col result__col--left" data-testid="result-left">
          <h2 class="result__h"><span>${t('战果 · 队伍与回合')}</span><${MicroLabel}>SQUADS · ROUNDS</${MicroLabel}></h2>
          <div class="result__squads">
            ${teams.map((tm, i) => html`<${SquadCard} key=${tm.id ?? i} team=${tm} frame=${frame} bosses=${bosses}
              myTeam=${Number.isInteger(myTeam) ? myTeam : null} note=${tm.isVersus ? null : verdict.sub} />`)}
          </div>
          ${verdict.timeVerdict ? html`<div class=${cx('result__timedec', verdict.timeTie && 'is-tie')} data-testid="result-time">
            <span class="result__timedec-label">${t('时间判定')}${weightLabel ? html` <em>${weightLabel}</em>` : null}</span>
            <b class="result__timedec-verdict" data-testid="result-time-verdict">${verdict.timeVerdict}</b>
          </div>` : null}
          <h2 class="result__h result__h--sub"><span>${t('排名')}</span><${MicroLabel}>RANKING</${MicroLabel}></h2>
          <ol class="result__ranking" data-testid="result-ranking">
            ${ranking.map((x) => html`<li key=${x.playerId} class=${cx('rank', x.team != null && `is-t${x.team}`, x.playerId === myId && 'is-self', !x.alive && 'is-dead')} data-testid="result-rank-row">
              <span class="rank__no num">${x.rank}</span>
              <span class="rank__name" title=${x.name}>${x.name}</span>
              <span class="rank__rounds num">${x.rounds}</span>
              ${x.titleName ? html`<span class="rank__title"><${Icon} name="crown" />${x.titleName}</span>` : null}
            </li>`)}
          </ol>
        </section>
        <section class="result__col result__col--right" data-testid="result-right">
          <h2 class="result__h"><span>${t('赏金与金币')}</span><${MicroLabel}>BOUNTY · GOLD</${MicroLabel}></h2>
          <${BountyPanel} players=${players} frame=${frame} />
        </section>
      </div>
      <section class="result__players" data-testid="result-players">
        <h2 class="result__h result__h--sub"><span>${t('同盟成员')}</span><${MicroLabel}>ALLIANCE REPORT</${MicroLabel}></h2>
        ${r.players.length ? players.map((p) => html`<${PlayerCard} key=${p.playerId} p=${p} myId=${myId} titles=${titles} best=${best} solo=${players.length < 2} />`)
          : html`<p class="t-dim">${t('暂无结算数据')}</p>`}
      </section>
      ${slot ? html`<div class="ui-slot" data-ui-slot="result.tab" aria-label=${t('界面插件')} dangerouslySetInnerHTML=${{ __html: '' }}></div>` : null}
      <footer class="result__foot">
        <${Button} variant="primary" size="xl" icon="chevronLeft" onClick=${onBack}>${backLabel}<//>
      </footer>
    </main>
  </div>`;
}
