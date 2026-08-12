// Turning one resolved round into a game-kit log entry.
//
// The kit's game-log is deliberately game-agnostic (see its doc comment): it
// takes a headline plus zero or more "bar rows" and knows nothing about what
// they mean. The Greed Game's headline is the VERDICT — courage, greed or a
// dead heat — because that is the thing a player wants to scan back through
// a match for ("when did I get punished?"), and the rows are the two bids
// against the bankrolls they were staked from.
//
// Both bids are logged in full. They were secret only until the reveal; a
// log that kept hiding the opponent's number would make the match
// unreviewable for no benefit.

import { type DuelResult } from "../engine/greedplay";
import { seatOf, verdictKind, type VerdictKind } from "./table";
import type { GameLogEntry, GameLogRow } from "@sneat/game-kit";

export interface RoundLogArgs {
  /** Zero-based round index — the kit renders it as `T{n+1}`. */
  round: number;
  /** Which seat the local player occupies. */
  you: 0 | 1;
  labels: readonly [string, string];
  bids: readonly [number, number];
  detail: DuelResult;
  deltas: readonly [number, number];
  /** Bankrolls as they stood BEFORE the round, so each bar reads as "this
   *  share of what I had". */
  bankrollsBefore: readonly [number, number];
}

export function roundLogEntry(args: RoundLogArgs): GameLogEntry {
  const kind = verdictKind(args.detail);
  const winner = seatOf(args.detail.winner);

  return {
    turn: args.round,
    head: headline(kind, winner, args),
    tie: kind === "draw",
    rows: [row(0, args), row(1, args)],
  };
}

function headline(kind: VerdictKind, winner: 0 | 1 | null, args: RoundLogArgs): Node {
  const frag = document.createDocumentFragment();

  const chip = document.createElement("span");
  chip.className = "log-verdict";
  chip.dataset.verdictKind = kind;
  chip.textContent = kind === "courage" ? "Courage" : kind === "greed" ? "Greed" : "Dead heat";
  frag.append(chip);

  const tail =
    winner === null
      ? " — nothing moves"
      : ` — ${args.labels[winner]} ${winner === args.you ? "take" : "takes"} ${args.detail.transfer}`;
  frag.append(document.createTextNode(tail));
  return frag;
}

function row(seat: 0 | 1, args: RoundLogArgs): GameLogRow {
  const before = args.bankrollsBefore[seat];
  return {
    label: args.labels[seat],
    value: String(args.bids[seat]),
    // Share of what that player had to stake, so the two bars are honest
    // even when the bankrolls have drifted far apart.
    fraction: before > 0 ? args.bids[seat] / before : 0,
    player: seat,
    won: seatOf(args.detail.winner) === seat,
    dim: seatOf(args.detail.winner) !== null && seatOf(args.detail.winner) !== seat,
  };
}
