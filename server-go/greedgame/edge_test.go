package greedgame

import (
	"context"
	"errors"
	"testing"
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
