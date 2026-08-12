import { test, expect } from "@playwright/test";
import { balanceValue, bidAndLock, chooseMode, lastLoggedBids, playVsBotToEnd } from "./helpers";

// Journey 1: menu -> vs Bot -> five rounds -> terminal banner -> BACK TO THE
// MENU -> a NEW match starts.
//
// The journey deliberately does NOT stop at the banner. That exact stopping
// point — one click short of the post-match controls — let a dead "Back to
// menu" button ship in eight sibling games at once: every suite asserted the
// banner and stopped, so nobody's `bootstrap` was ever driven past the end of
// a single session (game-kit/docs/APP-PLAYBOOK.md). A journey ends where the
// player's session ends, not where the match does.

test("vs Bot: plays to a terminal banner, then back to the menu and into a NEW match", async ({ page }) => {
  await page.goto("/");
  await chooseMode(page, "vs-bot");

  // Off the menu and into a match: the table is up, the menu is gone.
  await expect(page.locator("[data-duel-table]")).toBeVisible();
  await expect(page.locator("[data-round-tracker]")).toHaveText("Round 1 of 5");
  await expect(page.locator(".menu__btn--bot")).toHaveCount(0);
  await expect(page.locator("[data-balance='p1'] .balances__label")).toContainText("You: 100/100");

  await playVsBotToEnd(page);

  const banner = page.locator("[data-match-over]");
  await expect(banner).toBeVisible();
  await expect(banner).toHaveAttribute("data-outcome", /win|loss|draw/);
  // The banner reports both final bankrolls and their movement from 100.
  await expect(page.locator("[data-final-balance='You']")).toBeVisible();
  await expect(page.locator("[data-final-balance='Bot']")).toBeVisible();

  // Zero-sum: whatever one side gained, the other lost.
  const deltas = await page
    .locator("[data-match-over] [data-delta]")
    .evaluateAll((els) => els.map((el) => Number((el as HTMLElement).dataset.delta)));
  expect(deltas).toHaveLength(2);
  expect(deltas[0] + deltas[1]).toBe(0);

  // THE POINT OF THIS TEST — past the banner:
  await page.getByRole("button", { name: "Back to menu" }).click();
  await expect(page.locator(".menu__btn--bot")).toBeVisible();
  await expect(page.locator("[data-match-over]")).toHaveCount(0);

  // ...and the menu is live, not a screenshot of one: a second match starts
  // from it, on a fresh bankroll and a fresh round counter.
  await chooseMode(page, "vs-bot");
  await expect(page.locator("[data-duel-table]")).toBeVisible();
  await expect(page.locator("[data-round-tracker]")).toHaveText("Round 1 of 5");
  expect(await balanceValue(page, "p1")).toBe(100);
  expect(await balanceValue(page, "p2")).toBe(100);
});

test("vs Bot: the opponent's bid is not in the page before the reveal", async ({ page }) => {
  await page.goto("/");
  await chooseMode(page, "vs-bot");

  // The bot's bid for round 1 is already decided at this point (vs-bot.ts
  // computes it before asking the human), so if it were going to leak
  // anywhere it would be here.
  const theirValue = page.locator("[data-bid-card='them'] [data-bid-value]");
  await expect(theirValue).toHaveText("?");
  await expect(page.locator("[data-bid-card='them']")).toHaveAttribute("data-face", "down");

  await bidAndLock(page, 20);

  // ...and only after the round resolves is their number knowable at all —
  // read from the log, which is the permanent record (the cards turn back
  // face-down the moment the next round opens).
  await expect(page.locator(".log-verdict").first()).toBeVisible();
  const [yours, theirs] = await lastLoggedBids(page);
  expect(yours).toBe(20);
  expect(theirs).toBeGreaterThanOrEqual(1);
});

test.describe("with reduced motion", () => {
  // Every animation in styles/table.css is declared only under
  // `prefers-reduced-motion: no-preference`, and the JS waits in ui/table.ts
  // collapse to zero for the same visitor. The risk with collapsing waits is
  // that the reveal stops being a step at all — so this plays a whole match
  // that way and checks the verdict, the log and the banner all still land.
  test.use({ reducedMotion: "reduce" });

  test("a full match still plays, reveals and finishes", async ({ page }) => {
    await page.goto("/");
    await chooseMode(page, "vs-bot");

    await bidAndLock(page, 20);
    await expect(page.locator("[data-verdict]")).toHaveAttribute("data-kind", /courage|greed|draw/);
    await expect(page.locator(".log-verdict")).toHaveCount(1);

    await playVsBotToEnd(page);
    await expect(page.locator("[data-match-over]")).toBeVisible();
  });
});

test("vs Bot: the bid floor is 1 — the slider cannot reach 0 and 0 is submitted as 1", async ({ page }) => {
  await page.goto("/");
  await chooseMode(page, "vs-bot");

  // game-kit's bid-input is written for auctions where 0 means "pass", so
  // it ships min="0"; this game raises the floor to 1 (src/ui/bid-hero.ts).
  await expect(page.locator(".bid-input__slider")).toHaveAttribute("min", "1");
  await expect(page.locator(".bid-input__number")).toHaveAttribute("min", "1");

  // Typing 0 straight into the number field bypasses the slider's floor, so
  // the clamp on read is what catches it — and the table echoes the CLAMPED
  // value, so the player sees exactly what will be submitted.
  await page.locator(".bid-input__number").fill("0");
  await expect(page.locator("[data-greed-hint]")).toHaveAttribute("data-threshold", "0");
  await expect(page.locator("[data-bid-card='you'] [data-bid-value]")).toHaveText("1");

  await page.locator("[data-lock-bid]").click();
  await expect(page.locator(".log-verdict").first()).toBeVisible();
  expect((await lastLoggedBids(page))[0]).toBe(1);
});
