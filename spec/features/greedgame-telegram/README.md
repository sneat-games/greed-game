---
format: https://specscore.md/feature-specification
status: Draft
---

# Feature: GreedGame on Telegram (N-player, private + group, @GreedGameBot)

> [SpecScore.**Studio**](https://specscore.studio): | [Explore](https://specscore.studio/app/github.com/sneat-games/greed-game/spec/features/greedgame-telegram?op=explore) | [Edit](https://specscore.studio/app/github.com/sneat-games/greed-game/spec/features/greedgame-telegram?op=edit) | [Ask question](https://specscore.studio/app/github.com/sneat-games/greed-game/spec/features/greedgame-telegram?op=ask) | [Request change](https://specscore.studio/app/github.com/sneat-games/greed-game/spec/features/greedgame-telegram?op=request-change) |
**Status:** Draft
**Source Ideas:** greed-game-multiplayer

## Summary

**The Greed Game** as an **N-player hidden-bid** game on Telegram. Each round every
player secretly bids; **pairwise resolution** applies the classic 2-player rule to
every pair and nets the result. It runs on a dedicated **@GreedGameBot** (which owns
invites and DM bid entry) and can also be **launched from SneatBot `/games`**. It is
playable as a **private invite** (you + friends) or **in a group chat**, where one
**dedicated status message** tracks the session. Because bids are hidden, all state is
**server-side** (Firestore via dalgo) and bid entry always happens **privately** (DM).

This document follows the [SpecScore feature specification](https://specscore.md/feature-specification).

## Problem

The Greed Game is the owner's original hidden-bid game — *punish greed, reward
boldness*. Its legacy implementation (`sneat-games/greed-game`) was a 2-player app on
the dead `strongo/bots-framework` + `strongo/db` + the `sneat-games/arena` battle infra,
tied to a web SPA. We want to bring it to the current Sneat bot stack as a **real
multiplayer game**: N players, private *and* group play, on modern Firestore/dalgo
state. Unlike the callback-data mini-games (Reversi, RPS), GreedGame's hidden bids
**require server-side state** — a bid cannot live in client-visible callback data.

## Behavior

### The rule (engine)

#### REQ: duel-rule

A single duel between two integer bids (each ≥ 1) MUST resolve as: the amount that
changes hands is always **L = the lower bid**; the **higher** bidder wins (+L, other
−L — *courage*) **unless** the higher bid is strictly **> 2× the lower** (*greed*), in
which case the greedy higher bidder is punished and the **lower** bidder wins instead.
Equal bids draw (no transfer). Every duel is zero-sum, and neither player can win or
lose more than their own bid against any one opponent.

#### REQ: pairwise-resolution

A round of N players (N ≥ 2) MUST resolve **pairwise, under two caps** (from the
`greedplay` engine — the bot layer MUST NOT re-implement it): each player's single bid
duels every other player under REQ:duel-rule. **(1) Loss cap** — a player's *total*
loss in a round MUST NOT exceed their own bid; when their summed debts exceed it they
pay exactly their bid, split among the players who beat them in proportion to those
winners' bids (largest-remainder rounding). **(2) Win cap** — a winner takes at most
their own bid from any *one* opponent (automatic: the duel stake is the lower bid),
but MAY net more than their bid across several. The round MUST be zero-sum, and each
bid MUST be ≥ (players − 1) so a capped bid can always be split.

### Sessions & secret state

#### REQ: server-side-sessions

Game state MUST live server-side (Firestore via dalgo): a session holds its players,
per-player token balance, the current round, and each player's **secret bid for the
round**. A player's bid MUST NOT be revealed to other players (nor derivable from
client-visible callback data) until the round resolves.

#### REQ: bid-entry-private

Placing a bid MUST happen in a **private (DM) interaction** with @GreedGameBot, via
either an inline **calculator keypad** (tap digits + ×10/×100, ✅ to commit) or a
**typed number** — both accepted. A player therefore needs a DM relationship with
the bot; a group "Place bid" affordance MUST route the player into the bot DM.

### Homes & entry

#### REQ: greedgamebot-home

@GreedGameBot MUST be the game's home: it handles `/start` (incl. deep-link payloads
like `join_<sessionID>`), creating games, invites, DM bid entry, and notifications.

#### REQ: sneatbot-launch

SneatBot's `/games` MUST offer a GreedGame entry that launches the player into
@GreedGameBot (deep link), rather than hosting the multiplayer flow inside SneatBot.

### Private play (invites)

#### REQ: create-and-invite

A player MUST be able to create a session and invite others via a shareable deep
link (`t.me/GreedGameBot?start=join_<sessionID>`); opening it MUST add the opener to
that session (until it starts/fills).

### Group play

#### REQ: group-status-message

A session started in a group chat MUST be anchored to **one dedicated status
message** in that group, which MUST show the joined players, the round, a **bid
progress count** ("🔒 N/M bids in" — counts only, never values), and the previous
round's results + standings. Players join and trigger (private) bid entry from it.

### Round loop

#### REQ: resolve-when-all-in

A round MUST resolve only once **every active player has submitted a bid**. On
resolution the engine computes pairwise deltas, balances update, and **every player
(and the group status message, if any) MUST be notified** with the reveal + each
player's net + updated standings. Play then continues to the next round.

## Architecture & Components

- **`greedplay` engine** (this repo, `server-go/greedplay`) — pure N-player pairwise
  resolution (`Duel`, `DuelDetail`, `Resolve`), stdlib-only, released & versioned.
- **Session model + facade** (host bot, `sneat-co/sneat-go`) — Firestore/dalgo entities
  for a GreedGame session (players, balances, round, secret bids, chat context:
  private or group+`message_id`) and the transitions (create, join, place-bid,
  resolve). This is where server-side state lives.
- **@GreedGameBot profile** (`sneat-co/sneat-go`, mirroring `gameboardbot`) — `/start`
  + deep-link, create/invite, DM keypad + typed bid entry, group status message,
  notifications. Reads `GREEDGAMEBOT_TOKEN` / webhook secret (per the Cloud Run bot
  pipeline).
- **SneatBot launch entry** — a `/games` button deep-linking to @GreedGameBot.

## Not Doing / Out of Scope (v1)

- Real-money / tokens with monetary value — play tokens only.
- The legacy `sneat-games/arena` battle/tournament/leaderboard infra and the old web SPA.
- Matchmaking with strangers (the legacy "play a stranger") — invites + groups only.
- AI/robot players (the game is human-vs-human; a practice bot could come later).
- Web/other-messenger clients — Telegram only for now.

## Acceptance Criteria

### AC: duel-resolves-per-rule (verifies REQ:duel-rule)

**Given** two bids
**When** the duel resolves
**Then** the transfer is the lower bid; the **higher** bidder wins unless the higher
bid is > 2× the lower (then the **lower** bidder wins); equal bids draw; and the two
deltas sum to zero.

### AC: round-is-pairwise-and-zero-sum (verifies REQ:pairwise-resolution)

**Given** N players' bids (e.g. [10, 15, 40], or [10, 11, 12] where the loss cap bites)
**When** the round resolves
**Then** deltas are computed pairwise under the two caps (e.g. [0, +25, −25] and
[−10, −6, +16] respectively) and all deltas sum to zero.

### AC: bids-stay-secret (verifies REQ:server-side-sessions)

**Given** a session where some players have bid and others have not
**When** the state is inspected before resolution
**Then** no player's bid value is visible to other players or present in any
client-visible callback data; only the fact that they have/haven't bid is exposed.

### AC: bid-entered-privately (verifies REQ:bid-entry-private)

**Given** a player placing a bid (in a private or group session)
**When** they enter it
**Then** it is done in a DM with @GreedGameBot via the keypad or a typed number, and
the value is never shown in a shared/group message.

### AC: launch-from-sneatbot (verifies REQ:sneatbot-launch)

**Given** a user in SneatBot's `/games`
**When** they choose GreedGame
**Then** they are launched into @GreedGameBot (deep link), not into an in-SneatBot flow.

### AC: invite-deep-link-joins (verifies REQ:create-and-invite)

**Given** a shared invite link `t.me/GreedGameBot?start=join_<sessionID>`
**When** another user opens it
**Then** they are added to that session.

### AC: group-status-message-tracks-session (verifies REQ:group-status-message)

**Given** a session started in a group
**When** players join and bid
**Then** one dedicated group message shows the players, round, and a bid **count**
("🔒 N/M bids in") without revealing any bid, and shows the results + standings after
resolution.

### AC: resolves-only-when-all-in (verifies REQ:resolve-when-all-in)

**Given** an active round
**When** the last outstanding player submits their bid
**Then** the round resolves via the engine, balances update, and every player (and the
group status message, if any) is notified with the reveal, each net, and standings.

## Open Questions

- Round/session end condition (bust at 0? fixed number of rounds? host ends it?) —
  to be pinned during Phase 4.
- Bankroll size and whether balances are per-session or persist across sessions.

## Rehearse Integration

Engine REQs (duel-rule, pairwise-resolution) are covered by `greedplay` unit tests.
Session/flow REQs are integration-level and will be covered as those phases land.

---
*This document follows the https://specscore.md/feature-specification*
