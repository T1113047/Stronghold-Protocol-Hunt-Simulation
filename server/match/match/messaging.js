// server/match/match/messaging.js — Match methods: messaging — unicast, broadcast, toasts, the ticker lines
// (config.broadcasts by type; the remake's CUSTOM lines), the dirty marks and flush: m.private per player only when it
// changed (plus the prep scouts of that player's board), m.public throttled (DELAYS.PUBLIC_THROTTLE) and deduplicated.
// i18n (docs/I18N.md): a toast / CUSTOM line is a string (its own msgid) or a shared/i18n.js msg(msgid, params); the frame
// carries `text` (the Chinese rendering, what older clients show) plus `msgid` / `params`; a broadcast line carries its
// `args` so the client can fill the localized config.broadcasts template.
// Installed on Match.prototype by server/match/Match.js (a method container: never instantiated; `this` is the match).

import { DELAYS } from './common.js';
import { wireMessage } from '../../../shared/i18n.js';

export class MatchMessaging {
  sendTo(playerId, msg) {
    if (this.disposed) return false;
    const ps = this.players.get(playerId) || this.spectators.get(playerId);
    if (!ps || ps.isBot || ps.left) return false;
    try { return !!this.sendFn(playerId, msg); } catch (e) { this.reportError('send', e); return false; }
  }

  broadcast(msg) {
    if (this.disposed) return;
    try { this.broadcastFn(msg); } catch (e) { this.reportError('broadcast', e); }
  }

  /** @param {string|{ msgid: string, params?: object }} text a string or msg() (shared/i18n.js) */
  toast(ps, kind, text) {
    if (!ps || ps.isBot || ps.left || !ps.connected) return;
    this.sendTo(ps.playerId, { t: 'm.toast', kind, ...wireMessage(text) });
  }

  /** Broadcast ticker from config.broadcasts by type; `param` picks the variant (SHOP_LEVEL level, BOSS_HIT share…). */
  tickerFor(type, args = [], { playerId = null, to = null, param = null } = {}) {
    const list = Array.isArray(this.gd.config.broadcasts) ? this.gd.config.broadcasts.filter((b) => b && b.type === type) : [];
    let b = list[0];
    if (param != null) b = list.find((x) => Array.isArray(x.params) && x.params.includes(String(param))) || b;
    const tpl = b && typeof b.text === 'string' ? b.text : null;
    if (!tpl) return;
    const text = tpl.replace(/\{(\d)\}/g, (_, i) => (args[Number(i)] != null ? String(args[Number(i)]) : ''));
    const msg = { t: 'm.ticker', text, id: b.id, type, priority: Number(b.priority) || 0, playerId, args: args.map((a) => String(a ?? '')) };
    if (to) { this.sendTo(to, msg); return; }
    // 2V2 ('versus'): the two teams are SEPARATE games sharing one clock — a line about a player (its name is in the
    // text) reaches that player's team only. No playerId: a match-wide notice, which both teams may see.
    const team = this.isVersus && playerId ? this.teamIdOf(this.players.get(playerId)) : null;
    if (team != null) { for (const ps of this.order) if (this.teamIdOf(ps) === team) this.sendTo(ps.playerId, msg); return; }
    this.broadcast(msg);
  }

  /**
   * A ticker line of the remake's own (type CUSTOM). `priority`: the match-flow notices (隐秘核心已解锁, 联防阶段, a player out
   * or gone) take FLOW_TICKER_PRIORITY so the strip does not hold them behind shop-level lines; other lines 0. `team`:
   * 2V2 only — the line belongs to that team's own game and reaches nobody else.
   */
  tickerText(text, priority = 0, team = null) {
    if (!text) return;
    const w = wireMessage(text);
    const msg = { t: 'm.ticker', ...w, text: w.text.slice(0, 200), id: null, type: 'CUSTOM', priority: Number(priority) || 0, playerId: null };
    if (this.isVersus && team != null) { for (const ps of this.order) if (this.teamIdOf(ps) === team) this.sendTo(ps.playerId, msg); return; }
    this.broadcast(msg);
  }

  markPublic() { this._pubDirty = true; }

  /**
   * A team's public view (2V2, before the reveal): the OPPONENT is hidden — their player rows become stubs
   * (`hidden: true`), and their fields, per-team setup and 联防 entries are dropped. The full `base` view in solo/coop
   * or once the opponent is revealed (`Match#opponentRevealed` — R14 on, or the settlement). Spectator seats are never
   * built a team view at all: `_maybeSendPublic` hands them the full `base`.
   */
  _teamPublicView(base, team) {
    // 2V2: the top-level disabled bonds / banned chess are the VIEWER'S team's (each team has its own 3 available
    // cores); the opponent's are in `teamBans`, masked before the reveal.
    const bans = this.bansOf(team);
    const own = {
      disabledBonds: [...new Set([...bans.drawn, ...bans.staticOff])].sort(),
      drawnDisabledBonds: bans.drawn.slice(),
      bannedChess: bans.banned.slice(),
    };
    const sp = this.isVersus && this.phase === 'SP_DRAFT' && this.sp ? { sp: this.spViewFor(team) } : null;
    if (this.opponentRevealed) return { ...base, ...own, ...(sp || {}) };
    const same = (pid) => this.teamIdOf(this.players.get(pid)) === team;
    const out = {
      ...base, ...own, ...(sp || {}),
      players: base.players.map((row) => (same(row.playerId) ? row : {
        playerId: row.playerId, seat: row.seat, name: row.name, isBot: row.isBot, team: row.team, connected: row.connected, alive: row.alive,
        // 2V2: the hidden row still carries its TEAM's shared HP pool — the panel's two sides both show a bar
        lp: this.teamLps ? Math.max(0, this._teamLpOf(row.team)) : row.lp, hidden: true,
      })),
      fields: (base.fields || []).filter((f) => f.players.some(same)),
    };
    if (out.teamBans) out.teamBans = out.teamBans[team] ? { [team]: out.teamBans[team] } : {};
    if (out.rerollVotes) {
      const mine = out.rerollVotes[team] || null;
      out.rerollVotes = mine ? { [team]: mine } : {};
      // 2V2: the client reads the SOLO/coop scalar `rerollVote` — hand it the VIEWER's team's vote. Without this the
      // 重刷本局 click started a server-side vote nobody could see (its consent buttons never rendered), so the
      // briefing looked frozen until the vote window ran out. The other team's vote stays hidden.
      out.rerollVote = mine;
    } else if (out.rerollVote) {
      out.rerollVote = null;
    }
    if (out.unite) out.unite = { helpers: (out.unite.helpers || []).filter(same), leakers: (out.unite.leakers || []).filter(same) };
    if (out.draft && out.draft.picks) {
      out.draft = { ...out.draft,
        picks: Object.fromEntries(Object.entries(out.draft.picks).filter(([pid]) => same(pid))),
        skipsLeft: Object.fromEntries(Object.entries(out.draft.skipsLeft || {}).filter(([pid]) => same(pid))) };
    }
    if (out.confront && this.phase === 'CONFRONT' && this.confrontStage !== 'roster') {
      // 2V2 狩猎期: only the OWN team's targeting and submissions WHILE the phase runs — who the opponents aim at stays
      // hidden. The roster hold (confrontStage 'roster') is the reveal: both teams' lists are public there, exactly as
      // the 悬赏名单 popup promises, so it must NOT be filtered.
      const keep = (pid) => this.teamIdOf(this.players.get(pid)) === team;
      const targets = {};
      for (const [pid, t] of Object.entries(out.confront.targets || {})) if (keep(pid)) targets[pid] = t;
      const subs = {};
      for (const [pid, s] of Object.entries(out.confront.subs || {})) if (keep(pid)) subs[pid] = s;
      out.confront = { ...out.confront, targets, subs };
    }
    return out;
  }
  /**
   * A player's state changed: its m.private and (throttled, deduplicated) m.public (level, board, bonds…) — in a boss
   * round's prep also its pair partner's m.private, which shows this board on its other half (bossMate, item 51).
   */
  markPrivate(ps) {
    if (!ps) return;
    this._privDirty.add(ps);
    this._pubDirty = true;
    const m = this._bossMateOf(ps);
    if (m) this._privDirty.add(m.mate);
  }

  /** Send pending m.private (per player, only when changed) and m.public (throttled ≤ 10/s). */
  flush(forcePublic = false) {
    if (this.disposed) return;
    if (this._privDirty.size) {
      const list = [...this._privDirty];
      this._privDirty.clear();
      for (const ps of list) {
        if (!(ps.isBot || ps.left || !ps.connected)) this._sendPrivate(ps, false);
        this._notifyPrepScouts(ps);
      }
    }
    if (this._pubDirty || forcePublic) this._maybeSendPublic(forcePublic);
  }

  _sendPrivate(ps, force) {
    let view;
    try { view = ps.privateView(); } catch (e) { this.reportError('privateView', e); return; }
    const json = JSON.stringify(view);
    if (!force && json === ps._lastPriv) return;
    ps._lastPriv = json;
    this.sendTo(ps.playerId, view);
  }

  _maybeSendPublic(force) {
    const now = this.sched.now();
    if (!force && now - this._lastPubAt < DELAYS.PUBLIC_THROTTLE) {
      if (!this._pubTimer) {
        const wait = Math.max(1, DELAYS.PUBLIC_THROTTLE - (now - this._lastPubAt));
        this._pubTimer = this.sched.setTimeout(() => {
          this._pubTimer = null;
          if (this.disposed) return;
          try { this._maybeSendPublic(false); } catch (e) { this.reportError('public', e); }
        }, wait);
      }
      return;
    }
    this._pubDirty = false;
    let base;
    try { base = this.publicView(); } catch (e) { this.reportError('publicView', e); return; }
    if (!this.isVersus) {
      const { serverNow, ...rest } = base;
      void serverNow;
      const json = JSON.stringify(rest);
      if (!force && json === this._lastPubJson) return;
      this._lastPubJson = json;
      // Snapshot building / serialization can take time; throttle from the actual broadcast, not its start.
      this._lastPubAt = this.sched.now();
      this.broadcast(base);
      return;
    }
    // 2V2: a per-team view (the opponent hidden until the Final Assault / the settlement); spectator seats see the full one
    if (!this._lastPubJsonByTeam) this._lastPubJsonByTeam = new Map();
    let sent = false;
    for (const t of this.matchTeamIds()) {
      const view = this._teamPublicView(base, t);
      const json = JSON.stringify(view);
      if (!force && json === this._lastPubJsonByTeam.get(t)) continue;
      this._lastPubJsonByTeam.set(t, json);
      sent = true;
      for (const ps of this.order) if (this.teamIdOf(ps) === t) this.sendTo(ps.playerId, view);
    }
    if (!sent && !force) return;
    // Snapshot building / serialization can take time; throttle from the actual broadcast, not its start.
    this._lastPubAt = this.sched.now();
    for (const sp of this.spectators.values()) this.sendTo(sp.playerId, base);
  }
}
