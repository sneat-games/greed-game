/// <reference types="@cloudflare/workers-types" />
// Cloudflare Worker that deploys greed.sneat.games.
//
// Serves the static `dist/` build (uploaded as a static asset) and falls
// back to `index.html` for any path that isn't a real file, so `#room=<id>`
// share-link navigation works without any server route (a fragment never
// leaves the browser, but a full page load of a non-root path — e.g. a
// deep-linked bookmark — still needs somewhere to land). Mirrors
// bidding-tictactoe/web/host-worker/index.ts; per `[[cloudflare-not-
// firebase-hosting]]` this is the root-mount Cloudflare pattern, not a
// Firebase Hosting deploy.

interface Env {
  ASSETS: Fetcher; // Cloudflare Workers static-assets binding
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === "/" || url.pathname === "/index.html") {
      return env.ASSETS.fetch(new Request(new URL("/index.html", url), req));
    }
    const assetRes = await env.ASSETS.fetch(req);
    if (assetRes.status !== 404) return assetRes;
    return env.ASSETS.fetch(new Request(new URL("/index.html", url), req));
  },
};
