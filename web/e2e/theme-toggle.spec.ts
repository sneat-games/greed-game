import { test, expect } from "@playwright/test";

// Journey 4: the theme toggle persists across a reload with no flash of the
// wrong theme — game-kit's ui/theme.ts stores the preference in
// `localStorage["sneat-games-theme"]`, and Layout.astro's pre-paint inline
// script (not a JS module import, which would run too late) re-applies it
// before first paint.

test("theme toggle persists across a reload", async ({ page }) => {
  await page.goto("/");

  const toggle = page.locator(".theme-toggle");
  await expect(toggle).toBeVisible();

  const before = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));

  await toggle.click();
  const after = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
  expect(after).not.toBeNull();
  expect(after).not.toBe(before);
  expect(["light", "dark"]).toContain(after);

  const stored = await page.evaluate(() => localStorage.getItem("sneat-games-theme"));
  expect(stored).toBe(after);

  await page.reload();
  const afterReload = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
  expect(afterReload).toBe(after);

  // The pre-paint script is what makes that reload flash-free: it is inline
  // in <head>, so the attribute is already set before the first paint rather
  // than after a module round-trip.
  const headHtml = await page.evaluate(() => document.head.innerHTML);
  expect(headHtml).toContain("sneat-games-theme");
});

test("the cross-promo footer links the other Sneat games but not this one", async ({ page }) => {
  await page.goto("/");
  const footer = page.locator("[data-games-footer]");
  await expect(footer).toBeVisible();
  await expect(footer.getByRole("link", { name: "Hex" })).toBeVisible();
  await expect(footer.getByRole("link", { name: "All games" })).toBeVisible();
  await expect(footer.getByRole("link", { name: "The Greed Game" })).toHaveCount(0);
});

test("the standings preview shows a real local record and a badged mock ladder", async ({ page }) => {
  await page.goto("/");
  await page.locator("[data-standings-trigger]").click();

  const panel = page.locator("[data-standings-overlay]");
  await expect(panel).toBeVisible();
  await expect(page.locator("[data-standings-record]")).toContainText("Your vs-Bot record on this device");
  await expect(panel.locator(".badge")).toContainText("Powered by Competios — coming soon");

  await page.getByRole("button", { name: "Close" }).click();
  await expect(panel).toHaveCount(0);
});
