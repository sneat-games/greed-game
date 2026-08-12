// vs Friend: the round loop over an open peer connection.
//
// Bids are hidden with game-kit's commit-reveal primitives — `commitPayload
// ([bid], salt)`, then a reveal both sides verify against the commitment.
// Neither peer can read the other's bid before both are committed, and
// neither can change theirs after seeing the other's, because the reveal has
// to hash back to a commitment that was already on the wire. No server is
// involved: the relay only carries the WebRTC handshake.
//
// The payload is `[bid]` alone (Dots & Boxes' shape, not Hex's `[bid, cell]`)
// because a Greed Game round has nothing else in it — the bid IS the move.
//
// Turn clocks are self-enforced: each client only ever auto-submits its OWN
// bid (see ask-bid.ts), so a timeout can never leave the two peers disagreeing
// about a round. A silent peer abandons the match rather than being resolved
// by guesswork — mirrors bidding-tictactoe/web/src/ui/vs-friend.ts and
// hex/web/src/ui/friend-bidding.ts.

import {
  commitPayload,
  createBalances,
  createGameLog,
  createMatchShell,
  newSalt,
  openTurnInbox,
  verifyPayload,
  type GameLog,
  type MatchShell,
  type PeerHandle,
  type WireMessage,
} from "@sneat/game-kit";
import {
  MATCH_ROUNDS,
  MIN_BID,
  START_BANKROLL,
  matchOutcome,
  newMatch,
  playRound,
  type GreedMatch,
  type MatchOutcome,
} from "../engine/greedplay";
import { askBid } from "./ask-bid";
import { createBidHero, type BidHero } from "./bid-hero";
import { createDuelTable, type DuelTable } from "./table";
import { renderMatchOver } from "./match-over";
import { roundLogEntry } from "./round-log";

const PEER_GRACE_MS = 45_000;

class PeerGoneError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PeerGoneError";
  }
}

export async function runFriendMatch(root: HTMLElement, peer: PeerHandle): Promise<void> {
  const me: 0 | 1 = peer.role === "host" ? 0 : 1;
  const opp: 0 | 1 = me === 0 ? 1 : 0;
  const labels: [string, string] = me === 0 ? ["You", "Friend"] : ["Friend", "You"];

  const balances = createBalances({ initialBudget: START_BANKROLL, p1Label: labels[0], p2Label: labels[1] });
  const hero = createBidHero();
  const log = createGameLog();
  const shell = createMatchShell({ root, topLeft: balances.el, topRight: hero.el, log: log.el });

  // Recreated only when a NEW match starts — not when this one ends, or the
  // final reveal would vanish before the banner appears (playbook gotcha 4).
  let table = createDuelTable(shell.boardSlot, { youLabel: "You", themLabel: "Friend", you: me });

  for (;;) {
    let finished: { outcome: MatchOutcome; match: GreedMatch };
    try {
      finished = await playMatch(table, hero, balances, log, peer, me, opp, labels);
    } catch (e) {
      table.destroy();
      if (e instanceof PeerGoneError) {
        await renderAbandoned(shell, e.message);
        return;
      }
      throw e;
    }

    const again = await renderFinal(shell, finished.outcome, finished.match, me);
    if (!again) {
      trySend(peer, { kind: "leave" });
      table.destroy();
      return;
    }
    const accepted = await negotiateRematch(peer);
    if (!accepted) {
      table.destroy();
      await renderAbandoned(shell, "Your friend left the room.");
      return;
    }
    table.destroy();
    shell.reset();
    log.clear();
    balances.update([START_BANKROLL, START_BANKROLL]);
    table = createDuelTable(shell.boardSlot, { youLabel: "You", themLabel: "Friend", you: me });
  }
}

async function playMatch(
  table: DuelTable,
  hero: BidHero,
  balances: ReturnType<typeof createBalances>,
  log: GameLog,
  peer: PeerHandle,
  me: 0 | 1,
  opp: 0 | 1,
  labels: readonly [string, string],
): Promise<{ outcome: MatchOutcome; match: GreedMatch }> {
  let match = newMatch();

  for (;;) {
    table.beginRound(match.round, match.rounds);
    const { bids } = await playOneRound(table, hero, match, match.round, peer, me, opp);

    const bankrollsBefore = match.bankrolls;
    const result = resolveSafely(match, bids);
    await table.reveal({
      you: me,
      bids,
      detail: result.detail,
      deltas: result.deltas,
      // The bars move as the stake travels, not after the whole reveal.
      onStake: () => balances.update(result.next.bankrolls),
    });

    match = result.next;
    log.append(
      roundLogEntry({
        round: match.round - 1,
        you: me,
        labels,
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

async function playOneRound(
  table: DuelTable,
  hero: BidHero,
  match: GreedMatch,
  round: number,
  peer: PeerHandle,
  me: 0 | 1,
  opp: 0 | 1,
): Promise<{ bids: [number, number] }> {
  // Listen before waiting — see game-kit's turn-inbox.ts doc comment.
  const inbox = openTurnInbox(peer, round);
  try {
    const myBid = await askBid({
      hero,
      table,
      ownBalance: match.bankrolls[me],
      opponentBalance: match.bankrolls[opp],
      opponentBidIn: inbox.hasCommit(),
      onOpponentBid: (fn) => inbox.onCommit(fn),
    });
    table.lockYours(myBid);

    const salt = newSalt();
    const hash = await commitPayload([myBid], salt);
    peer.send({ kind: "commit", turn: round, hash });

    hero.setWaiting("Bid committed. Waiting for your friend…");
    const oppCommit = await orPeerGone(inbox, inbox.commit(), "Your friend stopped responding.");
    table.opponentCommitted();

    // Only now — with THEIR commitment already in hand — does our own bid go
    // out in the clear. That ordering is what makes the reveal safe.
    peer.send({ kind: "reveal", turn: round, bid: myBid, salt });
    const oppReveal = await orPeerGone(inbox, inbox.reveal(), "Your friend stopped responding.");

    const verified = await verifyPayload(oppCommit.hash, [oppReveal.bid], oppReveal.salt);
    if (!verified) {
      throw new PeerGoneError("Your friend's revealed bid did not match their commitment.");
    }
    if (!Number.isInteger(oppReveal.bid) || oppReveal.bid < MIN_BID || oppReveal.bid > match.bankrolls[opp]) {
      throw new PeerGoneError("Your friend revealed an impossible bid.");
    }

    const bids: [number, number] = me === 0 ? [myBid, oppReveal.bid] : [oppReveal.bid, myBid];
    return { bids };
  } finally {
    inbox.close();
  }
}

/**
 * `playRound` throws on a malformed bid. A well-behaved client's own UI
 * never produces one and playOneRound already range-checks the peer's
 * reveal, but a hostile or buggy peer is still the case this guards:
 * abandon rather than guess.
 */
function resolveSafely(match: GreedMatch, bids: readonly [number, number]) {
  try {
    return playRound(match, bids);
  } catch (e) {
    throw new PeerGoneError(
      e instanceof Error ? `Your friend's bid was invalid: ${e.message}` : "Your friend's bid was invalid.",
    );
  }
}

function orPeerGone<T>(inbox: ReturnType<typeof openTurnInbox>, p: Promise<T>, message: string): Promise<T> {
  const gone = inbox.closed().then((): T => {
    throw new PeerGoneError("Your friend left the room.");
  });
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new PeerGoneError(message)), PEER_GRACE_MS);
  });
  return Promise.race([p, gone, timeout]).finally(() => clearTimeout(timer));
}

function negotiateRematch(peer: PeerHandle): Promise<boolean> {
  return new Promise((resolve) => {
    const settle = (v: boolean) => {
      peer.offMessage(onMessage);
      peer.offClose(onClose);
      clearTimeout(timer);
      resolve(v);
    };
    const onMessage = (msg: WireMessage) => {
      if (msg.kind === "rematch-request") {
        trySend(peer, { kind: "rematch-accept" });
        settle(true);
      } else if (msg.kind === "rematch-accept") {
        settle(true);
      } else if (msg.kind === "leave") {
        settle(false);
      }
    };
    const onClose = () => settle(false);
    const timer = setTimeout(() => settle(false), PEER_GRACE_MS);
    peer.onMessage(onMessage);
    peer.onClose(onClose);
    trySend(peer, { kind: "rematch-request" });
  });
}

function trySend(peer: PeerHandle, msg: WireMessage): void {
  try {
    peer.send(msg);
  } catch (e) {
    console.debug("[pvp] send skipped", e);
  }
}

function renderFinal(
  shell: MatchShell,
  outcome: MatchOutcome,
  match: GreedMatch,
  me: 0 | 1,
): Promise<boolean> {
  const banner = renderMatchOver({
    outcome,
    you: me,
    youLabel: "You",
    themLabel: "Friend",
    bankrolls: match.bankrolls,
    startBankroll: match.startBankroll,
    rounds: MATCH_ROUNDS,
  });

  const again = document.createElement("button");
  again.type = "button";
  again.className = "btn btn--primary";
  again.textContent = "Rematch (same friend)";

  const leave = document.createElement("button");
  leave.type = "button";
  leave.className = "btn btn--ghost";
  leave.textContent = "Back to menu";

  shell.controls.append(banner, again, leave);
  return new Promise((resolve) => {
    again.addEventListener("click", () => {
      again.disabled = true;
      again.textContent = "Waiting for your friend…";
      resolve(true);
    });
    leave.addEventListener("click", () => resolve(false));
  });
}

/**
 * The match ended because the other side went away. Resolves only once the
 * player acknowledges it: main.ts re-renders the menu the moment a session
 * function returns, so returning immediately here would wipe the
 * explanation off the screen before it could be read.
 */
function renderAbandoned(shell: MatchShell, message: string): Promise<void> {
  shell.actions.hidden = true;
  shell.controls.innerHTML = "";
  const banner = document.createElement("p");
  banner.className = "error";
  banner.setAttribute("data-abandoned", "");
  banner.textContent = message;
  const leave = document.createElement("button");
  leave.type = "button";
  leave.className = "btn btn--ghost";
  leave.textContent = "Back to menu";
  shell.controls.append(banner, leave);
  return new Promise((resolve) => leave.addEventListener("click", () => resolve()));
}
