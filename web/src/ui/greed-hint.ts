// The self-referential greed hint — the one piece of teaching the screen
// does while a bid is being dialled.
//
// THE SECRECY CONTRACT: every sentence this module produces is a function of
// the LOCAL player's own bid and nothing else. `greedHint` takes exactly one
// argument, `yourBid`, so there is no channel through which the opponent's
// hidden bid could reach it — not a stale closure, not an "opponent has bid"
// flag, not the bankrolls. That is deliberate: a hint derived from anything
// the opponent chose would leak information in a hidden-bid game, which is
// the whole game. Keep the signature one-argument, and the property holds by
// construction rather than by review.
//
// What it teaches: your bid is GREEDY when it is strictly more than twice
// your opponent's — and being greedy loses you the round. So for any bid you
// dial there is a line below which the opponent's bid would punish you. That
// line is `greedThreshold(yourBid)` (see ../engine/greedplay.ts), and it is
// something you can compute about YOURSELF without knowing anything at all
// about them.

import { greedThreshold } from "../engine/greedplay";

export interface GreedHint {
  /** The largest opponent bid that would make `yourBid` greedy. 0 means no
   *  legal opponent bid can — the bid is unconditionally safe from the greed
   *  rule. */
  threshold: number;
  /** The most this bid can cost you this round: you never lose more than you
   *  staked, because the stake is the LOWER of the two bids. */
  atRisk: number;
  /** "safe" when the greed rule cannot touch this bid at all. */
  tone: "safe" | "risk";
  /** One sentence, ready to render. */
  text: string;
}

/** Build the hint for a bid the local player is currently dialling. */
export function greedHint(yourBid: number): GreedHint {
  const bid = Math.max(0, Math.floor(yourBid));
  const threshold = greedThreshold(bid);
  const atRisk = bid;

  if (threshold <= 0) {
    return {
      threshold: 0,
      atRisk,
      tone: "safe",
      text: `A bid of ${bid} can never be greedy — no legal bid is low enough to double under.`,
    };
  }
  const target = threshold === 1 ? "1" : `${threshold} or less`;
  return {
    threshold,
    atRisk,
    tone: "risk",
    text: `If your opponent bids ${target}, your ${bid} is greed — they take the round.`,
  };
}

export interface GreedHintView {
  el: HTMLElement;
  /** Re-render for a newly dialled bid. */
  update(yourBid: number): void;
}

/**
 * The rendered hint. `update` is the only way anything reaches it, and
 * `update` takes only the local bid — see the secrecy contract above.
 */
export function createGreedHint(initialBid = 0): GreedHintView {
  const el = document.createElement("p");
  el.className = "greed-hint";
  el.setAttribute("data-greed-hint", "");
  // Announced politely: it changes on every slider tick, so `assertive`
  // would make a screen reader unusable while dialling.
  el.setAttribute("aria-live", "polite");

  function update(yourBid: number): void {
    const hint = greedHint(yourBid);
    el.dataset.tone = hint.tone;
    el.dataset.threshold = String(hint.threshold);
    el.textContent = hint.text;
  }

  update(initialBid);
  return { el, update };
}
