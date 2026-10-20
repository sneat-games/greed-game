package greedgame

import (
	"context"
	"errors"
	"testing"

	"github.com/dal-go/dalgo/dal"
	"github.com/sneat-games/greed-game/server-go/greedgame/dal4greedgame"
)

func TestCreateSession_RequiresHostUserID(t *testing.T) {
	ctx, db := newMemoryDB(t)
	wallet := newFakeWallet(nil)
	if _, err := CreateSession(ctx, db, wallet, Player{}, 0, 0); err == nil {
		t.Fatal("expected an error for a missing host.UserID")
	}
}

func TestCreateSession_PropagatesAllowanceError(t *testing.T) {
	ctx, db := newMemoryDB(t)
	wallet := newFakeWallet(nil)
	boom := errors.New("allowance boom")
	// Wrap EnsureDailyAllowance failure via a tiny adapter, since fakeWallet's
	// EnsureDailyAllowance never fails on its own.
	failing := failingAllowanceWallet{CoinWallet: wallet, err: boom}
	if _, err := CreateSession(ctx, db, failing, Player{UserID: "host"}, 0, 0); !errors.Is(err, boom) {
		t.Fatalf("CreateSession: err = %v, want wrapping %v", err, boom)
	}
}

func TestJoin_RequiresPlayerUserID(t *testing.T) {
	ctx, db := newMemoryDB(t)
	wallet := newFakeWallet(nil)
	gameID, _ := CreateSession(ctx, db, wallet, Player{UserID: "host"}, 0, 0)
	if err := Join(ctx, db, wallet, gameID, Player{}); err == nil {
		t.Fatal("expected an error for a missing player.UserID")
	}
}

func TestJoin_PropagatesAllowanceError(t *testing.T) {
	ctx, db := newMemoryDB(t)
	wallet := newFakeWallet(nil)
	gameID, _ := CreateSession(ctx, db, wallet, Player{UserID: "host"}, 0, 0)

	boom := errors.New("allowance boom")
	failing := failingAllowanceWallet{CoinWallet: wallet, err: boom}
	if err := Join(ctx, db, failing, gameID, Player{UserID: "guest"}); !errors.Is(err, boom) {
		t.Fatalf("Join: err = %v, want wrapping %v", err, boom)
	}
}

func TestGetSession_UnknownGame(t *testing.T) {
	ctx, db := newMemoryDB(t)
	if _, err := GetSession(ctx, db, "missing"); !errors.Is(err, ErrGameNotFound) {
		t.Fatalf("GetSession(missing): err = %v, want ErrGameNotFound", err)
	}
}

func TestSetGroupMessage_UnknownGame(t *testing.T) {
	ctx, db := newMemoryDB(t)
	if err := SetGroupMessage(ctx, db, "missing", 1); !errors.Is(err, ErrGameNotFound) {
		t.Fatalf("SetGroupMessage(missing): err = %v, want ErrGameNotFound", err)
	}
}

func TestPlaceBid_PropagatesBalanceError(t *testing.T) {
	ctx, db := newMemoryDB(t)
	wallet := newFakeWallet(map[string]int{"a": 100, "b": 100})
	gameID, _ := CreateSession(ctx, db, wallet, Player{UserID: "a"}, 0, 0)
	_ = Join(ctx, db, wallet, gameID, Player{UserID: "b"})
	_ = StartSession(ctx, db, gameID)

	boom := errors.New("balance boom")
	failing := failingBalanceWallet{CoinWallet: wallet, err: boom}
	if _, err := PlaceBid(ctx, db, failing, gameID, "a", 5); !errors.Is(err, boom) {
		t.Fatalf("PlaceBid: err = %v, want wrapping %v", err, boom)
	}
}

// failingAllowanceWallet wraps a CoinWallet and always fails
// EnsureDailyAllowance, to test error propagation from CreateSession/Join.
type failingAllowanceWallet struct {
	CoinWallet
	err error
}

func (w failingAllowanceWallet) EnsureDailyAllowance(context.Context, string) error {
	return w.err
}

// failingBalanceWallet wraps a CoinWallet and always fails Balance, to test
// error propagation from PlaceBid.
type failingBalanceWallet struct {
	CoinWallet
	err error
}

func (w failingBalanceWallet) Balance(context.Context, string) (int, error) {
	return 0, w.err
}

type failingBalanceForUserWallet struct {
	CoinWallet
	failUserID string
	err        error
}

func (w failingBalanceForUserWallet) Balance(ctx context.Context, userID string) (int, error) {
	if userID == w.failUserID {
		return 0, w.err
	}
	return w.CoinWallet.Balance(ctx, userID)
}

type advanceOnSettleWallet struct {
	CoinWallet
	ctx    context.Context
	db     dal.DB
	gameID string
}

func (w advanceOnSettleWallet) Award(ctx context.Context, userID string, amount int, key string) error {
	_ = w.db.RunReadwriteTransaction(ctx, func(ctx context.Context, tx dal.ReadwriteTransaction) error {
		entry, _ := dal4greedgame.GetSessionTx(ctx, tx, w.gameID)
		entry.Data.Round = 99
		return tx.Set(ctx, entry.Record)
	})
	return w.CoinWallet.Award(ctx, userID, amount, key)
}

type deleteOnSettleWallet struct {
	CoinWallet
	ctx    context.Context
	db     dal.DB
	gameID string
}

func (w deleteOnSettleWallet) Award(ctx context.Context, userID string, amount int, key string) error {
	_ = w.db.RunReadwriteTransaction(ctx, func(ctx context.Context, tx dal.ReadwriteTransaction) error {
		entry, _ := dal4greedgame.GetSessionTx(ctx, tx, w.gameID)
		return tx.Delete(ctx, entry.Record.Key())
	})
	return w.CoinWallet.Award(ctx, userID, amount, key)
}

type failingDB struct {
	dal.DB
}

func (f failingDB) RunReadwriteTransaction(ctx context.Context, fn func(ctx context.Context, tx dal.ReadwriteTransaction) error, options ...dal.TransactionOption) error {
	return errors.New("simulated tx failure")
}

func TestEdgeCases(t *testing.T) {
	ctx, db := newMemoryDB(t)
	wallet := newFakeWallet(map[string]int{"a": 100, "b": 100, "c": 100})

	// failingDB on CreateSession
	if _, err := CreateSession(ctx, failingDB{DB: db}, wallet, Player{UserID: "a"}, 0, 0); err == nil {
		t.Error("CreateSession on failingDB expected error, got nil")
	}

	// Missing game tests for SetPlayerChatID, StartSession, RecordBid, ResolveRound
	if err := SetPlayerChatID(ctx, db, "missing", "a", 123); !errors.Is(err, ErrGameNotFound) {
		t.Errorf("SetPlayerChatID(missing) = %v, want ErrGameNotFound", err)
	}
	if err := StartSession(ctx, db, "missing"); !errors.Is(err, ErrGameNotFound) {
		t.Errorf("StartSession(missing) = %v, want ErrGameNotFound", err)
	}
	if _, err := RecordBid(ctx, db, "missing", "a", 10); !errors.Is(err, ErrGameNotFound) {
		t.Errorf("RecordBid(missing) = %v, want ErrGameNotFound", err)
	}
	if _, err := ResolveRound(ctx, db, wallet, "missing"); !errors.Is(err, ErrGameNotFound) {
		t.Errorf("ResolveRound(missing) = %v, want ErrGameNotFound", err)
	}

	// mapNotFound with generic error
	orig := errors.New("generic")
	if got := mapNotFound(orig); got != orig {
		t.Errorf("mapNotFound(%v) = %v, want same", orig, got)
	}

	// ResolveRound with sat out player
	gameID, _ := CreateSession(ctx, db, wallet, Player{UserID: "a"}, 0, 0)
	_ = Join(ctx, db, wallet, gameID, Player{UserID: "b"})
	_ = Join(ctx, db, wallet, gameID, Player{UserID: "c"})
	_ = StartSession(ctx, db, gameID)
	// Mark c as SatOut
	_ = db.RunReadwriteTransaction(ctx, func(ctx context.Context, tx dal.ReadwriteTransaction) error {
		entry, _ := dal4greedgame.GetSessionTx(ctx, tx, gameID)
		entry.Data.Players[2].SatOut = true
		return tx.Set(ctx, entry.Record)
	})
	_, _ = RecordBid(ctx, db, gameID, "a", 10)
	_, _ = RecordBid(ctx, db, gameID, "b", 15)
	if _, err := ResolveRound(ctx, db, wallet, gameID); err != nil {
		t.Fatalf("ResolveRound with sat out player failed: %v", err)
	}

	// ResolveRound with fewer than 2 active players
	gameID2, _ := CreateSession(ctx, db, wallet, Player{UserID: "a"}, 0, 0)
	_ = Join(ctx, db, wallet, gameID2, Player{UserID: "b"})
	_ = StartSession(ctx, db, gameID2)
	_ = db.RunReadwriteTransaction(ctx, func(ctx context.Context, tx dal.ReadwriteTransaction) error {
		entry, _ := dal4greedgame.GetSessionTx(ctx, tx, gameID2)
		entry.Data.Players[1].SatOut = true
		return tx.Set(ctx, entry.Record)
	})
	if _, err := ResolveRound(ctx, db, wallet, gameID2); err == nil {
		t.Error("ResolveRound with 1 active player expected error, got nil")
	}

	// ResolveRound balance error
	gameID3, _ := CreateSession(ctx, db, wallet, Player{UserID: "a"}, 0, 0)
	_ = Join(ctx, db, wallet, gameID3, Player{UserID: "b"})
	_ = StartSession(ctx, db, gameID3)
	_, _ = RecordBid(ctx, db, gameID3, "a", 10)
	_, _ = RecordBid(ctx, db, gameID3, "b", 15)
	failingWal := failingBalanceWallet{CoinWallet: wallet, err: errors.New("bal boom")}
	if _, err := ResolveRound(ctx, db, failingWal, gameID3); err == nil {
		t.Error("ResolveRound with failing balance wallet expected error, got nil")
	}

	// SetPlayerChatID idempotent write
	_ = SetPlayerChatID(ctx, db, gameID, "a", 123)
	if err := SetPlayerChatID(ctx, db, gameID, "a", 123); err != nil {
		t.Errorf("SetPlayerChatID idempotent call failed: %v", err)
	}

	// ResolveRound with negative bid causing greedplay.Resolve error
	gameID4, _ := CreateSession(ctx, db, wallet, Player{UserID: "a"}, 0, 0)
	_ = Join(ctx, db, wallet, gameID4, Player{UserID: "b"})
	_ = StartSession(ctx, db, gameID4)
	_ = db.RunReadwriteTransaction(ctx, func(ctx context.Context, tx dal.ReadwriteTransaction) error {
		entry, _ := dal4greedgame.GetSessionTx(ctx, tx, gameID4)
		entry.Data.Players[0].Bid = -1
		entry.Data.Players[1].Bid = 10
		return tx.Set(ctx, entry.Record)
	})
	if _, err := ResolveRound(ctx, db, wallet, gameID4); err == nil {
		t.Error("ResolveRound with negative bid expected error from greedplay.Resolve, got nil")
	}

	// ResolveRound with failing balance for sat-out player
	failingSatOutWal := failingBalanceForUserWallet{CoinWallet: wallet, failUserID: "c", err: errors.New("satout bal boom")}
	_, _ = RecordBid(ctx, db, gameID, "a", 10)
	_, _ = RecordBid(ctx, db, gameID, "b", 15)
	if _, err := ResolveRound(ctx, db, failingSatOutWal, gameID); err == nil {
		t.Error("ResolveRound with failing balance for sat-out player expected error, got nil")
	}

	// ResolveRound concurrently advanced
	gameID5, _ := CreateSession(ctx, db, wallet, Player{UserID: "a"}, 0, 0)
	_ = Join(ctx, db, wallet, gameID5, Player{UserID: "b"})
	_ = StartSession(ctx, db, gameID5)
	_, _ = RecordBid(ctx, db, gameID5, "a", 10)
	_, _ = RecordBid(ctx, db, gameID5, "b", 15)
	advWal := advanceOnSettleWallet{CoinWallet: wallet, ctx: ctx, db: db, gameID: gameID5}
	if _, err := ResolveRound(ctx, db, advWal, gameID5); err == nil {
		t.Error("ResolveRound concurrently advanced expected error, got nil")
	}

	// ResolveRound with session deleted during settlement
	gameID6, _ := CreateSession(ctx, db, wallet, Player{UserID: "a"}, 0, 0)
	_ = Join(ctx, db, wallet, gameID6, Player{UserID: "b"})
	_ = StartSession(ctx, db, gameID6)
	_, _ = RecordBid(ctx, db, gameID6, "a", 10)
	_, _ = RecordBid(ctx, db, gameID6, "b", 15)
	delWal := deleteOnSettleWallet{CoinWallet: wallet, ctx: ctx, db: db, gameID: gameID6}
	if _, err := ResolveRound(ctx, db, delWal, gameID6); err == nil {
		t.Error("ResolveRound with deleted session expected error, got nil")
	}
}
