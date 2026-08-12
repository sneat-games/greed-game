import { describe, it, expect } from "vitest";
import { MATCH_ROUNDS, MIN_BID, START_BANKROLL, newMatch, playRound, duelDetail } from "../engine/greedplay";
import { botStateFor, isDecisive, pickBid, type BotState } from "./bot";

/** Deterministic PRNG (same one the engine tests use), so a "random" bot is
 *  still a reproducible test subject. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const state = (over: Partial<BotState> = {}): BotState => ({
  own: START_BANKROLL,
  opponent: START_BANKROLL,
  round: 0,
  rounds: MATCH_ROUNDS,
  ...over,
});

describe("pickBid: the legal band", () => {
  it("never bids below 1 or above its own bankroll, for any bankroll pair", () => {
    const rng = mulberry32(21);
    for (let own = 1; own <= 200; own++) {
      for (const opponent of [1, 2, 7, 50, 199, 400]) {
        for (let round = 0; round < MATCH_ROUNDS; round++) {
          const bid = pickBid(state({ own, opponent, round }), rng);
          expect(Number.isInteger(bid), `own=${own} opp=${opponent} r=${round} -> ${bid}`).toBe(true);
          expect(bid).toBeGreaterThanOrEqual(MIN_BID);
          expect(bid).toBeLessThanOrEqual(own);
        }
      }
    }
  });

  it("bids the minimum when it has only one coin left", () => {
    expect(pickBid(state({ own: 1, opponent: 199 }), mulberry32(1))).toBe(MIN_BID);
  });
});

describe("pickBid: modest by default", () => {
  it("stakes a small share of its bankroll on an ordinary round", () => {
    const rng = mulberry32(5);
    for (let i = 0; i < 200; i++) {
      const bid = pickBid(state({ round: 1 }), rng);
      // 18% base with +/-30% jitter, capped by the greed guard at 2 x its
      // guess of the opponent's 18% — comfortably under a third either way.
      expect(bid).toBeGreaterThanOrEqual(MIN_BID);
      expect(bid).toBeLessThanOrEqual(Math.round(START_BANKROLL / 3));
    }
  });

  it("does not always bid the same number (the jitter is real)", () => {
    const rng = mulberry32(9);
    const seen = new Set<number>();
    for (let i = 0; i < 50; i++) seen.add(pickBid(state({ round: 1 }), rng));
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe("pickBid: stays off the greed line", () => {
  it("against a poor opponent it shrinks rather than overreaching into greed", () => {
    // The opponent has 10 coins; their plausible bid is ~2, so anything over
    // 4 would be greedy and would HAND them the round.
    const rng = mulberry32(13);
    for (let i = 0; i < 200; i++) {
      const bid = pickBid(state({ own: 190, opponent: 10, round: 1 }), rng);
      expect(bid).toBeLessThanOrEqual(4);
    }
  });

  it("a mid-match bid against an equal opponent is not greedy versus the same-sized bid", () => {
    const rng = mulberry32(17);
    for (let i = 0; i < 200; i++) {
      const bid = pickBid(state({ round: 1 }), rng);
      // Against a mirror of its own reasoning the bot must not be the greedy
      // side more than the jitter can explain: check the boundary case where
      // the opponent bids the bot's own base share.
      const opponentBase = Math.round(START_BANKROLL * 0.18);
      if (bid > opponentBase) {
        expect(duelDetail(bid, opponentBase).greedy, `bid ${bid} vs ${opponentBase}`).toBe(false);
      }
    }
  });
});

describe("pickBid: swings for it when behind and out of time", () => {
  it("bids enough on the final round to actually overturn the deficit", () => {
    const rng = mulberry32(23);
    // 40 vs 160: the gap is 120, and a round moves the gap by twice the
    // stake — so anything at or below 60 cannot win the match.
    for (let i = 0; i < 100; i++) {
      const bid = pickBid(state({ own: 40, opponent: 160, round: MATCH_ROUNDS - 1 }), rng);
      expect(bid).toBe(40); // clamped to all-in: the swing it needs exceeds its bankroll
    }
  });

  it("bids over half the deficit when it can afford to", () => {
    const rng = mulberry32(29);
    for (let i = 0; i < 100; i++) {
      const bid = pickBid(state({ own: 90, opponent: 110, round: MATCH_ROUNDS - 1 }), rng);
      expect(bid).toBeGreaterThan((110 - 90) / 2);
    }
  });
});

describe("pickBid: protects a lead on the last round", () => {
  it("shrinks its bid when ahead going into the final round", () => {
    const rng = mulberry32(31);
    let sumLast = 0;
    let sumMid = 0;
    for (let i = 0; i < 200; i++) {
      sumLast += pickBid(state({ own: 130, opponent: 70, round: MATCH_ROUNDS - 1 }), rng);
      sumMid += pickBid(state({ own: 130, opponent: 70, round: 1 }), rng);
    }
    expect(sumLast).toBeLessThan(sumMid);
  });
});

describe("isDecisive", () => {
  it("is true on the final round", () => {
    expect(isDecisive(state({ round: MATCH_ROUNDS - 1 }))).toBe(true);
  });
  it("is false mid-match with level bankrolls (nobody can be wiped)", () => {
    expect(isDecisive(state({ round: 1 }))).toBe(false);
  });
  it("is true mid-match once one side holds a third of the table or less", () => {
    // 200 coins on the table, so the cutoff sits between 66 and 67.
    expect(isDecisive(state({ own: 67, opponent: 133, round: 1 }))).toBe(false);
    expect(isDecisive(state({ own: 66, opponent: 134, round: 1 }))).toBe(true);
    expect(isDecisive(state({ own: 50, opponent: 150, round: 1 }))).toBe(true);
    // ...and it is symmetric: a round that can end the match can end it
    // whichever seat is about to be wiped.
    expect(isDecisive(state({ own: 133, opponent: 67, round: 1 }))).toBe(false);
    expect(isDecisive(state({ own: 150, opponent: 50, round: 1 }))).toBe(true);
  });
});

describe("botStateFor", () => {
  it("reads the seat's own and opponent bankrolls off a match", () => {
    const m = playRound(newMatch(), [10, 15]).next; // -> [90, 110]
    expect(botStateFor(m, 0)).toEqual({ own: 90, opponent: 110, round: 1, rounds: MATCH_ROUNDS });
    expect(botStateFor(m, 1)).toEqual({ own: 110, opponent: 90, round: 1, rounds: MATCH_ROUNDS });
  });
});

describe("bot vs bot: a full match always terminates legally", () => {
  it("plays 500 self-play matches without producing an illegal bid", () => {
    const rng = mulberry32(37);
    for (let trial = 0; trial < 500; trial++) {
      let m = newMatch();
      let guard = 0;
      while (m.round < m.rounds && m.bankrolls[0] > 0 && m.bankrolls[1] > 0) {
        const bids: [number, number] = [pickBid(botStateFor(m, 0), rng), pickBid(botStateFor(m, 1), rng)];
        expect(bids[0]).toBeLessThanOrEqual(m.bankrolls[0]);
        expect(bids[1]).toBeLessThanOrEqual(m.bankrolls[1]);
        m = playRound(m, bids).next; // throws on any illegal bid
        if (++guard > MATCH_ROUNDS + 1) throw new Error("match did not terminate");
      }
      expect(m.bankrolls[0] + m.bankrolls[1]).toBe(2 * START_BANKROLL);
    }
  });
});
