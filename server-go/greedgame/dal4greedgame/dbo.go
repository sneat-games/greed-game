// Package dal4greedgame is the dalgo persistence layer for GreedGame sessions:
// the DBO (data-bearing-object) shape and the key builder + get/save helpers.
// It holds no game rules — those live in the parent greedgame package, which
// is the only intended caller.
package dal4greedgame

import "time"

// ExtensionID namespaces GreedGame's records under ext/greedgame/... (a
// convention shared with other Sneat extensions: ext/<extID>/<collection>/<id>).
const ExtensionID = "greedgame"

// SessionsCollection holds one document per GreedGame session.
const SessionsCollection = "sessions"

// Status is a GameSessionDbo's lifecycle state.
type Status string

const (
	// StatusLobby: the session has been created and is accepting joins; no
	// round is in progress yet.
	StatusLobby Status = "lobby"

	// StatusActive: the host has started the game; players secretly bid each
	// round until it resolves.
	StatusActive Status = "active"

	// StatusFinished: the session has completed (fixed round count reached, or
	// fewer than two players remain able to bid) — a terminal state.
	StatusFinished Status = "finished"
)

// PlayerDbo is one participant in a GreedGame session.
type PlayerDbo struct {
	// UserID is the host's application-level user ID — the identity the
	// CoinWallet port operates on. Required, unique within a session's Players
	// slice.
	UserID string `json:"userID" firestore:"userID"`

	// Name is a display name captured at join time, used to render the group
	// status message and DMs without a live user lookup.
	Name string `json:"name" firestore:"name"`

	// ChatID is the player's private Telegram chat ID with the game's bot,
	// captured opportunistically the first time they interact with the bot in
	// a DM (joining a private invite, or placing a bid). Zero means the bot
	// cannot yet DM this player directly.
	ChatID int64 `json:"chatID,omitempty" firestore:"chatID,omitempty"`

	// Bid is this round's secret bid. Zero means "not yet bid this round". It is
	// reset to zero at the start of every round, including round 1.
	Bid int `json:"bid,omitempty" firestore:"bid,omitempty"`

	// SatOut is true once this player could no longer afford the round's minimum
	// bid; they are excluded from the active-player set (and from the bids
	// required for a round to resolve) for the rest of the session.
	SatOut bool `json:"satOut,omitempty" firestore:"satOut,omitempty"`
}

// GameSessionDbo is the persisted state of one GreedGame session: its players,
// the current round, and its chat context. Per-player coin balances are NOT
// stored here — they live in the host's CoinWallet ledger and are read live,
// so there is exactly one source of truth for a player's bankroll across
// every game that uses it.
type GameSessionDbo struct {
	// HostUserID is the player who created the session (first to join).
	HostUserID string `json:"hostUserID" firestore:"hostUserID"`

	// ChatID is the Telegram group chat this session is anchored to, or 0 for a
	// private-invite session (host + friends, coordinated entirely by DM).
	ChatID int64 `json:"chatID,omitempty" firestore:"chatID,omitempty"`

	// MessageID is the group's single dedicated status message, edited in
	// place as players join/bid/round resolves. Meaningless when ChatID is 0.
	MessageID int `json:"messageID,omitempty" firestore:"messageID,omitempty"`

	// Players are the session's participants in join order.
	Players []PlayerDbo `json:"players" firestore:"players"`

	// Round is the current round number, starting at 1 once Status is Active.
	// Zero while still in the Lobby.
	Round int `json:"round" firestore:"round"`

	// Rounds is the fixed number of rounds this session plays (default
	// DefaultRounds); the highest balance when Round exceeds Rounds wins. The
	// session may also finish earlier if fewer than two players can still bid.
	Rounds int `json:"rounds" firestore:"rounds"`

	// Status is the session's lifecycle state.
	Status Status `json:"status" firestore:"status"`

	// CreatedAt records session creation for housekeeping/ordering.
	CreatedAt time.Time `json:"createdAt" firestore:"createdAt"`
}

// Validate satisfies dalgo's optional ValidatableRecord hook, so a
// structurally broken session can never be persisted.
func (v *GameSessionDbo) Validate() error {
	if v.HostUserID == "" {
		return errMissingField("hostUserID")
	}
	if len(v.Players) == 0 {
		return errMissingField("players")
	}
	seen := make(map[string]struct{}, len(v.Players))
	for i, p := range v.Players {
		if p.UserID == "" {
			return errIndexedField("players", i, "userID")
		}
		if _, dup := seen[p.UserID]; dup {
			return errDuplicatePlayer(p.UserID)
		}
		seen[p.UserID] = struct{}{}
	}
	switch v.Status {
	case StatusLobby, StatusActive, StatusFinished:
	default:
		return errInvalidStatus(v.Status)
	}
	return nil
}
