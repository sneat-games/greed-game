// The duel table — this game's equivalent of a board.
//
// The Greed Game has NO board: the whole game is two hidden numbers meeting
// each other. So the thing that occupies game-kit's `boardSlot` (see the
// kit's match-shell.ts: "board rendering is 100% game-owned") is a table with
// two cards on it — yours and theirs — a round tracker above them, and the
// verdict below. Everything the player needs to read a round is here:
//
//   Round 3 of 5   ● ● ○ ○ ○
//   ┌──────────┐         ┌──────────┐
//   │   YOU    │   vs    │   BOT    │
//   │    24    │         │    ??    │
//   └──────────┘         └──────────┘
//              [ Lock in bid ]
//   Courage — your 24 beat their 20. You take 20.
//
// The drama is the reveal: both cards flip face-up together, the verdict
// lands a beat later, and the stake visibly travels to whoever won it. All
// three beats collapse to nothing under `prefers-reduced-motion` — the kit's
// theme.css already neuters CSS durations there, but the JS waits have to
// collapse too or the game merely feels slow instead of animated.

import { Winner, type DuelResult } from "../engine/greedplay";

/** Card flip duration; mirrored by `.duel-card` in styles/table.css. */
const FLIP_MS = 350;
/** How long after the flip the verdict sentence lands. */
const VERDICT_MS = 450;
/** How long the stake chip takes to travel to the winner. */
const STAKE_MS = 900;

export type VerdictKind = "courage" | "greed" | "draw";

export interface RevealArgs {
  /** Which seat the local player occupies. */
  you: 0 | 1;
  /** Both bids, `[player 0, player 1]`. */
  bids: readonly [number, number];
  /** The engine's own account of the round. */
  detail: DuelResult;
  /** Coin movement, `[player 0, player 1]`. */
  deltas: readonly [number, number];
  /**
   * Called at the exact moment the stake starts travelling, so the caller
   * can move the bankroll bars in step with it. The coins leaving one card
   * and the bar shrinking are one event to the player; splitting them (bars
   * after the whole reveal) reads as a lag, not as an animation.
   */
  onStake?(): void;
}

export interface DuelTable {
  el: HTMLElement;
  /** Start a round: cards face-down, verdict cleared, lock button armed. */
  beginRound(round: number, rounds: number): void;
  /** Live echo of the bid currently dialled into the bid panel. */
  setDialledBid(bid: number): void;
  /** Your bid is committed: the card locks and the button goes quiet. */
  lockYours(bid: number): void;
  /** The opponent has committed (their value stays hidden). */
  opponentCommitted(): void;
  /** Called when the player commits their bid. Replaces any previous handler. */
  onLock(handler: (() => void) | null): void;
  /** Enable/disable the commit button (e.g. while waiting for a peer). */
  enableLock(enabled: boolean, label?: string): void;
  /** Flip both cards, animate the verdict, move the stake. Resolves when the
   *  round has finished being told. */
  reveal(args: RevealArgs): Promise<void>;
  /** Tear down timers. Safe to call twice. */
  destroy(): void;
}

export interface DuelTableOptions {
  youLabel: string;
  themLabel: string;
  /** Which seat the local player occupies — decides which card is "yours". */
  you: 0 | 1;
}

export function createDuelTable(root: HTMLElement, opts: DuelTableOptions): DuelTable {
  const el = document.createElement("div");
  el.className = "duel-table";
  el.setAttribute("data-duel-table", "");

  // --- round tracker ------------------------------------------------------
  const tracker = document.createElement("div");
  tracker.className = "duel-table__tracker";

  const roundLabel = document.createElement("p");
  roundLabel.className = "duel-table__round";
  roundLabel.setAttribute("data-round-tracker", "");

  const pips = document.createElement("ol");
  pips.className = "duel-table__pips";
  pips.setAttribute("data-round-pips", "");
  pips.setAttribute("aria-hidden", "true"); // the label beside it says the same thing

  tracker.append(roundLabel, pips);

  // --- the two cards ------------------------------------------------------
  const yourCard = createBidCard("you", opts.youLabel);
  const theirCard = createBidCard("them", opts.themLabel);

  const middle = document.createElement("div");
  middle.className = "duel-table__middle";
  const vs = document.createElement("span");
  vs.className = "duel-table__vs";
  vs.textContent = "vs";
  const stake = document.createElement("span");
  stake.className = "duel-table__stake";
  stake.setAttribute("data-stake", "");
  stake.hidden = true;
  middle.append(vs, stake);

  const cards = document.createElement("div");
  cards.className = "duel-table__cards";
  cards.append(yourCard.el, middle, theirCard.el);

  // --- verdict + commit ---------------------------------------------------
  const verdict = document.createElement("p");
  verdict.className = "duel-verdict";
  verdict.setAttribute("data-verdict", "");
  verdict.setAttribute("role", "status");
  verdict.hidden = true;

  const lock = document.createElement("button");
  lock.type = "button";
  lock.className = "btn btn--primary duel-table__lock";
  lock.setAttribute("data-lock-bid", "");
  lock.textContent = "Lock in bid";

  const commitRow = document.createElement("div");
  commitRow.className = "duel-table__commit";
  commitRow.append(lock);

  el.append(tracker, cards, commitRow, verdict);
  root.append(el);

  // --- behaviour ----------------------------------------------------------
  let handler: (() => void) | null = null;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  lock.addEventListener("click", () => handler?.());

  function wait(ms: number): Promise<void> {
    const real = reducedMotion() ? 0 : ms;
    if (real === 0) return Promise.resolve();
    return new Promise((resolve) => {
      const t = setTimeout(() => {
        timers.delete(t);
        resolve();
      }, real);
      timers.add(t);
    });
  }

  function beginRound(round: number, rounds: number): void {
    roundLabel.textContent = `Round ${round + 1} of ${rounds}`;
    renderPips(pips, round, rounds);

    yourCard.reset("Choose your bid");
    theirCard.reset("Bidding…");

    // The verdict is NOT wiped here. It belongs to the round that just
    // finished, and wiping it as the next round opens is how a result goes
    // unread in every round but the last — the same lesson game-kit's
    // match-shell.ts records about its note line. It stays, marked stale,
    // until the next reveal replaces it. Only the first round of a match
    // starts with nothing to say.
    if (round === 0) {
      verdict.hidden = true;
      verdict.textContent = "";
      verdict.removeAttribute("data-kind");
      verdict.removeAttribute("data-winner");
    } else if (!verdict.hidden) {
      verdict.dataset.stale = "";
    }
    stake.hidden = true;
    stake.removeAttribute("data-direction");
    el.removeAttribute("data-revealed");
    el.removeAttribute("data-round-verdict");
    enableLock(true);
  }

  function enableLock(enabled: boolean, label?: string): void {
    lock.disabled = !enabled;
    if (label !== undefined) lock.textContent = label;
  }

  async function reveal(args: RevealArgs): Promise<void> {
    const them: 0 | 1 = args.you === 0 ? 1 : 0;
    const mine = args.bids[args.you];
    const theirs = args.bids[them];

    yourCard.show(mine, "Revealed");
    theirCard.show(theirs, "Revealed");
    el.setAttribute("data-revealed", "");
    await wait(FLIP_MS);

    const kind = verdictKind(args.detail);
    const winnerSeat = seatOf(args.detail.winner);
    const iWon = winnerSeat === args.you;

    // The table carries the kind too, so styles/table.css can reach the
    // punished CARD from the verdict (they are siblings, and the sting
    // belongs on the card). Deliberately a DIFFERENT attribute name from the
    // verdict paragraph's own `data-verdict`, so a `[data-verdict]` selector
    // — in CSS or in a test — resolves to exactly one element.
    el.dataset.roundVerdict = kind;
    verdict.hidden = false;
    verdict.removeAttribute("data-stale");
    verdict.dataset.kind = kind;
    verdict.dataset.winner = winnerSeat === null ? "none" : iWon ? "you" : "them";
    verdict.textContent = verdictText({ kind, iWon, mine, theirs, transfer: args.detail.transfer });
    yourCard.setOutcome(winnerSeat === null ? "draw" : iWon ? "won" : "lost");
    theirCard.setOutcome(winnerSeat === null ? "draw" : iWon ? "lost" : "won");
    await wait(VERDICT_MS);

    // The stake travels to whoever took it, and the bankroll bars move with
    // it. A draw moves nothing, so there is nothing to animate — but the
    // caller is still told, so it never has to special-case the draw.
    const delta = args.deltas[args.you];
    args.onStake?.();
    if (delta !== 0) {
      stake.hidden = false;
      stake.dataset.direction = delta > 0 ? "to-you" : "to-them";
      stake.textContent = `${delta > 0 ? "+" : "−"}${Math.abs(delta)}`;
      await wait(STAKE_MS);
    }
  }

  return {
    el,
    beginRound,
    setDialledBid: (bid) => yourCard.show(bid, "Not locked in yet"),
    lockYours: (bid) => {
      yourCard.show(bid, "Locked in 🔒");
      yourCard.lock();
      enableLock(false, "Bid locked in");
    },
    opponentCommitted: () => theirCard.hide("Bid is in 🔒"),
    onLock: (h) => {
      handler = h;
    },
    enableLock,
    reveal,
    destroy() {
      handler = null;
      for (const t of timers) clearTimeout(t);
      timers.clear();
      el.remove();
    },
  };
}

// --- pieces ---------------------------------------------------------------

interface BidCard {
  el: HTMLElement;
  /** Face-down: no number, just a state line. */
  hide(state: string): void;
  /** Face-up with a value. */
  show(value: number, state: string): void;
  /** Back to face-down and unlocked, with a fresh state line. */
  reset(state: string): void;
  lock(): void;
  setOutcome(outcome: "won" | "lost" | "draw"): void;
}

function createBidCard(side: "you" | "them", label: string): BidCard {
  const el = document.createElement("section");
  el.className = `duel-card duel-card--${side}`;
  el.setAttribute("data-bid-card", side);

  const who = document.createElement("h3");
  who.className = "duel-card__who";
  who.textContent = label;

  const face = document.createElement("div");
  face.className = "duel-card__face";

  const value = document.createElement("span");
  value.className = "duel-card__value";
  value.setAttribute("data-bid-value", "");
  face.append(value);

  const state = document.createElement("p");
  state.className = "duel-card__state";
  state.setAttribute("data-bid-state", "");

  el.append(who, face, state);

  function hide(text: string) {
    el.dataset.face = "down";
    // A real glyph rather than an empty box: the card should read as
    // "a bid is hidden here", not as "nothing here".
    value.textContent = "?";
    value.removeAttribute("data-value");
    state.textContent = text;
  }
  function show(v: number, text: string) {
    el.dataset.face = "up";
    value.textContent = String(v);
    value.dataset.value = String(v);
    state.textContent = text;
  }
  hide("");

  return {
    el,
    hide,
    show,
    reset(text: string) {
      el.removeAttribute("data-locked");
      el.removeAttribute("data-outcome");
      hide(text);
    },
    lock() {
      el.dataset.locked = "";
    },
    setOutcome(outcome) {
      el.dataset.outcome = outcome;
    },
  };
}

function renderPips(list: HTMLElement, round: number, rounds: number): void {
  list.innerHTML = "";
  for (let i = 0; i < rounds; i++) {
    const li = document.createElement("li");
    li.className = "duel-table__pip";
    li.dataset.state = i < round ? "done" : i === round ? "current" : "todo";
    list.append(li);
  }
}

/** Which seat won, or null on a draw. */
export function seatOf(w: Winner): 0 | 1 | null {
  if (w === Winner.First) return 0;
  if (w === Winner.Second) return 1;
  return null;
}

/** Name the round for the log, the verdict line and the aria status. */
export function verdictKind(detail: DuelResult): VerdictKind {
  if (detail.winner === Winner.Draw) return "draw";
  return detail.greedy ? "greed" : "courage";
}

export function verdictText(args: {
  kind: VerdictKind;
  iWon: boolean;
  mine: number;
  theirs: number;
  transfer: number;
}): string {
  const { kind, iWon, mine, theirs, transfer } = args;
  if (kind === "draw") return `Dead heat — you both bid ${mine}. Nothing moves.`;
  if (kind === "courage") {
    return iWon
      ? `Courage — your ${mine} beat their ${theirs}. You take ${transfer}.`
      : `Courage — their ${theirs} beat your ${mine}. They take ${transfer}.`;
  }
  return iWon
    ? `Greed! Their ${theirs} was more than double your ${mine} — the rule punishes them. You take ${transfer}.`
    : `Greed! Your ${mine} was more than double their ${theirs} — the rule punishes you. They take ${transfer}.`;
}

function reducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}
