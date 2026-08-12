// Port of server-go/greedplay — the resolution engine for The Greed Game.
//
// This file is a faithful vanilla TypeScript mirror of the Go rule-of-record
// at ../../../server-go/greedplay/greedplay.go, plus the two-player MATCH
// layer the Go package deliberately leaves to its session layer
// (server-go/greedgame). Any rule change in the Go package must trip a
// corresponding test on this side — greedplay.test.ts mirrors
// greedplay_test.go fixture-for-fixture, naming each `describe` block after
// the Go test function it mirrors so the correspondence stays auditable.
//
// # The duel rule (mirrors greedplay.Duel / greedplay.DuelDetail)
//
// Two players make hidden integer bids. The amount at stake is always L, the
// LOWER of the two bids. The HIGHER bidder wins (courage — takes L) UNLESS
// the higher bid is strictly more than GREED_FACTOR times the lower bid
// ("greed"), in which case the greedy higher bidder is punished and the
// LOWER bidder wins instead. Equal bids draw and nothing moves. Because the
// stake is the lower bid, neither player can win or lose more than their own
// bid — so a bankroll can never go negative.
//
// # What is NOT ported
//
// The Go package also resolves N-player rounds (`Resolve`, `ResolveMatrix`,
// `apportion` and the loss/win settlement caps). N players is explicitly out
// of scope for the web MVP (founder decision, 2026-08-12: the web game is a
// two-player duel), so those are deliberately absent here rather than ported
// and left untested. In two players the settlement caps are automatic — the
// stake is already the lower bid — which is exactly what the Go test
// `TestResolve_N2MatchesDuel` asserts, and what `roundDeltas` re-asserts on
// this side.
//
// The engine is session-agnostic and pure: no DOM, no network, no clocks,
// no randomness. Bankrolls are plain integers; the UI decides what a "coin"
// looks like, exactly as the Go original stays out of the wallet's way.

/**
 * The greed threshold: when a duel's higher bid is strictly greater than
 * GREED_FACTOR times the lower bid, the higher bidder is "greedy" and loses
 * (the lower bidder wins). At or below GREED_FACTOR times the lower bid the
 * higher bidder is merely courageous and wins. Mirrors greedplay.GreedFactor.
 */
export const GREED_FACTOR = 2;

/** Which side of a duel won. Mirrors greedplay.Winner. */
export enum Winner {
  /** The bids were equal and nothing moved. */
  Draw = 0,
  /** The first bid (a) won the duel. */
  First = 1,
  /** The second bid (b) won the duel. */
  Second = 2,
}

/** Renders a Winner for logs and test output. Mirrors Winner.String(). */
export function winnerString(w: Winner): string {
  switch (w) {
    case Winner.Draw:
      return "Draw";
    case Winner.First:
      return "First";
    case Winner.Second:
      return "Second";
    default:
      return `Winner(${w as number})`;
  }
}

/** One duel, described for a results screen. Mirrors greedplay.DuelResult. */
export interface DuelResult {
  /** The duel stake: min(a, b), or 0 on a draw. */
  transfer: number;
  /** Draw, First (a won) or Second (b won). */
  winner: Winner;
  /**
   * True when the higher bid was greedy (> GREED_FACTOR × the lower bid) and
   * was therefore punished — i.e. the LOWER bidder won. False on a draw and
   * when the higher (courageous) bidder won.
   */
  greedy: boolean;
}

/**
 * Resolves one duel between bids `a` and `b`, returning the token delta for
 * a and for b. The result is zero-sum (`da === -db`) and the stake is always
 * `min(a, b)`. Equal bids draw and return `[0, 0]`. Mirrors greedplay.Duel.
 */
export function duel(a: number, b: number): [da: number, db: number] {
  if (a === b) return [0, 0];
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  const greedy = hi > GREED_FACTOR * lo; // higher bid strictly more than 2x the lower => greed

  // The HIGHER bidder wins (courage) UNLESS the higher bid is greedy, in
  // which case the greedy bidder is punished and the LOWER bidder wins.
  const aIsHigher = a > b;
  const aWins = aIsHigher !== greedy;

  return aWins ? [lo, -lo] : [-lo, lo];
}

/**
 * Resolves one duel and describes it for a detailed results screen.
 * Semantics match `duel`. Mirrors greedplay.DuelDetail.
 */
export function duelDetail(a: number, b: number): DuelResult {
  const [da] = duel(a, b);
  // A draw is the only way da can be 0: otherwise |da| === min(a, b) >= 1.
  if (da === 0) return { transfer: 0, winner: Winner.Draw, greedy: false };
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return {
    transfer: lo,
    winner: da < 0 ? Winner.Second : Winner.First,
    greedy: hi > GREED_FACTOR * lo,
  };
}

// --- The two-player match ------------------------------------------------
//
// Everything below is the MATCH layer: the Go engine resolves a single
// round and leaves bankrolls, round counts and the end condition to
// server-go/greedgame. The web MVP's match shape is a founder decision
// (2026-08-12): two players, 100 coins each, five rounds, larger bankroll
// wins, and an immediate end if anyone reaches 0.

/** Each player's bankroll at the start of a match. */
export const START_BANKROLL = 100;

/** How many rounds a match lasts, if nobody goes broke first. */
export const MATCH_ROUNDS = 5;

/** The smallest legal bid. A player must always stake something real. */
export const MIN_BID = 1;

/** Thrown when a bid is below MIN_BID. */
export class BidBelowMinimumError extends Error {
  constructor(bid: number) {
    super(`greedplay: bid ${bid} is below the minimum of ${MIN_BID}`);
    this.name = "BidBelowMinimumError";
  }
}

/** Thrown when a bid exceeds the bidder's own bankroll. */
export class BidExceedsBankrollError extends Error {
  constructor(bid: number, bankroll: number) {
    super(`greedplay: bid ${bid} exceeds the bankroll of ${bankroll}`);
    this.name = "BidExceedsBankrollError";
  }
}

/** Thrown when a round is played on a match that has already ended. */
export class MatchOverError extends Error {
  constructor() {
    super("greedplay: the match is already over");
    this.name = "MatchOverError";
  }
}

/** An immutable match state. `playRound` returns the next one. */
export interface GreedMatch {
  /** Coins held by `[player 0, player 1]`. Never negative. */
  readonly bankrolls: readonly [number, number];
  /** How many rounds have already been played (so the round about to be
   *  played is `round + 1` of `rounds` in human terms). */
  readonly round: number;
  /** How many rounds this match lasts in total. */
  readonly rounds: number;
  /** What each player started with — kept so the end screen can show the
   *  movement from it without the UI having to remember. */
  readonly startBankroll: number;
}

export function newMatch(opts: { bankroll?: number; rounds?: number } = {}): GreedMatch {
  const bankroll = opts.bankroll ?? START_BANKROLL;
  const rounds = opts.rounds ?? MATCH_ROUNDS;
  return { bankrolls: [bankroll, bankroll], round: 0, rounds, startBankroll: bankroll };
}

/** The largest bid `player` may make right now: their whole bankroll. */
export function maxBid(m: GreedMatch, player: 0 | 1): number {
  return m.bankrolls[player];
}

export type MatchOutcome =
  | { kind: "ongoing" }
  /** `bankrupt` = the loser hit 0 and could no longer meet the minimum bid,
   *  so the match ended early; `rounds` = all rounds were played. */
  | { kind: "win"; winner: 0 | 1; reason: "rounds" | "bankrupt" }
  | { kind: "draw" };

/**
 * The match's standing, derived purely from the state.
 *
 * Early end first: a player on 0 coins cannot meet the MIN_BID of 1, so the
 * match is over the instant a bankroll hits zero, whatever the round count
 * says — the other player wins. Otherwise, once every round has been played
 * the larger bankroll wins and equal bankrolls draw.
 */
export function matchOutcome(m: GreedMatch): MatchOutcome {
  const [a, b] = m.bankrolls;
  // Both cannot be 0 at once: the round is zero-sum, so somebody received
  // whatever the broke player paid.
  if (a <= 0) return { kind: "win", winner: 1, reason: "bankrupt" };
  if (b <= 0) return { kind: "win", winner: 0, reason: "bankrupt" };
  if (m.round >= m.rounds) {
    if (a === b) return { kind: "draw" };
    return { kind: "win", winner: a > b ? 0 : 1, reason: "rounds" };
  }
  return { kind: "ongoing" };
}

/** Convenience predicate over `matchOutcome`. */
export function isMatchOver(m: GreedMatch): boolean {
  return matchOutcome(m).kind !== "ongoing";
}

/** One resolved round: what happened, what moved, and the resulting state. */
export interface RoundResult {
  /** The duel detail for `[bid0, bid1]` — stake, winner, greed flag. */
  detail: DuelResult;
  /** Coin change for `[player 0, player 1]`; always sums to zero. */
  deltas: readonly [number, number];
  /** The match state after the round: bankrolls moved, round advanced. */
  next: GreedMatch;
}

/**
 * Resolves a round of the two-player match. Both bids must be integers in
 * `[MIN_BID, that player's bankroll]`.
 *
 * The settlement is the plain duel: the stake is the lower bid, so no
 * player can ever lose more than they staked and no bankroll can go
 * negative. (This is the two-player case of the Go engine's loss/win caps,
 * which bind only for N > 2 — see the module comment.)
 */
export function playRound(m: GreedMatch, bids: readonly [number, number]): RoundResult {
  if (isMatchOver(m)) throw new MatchOverError();
  validateBid(bids[0], m.bankrolls[0]);
  validateBid(bids[1], m.bankrolls[1]);

  const detail = duelDetail(bids[0], bids[1]);
  const deltas = roundDeltas(bids);
  return {
    detail,
    deltas,
    next: {
      ...m,
      bankrolls: [m.bankrolls[0] + deltas[0], m.bankrolls[1] + deltas[1]],
      round: m.round + 1,
    },
  };
}

/**
 * The zero-sum coin movement for one two-player round. Exported so tests can
 * assert it against `duel` directly, mirroring the Go engine's
 * `TestResolve_N2MatchesDuel` (which pins `Resolve` for N=2 to `Duel`).
 */
export function roundDeltas(bids: readonly [number, number]): readonly [number, number] {
  const [da, db] = duel(bids[0], bids[1]);
  return [da, db];
}

function validateBid(bid: number, bankroll: number): void {
  if (!Number.isInteger(bid) || bid < MIN_BID) throw new BidBelowMinimumError(bid);
  if (bid > bankroll) throw new BidExceedsBankrollError(bid, bankroll);
}

/**
 * The greed line for a bid you are about to make, expressed purely in terms
 * of YOUR OWN bid: the largest opponent bid that would make yours greedy.
 *
 * Your bid `y` is greedy against an opponent bid `x` exactly when you are
 * the higher bidder and `y > GREED_FACTOR * x`, i.e. `x < y / 2`. Over
 * integers the largest such `x` is `ceil(y / 2) - 1`. A bid of 1 can never
 * be greedy (the threshold is 0 and every legal bid is at least 1).
 *
 * This lives in the engine because it IS the rule, and it is a function of
 * one argument by construction — it cannot leak anything about the
 * opponent's hidden bid, because it is never given it. See ui/greed-hint.ts,
 * which renders it.
 */
export function greedThreshold(yourBid: number): number {
  return Math.max(0, Math.ceil(yourBid / 2) - 1);
}

/**
 * The inverse of `greedThreshold`: the largest bid that is still NOT greedy
 * against an opponent bid of `opponentBid` — i.e. the most you can stake and
 * still win as the courageous higher bidder. Kept here rather than as a bare
 * `2 * x` in the bot so the greed rule lives in exactly one place.
 */
export function maxNonGreedyBid(opponentBid: number): number {
  return GREED_FACTOR * opponentBid;
}
