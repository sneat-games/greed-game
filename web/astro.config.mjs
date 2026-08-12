import { defineConfig } from "astro/config";
import AstroPWA from "@vite-pwa/astro";

export default defineConfig({
  // CrazyGames/itch.io accept a static HTML5 bundle; Static is the default
  // output. See scripts/relativize-dist.mjs (run as part of `npm run
  // build`) for how the resulting dist/ stays zippable from a non-root
  // path — Astro itself always emits root-absolute asset URLs, so that
  // script rewrites dist/index.html + manifest.webmanifest in place after
  // the build rather than fighting Astro/Vite's base-path handling.
  output: "static",
  devToolbar: { enabled: false },
  integrations: [
    AstroPWA({
      registerType: "autoUpdate",
      // Auto-injection is OFF: main.ts registers the built service worker
      // itself, gated to *.sneat.games ONLY — never on localhost (a worker
      // precaches built asset hashes, so a local preview keeps serving the
      // PREVIOUS build after a rebuild) and never inside a CrazyGames/
      // itch.io iframe. See game-kit/docs/APP-PLAYBOOK.md gotcha 2.
      injectRegister: false,
      manifest: {
        name: "The Greed Game — Sneat Games",
        short_name: "Greed Game",
        description:
          "The Greed Game: a 5-round hidden-bid duel where courage wins and greed is punished. vs Bot (offline-capable) or vs Friend.",
        theme_color: "#ca8a04",
        background_color: "#0f172a",
        display: "standalone",
        start_url: ".",
        scope: ".",
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // Precache the app shell + hashed assets; nothing dynamic to cache
        // beyond that (vs-Bot is fully client-side; vs-Friend needs the
        // network by nature — see docs/DESIGN.md's Offline section).
        globPatterns: ["**/*.{js,css,html,svg,png,ico,webmanifest}"],
        // registerType: "autoUpdate" above does NOT apply these when
        // injectRegister is false — that option only takes effect inside
        // the registration code vite-plugin-pwa would otherwise inject, and
        // we register by hand. Set explicitly so the worker self-activates:
        // skipWaiting + clientsClaim let a new worker take over on its own
        // next install/activate, with no cooperation from page JS needed —
        // which matters because a client already stuck behind an old
        // worker never runs the new page JS that would otherwise ask it to
        // update (the old worker is exactly what keeps serving the old JS).
        skipWaiting: true,
        clientsClaim: true,
      },
      devOptions: { enabled: false },
    }),
  ],
});
