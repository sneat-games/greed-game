package dal4greedgame

import (
	"context"

	"github.com/dal-go/dalgo/dal"
	"github.com/dal-go/record"
)

// SessionEntry is the typed dalgo envelope for a GreedGame session: ID (the
// gameID), Key, the underlying Record, and the strongly typed Data.
type SessionEntry = record.DataWithID[string, *GameSessionDbo]

// NewSessionEntry builds an (as-yet-unpopulated) envelope for gameID, ready to
// be passed to db.Get / tx.Get / tx.Set.
func NewSessionEntry(gameID string) SessionEntry {
	return record.NewDataWithID(gameID, newSessionKey(gameID), new(GameSessionDbo))
}

// GetSession loads a session outside of any transaction (a plain read). Use
// GetSessionTx to read inside an already-open dal.ReadwriteTransaction instead
// — never call GetSession from inside a transaction callback on the same DB:
// on a strict in-memory test DB (and most real backends) that deadlocks or
// violates the backend's read/write ordering rules.
func GetSession(ctx context.Context, db dal.DB, gameID string) (SessionEntry, error) {
	entry := NewSessionEntry(gameID)
	err := db.Get(ctx, entry.Record)
	return entry, err
}

// GetSessionTx loads a session using an already-open read/write transaction's
// Get, so the read participates in that transaction.
func GetSessionTx(ctx context.Context, tx dal.ReadSession, gameID string) (SessionEntry, error) {
	entry := NewSessionEntry(gameID)
	err := tx.Get(ctx, entry.Record)
	return entry, err
}

// SaveSession persists entry in its own read-write transaction (a plain,
// non-conditional write — callers needing get-then-set atomicity should use
// GetSessionTx + tx.Set inside their own db.RunReadwriteTransaction instead, as
// the round-bidding logic in the parent package does).
func SaveSession(ctx context.Context, db dal.DB, entry SessionEntry) error {
	return db.RunReadwriteTransaction(ctx, func(ctx context.Context, tx dal.ReadwriteTransaction) error {
		return tx.Set(ctx, entry.Record)
	})
}

// IsNotFound reports whether err represents a missing session document.
func IsNotFound(err error) bool {
	return record.IsNotFound(err)
}
