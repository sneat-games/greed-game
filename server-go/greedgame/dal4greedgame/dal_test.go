package dal4greedgame

import (
	"context"
	"errors"
	"testing"

	"github.com/dal-go/dalgo/dal"
	"github.com/dal-go/record"
)

func TestNewSessionEntry_KeyShape(t *testing.T) {
	entry := NewSessionEntry("g1")
	if entry.ID != "g1" {
		t.Fatalf("ID = %q, want g1", entry.ID)
	}
	want := "ext/greedgame/sessions/g1"
	if got := entry.Key.String(); got != want {
		t.Fatalf("Key.String() = %q, want %q", got, want)
	}
}

func TestSaveAndGetSession_RoundTrip(t *testing.T) {
	ctx, db := newMemoryDB(t)

	entry := NewSessionEntry("g1")
	entry.Data.HostUserID = "u1"
	entry.Data.Rounds = 5
	entry.Data.Status = StatusLobby
	entry.Data.Players = []PlayerDbo{{UserID: "u1", Name: "Alice"}}

	if err := SaveSession(ctx, db, entry); err != nil {
		t.Fatalf("SaveSession: %v", err)
	}

	loaded, err := GetSession(ctx, db, "g1")
	if err != nil {
		t.Fatalf("GetSession: %v", err)
	}
	if loaded.Data.HostUserID != "u1" || len(loaded.Data.Players) != 1 || loaded.Data.Players[0].Name != "Alice" {
		t.Fatalf("loaded session mismatch: %+v", loaded.Data)
	}
}

func TestGetSessionTx_ParticipatesInTransaction(t *testing.T) {
	ctx, db := newMemoryDB(t)
	entry := NewSessionEntry("g1")
	entry.Data.HostUserID = "u1"
	entry.Data.Status = StatusLobby
	entry.Data.Players = []PlayerDbo{{UserID: "u1"}}
	if err := SaveSession(ctx, db, entry); err != nil {
		t.Fatalf("SaveSession: %v", err)
	}

	err := db.RunReadwriteTransaction(ctx, func(ctx context.Context, tx dal.ReadwriteTransaction) error {
		loaded, gErr := GetSessionTx(ctx, tx, "g1")
		if gErr != nil {
			return gErr
		}
		if loaded.Data.HostUserID != "u1" {
			t.Fatalf("HostUserID = %q, want u1", loaded.Data.HostUserID)
		}
		loaded.Data.Round = 1
		return tx.Set(ctx, loaded.Record)
	})
	if err != nil {
		t.Fatalf("RunReadwriteTransaction: %v", err)
	}

	loaded, err := GetSession(ctx, db, "g1")
	if err != nil {
		t.Fatalf("GetSession: %v", err)
	}
	if loaded.Data.Round != 1 {
		t.Fatalf("Round = %d, want 1 (set via GetSessionTx + tx.Set)", loaded.Data.Round)
	}

	// Not-found also propagates correctly through GetSessionTx.
	err = db.RunReadwriteTransaction(ctx, func(ctx context.Context, tx dal.ReadwriteTransaction) error {
		_, gErr := GetSessionTx(ctx, tx, "missing")
		return gErr
	})
	if !IsNotFound(err) {
		t.Fatalf("GetSessionTx(missing): IsNotFound(%v) = false, want true", err)
	}
}

func TestGetSession_NotFound(t *testing.T) {
	ctx, db := newMemoryDB(t)
	_, err := GetSession(ctx, db, "missing")
	if err == nil {
		t.Fatal("expected an error for a missing session")
	}
	if !IsNotFound(err) {
		t.Fatalf("IsNotFound(%v) = false, want true", err)
	}
	if !errors.Is(err, record.ErrRecordNotFound) {
		t.Fatalf("errors.Is(err, record.ErrRecordNotFound) = false")
	}
}

func TestGameSessionDbo_Validate(t *testing.T) {
	valid := func() *GameSessionDbo {
		return &GameSessionDbo{
			HostUserID: "u1",
			Status:     StatusLobby,
			Players:    []PlayerDbo{{UserID: "u1"}},
		}
	}

	if err := valid().Validate(); err != nil {
		t.Fatalf("expected valid session to pass, got %v", err)
	}

	noHost := valid()
	noHost.HostUserID = ""
	if err := noHost.Validate(); err == nil {
		t.Fatal("expected error for missing HostUserID")
	}

	noPlayers := valid()
	noPlayers.Players = nil
	if err := noPlayers.Validate(); err == nil {
		t.Fatal("expected error for empty Players")
	}

	blankPlayerID := valid()
	blankPlayerID.Players = []PlayerDbo{{UserID: ""}}
	if err := blankPlayerID.Validate(); err == nil {
		t.Fatal("expected error for a player with an empty UserID")
	}

	dupPlayer := valid()
	dupPlayer.Players = []PlayerDbo{{UserID: "u1"}, {UserID: "u1"}}
	if err := dupPlayer.Validate(); err == nil {
		t.Fatal("expected error for duplicate player UserID")
	}

	badStatus := valid()
	badStatus.Status = Status("bogus")
	if err := badStatus.Validate(); err == nil {
		t.Fatal("expected error for an invalid status")
	}
}
