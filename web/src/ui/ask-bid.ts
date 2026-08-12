// Asking the local player for their bid for one round.
//
// There is no board here, so unlike every other kit game the commit gesture
// is a button on the table ("Lock in bid") rather than a click on a cell —
// but the clock rules are exactly the ones the kit documents, and are the
// same in every Sneat bidding game:
//
//   - Opponent's bid already in -> LATE_BID_MS to answer.
//   - Nobody has bid yet        -> STALL_MS; a late-arriving opponent bid
//     replaces the stall clock with the shorter answer clock.
//
// The auto-bid on expiry is the value the player already has dialled (see
// bid-hero.ts, which keeps the panel's "you auto-bid N" line following it),
// clamped into the legal band. The kit's own LATE_BID_DEFAULT of 0 is not
// usable here: 0 is not a legal Greed Game bid. Crucially the clock is still
// SELF-ENFORCED — a client only ever submits its OWN bid, so a timeout can
// never make the two peers disagree about a round.
//
// vs-Bot passes `opponentBidIn: true` (the bot's hidden bid is computed
// before the human is asked — see vs-bot.ts) with the longer
// VS_BOT_LATE_BID_MS, so a solo player is never rushed by the PvP clock.

import { LATE_BID_MS, STALL_MS, stallBid } from "@sneat/game-kit";
import { MIN_BID } from "../engine/greedplay";
import type { BidHero } from "./bid-hero";
import type { DuelTable } from "./table";

/** Thrown when a round is interrupted — currently only by "New match". */
export class BidAbortedError extends Error {
  constructor() {
    super("askBid: the round was aborted");
    this.name = "BidAbortedError";
  }
}

export interface AskBidOptions {
  hero: BidHero;
  table: DuelTable;
  /** The local player's bankroll — the bid ceiling for this round. */
  ownBalance: number;
  /** The opponent's bankroll. Public information; used only for the stall
   *  default, never for the greed hint. */
  opponentBalance: number;
  /** True when the opponent's bid is already in as this round starts. */
  opponentBidIn: boolean;
  /** Subscribe to the opponent's bid landing mid-round (vs-Friend only). */
  onOpponentBid?(fn: () => void): () => void;
  /** Abandon the round — rejects with BidAbortedError. vs-Bot only. */
  abort?: AbortSignal;
  /** Answer window once the opponent's bid is in. Defaults to the PvP
   *  LATE_BID_MS; vs-Bot passes the longer VS_BOT_LATE_BID_MS. */
  lateBidMs?: number;
}

export function askBid(opts: AskBidOptions): Promise<number> {
  const { hero, table, ownBalance, opponentBalance } = opts;

  hero.beginRound(ownBalance);
  hero.setHint(`Bid between ${MIN_BID} and ${ownBalance}, then lock it in.`);
  table.setDialledBid(hero.value());
  table.enableLock(true, "Lock in bid");
  if (opts.opponentBidIn) table.opponentCommitted();

  return new Promise<number>((resolve, reject) => {
    let settled = false;
    let unsubscribe: (() => void) | undefined;

    const settle = (run: () => void) => {
      if (settled) return;
      settled = true;
      unsubscribe?.();
      opts.abort?.removeEventListener("abort", onAbort);
      table.onLock(null);
      hero.stopClock();
      run();
    };
    const finish = (bid: number) => settle(() => resolve(clamp(bid, ownBalance)));
    function onAbort() {
      settle(() => reject(new BidAbortedError()));
    }

    if (opts.abort?.aborted) {
      onAbort();
      return;
    }
    opts.abort?.addEventListener("abort", onAbort, { once: true });

    hero.onInput((bid) => {
      if (!settled) table.setDialledBid(bid);
    });

    const runLateBidClock = () => {
      if (settled) return;
      table.opponentCommitted();
      hero.runClock({
        ms: opts.lateBidMs ?? LATE_BID_MS,
        label: "Opponent has bid — answer within",
        autoBid: hero.value(),
        // Read the dialled value AT EXPIRY, not at clock start: the player
        // may keep moving the slider while it runs, and the panel's own
        // "you auto-bid N" line is kept in step with this (bid-hero.ts).
        onExpire: () => finish(hero.value()),
      });
    };

    if (opts.opponentBidIn) {
      runLateBidClock();
    } else {
      // stallBid can return 0 for a bankroll of 1 (it halves); clamp it into
      // the legal band like every other bid this module submits.
      const auto = clamp(stallBid(ownBalance, opponentBalance), ownBalance);
      hero.runClock({
        ms: STALL_MS,
        label: "Bid within",
        autoBid: auto,
        onExpire: () => finish(auto),
      });
      unsubscribe = opts.onOpponentBid?.(runLateBidClock);
    }

    table.onLock(() => finish(hero.value()));
  });
}

function clamp(bid: number, max: number): number {
  const hi = Math.max(MIN_BID, Math.floor(max));
  const n = Math.floor(Number.isFinite(bid) ? bid : MIN_BID);
  return n < MIN_BID ? MIN_BID : n > hi ? hi : n;
}
