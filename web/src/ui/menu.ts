// The mode-select menu.
//
// WHICH KIT MENU AND WHY. game-kit ships two (see its ui/menu.ts):
// `renderMenu`, the three-radio-group form used by Hex and Dots & Boxes, and
// `renderMenuSimple`, BTTT's three-button menu. The Greed Game has exactly
// ONE choice to make — vs Bot or vs Friend — because it has no board size and
// (in the MVP) no variant.
//
// `renderMenu` is out: its group legends are hard-coded to "Variant" and
// "Board size", so a single-option group would put a "Board size" heading on
// a game that has no board. Filling a form with a field that is meaningless
// is worse than not having the field.
//
// So: `renderMenuSimple`, with its third button removed. That button is
// "Leave", which in BTTT is an IN-MATCH affordance (leave the room you are
// in). At the top-level menu there is nothing to leave, and a button that
// resolves to a state the caller cannot act on is exactly the dead control
// this family already shipped once. It is removed here rather than wired to
// something invented.
//
// Everything the simple menu doesn't carry — the rules a first-time player
// needs, and the offline notice on vs Friend — is appended around it.

import { renderMenuSimple } from "@sneat/game-kit";
import { MATCH_ROUNDS, START_BANKROLL } from "../engine/greedplay";

export type GreedMode = "vs-bot" | "vs-friend";

export function renderGreedMenu(root: HTMLElement): Promise<GreedMode> {
  const offline = typeof navigator !== "undefined" && navigator.onLine === false;

  const promise = renderMenuSimple(root, {
    title: "Play The Greed Game",
    subtitle:
      `Two players, ${START_BANKROLL} coins each, ${MATCH_ROUNDS} rounds of hidden bids. ` +
      "Courage takes the pot — greed hands it away.",
  });

  // renderMenuSimple builds its DOM synchronously before returning the
  // pending promise (only a button click resolves it), so it is safe to
  // reach back into `root` here, before the player has interacted.
  root.querySelector(".menu__btn--leave")?.remove();
  root.querySelector(".menu")?.append(rulesCard());
  if (offline) markVsFriendOffline(root);

  // With the "Leave" button removed above, the kit's third outcome is
  // unreachable — but the kit's type still allows it, so narrow explicitly
  // rather than casting.
  return promise.then((choice) => (choice === "vs-friend" ? "vs-friend" : "vs-bot"));
}

function rulesCard(): HTMLElement {
  const card = document.createElement("section");
  card.className = "card rules-card";
  card.setAttribute("data-rules-card", "");

  const title = document.createElement("h3");
  title.className = "card__title";
  title.textContent = "How it works";

  const list = document.createElement("ul");
  list.className = "rules-card__list";
  for (const line of [
    "Both players secretly bid at least 1 coin, up to their whole bankroll.",
    "The stake is the LOWER of the two bids — you can never lose more than you bid.",
    "The higher bidder takes the stake. That is courage.",
    "Unless the higher bid is more than DOUBLE the lower one. That is greed, and the lower bidder takes the stake instead.",
    "Equal bids draw. After 5 rounds the bigger bankroll wins — and running out of coins ends it early.",
  ]) {
    const li = document.createElement("li");
    li.textContent = line;
    list.append(li);
  }

  card.append(title, list);
  return card;
}

function markVsFriendOffline(root: HTMLElement): void {
  const btn = root.querySelector<HTMLButtonElement>(".menu__btn--friend");
  if (!btn) return;
  btn.disabled = true;
  btn.setAttribute("aria-disabled", "true");
  btn.textContent = "vs Friend — offline";
  btn.title = "Connect to the internet to play a friend.";
}
