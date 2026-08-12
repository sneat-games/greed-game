// The end-of-match banner. game-kit's match-shell.ts deliberately ships no
// generic version of this (only the game knows what "win" means), so this
// game builds its own — styled entirely through theme.css's `.match-over`
// family, which IS shared chrome.
//
// Two things every Greed Game banner says that a board game's would not:
// WHY the match ended (five rounds played, or somebody ran out of coins),
// and where each bankroll finished relative to the 100 it started from —
// the movement is the score.

import type { MatchOutcome } from "../engine/greedplay";

export interface MatchOverOptions {
  outcome: MatchOutcome;
  /** Which seat the local player occupies. */
  you: 0 | 1;
  youLabel: string;
  themLabel: string;
  bankrolls: readonly [number, number];
  startBankroll: number;
  rounds: number;
}

export function renderMatchOver(opts: MatchOverOptions): HTMLElement {
  const { outcome, you, youLabel, themLabel } = opts;
  const them: 0 | 1 = you === 0 ? 1 : 0;

  const result: "win" | "loss" | "draw" =
    outcome.kind === "draw" ? "draw" : outcome.kind === "win" && outcome.winner === you ? "win" : "loss";
  const reason = outcome.kind === "win" ? outcome.reason : "rounds";

  const el = document.createElement("div");
  el.className = `match-over match-over--${result}`;
  el.setAttribute("data-match-over", "");
  el.setAttribute("data-outcome", result);
  el.setAttribute("data-reason", reason);

  const headline = document.createElement("p");
  headline.className = "match-over__headline";
  headline.textContent = headlineText({ result, reason, youLabel, themLabel, rounds: opts.rounds });
  el.append(headline);

  const box = document.createElement("div");
  box.className = "match-over__balances";
  box.append(
    balanceRow(youLabel, opts.bankrolls[you], opts.startBankroll),
    balanceRow(themLabel, opts.bankrolls[them], opts.startBankroll),
  );
  el.append(box);

  return el;
}

function headlineText(args: {
  result: "win" | "loss" | "draw";
  reason: "rounds" | "bankrupt";
  youLabel: string;
  themLabel: string;
  rounds: number;
}): string {
  const { result, reason, themLabel, rounds } = args;
  if (result === "draw") return `Dead level after ${rounds} rounds — a draw.`;
  if (reason === "bankrupt") {
    return result === "win"
      ? `${themLabel} ran out of coins — you win!`
      : `You ran out of coins — ${themLabel} wins.`;
  }
  return result === "win"
    ? `You finish ahead after ${rounds} rounds — you win!`
    : `${themLabel} finishes ahead after ${rounds} rounds — you lose.`;
}

function balanceRow(label: string, value: number, initial: number): HTMLElement {
  const row = document.createElement("div");
  row.className = "match-over__balance";
  row.setAttribute("data-final-balance", label);

  const l = document.createElement("span");
  l.className = "match-over__balance-label";
  l.textContent = label;

  const v = document.createElement("span");
  v.className = "match-over__balance-value";
  v.textContent = String(value);

  const delta = value - initial;
  const d = document.createElement("span");
  d.className = `match-over__balance-delta${
    delta > 0 ? " match-over__balance-delta--up" : delta < 0 ? " match-over__balance-delta--down" : ""
  }`;
  d.setAttribute("data-delta", String(delta));
  d.textContent = delta === 0 ? "±0" : delta > 0 ? `+${delta}` : String(delta);

  row.append(l, v, d);
  return row;
}
