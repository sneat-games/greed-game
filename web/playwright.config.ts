import { defineConfig, devices } from "@playwright/test";

// e2e webServer stack: a production-equivalent build served by `astro
// preview`, plus the kit's in-process relay mimic (`test-relay.mjs`) so
// vs-Friend journeys never touch the real webrtc.sneat.games relay. Both are
// started fresh for every `npm run e2e` — see game-kit/docs/DESIGN.md's
// "Testing" section and the kit's own test-relay.mjs doc comment.
//
// PORT 4766 is this repo's OWN preview port, deliberately NOT Astro's
// default 4321: every sibling sneat-games app answers happily on 4321, so a
// shared port plus `reuseExistingServer` silently runs this suite against
// WHICHEVER app booted first — a green run that proved nothing about The
// Greed Game (game-kit/docs/APP-PLAYBOOK.md gotcha 6). The app entry
// therefore pins a port nobody else claims AND sets `reuseExistingServer:
// false` unconditionally, so a stale server on it fails the run loudly
// (EADDRINUSE) instead of being adopted. The relay is the opposite case:
// 8787 is fixed by the kit (`defaultRelayBase()` hard-codes it for
// localhost origins), it is game-agnostic, and a developer running the real
// `webrtc-relay` there is an intentional, supported setup — so reusing that
// one is correct.
const APP_PORT = 4766;

export default defineConfig({
  testDir: "./e2e",
  timeout: 45_000,
  expect: { timeout: 10_000 },
  // A single shared `astro preview` + relay stack backs every spec (see the
  // webServer entries below), and the PvP spec opens real WebRTC
  // DataChannels. Running those concurrently saturates a modest CI/sandbox
  // runner and produces pure resource-contention timeouts that have nothing
  // to do with the app. One worker trades run time for determinism.
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  // Always allow one retry: a shared preview server backing every spec
  // occasionally hiccups under a loaded machine (a webServer stall, not a
  // product bug) — a retry absorbs that without masking a genuine failure,
  // since a real assertion failure fails identically on the retry too.
  retries: 1,
  workers: 1,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${APP_PORT}`,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: `npm run build && npm run preview -- --port ${APP_PORT}`,
      url: `http://localhost:${APP_PORT}`,
      reuseExistingServer: false,
      timeout: 180_000,
    },
    {
      // `port` (not `url`) — every one of test-relay.mjs's routes 404s on a
      // bare GET /, and Playwright's `url` readiness check wants a 2xx/3xx
      // response; waiting for the TCP port to accept connections is the
      // right check for this server.
      command: "npm run relay",
      port: 8787,
      reuseExistingServer: true,
      timeout: 20_000,
    },
  ],
});
