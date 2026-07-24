---
format: https://specscore.md/idea-specification
status: Specifying
---

# Idea: The Greed Game — hidden-bid multiplayer

**Status:** Specifying
**Date:** 2026-07-24
**Owner:** alex
**Promotes To:** greedgame-telegram
**Supersedes:** —
**Related Ideas:** —

## Problem Statement

How might we bring the Greed Game (hidden-bid, punish-greed/reward-boldness) to Telegram as an N-player game playable in private invites and group chats?

## Context

The Greed Game is the owner's original hidden-bid game: two (now N) players secretly
bid; the money that changes hands is always the **lower** bid; the lower bidder wins
**unless** the higher bid is **> 2×** the lower, in which case the bold high-bidder
wins. It punishes moderate greed and rewards boldness. Its legacy build
(`prizarena/greed-game`) is a dead 2-player app on `strongo/bots-framework` +
`strongo/db` + `prizarena/arena` with a web SPA. SneatBot already has a `/games`
menu (Reversi, RPS); GreedGame is the next candidate, but — unlike those callback-data
games — its **hidden bids require server-side state**.

## Recommended Direction

Rebuild GreedGame on the current Sneat stack as a **true multiplayer** game.
Generalize to **N players via pairwise resolution** (your one bid duels every other
player; net the results — zero-sum, and actually richer: when everyone bids low the
lowest sweeps, which is exactly what makes a bold >2× leap pay). Keep all state in
**Firestore/dalgo sessions** with **secret per-player bids**.

Give it a dedicated **@GreedGameBot** (owns invites + DM bid entry + notifications),
launchable from **SneatBot `/games`**. Support **private invites** and **group chats**,
where one **dedicated status message** tracks the session and shows a bid *count*
("🔒 N/M in") without revealing values. Bid entry is always **private** (DM) — via a
calculator keypad or a typed number — so bids stay hidden even in a group.

## Alternatives Considered

- **Solo-vs-robot in callback data (like Reversi/RPS)** — lost: GreedGame's essence is
  reading a *person's* nerve; vs a robot it degenerates to math (random) or a
  prediction duel (AI). The real game is human-vs-human.
- **2-player only** — lost: pairwise resolution generalizes cleanly to N with more
  strategic depth, for the same session/invite infrastructure cost.
- **Host inside SneatBot only** — lost: a standalone multiplayer game with invites,
  lobbies, and group status messages fits a dedicated bot better; SneatBot just
  launches into it.

## MVP Scope

A group of people can start a Greed Game (private invite or in a group), each secretly
place bids over successive rounds via the bot's DM, and see each round resolved
(pairwise) with the reveal, their net, and updated standings — with **no bid ever
leaking** before resolution.

## Not Doing (and Why)

- Real-money value / payments — play tokens only; keep it a game.
- Legacy `prizarena/arena` tournament/leaderboard infra + the old web SPA — superseded.
- Stranger matchmaking — invites + groups only for v1.
- AI/robot players — the game is human-vs-human; a practice bot is a possible later add.
- Web / other messengers — Telegram only for now.

## Key Assumptions to Validate

| Tier | Assumption | How to validate |
|------|------------|-----------------|
| Must-be-true | Hidden bids can be collected privately (DM keypad/typed) while a group's dedicated status message shows only counts — i.e. no bid leaks. | Build the group flow; verify the group message never carries a value and bid entry is DM-only. |
| Must-be-true | Pairwise N-player resolution is understandable enough for players via a per-duel results screen. | Play-test 3–4 players; confirm the reveal/standings read clearly. |
| Should-be-true | Players will start a DM with @GreedGameBot to bid (needed for secrecy) rather than abandon. | Watch join→bid conversion in group games. |
| Might-be-true | N-player greed stays fun and non-degenerate (bold play remains worthwhile as N grows). | Play-test with 4–6; check bold leaps still pay. |

## SpecScore Integration

- **New Features this would create:** [`greedgame-telegram`](../features/greedgame-telegram/README.md)
- **Existing Features affected:** the ecosystem [`games`](../../../../sneat-co/backstage/spec/features/games/README.md) feature (GreedGame moves from candidate to specified).
- **Dependencies:** a new @GreedGameBot (BotFather + `GREEDGAMEBOT_TOKEN`); Firestore/dalgo; host wiring in `sneat-co/sneat-go`.

## Open Questions

None at this time.
