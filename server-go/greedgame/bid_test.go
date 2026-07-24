package greedgame

import (
	"errors"
	"sync"
	"testing"
)

func TestRecordBid_HappyPathAndAllBidsIn(t *testing.T) {
	ctx, db := newMemoryDB(t)
	wallet := newFakeWallet(map[string]int{"a": 100, "b": 100, "c": 100})

	gameID, err := CreateSession(ctx, db, wallet, Player{UserID: "a"}, 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	if err := Join(ctx, db, wallet, gameID, Player{UserID: "b"}); err != nil {
		t.Fatal(err)
	}
	if err := Join(ctx, db, wallet, gameID, Player{UserID: "c"}); err != nil {
		t.Fatal(err)
	}
	if err := StartSession(ctx, db, gameID); err != nil {
		t.Fatal(err)
	}

	r1, err := RecordBid(ctx, db, gameID, "a", 5)
	if err != nil {
		t.Fatalf("first bid: %v", err)
	}
	if r1.AllBidsIn {
		t.Fatal("AllBidsIn must be false after only 1 of 3 players bid")
	}
	if r1.ActivePlayerCount != 3 {
		t.Fatalf("ActivePlayerCount = %d, want 3", r1.ActivePlayerCount)
	}

	r2, err := RecordBid(ctx, db, gameID, "b", 5)
	if err != nil {
		t.Fatalf("second bid: %v", err)
	}
	if r2.AllBidsIn {
		t.Fatal("AllBidsIn must be false after only 2 of 3 players bid")
	}

	r3, err := RecordBid(ctx, db, gameID, "c", 5)
	if err != nil {
		t.Fatalf("third bid: %v", err)
	}
	if !r3.AllBidsIn {
		t.Fatal("AllBidsIn must be true once the last active player bids")
	}
	if r3.Round != 1 {
		t.Fatalf("Round = %d, want 1", r3.Round)
	}
}

func TestRecordBid_RejectsBelowMinimum(t *testing.T) {
	ctx, db := newMemoryDB(t)
	wallet := newFakeWallet(map[string]int{"a": 100, "b": 100, "c": 100})
	gameID, _ := CreateSession(ctx, db, wallet, Player{UserID: "a"}, 0, 0)
	_ = Join(ctx, db, wallet, gameID, Player{UserID: "b"})
	_ = Join(ctx, db, wallet, gameID, Player{UserID: "c"})
	_ = StartSession(ctx, db, gameID)

	// 3 active players -> minimum bid is 2.
	if _, err := RecordBid(ctx, db, gameID, "a", 1); !errors.Is(err, ErrBidTooLow) {
		t.Fatalf("err = %v, want ErrBidTooLow", err)
	}
	if _, err := RecordBid(ctx, db, gameID, "a", 2); err != nil {
		t.Fatalf("bid at the exact minimum should succeed: %v", err)
	}
}

func TestRecordBid_RejectsDoubleBid(t *testing.T) {
	ctx, db := newMemoryDB(t)
	wallet := newFakeWallet(map[string]int{"a": 100, "b": 100})
	gameID, _ := CreateSession(ctx, db, wallet, Player{UserID: "a"}, 0, 0)
	_ = Join(ctx, db, wallet, gameID, Player{UserID: "b"})
	_ = StartSession(ctx, db, gameID)

	if _, err := RecordBid(ctx, db, gameID, "a", 3); err != nil {
		t.Fatal(err)
	}
	if _, err := RecordBid(ctx, db, gameID, "a", 4); !errors.Is(err, ErrAlreadyBid) {
		t.Fatalf("second bid from the same player in the same round: err = %v, want ErrAlreadyBid", err)
	}
}

func TestRecordBid_RejectsUnknownPlayer(t *testing.T) {
	ctx, db := newMemoryDB(t)
	wallet := newFakeWallet(map[string]int{"a": 100, "b": 100})
	gameID, _ := CreateSession(ctx, db, wallet, Player{UserID: "a"}, 0, 0)
	_ = Join(ctx, db, wallet, gameID, Player{UserID: "b"})
	_ = StartSession(ctx, db, gameID)

	if _, err := RecordBid(ctx, db, gameID, "stranger", 5); !errors.Is(err, ErrPlayerNotInGame) {
		t.Fatalf("err = %v, want ErrPlayerNotInGame", err)
	}
}

func TestRecordBid_RejectsWhenGameNotActive(t *testing.T) {
	ctx, db := newMemoryDB(t)
	wallet := newFakeWallet(map[string]int{"a": 100, "b": 100})
	gameID, _ := CreateSession(ctx, db, wallet, Player{UserID: "a"}, 0, 0)
	_ = Join(ctx, db, wallet, gameID, Player{UserID: "b"})
	// Still in the lobby: no active round yet.
	if _, err := RecordBid(ctx, db, gameID, "a", 5); !errors.Is(err, ErrGameNotActive) {
		t.Fatalf("err = %v, want ErrGameNotActive", err)
	}
}

func TestPlaceBid_RejectsOverBalance(t *testing.T) {
	ctx, db := newMemoryDB(t)
	wallet := newFakeWallet(map[string]int{"a": 100, "b": 100})
	gameID, _ := CreateSession(ctx, db, wallet, Player{UserID: "a"}, 0, 0)
	_ = Join(ctx, db, wallet, gameID, Player{UserID: "b"})
	_ = StartSession(ctx, db, gameID)

	if _, err := PlaceBid(ctx, db, wallet, gameID, "a", 1000); !errors.Is(err, ErrBidTooHigh) {
		t.Fatalf("PlaceBid over balance: err = %v, want ErrBidTooHigh", err)
	}
}

func TestPlaceBid_RejectsNonPositive(t *testing.T) {
	ctx, db := newMemoryDB(t)
	wallet := newFakeWallet(map[string]int{"a": 100, "b": 100})
	gameID, _ := CreateSession(ctx, db, wallet, Player{UserID: "a"}, 0, 0)
	_ = Join(ctx, db, wallet, gameID, Player{UserID: "b"})
	_ = StartSession(ctx, db, gameID)

	if _, err := PlaceBid(ctx, db, wallet, gameID, "a", 0); !errors.Is(err, ErrBidTooLow) {
		t.Fatalf("PlaceBid(0): err = %v, want ErrBidTooLow", err)
	}
	if _, err := PlaceBid(ctx, db, wallet, gameID, "a", -5); !errors.Is(err, ErrBidTooLow) {
		t.Fatalf("PlaceBid(-5): err = %v, want ErrBidTooLow", err)
	}
}

func TestPlaceBid_HappyPath(t *testing.T) {
	ctx, db := newMemoryDB(t)
	wallet := newFakeWallet(map[string]int{"a": 100, "b": 100})
	gameID, _ := CreateSession(ctx, db, wallet, Player{UserID: "a"}, 0, 0)
	_ = Join(ctx, db, wallet, gameID, Player{UserID: "b"})
	_ = StartSession(ctx, db, gameID)

	r, err := PlaceBid(ctx, db, wallet, gameID, "a", 10)
	if err != nil {
		t.Fatalf("PlaceBid: %v", err)
	}
	if r.AllBidsIn {
		t.Fatal("AllBidsIn should be false with only 1 of 2 players bid")
	}
}

// TestRecordBid_ConcurrentLastTwoBids_ExactlyOneObservesAllBidsIn is THE
// hardest-part test: two players submitting the last two outstanding bids at
// the same instant must never both be told "all bids are in". It fires N
// goroutines, one per remaining active player, all racing to submit the final
// bids of a round via RecordBid, and asserts that EXACTLY ONE of them
// observes AllBidsIn=true. This is only a meaningful test because the strict
// in-memory dalgo test DB (newMemoryDB) takes a real exclusive lock for the
// full duration of each RunReadwriteTransaction, so concurrent callers are
// genuinely serialized against each other exactly like a production
// transactional backend would (Firestore transactions retry on conflicting
// writes) — a bug that read-then-wrote across two separate calls instead of
// inside one transaction would let more than one goroutine observe
// AllBidsIn=true here.
func TestRecordBid_ConcurrentLastTwoBids_ExactlyOneObservesAllBidsIn(t *testing.T) {
	ctx, db := newMemoryDB(t)
	const n = 8 // active players racing to submit the round's last bids
	balances := map[string]int{}
	users := make([]string, n)
	for i := 0; i < n; i++ {
		users[i] = string(rune('a' + i))
		balances[users[i]] = 1000
	}
	wallet := newFakeWallet(balances)

	gameID, err := CreateSession(ctx, db, wallet, Player{UserID: users[0]}, 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	for _, u := range users[1:] {
		if err := Join(ctx, db, wallet, gameID, Player{UserID: u}); err != nil {
			t.Fatal(err)
		}
	}
	if err := StartSession(ctx, db, gameID); err != nil {
		t.Fatal(err)
	}

	var wg sync.WaitGroup
	results := make([]BidResult, n)
	errs := make([]error, n)
	wg.Add(n)
	for i, u := range users {
		i, u := i, u
		go func() {
			defer wg.Done()
			results[i], errs[i] = RecordBid(ctx, db, gameID, u, n-1)
		}()
	}
	wg.Wait()

	allInCount := 0
	for i := range users {
		if errs[i] != nil {
			t.Fatalf("RecordBid(%s): unexpected error: %v", users[i], errs[i])
		}
		if results[i].AllBidsIn {
			allInCount++
		}
	}
	if allInCount != 1 {
		t.Fatalf("exactly one goroutine must observe AllBidsIn=true, got %d", allInCount)
	}

	// Sanity: every player's bid was in fact recorded.
	entry, err := GetSession(ctx, db, gameID)
	if err != nil {
		t.Fatal(err)
	}
	for _, p := range entry.Data.Players {
		if p.Bid != n-1 {
			t.Fatalf("player %s bid = %d, want %d", p.UserID, p.Bid, n-1)
		}
	}
}
