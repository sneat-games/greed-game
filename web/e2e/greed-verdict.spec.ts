import { test, expect } from "@playwright/test";
import { chooseMode, expectBalance, lastLoggedBids } from "./helpers";

// Journey 2: a round that ends in GREED — the rule the whole game is named
// after — driven deterministically rather than waited for.
//
// HOW IT IS MADE DETERMINISTIC. Going all in on round 1 forces it. The bot's
// opening bid (src/bot/bot.ts) is `round(100 * 0.18 * jitter)` with jitter in
// [0.7, 1.3], further capped at twice its guess of the opponent's bid — so it
// is between 13 and 23, always. A bid of 100 is greedy against anything below
// 50, so the greed rule fires on every run, and the punished side is always
// the human. If the bot's sizing constants ever change, this test fails with
// a readable "expected greed, got courage" rather than flaking.

test("a bid of 100 against the bot's opening is punished as greed", async ({ page }) => {
  await page.goto("/");
  await chooseMode(page, "vs-bot");
  await expect(page.locator("[data-round-tracker]")).toHaveText("Round 1 of 5");

  // Dial the bid directly. The live hint is self-referential: for a bid of
  // 100 the greed line is at 49 (`ceil(100/2) - 1`), computed from the local
  // bid alone and never from the opponent's.
  await page.locator(".bid-input__number").fill("100");
  const hint = page.locator("[data-greed-hint]");
  await expect(hint).toHaveAttribute("data-threshold", "49");
  await expect(hint).toHaveAttribute("data-tone", "risk");
  await expect(hint).toContainText("If your opponent bids 49 or less, your 100 is greed");

  await page.locator("[data-lock-bid]").click();

  const verdict = page.locator("[data-verdict]");
  await expect(verdict).toBeVisible();
  await expect(verdict).toHaveAttribute("data-kind", "greed");
  await expect(verdict).toHaveAttribute("data-winner", "them");
  await expect(verdict).toContainText("Greed!");
  await expect(verdict).toContainText("more than double");

  // Both cards are face-up, and the punished one is the human's.
  await expect(page.locator("[data-bid-card='you'] [data-bid-value]")).toHaveText("100");
  await expect(page.locator("[data-bid-card='you']")).toHaveAttribute("data-outcome", "lost");
  await expect(page.locator("[data-bid-card='them']")).toHaveAttribute("data-outcome", "won");

  // The log records the verdict and both bids.
  await expect(page.locator(".log-verdict").first()).toHaveAttribute("data-verdict-kind", "greed");
  const [yourBid, theirBid] = await lastLoggedBids(page);
  expect(yourBid).toBe(100);
  expect(theirBid).toBeGreaterThanOrEqual(13);
  expect(theirBid).toBeLessThanOrEqual(23);

  // The stake is the LOWER bid — the bot's — so the human loses only what
  // the BOT staked, never their own 100. A player can never lose more than
  // they bid, which is why a bankroll cannot go negative.
  await expectBalance(page, "p1", 100 - theirBid);
  await expectBalance(page, "p2", 100 + theirBid);
});

test("a courageous bid — higher, but not more than double — takes the round", async ({ page }) => {
  await page.goto("/");
  await chooseMode(page, "vs-bot");

  // The bot's opening is in [13, 23]. A bid of 26 is above all of that and at
  // most double the lowest of it (2 x 13 = 26), so it is the higher bid AND
  // never greedy: courage, every run.
  await page.locator(".bid-input__number").fill("26");
  await page.locator("[data-lock-bid]").click();

  const verdict = page.locator("[data-verdict]");
  await expect(verdict).toBeVisible();
  await expect(verdict).toHaveAttribute("data-kind", "courage");
  await expect(verdict).toHaveAttribute("data-winner", "you");
  await expect(verdict).toContainText("Courage");

  await expect(page.locator(".log-verdict").first()).toHaveAttribute("data-verdict-kind", "courage");
  const [, theirBid] = await lastLoggedBids(page);
  await expectBalance(page, "p1", 100 + theirBid);
});
