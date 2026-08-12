# The Greed Game — Web

Two-player web build of The Greed Game at
[greed.sneat.games](https://greed.sneat.games): a hidden-bid duel where
bidding big is brave, but bidding *too* big is greedy — and greed loses.

Client-only, like the rest of the [Sneat games family](https://sneat.games):
vs Bot runs entirely in the browser (offline-capable), and vs Friend is a
direct browser-to-browser WebRTC connection brokered by the shared
`webrtc.sneat.games` relay. No accounts, no server holding game state.

## The rules

Both players start with **100 coins** and play **5 rounds**. Each round both
secretly bid an integer from 1 up to their own bankroll, then:

| | Outcome |
|---|---|
| Bids equal | **Draw** — nothing moves |
| Higher bid ≤ 2× the lower | **Courage** — the higher bidder wins the stake |
| Higher bid > 2× the lower | **Greed** — the higher bidder is punished, and the *lower* bidder wins the stake |

The stake is always **L, the lower of the two bids**, so nobody can lose more
than they themselves bid, and a bankroll can never go negative. After 5 rounds
the larger bankroll wins; equal bankrolls draw. If a player's bankroll hits 0
they can no longer meet the minimum bid, so the match ends there and then.

`GreedFactor` is 2 — see `src/engine/greedplay.ts`.

## Go rule-of-record

`src/engine/greedplay.ts` is a faithful TypeScript port of
`server-go/greedplay/greedplay.go` in this repo, which remains the rule of
record. The tests in `greedplay.test.ts` mirror `greedplay_test.go`
fixture-for-fixture, so a rule change in Go trips a failure on the TS side.
The Go engine also implements the **N-player** settlement (pairwise duels plus
the two caps); the web build deliberately ships the **2-player** case only —
see `spec/features/web-game/README.md`.

## Hidden bids without a server

Bids are hidden with the same commit–reveal the other Sneat bidding games use
(`@sneat/game-kit`): each peer sends `sha256(bid|salt)` first, and only once
both commitments are in does either reveal. Neither side can read the other's
bid before committing to their own, and neither can change a bid afterwards —
so a two-player match needs no server to keep the secret. An e2e test asserts
the opponent's bid is nowhere in the page before the reveal.

## Local development

```sh
npm install
npm run dev          # http://localhost:4321
npm run test         # vitest — engine, bot, greed hint
npm run typecheck
npm run lint
npm run build        # static dist/, relative paths (portal-zippable)
npm run e2e          # Playwright journeys
npm run relay        # the kit's local signalling relay, for vs-Friend
```

## Deploy

| Surface | How |
|---|---|
| greed.sneat.games | `npm run host:deploy` (Cloudflare Worker `greed-game`) |
| CrazyGames / itch.io | `npm run build && zip -r greed-game.zip dist/` |

The service worker registers **only** on `*.sneat.games` — never on localhost
(it would serve a stale build after a rebuild) and never inside a portal
iframe.
