// The bid panel, which in this game is the whole input surface — there is no
// board to click, so the number IS the move.
//
// This wraps game-kit's `createBidPanel` (slider + number field + turn clock)
// rather than replacing it, and adds the two things The Greed Game needs on
// top:
//
//   1. **A minimum of 1.** The kit's bid-input is written for first-price
//      auctions, where bidding 0 is a legal "I pass" — so its slider and
//      number field are hard-wired to `min="0"`. Here a bid must be at least
//      MIN_BID: you always have something at stake. We raise the DOM
//      minimum after every `beginTurn` (which rebuilds the controls) so the
//      slider physically cannot reach 0, AND clamp on read so a number field
//      typed down to 0 still submits a legal bid. Both, not either: the DOM
//      attribute is what the player feels, the clamp is what the engine is
//      promised.
//   2. **The live greed hint** (see greed-hint.ts), re-rendered on every
//      slider tick from the local bid alone.
//
// It also keeps the clock's "no bid -> you auto-bid N" line honest: the kit
// writes that line once when the countdown starts, but here the auto-bid IS
// whatever is currently dialled, so it is rewritten on every change.

import { createBidPanel, type BidPanel, type ClockOptions } from "@sneat/game-kit";
import { MIN_BID } from "../engine/greedplay";
import { createGreedHint, type GreedHintView } from "./greed-hint";

export interface BidHero {
  el: HTMLElement;
  /** Rebuild the controls for a new round's bankroll. */
  beginRound(max: number): void;
  /** The bid currently dialled, clamped into `[MIN_BID, max]`. */
  value(): number;
  /** Called on every change to the dialled bid, with the clamped value. */
  onInput(cb: (bid: number) => void): void;
  /** Replace the panel's hint line (the kit's default talks about boards). */
  setHint(text: string): void;
  runClock(opts: ClockOptions): void;
  stopClock(): void;
  setWaiting(message: string): void;
}

export function createBidHero(): BidHero {
  const panel: BidPanel = createBidPanel();
  const hint: GreedHintView = createGreedHint(MIN_BID);

  // The kit panel's children are [title, input slot, hint, clock]; the greed
  // hint belongs directly under the kit's own hint line, above the clock.
  const kitHint = panel.el.querySelector("[data-bid-hint]");
  if (kitHint) kitHint.after(hint.el);
  else panel.el.append(hint.el);

  let max = 0;
  const listeners = new Set<(bid: number) => void>();
  let clockRunning = false;

  function clamp(v: number): number {
    const hi = Math.max(MIN_BID, Math.floor(max));
    const n = Math.floor(Number.isFinite(v) ? v : MIN_BID);
    return n < MIN_BID ? MIN_BID : n > hi ? hi : n;
  }

  function value(): number {
    return clamp(panel.value());
  }

  function enforceMinimum(): void {
    for (const sel of [".bid-input__slider", ".bid-input__number"]) {
      const input = panel.el.querySelector<HTMLInputElement>(sel);
      if (input) input.min = String(MIN_BID);
    }
  }

  function setAutoBidLine(): void {
    if (!clockRunning) return;
    const auto = panel.el.querySelector("[data-auto-bid]");
    // The kit writes this once when the countdown starts; here the auto-bid
    // is whatever is dialled at the moment it expires, so it must follow.
    if (auto) auto.textContent = `No bid → you auto-bid ${value()}`;
  }

  // `input` bubbles from both controls, and the slot is rebuilt every round,
  // so one delegated listener on the panel outlives every rebuild.
  panel.el.addEventListener("input", () => {
    const v = value();
    hint.update(v);
    setAutoBidLine();
    for (const cb of listeners) cb(v);
  });

  return {
    el: panel.el,
    beginRound(newMax: number) {
      max = Math.max(MIN_BID, Math.floor(newMax));
      // A modest default rather than the kit's half-your-budget: in this
      // game the stake is the LOWER bid, so half your bankroll is a wild
      // opening, and the opening number a player sees teaches them the game.
      const initial = Math.min(max, Math.max(MIN_BID, Math.round(max * 0.2)));
      panel.beginTurn({ max, initial });
      enforceMinimum();
      clockRunning = false;
      hint.update(value());
      for (const cb of listeners) cb(value());
    },
    value,
    onInput(cb) {
      listeners.add(cb);
    },
    setHint(text: string) {
      const el = panel.el.querySelector("[data-bid-hint]");
      if (el) el.textContent = text;
    },
    runClock(opts: ClockOptions) {
      clockRunning = true;
      panel.runClock(opts);
      setAutoBidLine();
    },
    stopClock() {
      clockRunning = false;
      panel.stopClock();
    },
    setWaiting(message: string) {
      clockRunning = false;
      panel.setWaiting(message);
    },
  };
}
