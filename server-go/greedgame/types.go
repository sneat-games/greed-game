package greedgame

import "context"

// DefaultRounds is how many rounds a session plays when not overridden.
const DefaultRounds = 5

// CoinWallet is the port this package uses for every coin-ledger operation. A
// host implements it over its own wallet/coin service (e.g. sneat-go
// implements it over sneat-core-modules/wallet/gamecoins) and passes it into
// CreateSession, Join, PlaceBid, and ResolveRound. This package never imports
// a concrete wallet implementation.
//
// Every method is idempotent-key-aware where it moves value (Stake, Award),
// mirroring the shared Sneat wallet convention: a retried call with the same
// idemKey is a no-op replay, never a double-move.
type CoinWallet interface {
	// EnsureDailyAllowance grants a player's free coin allowance if they don't
	// already have today's, so a player never needs a separate "top up" step.
	// It must be safe to call repeatedly (idempotent per user/day).
	EnsureDailyAllowance(ctx context.Context, userID string) error

	// Balance returns a player's current coin balance.
	Balance(ctx context.Context, userID string) (int, error)

	// Stake debits amount coins from a player (a round's loss), idempotent by
	// idemKey. amount must be > 0.
	Stake(ctx context.Context, userID string, amount int, idemKey string) error

	// Award credits amount coins to a player (a round's win), idempotent by
	// idemKey. amount must be > 0.
	Award(ctx context.Context, userID string, amount int, idemKey string) error
}

// Player identifies one participant for Create/Join calls.
type Player struct {
	// UserID is the host's application-level user ID.
	UserID string
	// Name is a display name (see PlayerDbo.Name).
	Name string
	// ChatID is the player's private Telegram chat ID with the game's bot, if
	// already known at join time (e.g. they joined via a DM deep link). Zero
	// when unknown yet (e.g. they joined a group session via a callback tap).
	// Hosts that are not Telegram-backed can simply always pass 0.
	ChatID int64
}

// BidResult is returned by RecordBid/PlaceBid.
type BidResult struct {
	// GameID is the session the bid was recorded against.
	GameID string
	// Round is the round the bid was recorded for.
	Round int
	// AllBidsIn is true when this bid was the LAST one needed to complete the
	// round — i.e. every active player now has a bid. At most one call across
	// any number of concurrent bidders ever observes this as true for a given
	// (gameID, round) pair; see RecordBid's transaction.
	AllBidsIn bool
	// ActivePlayerCount is how many players were required to bid this round.
	ActivePlayerCount int
}

// PlayerRoundResult is one player's outcome from a resolved round.
type PlayerRoundResult struct {
	UserID  string
	Name    string
	Bid     int
	Delta   int // net coins won (positive) or lost (negative) this round
	Balance int // coin balance AFTER settlement
}

// Standing is one player's position in the running/final standings.
type Standing struct {
	UserID  string
	Name    string
	Balance int
	SatOut  bool
}

// RoundOutcome is returned by ResolveRound: everything the caller needs to
// render the reveal message(s) and the group status message.
type RoundOutcome struct {
	GameID string
	// Round is the round number that was just resolved.
	Round int
	// NextRound is Round+1, or 0 when Finished.
	NextRound int
	// Finished is true when this was the session's last round (fixed round
	// count reached, or fewer than two players remain able to bid).
	Finished bool
	// Results holds one entry per player who was active (bid) this round, in
	// player order.
	Results []PlayerRoundResult
	// NewlySatOut lists userIDs who fell below the next round's minimum bid as
	// of this resolution (empty when Finished).
	NewlySatOut []string
	// Standings ranks every player (including those sitting out) by balance,
	// highest first.
	Standings []Standing
}
