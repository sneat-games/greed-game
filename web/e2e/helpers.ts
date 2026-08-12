import { type Page, expect } from "@playwright/test";

/** Start a mode from the menu (see src/ui/menu.ts — game-kit's
 *  `renderMenuSimple` with the meaningless "Leave" button removed). */
export async function chooseMode(page: Page, mode: "vs-bot" | "vs-friend"): Promise<void> {
  await page.locator(mode === "vs-bot" ? ".menu__btn--bot" : ".menu__btn--friend").click();
}

/** The bid ceiling the panel is currently offering — i.e. this player's
 *  bankroll, which the kit's bid-input publishes as the control's `max`. */
export async function currentMaxBid(page: Page): Promise<number> {
  const raw = await page.locator(".bid-input__number").getAttribute("max");
  return Number(raw);
}

/**
 * Dial a bid and commit it. Waits for the round to actually be asking (the
 * lock button is only enabled between `askBid` starting and the bid being
 * locked), and never dials above the current bankroll.
 */
export async function bidAndLock(page: Page, desired: number): Promise<number> {
  const lock = page.locator("[data-lock-bid]");
  await expect(lock).toBeEnabled();
  const max = await currentMaxBid(page);
  const bid = Math.max(1, Math.min(desired, max));
  await page.locator(".bid-input__number").fill(String(bid));
  await lock.click();
  return bid;
}

/** True once the match has reached its end-of-match banner. */
export async function isMatchOver(page: Page): Promise<boolean> {
  return (await page.locator("[data-match-over]").count()) > 0;
}

/**
 * Play a vs-Bot match to its terminal banner by bidding the same modest
 * amount every round (clamped to whatever bankroll is left). Five rounds
 * either run out or somebody goes broke first — both are terminal.
 */
export async function playVsBotToEnd(page: Page, bid = 20, maxRounds = 8): Promise<void> {
  for (let i = 0; i < maxRounds; i++) {
    if (await isMatchOver(page)) return;
    await bidAndLock(page, bid);
    // The reveal (flip -> verdict -> stake) takes about 1.7s, after which
    // either the next round's lock button re-enables or the banner is up.
    await Promise.race([
      page.locator("[data-lock-bid]:not([disabled])").waitFor({ state: "attached", timeout: 15_000 }),
      page.locator("[data-match-over]").waitFor({ state: "attached", timeout: 15_000 }),
    ]);
  }
  if (!(await isMatchOver(page))) throw new Error("vs-Bot match did not reach a terminal banner in time");
}

/** Parse a balances row's "Label: value/max" text into its numeric value. */
export async function balanceValue(page: Page, player: "p1" | "p2"): Promise<number> {
  const text = await page.locator(`[data-balance="${player}"] .balances__label`).innerText();
  const match = /:\s*(-?\d+)\/(\d+)/.exec(text);
  if (!match) throw new Error(`could not parse balance text: "${text}"`);
  return Number(match[1]);
}

/** Assert a balance settles on a value. The bars move partway through the
 *  reveal animation (see ui/table.ts's `onStake`), so a one-shot read taken
 *  right after the verdict lands can beat them there. */
export async function expectBalance(page: Page, player: "p1" | "p2", value: number): Promise<void> {
  await expect.poll(() => balanceValue(page, player), { timeout: 10_000 }).toBe(value);
}

/**
 * Both bids from the newest game-log entry, as `[seat 0, seat 1]`.
 *
 * Read from the LOG rather than from the cards: the cards turn face-down
 * again the moment the next round opens, so a read taken a beat later gets
 * "?". The log is the permanent record, which is what it is for.
 */
export async function lastLoggedBids(page: Page): Promise<[number, number]> {
  const labels = await page
    .locator(".game-log__entry")
    .first()
    .locator(".game-log__bid-label")
    .allInnerTexts();
  if (labels.length !== 2) throw new Error(`expected 2 logged bids, got ${labels.length}`);
  const parse = (text: string) => {
    const m = /:\s*(\d+)/.exec(text);
    if (!m) throw new Error(`could not parse logged bid: "${text}"`);
    return Number(m[1]);
  };
  return [parse(labels[0]), parse(labels[1])];
}

/** Every round's verdict, oldest first, as recorded in the game log. The kit
 *  log prepends (newest first), so this reverses it. */
export async function loggedVerdicts(page: Page): Promise<string[]> {
  const kinds = await page.locator(".log-verdict").evaluateAll((els) =>
    els.map((el) => (el as HTMLElement).dataset.verdictKind ?? ""),
  );
  return kinds.reverse();
}
