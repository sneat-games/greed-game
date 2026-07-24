package greedgame

import (
	"context"
	"fmt"
	"time"

	"github.com/dal-go/dalgo/dal"

	"github.com/sneat-games/greed-game/server-go/greedgame/dal4greedgame"
)

// CreateSession creates a new session with host as its sole player and grants
// them their coin allowance via wallet. chatID is 0 for a private-invite
// session, or a Telegram group chat ID for a group session; the caller is
// responsible for posting/anchoring that group's status message afterwards.
// rounds<=0 defaults to DefaultRounds.
func CreateSession(ctx context.Context, db dal.DB, wallet CoinWallet, host Player, chatID int64, rounds int) (gameID string, err error) {
	if host.UserID == "" {
		return "", fmt.Errorf("greedgame: CreateSession: host.UserID is required")
	}
	if rounds <= 0 {
		rounds = DefaultRounds
	}
	// The wallet call is external: do it BEFORE opening any dal transaction
	// (see package doc on why CoinWallet calls never run inside one).
	if err = wallet.EnsureDailyAllowance(ctx, host.UserID); err != nil {
		return "", fmt.Errorf("greedgame: CreateSession: grant allowance to host: %w", err)
	}

	gameID = NewGameID()
	entry := dal4greedgame.NewSessionEntry(gameID)
	// Mutate THROUGH the pointer NewSessionEntry allocated (rather than
	// reassigning entry.Data to a different pointer): entry.Record's Data()
	// aliases the original allocation, so replacing the pointer here would
	// silently save an empty struct instead.
	*entry.Data = *newSessionEntryData(gameID, host, chatID, rounds)
	if err = dal4greedgame.SaveSession(ctx, db, entry); err != nil {
		return "", fmt.Errorf("greedgame: CreateSession: save session %s: %w", gameID, err)
	}
	return gameID, nil
}

// SetGroupMessage records the anchored group status message's ID once it has
// been posted (the session must already carry the group's ChatID, set at
// CreateSession time).
func SetGroupMessage(ctx context.Context, db dal.DB, gameID string, messageID int) error {
	return db.RunReadwriteTransaction(ctx, func(ctx context.Context, tx dal.ReadwriteTransaction) error {
		entry, err := dal4greedgame.GetSessionTx(ctx, tx, gameID)
		if err != nil {
			return mapNotFound(err)
		}
		entry.Data.MessageID = messageID
		return tx.Set(ctx, entry.Record)
	})
}

// Join adds player to gameID's lobby. It grants the player's coin allowance
// via wallet (idempotent, so re-joining is harmless) before opening the join
// transaction.
//
// v1 only allows joining while the session is in its Lobby ("until it
// starts/fills" — simplified to "until the host starts the game"; joining
// mid-round is not supported, see package doc).
func Join(ctx context.Context, db dal.DB, wallet CoinWallet, gameID string, player Player) error {
	if player.UserID == "" {
		return fmt.Errorf("greedgame: Join: player.UserID is required")
	}
	if err := wallet.EnsureDailyAllowance(ctx, player.UserID); err != nil {
		return fmt.Errorf("greedgame: Join: grant allowance to %s: %w", player.UserID, err)
	}
	return db.RunReadwriteTransaction(ctx, func(ctx context.Context, tx dal.ReadwriteTransaction) error {
		entry, err := dal4greedgame.GetSessionTx(ctx, tx, gameID)
		if err != nil {
			return mapNotFound(err)
		}
		session := entry.Data
		if idx := findPlayerIndex(session.Players, player.UserID); idx >= 0 {
			// Re-joining (e.g. tapping the invite link twice, or the group Join
			// button after already joining) is a harmless no-op — but do capture a
			// freshly-seen ChatID, since that is exactly how we opportunistically
			// learn a player's DM chat ID.
			if player.ChatID != 0 {
				session.Players[idx].ChatID = player.ChatID
			}
			return tx.Set(ctx, entry.Record)
		}
		if session.Status != dal4greedgame.StatusLobby {
			return ErrGameNotInLobby
		}
		session.Players = append(session.Players, dal4greedgame.PlayerDbo{
			UserID: player.UserID,
			Name:   player.Name,
			ChatID: player.ChatID,
		})
		return tx.Set(ctx, entry.Record)
	})
}

// SetPlayerChatID opportunistically records a player's private DM chat ID
// (e.g. the first time they interact with the bot privately after joining a
// group session via its callback button, without submitting a bid yet). A
// no-op if the player is not part of the session or chatID is 0.
func SetPlayerChatID(ctx context.Context, db dal.DB, gameID, userID string, chatID int64) error {
	if chatID == 0 {
		return nil
	}
	return db.RunReadwriteTransaction(ctx, func(ctx context.Context, tx dal.ReadwriteTransaction) error {
		entry, err := dal4greedgame.GetSessionTx(ctx, tx, gameID)
		if err != nil {
			return mapNotFound(err)
		}
		idx := findPlayerIndex(entry.Data.Players, userID)
		if idx < 0 {
			return ErrPlayerNotInGame
		}
		if entry.Data.Players[idx].ChatID == chatID {
			return nil // already up to date; avoid a needless write
		}
		entry.Data.Players[idx].ChatID = chatID
		return tx.Set(ctx, entry.Record)
	})
}

// StartSession transitions gameID from Lobby to Active and begins round 1. It
// requires at least two players.
func StartSession(ctx context.Context, db dal.DB, gameID string) error {
	return db.RunReadwriteTransaction(ctx, func(ctx context.Context, tx dal.ReadwriteTransaction) error {
		entry, err := dal4greedgame.GetSessionTx(ctx, tx, gameID)
		if err != nil {
			return mapNotFound(err)
		}
		session := entry.Data
		if session.Status != dal4greedgame.StatusLobby {
			return ErrGameNotInLobby
		}
		if len(session.Players) < 2 {
			return ErrNotEnoughPlayers
		}
		session.Status = dal4greedgame.StatusActive
		session.Round = 1
		return tx.Set(ctx, entry.Record)
	})
}

// GetSession loads gameID's current state (a plain, non-transactional read).
func GetSession(ctx context.Context, db dal.DB, gameID string) (dal4greedgame.SessionEntry, error) {
	entry, err := dal4greedgame.GetSession(ctx, db, gameID)
	if err != nil {
		return entry, mapNotFound(err)
	}
	return entry, nil
}

func mapNotFound(err error) error {
	if dal4greedgame.IsNotFound(err) {
		return ErrGameNotFound
	}
	return err
}

// findPlayerIndex returns the index of userID in players, or -1.
func findPlayerIndex(players []dal4greedgame.PlayerDbo, userID string) int {
	for i := range players {
		if players[i].UserID == userID {
			return i
		}
	}
	return -1
}

// activePlayers returns the players who have not sat out.
func activePlayers(players []dal4greedgame.PlayerDbo) []dal4greedgame.PlayerDbo {
	active := make([]dal4greedgame.PlayerDbo, 0, len(players))
	for _, p := range players {
		if !p.SatOut {
			active = append(active, p)
		}
	}
	return active
}

// activePlayerCount is len(activePlayers(players)) without the allocation.
func activePlayerCount(players []dal4greedgame.PlayerDbo) int {
	n := 0
	for _, p := range players {
		if !p.SatOut {
			n++
		}
	}
	return n
}

// minBidFor returns the minimum bid for a round with activeCount active
// players: the greedplay engine requires bids >= players-1 (so a capped bid
// can always be split among every other active player), floored at 1 so a
// single remaining player is never asked for a zero-or-negative bid.
func minBidFor(activeCount int) int {
	min := activeCount - 1
	if min < 1 {
		min = 1
	}
	return min
}

// allActiveBidsIn reports whether every non-sat-out player has a non-zero Bid.
func allActiveBidsIn(players []dal4greedgame.PlayerDbo) bool {
	found := false
	for _, p := range players {
		if p.SatOut {
			continue
		}
		found = true
		if p.Bid == 0 {
			return false
		}
	}
	return found // false if there are no active players at all (degenerate)
}

func newSessionEntryData(_ string, host Player, chatID int64, rounds int) *dal4greedgame.GameSessionDbo {
	return &dal4greedgame.GameSessionDbo{
		HostUserID: host.UserID,
		ChatID:     chatID,
		Players: []dal4greedgame.PlayerDbo{{
			UserID: host.UserID,
			Name:   host.Name,
			ChatID: host.ChatID,
		}},
		Round:     0,
		Rounds:    rounds,
		Status:    dal4greedgame.StatusLobby,
		CreatedAt: time.Now(),
	}
}
