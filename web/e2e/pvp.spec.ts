import { test, expect, type Page } from "@playwright/test";
import { balanceValue, bidAndLock, chooseMode, isMatchOver, loggedVerdicts } from "./helpers";

// Journey 3: a full host <-> guest match across two browser contexts, against
// the kit's local relay stub (test-relay.mjs, started as playwright.config's
// second webServer). The bids are hidden with commit-reveal, so this also
// proves the two peers converge on the SAME verdict for every round without
// either ever seeing the other's number early.
//
// The script is deterministic: the host bids 20 every round and the guest 30.
// 30 is higher but not more than double, so it is courage every time and the
// guest takes 20 a round — 100/100, 80/120, 60/140, 40/160, 20/180, and on
// round 5 the host's last 20 goes too, which is the EARLY-END rule (a player
// on 0 cannot meet the minimum bid) landing on the final round.

const HOST_BID = 20;
const GUEST_BID = 30;

test("PvP: both peers agree on every round's verdict and on the final bankrolls", async ({ browser }) => {
  test.setTimeout(120_000);

  const hostCtx = await browser.newContext();
  const guestCtx = await browser.newContext();
  const host = await hostCtx.newPage();
  const guest = await guestCtx.newPage();

  try {
    await host.goto("/");
    await chooseMode(host, "vs-friend");

    // The invite is rendered BEFORE the host peer is awaited (playbook
    // gotcha 5), so the room code is on screen while the handshake runs.
    const link = host.locator("[data-invite-link]");
    await expect(link).toBeVisible({ timeout: 15_000 });
    const url = new URL((await link.innerText()).trim());
    await guest.goto(`${url.pathname}${url.search}${url.hash}`);

    // Both sides reach the match screen once the WebRTC handshake and the
    // `hello`/`hello-ack` config negotiation (vs-friend.ts) complete.
    await expect(host.locator("[data-duel-table]")).toBeVisible({ timeout: 30_000 });
    await expect(guest.locator("[data-duel-table]")).toBeVisible({ timeout: 30_000 });

    // Secrecy: before either has locked in, neither card shows a number.
    await expect(host.locator("[data-bid-card='them'] [data-bid-value]")).toHaveText("?");
    await expect(guest.locator("[data-bid-card='them'] [data-bid-value]")).toHaveText("?");

    for (let round = 0; round < 5; round++) {
      if ((await isMatchOver(host)) && (await isMatchOver(guest))) break;
      await Promise.all([bidAndLock(host, HOST_BID), bidAndLock(guest, GUEST_BID)]);
      await Promise.all([waitForRoundToSettle(host), waitForRoundToSettle(guest)]);
    }

    const hostOver = host.locator("[data-match-over]");
    const guestOver = guest.locator("[data-match-over]");
    await expect(hostOver).toBeVisible({ timeout: 30_000 });
    await expect(guestOver).toBeVisible({ timeout: 30_000 });

    // 1. Every round resolved to the same verdict on both peers.
    const hostVerdicts = await loggedVerdicts(host);
    const guestVerdicts = await loggedVerdicts(guest);
    expect(hostVerdicts.length).toBeGreaterThan(0);
    expect(hostVerdicts).toEqual(guestVerdicts);
    expect(new Set(hostVerdicts)).toEqual(new Set(["courage"]));

    // 2. The bankrolls agree. Seat 0 is the host on BOTH pages (the kit's
    //    peer.ts pins host = player 0), so the two balance rows must match
    //    number for number.
    expect(await balanceValue(host, "p1")).toBe(await balanceValue(guest, "p1"));
    expect(await balanceValue(host, "p2")).toBe(await balanceValue(guest, "p2"));
    expect(await balanceValue(host, "p1")).toBe(0);
    expect(await balanceValue(host, "p2")).toBe(200);

    // 3. Complementary outcomes — and the reason is the early-end rule.
    expect([await hostOver.getAttribute("data-outcome"), await guestOver.getAttribute("data-outcome")]).toEqual([
      "loss",
      "win",
    ]);
    await expect(hostOver).toHaveAttribute("data-reason", "bankrupt");
    await expect(guestOver).toHaveAttribute("data-reason", "bankrupt");
    await expect(hostOver).toContainText("ran out of coins");
  } finally {
    await hostCtx.close();
    await guestCtx.close();
  }
});

/** Wait until the reveal has finished — either the next round is asking for
 *  a bid again, or the match is over. */
async function waitForRoundToSettle(page: Page): Promise<void> {
  await Promise.race([
    page.locator("[data-lock-bid]:not([disabled])").waitFor({ state: "attached", timeout: 30_000 }),
    page.locator("[data-match-over]").waitFor({ state: "attached", timeout: 30_000 }),
  ]);
}
