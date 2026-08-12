// vs Bot. Five rounds of hidden bids against the local bot, entirely
// client-side (docs/DESIGN.md "Offline": bots run in the browser, so
// single-player works with no network at all).
//
// Mirrors the shape of hex/web/src/ui/vs-bot-bidding.ts: the bot's bid is
// computed BEFORE the human is asked, so it is already "in" when askBid
// starts — the human always answers on the longer VS_BOT_LATE_BID_MS clock
// and the 30-second stall case can never arise here.

import {
  createBalances,
  createConfirmButton,
  createGameLog,
  createMatchShell,
  VS_BOT_LATE_BID_MS,
  type GameLog,
  type MatchShell,
} from "@sneat/game-kit";
import {
  MATCH_ROUNDS,
  START_BANKROLL,
  matchOutcome,
  newMatch,
  playRound,
  type GreedMatch,
  type MatchOutcome,
} from "../engine/greedplay";
import { botStateFor, pickBid } from "../bot/bot";
import { askBid, BidAbortedError } from "./ask-bid";
import { createBidHero, type BidHero } from "./bid-hero";
import { createDuelTable, type DuelTable } from "./table";
import { renderMatchOver } from "./match-over";
import { roundLogEntry } from "./round-log";
import { recordVsBotResult } from "./standings";

const HUMAN = 0 as const;
const BOT = 1 as const;
const LABELS = ["You", "Bot"] as const;

export async function runVsBot(root: HTMLElement): Promise<void> {
  const balances = createBalances({ initialBudget: START_BANKROLL, p1Label: LABELS[0], p2Label: LABELS[1] });
  const hero = createBidHero();
  const log = createGameLog();
  const shell = createMatchShell({ root, topLeft: balances.el, topRight: hero.el, log: log.el });

  let restart = new AbortController();
  const newMatchBtn = createConfirmButton({
    label: "New match",
    confirmLabel: "Restart — click again",
    onConfirm: () => restart.abort(),
  });
  shell.actions.append(newMatchBtn.el);

  // Torn down and recreated only when a NEW match is about to start — not
  // the instant the current one ends, or the final round's reveal (drawn at
  // the moment the match finishes) would vanish before the banner appears.
  // game-kit/docs/APP-PLAYBOOK.md gotcha 4.
  let table = createDuelTable(shell.boardSlot, { youLabel: LABELS[0], themLabel: LABELS[1], you: HUMAN });

  const resetForNewMatch = () => {
    table.destroy();
    shell.reset();
    log.clear();
    balances.update([START_BANKROLL, START_BANKROLL]);
    table = createDuelTable(shell.boardSlot, { youLabel: LABELS[0], themLabel: LABELS[1], you: HUMAN });
  };

  for (;;) {
    restart = new AbortController();
    newMatchBtn.disarm();

    const finished = await playMatch(table, hero, balances, log, restart.signal);
    if (finished === null) {
      // "New match" mid-match: start over without a result screen.
      resetForNewMatch();
      continue;
    }

    recordVsBotResult(resultFor(finished.outcome));
    shell.actions.hidden = true;
    const again = await renderFinal(shell, finished.outcome, finished.match);
    if (!again) {
      table.destroy();
      return;
    }
    resetForNewMatch();
  }
}

function resultFor(outcome: MatchOutcome): "win" | "loss" | "draw" {
  if (outcome.kind === "draw") return "draw";
  if (outcome.kind === "win") return outcome.winner === HUMAN ? "win" : "loss";
  // Unreachable: playMatch only returns terminal outcomes.
  return "draw";
}

async function playMatch(
  table: DuelTable,
  hero: BidHero,
  balances: ReturnType<typeof createBalances>,
  log: GameLog,
  signal: AbortSignal,
): Promise<{ outcome: MatchOutcome; match: GreedMatch } | null> {
  let match = newMatch();

  for (;;) {
    table.beginRound(match.round, match.rounds);

    // The bot commits first (hidden), so its bid is already in when the
    // human is asked — see the module comment.
    const botBid = pickBid(botStateFor(match, BOT));

    let humanBid: number;
    try {
      humanBid = await askBid({
        hero,
        table,
        ownBalance: match.bankrolls[HUMAN],
        opponentBalance: match.bankrolls[BOT],
        opponentBidIn: true,
        lateBidMs: VS_BOT_LATE_BID_MS,
        abort: signal,
      });
    } catch (e) {
      if (e instanceof BidAbortedError) return null;
      throw e;
    }

    table.lockYours(humanBid);
    hero.setWaiting("Bids are in — revealing…");

    const bids: [number, number] = [humanBid, botBid];
    const bankrollsBefore = match.bankrolls;
    const result = playRound(match, bids);

    await table.reveal({
      you: HUMAN,
      bids,
      detail: result.detail,
      deltas: result.deltas,
      // The bars move as the stake travels, not after the whole reveal.
      onStake: () => balances.update(result.next.bankrolls),
    });

    match = result.next;
    log.append(
      roundLogEntry({
        round: result.next.round - 1,
        you: HUMAN,
        labels: LABELS,
        bids,
        detail: result.detail,
        deltas: result.deltas,
        bankrollsBefore,
      }),
    );

    const outcome = matchOutcome(match);
    if (outcome.kind !== "ongoing") return { outcome, match };
  }
}

function renderFinal(shell: MatchShell, outcome: MatchOutcome, match: GreedMatch): Promise<boolean> {
  const banner = renderMatchOver({
    outcome,
    you: HUMAN,
    youLabel: LABELS[0],
    themLabel: LABELS[1],
    bankrolls: match.bankrolls,
    startBankroll: match.startBankroll,
    rounds: MATCH_ROUNDS,
  });

  const again = document.createElement("button");
  again.type = "button";
  again.className = "btn btn--primary";
  again.textContent = "Rematch";

  const leave = document.createElement("button");
  leave.type = "button";
  leave.className = "btn btn--ghost";
  leave.textContent = "Back to menu";

  shell.controls.append(banner, again, leave);
  return new Promise((resolve) => {
    again.addEventListener("click", () => resolve(true));
    leave.addEventListener("click", () => resolve(false));
  });
}
