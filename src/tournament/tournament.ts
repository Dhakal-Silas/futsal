import { Rng } from '../core/rng';
import { loadRaw, removeKey, saveJSON } from '../core/storage';
import { TEAMS, teamById } from '../sim/teams';
import { autoSimMatch } from './autosim';
import { createBracket, createGroups, drawOrder, knockoutFromGroups, nextMatch, recordResult, champion, isEliminated, type Bracket, type GroupMatch, type TMatch, groupTable } from './bracket';

export interface TournamentState {
  version: 1;
  seed: number;
  userTeam: string;
  classico: boolean;
  groupStage: boolean;
  stage: 'draw' | 'groups' | 'knockout' | 'done';
  drawOrder: string[];
  groups: string[][] | null;
  groupMatches: GroupMatch[] | null;
  bracket: Bracket | null;
  halfMinutes: number;
  difficulty: string;
  formation: string;
  /** results of the user's played matches, for the bracket view */
  log: string[];
}

const KEY = 'tournament';

export class Tournament {
  state: TournamentState;
  rng: Rng;
  constructor(state: TournamentState) { this.state = state; this.rng = new Rng(state.seed ^ 0x9e37); }

  static create(userTeam: string, classico: boolean, groupStage: boolean, halfMinutes: number, difficulty: string, formation: string, seed = Date.now() & 0xffffff): Tournament {
    const rng = new Rng(seed);
    const ids = TEAMS.map((t) => t.id);
    const order = drawOrder(ids, rng, classico ? ['rma', 'fcb'] : null);
    const st: TournamentState = {
      version: 1, seed, userTeam, classico, groupStage, stage: 'draw', drawOrder: order, groups: null, groupMatches: null, bracket: null,
      halfMinutes, difficulty, formation, log: [],
    };
    const t = new Tournament(st);
    if (groupStage) {
      // in group mode the classico constraint is applied on the knockout seeding later
      const g = createGroups(order, 4);
      st.groups = g.groups; st.groupMatches = g.matches;
    } else st.bracket = createBracket(order);
    return t;
  }

  static load(): Tournament | null {
    const st = loadRaw<TournamentState>(KEY);
    if (!st || st.version !== 1) return null;
    return new Tournament(st);
  }
  save() { saveJSON(KEY, this.state); }
  static clear() { removeKey(KEY); }

  /** Finish the draw presentation. */
  beginPlay() { this.state.stage = this.state.groupStage ? 'groups' : 'knockout'; this.save(); }

  get userTeam() { return teamById(this.state.userTeam); }
  get bracket() { return this.state.bracket; }

  /** The next match the user must play (or null if the user is out / done). */
  nextUserMatch(): { kind: 'group'; match: GroupMatch } | { kind: 'knockout'; match: TMatch } | null {
    const st = this.state;
    if (st.stage === 'groups' && st.groupMatches) {
      // play group matches in order; auto-sim the others as we go
      const m = st.groupMatches.find((x) => !x.played && (x.a === st.userTeam || x.b === st.userTeam));
      return m ? { kind: 'group', match: m } : null;
    }
    if (st.stage === 'knockout' && st.bracket) {
      this.simOthersUntilUser();
      const m = nextMatch(st.bracket);
      if (!m) return null;
      if (m.a === st.userTeam || m.b === st.userTeam) return { kind: 'knockout', match: m };
      return null;
    }
    return null;
  }

  /** Auto-sim every match that does not involve the user, up to the user's next match. */
  simOthersUntilUser() {
    const st = this.state;
    if (st.stage === 'groups' && st.groupMatches) {
      for (const m of st.groupMatches) {
        if (m.played || m.a === st.userTeam || m.b === st.userTeam) continue;
        const r = autoSimMatch(teamById(m.a), teamById(m.b), this.rng, false, st.halfMinutes);
        m.scoreA = r.scoreA; m.scoreB = r.scoreB; m.played = true;
      }
      if (st.groupMatches.every((m) => m.played)) this.finishGroups();
    } else if (st.stage === 'knockout' && st.bracket) {
      let guard = 0;
      while (guard++ < 64) {
        const m = nextMatch(st.bracket);
        if (!m) { st.stage = 'done'; break; }
        if (m.a === st.userTeam || m.b === st.userTeam) break;
        const r = autoSimMatch(teamById(m.a!), teamById(m.b!), this.rng, true, st.halfMinutes);
        recordResult(st.bracket, m.id, r.scoreA, r.scoreB, r.aet, r.pens);
      }
    }
    this.save();
  }

  private finishGroups() {
    const st = this.state;
    if (!st.groups || !st.groupMatches) return;
    let seeds = knockoutFromGroups(st.groups, st.groupMatches);
    if (st.classico) {
      // keep Madrid and Barcelona in opposite halves if both qualified
      const ix = seeds.indexOf('rma'), iy = seeds.indexOf('fcb');
      if (ix >= 0 && iy >= 0 && (ix < 4) === (iy < 4)) {
        const target = ix < 4 ? 4 + this.rng.int(0, 3) : this.rng.int(0, 3);
        const t = seeds[target]; seeds[target] = 'fcb'; seeds[iy] = t;
      }
    }
    st.bracket = createBracket(seeds);
    st.stage = 'knockout';
  }

  /** Record the user's result. */
  recordUserResult(scoreA: number, scoreB: number, aet: boolean, pens: [number, number] | null) {
    const st = this.state;
    const nm = this.nextUserMatch();
    if (!nm) return;
    if (nm.kind === 'group') {
      nm.match.scoreA = scoreA; nm.match.scoreB = scoreB; nm.match.played = true;
      st.log.push(`${nm.match.a} ${scoreA}-${scoreB} ${nm.match.b}`);
      this.simOthersUntilUser();
    } else {
      recordResult(st.bracket!, nm.match.id, scoreA, scoreB, aet, pens);
      st.log.push(`${nm.match.a} ${scoreA}-${scoreB} ${nm.match.b}`);
      if (champion(st.bracket!)) st.stage = 'done';
    }
    this.save();
  }

  get champion(): string | null { return this.state.bracket ? champion(this.state.bracket) : null; }
  get userEliminated(): boolean {
    const st = this.state;
    if (st.stage === 'knockout' || st.stage === 'done') return st.bracket ? isEliminated(st.bracket, st.userTeam) : false;
    if (st.stage === 'groups' && st.groupMatches && st.groups) {
      // eliminated only when the group is complete and the user is not in the top 2
      const gi = st.groups.findIndex((g) => g.includes(st.userTeam));
      const done = st.groupMatches.filter((m) => m.group === gi).every((m) => m.played);
      if (!done) return false;
      const table = groupTable(st.groups[gi], st.groupMatches, gi);
      return table.findIndex((r) => r.team === st.userTeam) > 1;
    }
    return false;
  }
  get isDone() { return this.state.stage === 'done' || (!!this.champion); }
  /** Is the user's next knockout match the final? */
  get userInFinal(): boolean {
    const st = this.state;
    if (!st.bracket) return false;
    const f = st.bracket.rounds[st.bracket.rounds.length - 1][0];
    return !f.played && (f.a === st.userTeam || f.b === st.userTeam) && f.a !== null && f.b !== null;
  }
}
