// Port of server-go/greedplay/greedplay_test.go — same cases, same
// assertions. Any rule change in the Go package must trip a corresponding
// failure here.
//
// Each `describe` block below is named after the Go test function it
// mirrors, so the correspondence is auditable by grepping both files for the
// same `TestX` name. Go tests with NO counterpart here are the N-player
// settlement ones — `TestResolve_Oracle`, `TestResolve_LossCapOracle`, the
// 3+-player rows of `TestResolve_HandComputedTables`, every
// `TestResolveMatrix_*` and every `TestApportion_*`. N players is out of
// scope for the web MVP (founder decision, 2026-08-12), so `Resolve`,
// `ResolveMatrix` and `apportion` are not ported and are not stubbed here.
//
// The randomised Go tests seed `math/rand`; TypeScript has no equivalent, so
// they are mirrored with a local deterministic PRNG (`mulberry32`). The
// sampled VALUES therefore differ from Go's — the INVARIANT asserted over
// them (zero-sum, symmetry, greedy-iff-lower-won, loss never exceeds bid) is
// identical, which is the part the test exists for.
import { describe, it, expect } from "vitest";
import {
  GREED_FACTOR,
  MATCH_ROUNDS,
  MIN_BID,
  START_BANKROLL,
  Winner,
  winnerString,
  duel,
  duelDetail,
  greedThreshold,
  isMatchOver,
  matchOutcome,
  maxBid,
  maxNonGreedyBid,
  newMatch,
  playRound,
  roundDeltas,
  BidBelowMinimumError,
  BidExceedsBankrollError,
  MatchOverError,
  type DuelResult,
  type GreedMatch,
} from "./greedplay";

/** Deterministic PRNG so the randomised mirrors below are reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** `rng` in `[1, n]`, mirroring Go's `rng.Intn(n) + 1`. */
function roll(rng: () => number, n: number): number {
  return Math.floor(rng() * n) + 1;
}

// --- Duel -------------------------------------------------------------------

describe("TestDuel_CourageCase_HigherWins", () => {
  it("15 <= 2*10, so the higher (courageous) bidder wins +10", () => {
    expect(duel(10, 15)).toEqual([-10, 10]);
  });
});

describe("TestDuel_GreedCase_LowerWins", () => {
  it("25 > 2*10, so the higher bid is greedy and is punished: the lower (10) wins", () => {
    expect(duel(10, 25)).toEqual([10, -10]);
  });
});

describe("TestDuel_HigherWinsWhenHigherIsFirstArg", () => {
  it("6 <= 2*3, so the higher (6) bidder wins +3", () => {
    expect(duel(6, 3)).toEqual([3, -3]);
  });
});

describe("TestDuel_Draw", () => {
  it("equal bids move nothing", () => {
    expect(duel(10, 10)).toEqual([0, 0]);
  });
});

describe("TestDuel_ExactlyDoubleBoundary", () => {
  it("H == 2L: not greedy, higher (20) wins", () => {
    expect(duel(10, 20)).toEqual([-10, 10]);
  });
  it("H == 2L+1: greedy, lower (10) wins", () => {
    expect(duel(10, 21)).toEqual([10, -10]);
  });
});

describe("TestDuel_ZeroSum_And_Symmetry", () => {
  it("is zero-sum and symmetric across 5000 random pairs", () => {
    const rng = mulberry32(1);
    for (let i = 0; i < 5000; i++) {
      const a = roll(rng, 1_000_000);
      const b = roll(rng, 1_000_000);
      const [da, db] = duel(a, b);
      expect(da, `duel(${a},${b}) not zero-sum`).toBe(-db);
      // Symmetry: swapping the arguments swaps the deltas.
      expect(duel(b, a), `duel not symmetric for (${a},${b})`).toEqual([db, da]);
    }
  });
});

// --- DuelDetail -------------------------------------------------------------

describe("TestDuelDetail", () => {
  const cases: Array<[number, number, DuelResult]> = [
    [10, 15, { transfer: 10, winner: Winner.Second, greedy: false }], // courage, higher(b) wins
    [10, 25, { transfer: 10, winner: Winner.First, greedy: true }], // greed, lower(a) wins
    [6, 3, { transfer: 3, winner: Winner.First, greedy: false }], // courage, higher(a) wins
    [25, 10, { transfer: 10, winner: Winner.Second, greedy: true }], // greed, lower(b) wins
    [10, 10, { transfer: 0, winner: Winner.Draw, greedy: false }], // draw
    [10, 20, { transfer: 10, winner: Winner.Second, greedy: false }], // boundary H==2L, higher(b) wins
    [10, 21, { transfer: 10, winner: Winner.First, greedy: true }], // boundary H==2L+1, lower(a) wins
  ];
  for (const [a, b, want] of cases) {
    it(`duelDetail(${a},${b})`, () => {
      expect(duelDetail(a, b)).toEqual(want);
    });
  }
});

describe("TestDuelDetail_GreedyIffLowerWon", () => {
  it("greedy is exactly the >2x condition, and exactly when the lower bid won", () => {
    const rng = mulberry32(2);
    for (let i = 0; i < 5000; i++) {
      const a = roll(rng, 500);
      const b = roll(rng, 500);
      const got = duelDetail(a, b);
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);

      if (a === b) {
        expect(got).toEqual({ transfer: 0, winner: Winner.Draw, greedy: false });
        continue;
      }
      // Transfer is always the lower bid on a non-draw.
      expect(got.transfer, `duelDetail(${a},${b}).transfer`).toBe(lo);

      const winVal = got.winner === Winner.First ? a : b;
      expect(got.winner).not.toBe(Winner.Draw);
      // Greed punishes the higher bidder, so greedy iff the LOWER value won.
      expect(got.greedy, `duelDetail(${a},${b}) greedy vs lowerWon`).toBe(winVal === lo);
      // ...and greedy must be exactly the >2x condition.
      expect(got.greedy, `duelDetail(${a},${b}) greedy vs hi>2*lo`).toBe(hi > GREED_FACTOR * lo);
    }
  });
});

describe("Winner.String", () => {
  it("renders each winner", () => {
    expect(winnerString(Winner.Draw)).toBe("Draw");
    expect(winnerString(Winner.First)).toBe("First");
    expect(winnerString(Winner.Second)).toBe("Second");
    expect(winnerString(7 as Winner)).toBe("Winner(7)");
  });
});

// --- Round settlement (the two-player case of Go's Resolve) -----------------

describe("TestResolve_HandComputedTables", () => {
  // The two-player rows of the Go table; the 3+-player rows exercise the
  // N-player loss cap, which this port does not carry (see the file header).
  const cases: Array<[[number, number], [number, number]]> = [
    [[1, 1], [0, 0]], // draw
    [[3, 6], [-3, 3]], // courage, higher(6) wins
    [[2, 5], [2, -2]], // greed, lower(2) wins
    [[10, 20], [-10, 10]], // boundary H==2L, higher wins
  ];
  for (const [bids, want] of cases) {
    it(`roundDeltas(${bids.join(",")})`, () => {
      expect(roundDeltas(bids)).toEqual(want);
    });
  }
});

describe("TestResolve_N2MatchesDuel", () => {
  it("the round settlement for two players is exactly the duel", () => {
    const rng = mulberry32(3);
    for (let i = 0; i < 2000; i++) {
      const a = roll(rng, 10_000);
      const b = roll(rng, 10_000);
      expect(roundDeltas([a, b])).toEqual(duel(a, b));
    }
  });
});

describe("TestResolve_ZeroSumRandom", () => {
  it("every round nets to zero", () => {
    const rng = mulberry32(4);
    for (let i = 0; i < 3000; i++) {
      const bids: [number, number] = [roll(rng, 1_000_000), roll(rng, 1_000_000)];
      const [d0, d1] = roundDeltas(bids);
      expect(d0 + d1, `roundDeltas(${bids.join(",")}) not zero-sum`).toBe(0);
    }
  });
});

describe("TestResolve_LossNeverExceedsBid", () => {
  it("no player ever loses more than their own bid in a round", () => {
    const rng = mulberry32(6);
    for (let i = 0; i < 5000; i++) {
      const bids: [number, number] = [roll(rng, 1000), roll(rng, 1000)];
      const deltas = roundDeltas(bids);
      for (const j of [0, 1] as const) {
        expect(-deltas[j], `player ${j} lost more than bid ${bids[j]}`).toBeLessThanOrEqual(bids[j]);
      }
    }
  });
});

describe("TestResolve_PerOpponentWinNeverExceedsWinnerBid", () => {
  it("a winner takes at most their own bid from their opponent", () => {
    const rng = mulberry32(7);
    for (let i = 0; i < 5000; i++) {
      const a = roll(rng, 10_000);
      const b = roll(rng, 10_000);
      const det = duelDetail(a, b);
      if (det.winner === Winner.Draw) continue;
      const winnerBid = det.winner === Winner.First ? a : b;
      expect(det.transfer, `stake exceeds winner bid for (${a},${b})`).toBeLessThanOrEqual(winnerBid);
    }
  });
});

describe("TestResolve_Errors", () => {
  // The Go engine's ErrInvalidBid guards `bid >= players-1`; the two-player
  // match's equivalent floor is MIN_BID (1), plus a ceiling the Go engine has
  // no notion of (it never sees a bankroll): you cannot stake what you do not
  // have.
  const m = newMatch();
  it("rejects a bid of 0", () => {
    expect(() => playRound(m, [0, 5])).toThrow(BidBelowMinimumError);
  });
  it("rejects a negative bid", () => {
    expect(() => playRound(m, [5, -1])).toThrow(BidBelowMinimumError);
  });
  it("rejects a non-integer bid", () => {
    expect(() => playRound(m, [2.5, 5])).toThrow(BidBelowMinimumError);
  });
  it("rejects a bid above the bidder's bankroll", () => {
    expect(() => playRound(m, [START_BANKROLL + 1, 5])).toThrow(BidExceedsBankrollError);
  });
  it("accepts a bid of exactly MIN_BID and exactly the bankroll", () => {
    expect(() => playRound(m, [MIN_BID, START_BANKROLL])).not.toThrow();
  });
});

// --- The two-player match (no Go counterpart: server-go/greedgame owns it) --

describe("match: defaults", () => {
  it("starts both players on 100 coins for 5 rounds", () => {
    const m = newMatch();
    expect(m.bankrolls).toEqual([START_BANKROLL, START_BANKROLL]);
    expect(START_BANKROLL).toBe(100);
    expect(m.rounds).toBe(MATCH_ROUNDS);
    expect(MATCH_ROUNDS).toBe(5);
    expect(m.round).toBe(0);
    expect(matchOutcome(m)).toEqual({ kind: "ongoing" });
    expect(maxBid(m, 0)).toBe(START_BANKROLL);
  });
});

describe("match: a round moves the stake and advances the round", () => {
  it("courage: the higher bidder takes the lower bid", () => {
    const r = playRound(newMatch(), [10, 15]);
    expect(r.detail).toEqual({ transfer: 10, winner: Winner.Second, greedy: false });
    expect(r.deltas).toEqual([-10, 10]);
    expect(r.next.bankrolls).toEqual([90, 110]);
    expect(r.next.round).toBe(1);
  });
  it("greed: the higher bidder is punished and the lower bidder takes the stake", () => {
    const r = playRound(newMatch(), [10, 25]);
    expect(r.detail).toEqual({ transfer: 10, winner: Winner.First, greedy: true });
    expect(r.next.bankrolls).toEqual([110, 90]);
  });
  it("draw: nothing moves", () => {
    const r = playRound(newMatch(), [40, 40]);
    expect(r.detail).toEqual({ transfer: 0, winner: Winner.Draw, greedy: false });
    expect(r.next.bankrolls).toEqual([START_BANKROLL, START_BANKROLL]);
    expect(r.next.round).toBe(1);
  });
});

describe("match: bankrolls are conserved across the whole match", () => {
  it("the two bankrolls always sum to twice the start", () => {
    const rng = mulberry32(11);
    for (let trial = 0; trial < 500; trial++) {
      let m = newMatch();
      while (!isMatchOver(m)) {
        const bids: [number, number] = [roll(rng, maxBid(m, 0)), roll(rng, maxBid(m, 1))];
        m = playRound(m, bids).next;
        expect(m.bankrolls[0] + m.bankrolls[1]).toBe(2 * START_BANKROLL);
        expect(m.bankrolls[0]).toBeGreaterThanOrEqual(0);
        expect(m.bankrolls[1]).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe("match: the end condition after all rounds", () => {
  const after = (bankrolls: [number, number]): GreedMatch => ({
    bankrolls,
    round: MATCH_ROUNDS,
    rounds: MATCH_ROUNDS,
    startBankroll: START_BANKROLL,
  });
  it("the larger bankroll wins", () => {
    expect(matchOutcome(after([120, 80]))).toEqual({ kind: "win", winner: 0, reason: "rounds" });
    expect(matchOutcome(after([80, 120]))).toEqual({ kind: "win", winner: 1, reason: "rounds" });
  });
  it("equal bankrolls draw", () => {
    expect(matchOutcome(after([100, 100]))).toEqual({ kind: "draw" });
  });
  it("a match is still ongoing with rounds left", () => {
    expect(matchOutcome({ ...after([120, 80]), round: MATCH_ROUNDS - 1 })).toEqual({ kind: "ongoing" });
  });
});

describe("match: early end when a bankroll reaches 0", () => {
  it("a player on 0 cannot meet the minimum bid, so the other player wins immediately", () => {
    // Player 0 has 10 left and goes all in; player 1 answers with 15, which
    // is <= 2*10 so it is courage, not greed — player 0 is wiped out.
    const m: GreedMatch = { bankrolls: [10, 190], round: 1, rounds: MATCH_ROUNDS, startBankroll: START_BANKROLL };
    const r = playRound(m, [10, 15]);
    expect(r.next.bankrolls).toEqual([0, 200]);
    expect(r.next.round).toBe(2); // rounds remain, but...
    expect(r.next.round).toBeLessThan(r.next.rounds);
    expect(matchOutcome(r.next)).toEqual({ kind: "win", winner: 1, reason: "bankrupt" });
    expect(isMatchOver(r.next)).toBe(true);
  });
  it("bankruptcy beats the round count either way round", () => {
    const m: GreedMatch = { bankrolls: [200, 0], round: 2, rounds: MATCH_ROUNDS, startBankroll: START_BANKROLL };
    expect(matchOutcome(m)).toEqual({ kind: "win", winner: 0, reason: "bankrupt" });
  });
  it("an all-in loss against a GREEDY answer does NOT bust you — greed hands you the stake", () => {
    // Same all-in, but the opponent overreaches: 25 > 2*10 is greed, so the
    // lower (all-in) bidder wins instead and survives.
    const m: GreedMatch = { bankrolls: [10, 190], round: 1, rounds: MATCH_ROUNDS, startBankroll: START_BANKROLL };
    const r = playRound(m, [10, 25]);
    expect(r.next.bankrolls).toEqual([20, 180]);
    expect(matchOutcome(r.next)).toEqual({ kind: "ongoing" });
  });
  it("refuses to play another round once the match is over", () => {
    const over: GreedMatch = { bankrolls: [0, 200], round: 2, rounds: MATCH_ROUNDS, startBankroll: START_BANKROLL };
    expect(() => playRound(over, [1, 1])).toThrow(MatchOverError);
  });
});

// --- greedThreshold ---------------------------------------------------------

describe("greedThreshold", () => {
  it("is the largest opponent bid that would make yours greedy", () => {
    expect(greedThreshold(10)).toBe(4); // 10 > 2*4, but 10 is not > 2*5
    expect(greedThreshold(11)).toBe(5); // 11 > 2*5, but 11 is not > 2*6
    expect(greedThreshold(2)).toBe(0);
    expect(greedThreshold(1)).toBe(0); // a bid of 1 can never be greedy
  });
  it("agrees with duelDetail for every bid pair up to 60", () => {
    for (let y = 1; y <= 60; y++) {
      const t = greedThreshold(y);
      for (let x = 1; x <= 60; x++) {
        // The hint only claims something about the case where YOUR bid is
        // the higher one; equal bids draw and a lower bid is never greedy.
        if (x >= y) continue;
        const iAmGreedy = duelDetail(y, x).greedy;
        expect(iAmGreedy, `y=${y} x=${x}`).toBe(x <= t);
      }
    }
  });
});

describe("maxNonGreedyBid", () => {
  it("is the largest bid that still wins as the courageous higher bidder", () => {
    for (let x = 1; x <= 60; x++) {
      const cap = maxNonGreedyBid(x);
      expect(duelDetail(cap, x).greedy, `bid ${cap} vs ${x}`).toBe(false);
      expect(duelDetail(cap + 1, x).greedy, `bid ${cap + 1} vs ${x}`).toBe(true);
    }
  });
  it("round-trips with greedThreshold", () => {
    for (let x = 1; x <= 60; x++) {
      expect(greedThreshold(maxNonGreedyBid(x))).toBe(x - 1);
    }
  });
});
