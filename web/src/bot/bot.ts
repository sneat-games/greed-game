// bot — the MVP Greed Game bot ("simple, random-with-manners", the house
// style from game-kit/docs/DESIGN.md §"Bots"). No search, no opponent model,
// no learning: a handful of honest heuristics that are directionally right,
// not strong play. A stronger bot is a later-wave concern.
//
// Everything below is stated as a heuristic on purpose. The Greed Game's
// only hard truths are in the engine (../engine/greedplay.ts); this file is
// judgement, and it says so.

import { MIN_BID, maxNonGreedyBid, type GreedMatch } from "../engine/greedplay";

/** What the bot is allowed to know: public information only. Bankrolls are
 *  public in this game (only the BID is hidden), so this is exactly what a
 *  human opponent can see too. */
export interface BotState {
  /** The bot's own bankroll. */
  own: number;
  /** The opponent's bankroll. */
  opponent: number;
  /** Rounds already played (so this is round `round + 1` in human terms). */
  round: number;
  /** Rounds in the whole match. */
  rounds: number;
}

/** Read a `BotState` off an engine match state, from `player`'s seat. */
export function botStateFor(m: GreedMatch, player: 0 | 1): BotState {
  const other = player === 0 ? 1 : 0;
  return { own: m.bankrolls[player], opponent: m.bankrolls[other], round: m.round, rounds: m.rounds };
}

/**
 * The share of its own bankroll the bot stakes on an ordinary round. Low on
 * purpose: in this game the stake is the LOWER of the two bids, so bidding
 * big buys you nothing extra against a small bid — it only risks tripping
 * the greed rule and handing the round away.
 */
const BASE_FRACTION = 0.18;

/** How far the jitter moves the base bid, as a multiplier. Pure texture: a
 *  bot that bid exactly 18% every round would be trivially readable. */
const JITTER_LO = 0.7;
const JITTER_HI = 1.3;

/** The share staked when the bot is AHEAD going into the final round, where
 *  a draw is as good as a win: bid small, let the opponent overreach into
 *  the greed rule. Deliberately not the minimum of 1 — that is the
 *  theoretically best defensive bid, and it makes the last round of every
 *  match identical and dull. */
const PROTECT_FRACTION = 0.08;

/**
 * Whether the match can END on this round — exported so the UI can badge it
 * ("match point") if it wants to, and used by `pickBid` as one input.
 *
 * Two ways a round ends a match:
 *
 *   1. It is the final round.
 *   2. A bankroll reaches 0. That needs the poorer player to go ALL IN (a
 *      player never loses more than their own bid) and the richer player to
 *      answer somewhere in `(B, 2B]` — above it to be the higher bidder, no
 *      higher than `2B` or the greed rule flips the round back. So it is
 *      possible only when the bankrolls DIFFER, and it is plausible only
 *      when the poorer player is far enough behind to be tempted into an
 *      all-in at all. We take "far enough behind" as holding no more than a
 *      third of the coins on the table (`2 * low <= high`) — that part is a
 *      judgement call, not a rule.
 */
export function isDecisive(state: BotState): boolean {
  if (state.round >= state.rounds - 1) return true;
  const low = Math.min(state.own, state.opponent);
  const high = Math.max(state.own, state.opponent);
  return 2 * low <= high;
}

/**
 * Pick the bot's bid for the round it is about to play.
 *
 * The heuristics, in the order they apply:
 *
 *   1. **Modest by default.** Stake `BASE_FRACTION` of own bankroll, with
 *      jitter, because the stake is the lower bid — overbidding wins nothing
 *      and risks greed.
 *   2. **Stay off the greed line.** Guess the opponent bids the same modest
 *      share of THEIR bankroll, and cap at twice that guess: at or below
 *      `2 × opponent bid` the higher bidder wins, one coin above it the
 *      higher bidder loses. Against a nearly-broke opponent this cap is
 *      small — which is correct, because against a small bid a big bid IS
 *      greedy.
 *   3. **Swing it when behind and out of time.** On the final round (or any
 *      round the match can end on) while trailing, bid big enough that
 *      winning the round would actually overturn the deficit — a round moves
 *      the gap by twice the stake, so the stake must exceed half of it.
 *   4. **Protect a lead on the last round,** where a draw is as good as a
 *      win: bid small and let the opponent overreach into greed.
 *
 * Always returns an integer in `[MIN_BID, state.own]`. `rng` is injectable
 * so tests are deterministic.
 */
export function pickBid(state: BotState, rng: () => number = Math.random): number {
  const own = Math.max(0, Math.floor(state.own));
  // Nothing to decide. (A bankroll of 0 means the match is already over per
  // greedplay.matchOutcome and the caller should not have asked — returning
  // the floor keeps this total rather than throwing from a bot.)
  if (own <= MIN_BID) return MIN_BID;

  const opponent = Math.max(0, Math.floor(state.opponent));
  const lastRound = state.round >= state.rounds - 1;
  const behind = own < opponent;

  // 1. Modest base, jittered.
  const jitter = JITTER_LO + rng() * (JITTER_HI - JITTER_LO);
  let bid = Math.round(own * BASE_FRACTION * jitter);

  // 4. Ahead going into the last round: a draw wins the match, so shrink.
  if (lastRound && !behind) {
    bid = Math.round(own * PROTECT_FRACTION * jitter);
  }

  // 2. Stay off the greed line against a plausible opponent bid. The cap
  //    itself is the engine's rule (`maxNonGreedyBid`), not a local `2 * g`;
  //    only the GUESS at the opponent's bid is the bot's own judgement.
  const guessedOpponentBid = Math.max(MIN_BID, Math.round(opponent * BASE_FRACTION));
  const greedSafeCap = maxNonGreedyBid(guessedOpponentBid);
  if (bid > greedSafeCap) bid = greedSafeCap;

  // 3. Behind with the match on the line: a round shifts the gap by twice the
  //    stake, so anything at or below half the deficit cannot overturn it. Bid
  //    over that line even though it may read as greedy — a bid that cannot
  //    win the match is worth nothing.
  if (behind && (lastRound || isDecisive(state))) {
    const deficit = opponent - own;
    const swing = Math.floor(deficit / 2) + 1;
    if (swing > bid) bid = swing;
  }

  return clampBid(bid, own);
}

/** Clamp to the legal band the engine enforces: an integer in `[1, own]`. */
function clampBid(bid: number, own: number): number {
  const max = Math.max(MIN_BID, Math.floor(own));
  const b = Math.floor(Number.isFinite(bid) ? bid : MIN_BID);
  if (b < MIN_BID) return MIN_BID;
  if (b > max) return max;
  return b;
}
