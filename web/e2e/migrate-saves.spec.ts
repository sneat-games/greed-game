import { test, expect } from "@playwright/test";

// Saves handed over from the retired greed.sneat.games subdomain. Its
// /__migrate.html (sneat-games/sneat.games) reads the old origin's
// localStorage and navigates to https://sneat.games/greed/#migrate=<b64>;
// bootstrap() imports through game-kit's consumeMigratedStorage() and strips
// the parameter. Encoding: base64url (unpadded) of a JSON object.
function payload(saves: Record<string, string>): string {
  return Buffer.from(JSON.stringify(saves), "utf8").toString("base64url");
}

test("imports the old subdomain's record and theme, then strips #migrate", async ({ page }) => {
  const migrate = payload({
    "greed-game:standings:vs-bot": '{"wins":7,"losses":2,"draws":1}',
    "sneat-games-theme": "dark",
    "not-allowlisted": "x",
  });
  await page.goto(`/#migrate=${migrate}`);
  await expect(page.locator(".standings-trigger")).toBeVisible();

  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe("");
  const stored = await page.evaluate(() => ({
    record: localStorage.getItem("greed-game:standings:vs-bot"),
    theme: localStorage.getItem("sneat-games-theme"),
    other: localStorage.getItem("not-allowlisted"),
    attr: document.documentElement.getAttribute("data-theme"),
  }));
  expect(stored).toEqual({ record: '{"wins":7,"losses":2,"draws":1}', theme: "dark", other: null, attr: "dark" });

  await page.locator(".standings-trigger").click();
  await expect(page.getByText("7W")).toBeVisible();
});

test("a save already made here wins over the hand-over", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.setItem("greed-game:standings:vs-bot", '{"wins":1,"losses":0,"draws":0}'));
  await page.goto("about:blank"); // a hash-only change would not reload the page
  await page.goto(`/#migrate=${payload({ "greed-game:standings:vs-bot": '{"wins":9,"losses":9,"draws":9}' })}`);
  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe("");
  expect(await page.evaluate(() => localStorage.getItem("greed-game:standings:vs-bot"))).toBe('{"wins":1,"losses":0,"draws":0}');
});
