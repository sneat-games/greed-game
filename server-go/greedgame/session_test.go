package greedgame

import (
	"errors"
	"testing"

	"github.com/sneat-games/greed-game/server-go/greedgame/dal4greedgame"
)

func TestCreateSession_GrantsAllowanceAndSeedsLobby(t *testing.T) {
	ctx, db := newMemoryDB(t)
	wallet := newFakeWallet(nil)

	gameID, err := CreateSession(ctx, db, wallet, Player{UserID: "host", Name: "Host", ChatID: 111}, 0, 0)
	if err != nil {
		t.Fatalf("CreateSession: %v", err)
	}
	if gameID == "" {
		t.Fatal("expected a non-empty gameID")
	}
	if _, ok := wallet.balances["host"]; !ok {
		t.Fatal("expected CreateSession to grant the host's coin allowance")
	}

	entry, err := GetSession(ctx, db, gameID)
	if err != nil {
		t.Fatalf("GetSession: %v", err)
	}
	s := entry.Data
	if s.Status != dal4greedgame.StatusLobby {
		t.Fatalf("Status = %v, want Lobby", s.Status)
	}
	if s.Rounds != DefaultRounds {
		t.Fatalf("Rounds = %d, want default %d", s.Rounds, DefaultRounds)
	}
	if len(s.Players) != 1 || s.Players[0].UserID != "host" || s.Players[0].ChatID != 111 {
		t.Fatalf("unexpected initial players: %+v", s.Players)
	}
}

func TestCreateSession_CustomRoundsAndGroupChatID(t *testing.T) {
	ctx, db := newMemoryDB(t)
	wallet := newFakeWallet(nil)

	gameID, err := CreateSession(ctx, db, wallet, Player{UserID: "host"}, 555, 3)
	if err != nil {
		t.Fatalf("CreateSession: %v", err)
	}
	entry, _ := GetSession(ctx, db, gameID)
	if entry.Data.ChatID != 555 {
		t.Fatalf("ChatID = %d, want 555", entry.Data.ChatID)
	}
	if entry.Data.Rounds != 3 {
		t.Fatalf("Rounds = %d, want 3", entry.Data.Rounds)
	}
}

func TestJoin_AddsPlayerAndGrantsAllowance(t *testing.T) {
	ctx, db := newMemoryDB(t)
	wallet := newFakeWallet(nil)

	gameID, err := CreateSession(ctx, db, wallet, Player{UserID: "host"}, 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	if err := Join(ctx, db, wallet, gameID, Player{UserID: "guest", Name: "Guest", ChatID: 222}); err != nil {
		t.Fatalf("Join: %v", err)
	}
	if _, ok := wallet.balances["guest"]; !ok {
		t.Fatal("expected Join to grant the guest's coin allowance")
	}

	entry, _ := GetSession(ctx, db, gameID)
	if len(entry.Data.Players) != 2 {
		t.Fatalf("expected 2 players, got %d", len(entry.Data.Players))
	}
	if entry.Data.Players[1].UserID != "guest" || entry.Data.Players[1].ChatID != 222 {
		t.Fatalf("unexpected joined player: %+v", entry.Data.Players[1])
	}
}

func TestJoin_ReJoinIsANoOpButRefreshesChatID(t *testing.T) {
	ctx, db := newMemoryDB(t)
	wallet := newFakeWallet(nil)

	gameID, _ := CreateSession(ctx, db, wallet, Player{UserID: "host"}, 0, 0)
	if err := Join(ctx, db, wallet, gameID, Player{UserID: "guest", ChatID: 1}); err != nil {
		t.Fatal(err)
	}
	// Re-joining (e.g. tapping the group's Join button twice, or the invite
	// link after already joining) must not duplicate the player, but SHOULD
	// pick up a freshly observed ChatID.
	if err := Join(ctx, db, wallet, gameID, Player{UserID: "guest", ChatID: 999}); err != nil {
		t.Fatalf("re-Join: %v", err)
	}
	entry, _ := GetSession(ctx, db, gameID)
	if len(entry.Data.Players) != 2 {
		t.Fatalf("re-Join must not duplicate the player, got %d players", len(entry.Data.Players))
	}
	if entry.Data.Players[1].ChatID != 999 {
		t.Fatalf("re-Join did not refresh ChatID: got %d, want 999", entry.Data.Players[1].ChatID)
	}
}

func TestJoin_RejectedOnceGameHasStarted(t *testing.T) {
	ctx, db := newMemoryDB(t)
	wallet := newFakeWallet(map[string]int{"host": 1000, "guest": 1000})

	gameID, _ := CreateSession(ctx, db, wallet, Player{UserID: "host"}, 0, 0)
	if err := Join(ctx, db, wallet, gameID, Player{UserID: "guest"}); err != nil {
		t.Fatal(err)
	}
	if err := StartSession(ctx, db, gameID); err != nil {
		t.Fatalf("StartSession: %v", err)
	}
	if err := Join(ctx, db, wallet, gameID, Player{UserID: "latecomer"}); !errors.Is(err, ErrGameNotInLobby) {
		t.Fatalf("Join after start: err = %v, want ErrGameNotInLobby", err)
	}
}

func TestJoin_UnknownGame(t *testing.T) {
	ctx, db := newMemoryDB(t)
	wallet := newFakeWallet(nil)
	if err := Join(ctx, db, wallet, "missing", Player{UserID: "guest"}); !errors.Is(err, ErrGameNotFound) {
		t.Fatalf("Join(missing game): err = %v, want ErrGameNotFound", err)
	}
}

func TestStartSession_RequiresTwoPlayers(t *testing.T) {
	ctx, db := newMemoryDB(t)
	wallet := newFakeWallet(nil)
	gameID, _ := CreateSession(ctx, db, wallet, Player{UserID: "host"}, 0, 0)
	if err := StartSession(ctx, db, gameID); !errors.Is(err, ErrNotEnoughPlayers) {
		t.Fatalf("StartSession with 1 player: err = %v, want ErrNotEnoughPlayers", err)
	}
}

func TestStartSession_SetsActiveAndRoundOne(t *testing.T) {
	ctx, db := newMemoryDB(t)
	wallet := newFakeWallet(nil)
	gameID, _ := CreateSession(ctx, db, wallet, Player{UserID: "host"}, 0, 0)
	_ = Join(ctx, db, wallet, gameID, Player{UserID: "guest"})

	if err := StartSession(ctx, db, gameID); err != nil {
		t.Fatalf("StartSession: %v", err)
	}
	entry, _ := GetSession(ctx, db, gameID)
	if entry.Data.Status != dal4greedgame.StatusActive || entry.Data.Round != 1 {
		t.Fatalf("unexpected state after start: status=%v round=%d", entry.Data.Status, entry.Data.Round)
	}

	// Starting twice must not be allowed.
	if err := StartSession(ctx, db, gameID); !errors.Is(err, ErrGameNotInLobby) {
		t.Fatalf("double StartSession: err = %v, want ErrGameNotInLobby", err)
	}
}

func TestSetGroupMessage(t *testing.T) {
	ctx, db := newMemoryDB(t)
	wallet := newFakeWallet(nil)
	gameID, _ := CreateSession(ctx, db, wallet, Player{UserID: "host"}, 123, 0)
	if err := SetGroupMessage(ctx, db, gameID, 456); err != nil {
		t.Fatalf("SetGroupMessage: %v", err)
	}
	entry, _ := GetSession(ctx, db, gameID)
	if entry.Data.MessageID != 456 {
		t.Fatalf("MessageID = %d, want 456", entry.Data.MessageID)
	}
}

func TestSetPlayerChatID(t *testing.T) {
	ctx, db := newMemoryDB(t)
	wallet := newFakeWallet(nil)
	gameID, _ := CreateSession(ctx, db, wallet, Player{UserID: "host"}, 0, 0)
	_ = Join(ctx, db, wallet, gameID, Player{UserID: "guest"})

	if err := SetPlayerChatID(ctx, db, gameID, "guest", 42); err != nil {
		t.Fatalf("SetPlayerChatID: %v", err)
	}
	entry, _ := GetSession(ctx, db, gameID)
	if entry.Data.Players[1].ChatID != 42 {
		t.Fatalf("ChatID = %d, want 42", entry.Data.Players[1].ChatID)
	}

	if err := SetPlayerChatID(ctx, db, gameID, "stranger", 1); !errors.Is(err, ErrPlayerNotInGame) {
		t.Fatalf("SetPlayerChatID(stranger): err = %v, want ErrPlayerNotInGame", err)
	}

	// Zero chatID is a documented no-op, including for a non-existent game.
	if err := SetPlayerChatID(ctx, db, "missing-game", "guest", 0); err != nil {
		t.Fatalf("SetPlayerChatID with chatID=0 should be a no-op, got %v", err)
	}
}

func TestMinBidFor(t *testing.T) {
	cases := []struct{ active, want int }{
		{0, 1}, {1, 1}, {2, 1}, {3, 2}, {5, 4},
	}
	for _, c := range cases {
		if got := minBidFor(c.active); got != c.want {
			t.Errorf("minBidFor(%d) = %d, want %d", c.active, got, c.want)
		}
	}
}

func TestAllActiveBidsIn(t *testing.T) {
	players := func(bids ...int) []dal4greedgame.PlayerDbo {
		p := make([]dal4greedgame.PlayerDbo, len(bids))
		for i, b := range bids {
			p[i] = dal4greedgame.PlayerDbo{UserID: string(rune('a' + i)), Bid: b}
		}
		return p
	}

	if allActiveBidsIn(players()) {
		t.Error("no players: expected false")
	}
	if allActiveBidsIn(players(0, 5)) {
		t.Error("one missing bid: expected false")
	}
	if !allActiveBidsIn(players(3, 5)) {
		t.Error("all bid: expected true")
	}

	// A sat-out player with no bid must not block resolution.
	withSatOut := players(3, 0)
	withSatOut[1].SatOut = true
	if !allActiveBidsIn(withSatOut) {
		t.Error("sat-out player without a bid must not count against AllBidsIn")
	}
}
