// Package greedgame is the host-agnostic session and round-resolution logic
// for the Greed Game's multiplayer flow (originally built for the
// @GreedGameBot Telegram bot, but this package has no bot/Telegram
// dependency). It owns:
//
//   - the Firestore/dalgo session model (dal4greedgame): players, chat
//     context, round number, and each player's secret per-round bid;
//   - joining/starting a session;
//   - recording a bid and detecting "every active player has now bid"
//     ATOMICALLY in one read-write transaction (see RecordBid) — the two-late-
//     bidders race this guards against is the single hardest correctness
//     requirement of this package;
//   - resolving a round via the sneat-games/greed-game greedplay engine and
//     settling the result through the host-supplied CoinWallet.
//
// # Host wiring
//
// This package takes both its persistence (dal.DB) and its coin ledger
// (CoinWallet) as explicit parameters from the host — it imports neither a
// concrete database driver nor a concrete wallet implementation. A host
// (e.g. sneat-co/sneat-go) wires a real dal.DB and a CoinWallet adapter over
// its own coin ledger (e.g. sneat-core-modules/wallet/gamecoins) and calls
// into this package; nothing in this package ever imports the host module.
//
// # Coin model
//
// A player's coin balance is their bankroll and is NOT duplicated in the
// session document — the host's CoinWallet is the single source of truth,
// read live via Balance and mutated via Stake/Award with idempotent keys
// ("greedgame:<gameID>:r<round>:<userID>"). EnsureDailyAllowance is called
// whenever a player joins a session, so nobody needs a separate "top up" step.
//
// # Why CoinWallet calls never happen inside a dal transaction
//
// A CoinWallet implementation resolves and mutates its own ledger storage;
// calling it from inside an open db.RunReadwriteTransaction on the SAME
// database can deadlock (a strict in-memory test DB takes a single exclusive
// lock for the whole transaction) and is unsafe on most real backends too.
// Every function in this package that both touches the session document AND
// calls into the CoinWallet therefore does the wallet call(s) OUTSIDE any
// transaction it opens, in a well-defined order: balance reads before the bid
// transaction (PlaceBid), stake/award calls between reading the resolved
// round and writing the next round's state (ResolveRound).
//
// # A player who can't afford the minimum bid
//
// Once a player's coin balance drops below the round's minimum bid (active
// players - 1, the greedplay engine's own splittability floor), they are
// marked SatOut and excluded from the active-player set — and therefore from
// the "every active player has bid" check — for the rest of the session. They
// keep their final balance and appear in standings, but place no further bids.
//
// # Session end condition
//
// A session plays a fixed number of rounds (GameSessionDbo.Rounds, default
// DefaultRounds). It can also end earlier if fewer than two players remain
// able to bid. The player with the highest final coin balance wins.
package greedgame
