package greedgame

import (
	"context"
	"errors"
	"testing"

	"github.com/dal-go/dalgo/dal"

	"github.com/sneat-games/greed-game/server-go/greedgame/dal4greedgame"
)

// newActiveGame creates, joins, and starts a session for the given userIDs (in
// order — the first is the host) with the given starting balances, returning
// everything a resolve test needs.
func newActiveGame(t *testing.T, userIDs []string, startingBalance int) (ctx context.Context, db dal.DB, wallet *fakeWallet, gameID string) {
	t.Helper()
	ctx, db = newMemoryDB(t)
	balances := make(map[string]int, len(userIDs))
	for _, u := range userIDs {
		balances[u] = startingBalance
	}
	wallet = newFakeWallet(balances)

	var err error
	gameID, err = CreateSession(ctx, db, wallet, Player{UserID: userIDs[0]}, 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	for _, u := range userIDs[1:] {
		if err := Join(ctx, db, wallet, gameID, Player{UserID: u}); err != nil {
			t.Fatal(err)
		}
	}
	if err := StartSession(ctx, db, gameID); err != nil {
		t.Fatal(err)
	}
	return ctx, db, wallet, gameID
}

func resultFor(results []PlayerRoundResult, userID string) (PlayerRoundResult, bool) {
	for _, r := range results {
		if r.UserID == userID {
			return r, true
		}
	}
	return PlayerRoundResult{}, false
}

// TestResolveRound_MatchesEngineFixture_CourageExample uses the exact
// 3-player fixture from the feature spec's AC (bids [10,15,40] -> deltas
// [0,+25,-25]) to verify ResolveRound settles PRECISELY what greedplay.Resolve
// computes, with no re-derivation of the rule in this package.
func TestResolveRound_MatchesEngineFixture_CourageExample(t *testing.T) {
	users := []string{"a", "b", "c"}
	ctx, db, wallet, gameID := newActiveGame(t, users, 1000)

	bids := map[string]int{"a": 10, "b": 15, "c": 40}
	for _, u := range users {
		if _, err := RecordBid(ctx, db, gameID, u, bids[u]); err != nil {
			t.Fatalf("RecordBid(%s): %v", u, err)
		}
	}

	outcome, err := ResolveRound(ctx, db, wallet, gameID)
	if err != nil {
		t.Fatalf("ResolveRound: %v", err)
	}

	wantDeltas := map[string]int{"a": 0, "b": 25, "c": -25}
	for _, u := range users {
		r, ok := resultFor(outcome.Results, u)
		if !ok {
			t.Fatalf("missing result for %s", u)
		}
		if r.Delta != wantDeltas[u] {
			t.Errorf("delta[%s] = %d, want %d", u, r.Delta, wantDeltas[u])
		}
		if r.Bid != bids[u] {
			t.Errorf("bid[%s] = %d, want %d", u, r.Bid, bids[u])
		}
		wantBalance := 1000 + wantDeltas[u]
		if r.Balance != wantBalance || wallet.balanceOf(u) != wantBalance {
			t.Errorf("balance[%s] = %d (wallet: %d), want %d", u, r.Balance, wallet.balanceOf(u), wantBalance)
		}
	}
	sum := 0
	for _, r := range outcome.Results {
		sum += r.Delta
	}
	if sum != 0 {
		t.Errorf("deltas must sum to zero, got %d", sum)
	}
}

// TestResolveRound_MatchesEngineFixture_LossCapExample uses the spec's second
// fixture ([10,11,12] -> [-10,-6,+16]), where the per-player loss cap binds.
func TestResolveRound_MatchesEngineFixture_LossCapExample(t *testing.T) {
	users := []string{"a", "b", "c"}
	ctx, db, wallet, gameID := newActiveGame(t, users, 1000)

	bids := map[string]int{"a": 10, "b": 11, "c": 12}
	for _, u := range users {
		if _, err := RecordBid(ctx, db, gameID, u, bids[u]); err != nil {
			t.Fatal(err)
		}
	}
	outcome, err := ResolveRound(ctx, db, wallet, gameID)
	if err != nil {
		t.Fatalf("ResolveRound: %v", err)
	}
	wantDeltas := map[string]int{"a": -10, "b": -6, "c": 16}
	for _, u := range users {
		r, _ := resultFor(outcome.Results, u)
		if r.Delta != wantDeltas[u] {
			t.Errorf("delta[%s] = %d, want %d", u, r.Delta, wantDeltas[u])
		}
	}
}

// TestResolveRound_UsesIdempotentSettlementKeys asserts the exact idemKey
// shape ("greedgame:<gameID>:r<round>:<userID>") the spec mandates, so a
// retried settlement can never double-move coins.
func TestResolveRound_UsesIdempotentSettlementKeys(t *testing.T) {
	users := []string{"a", "b"}
	ctx, db, wallet, gameID := newActiveGame(t, users, 100)

	// a=1, b=3: 3 > 2*1 -> greedy, lower (a) wins. delta a:+1, b:-1.
	if _, err := RecordBid(ctx, db, gameID, "a", 1); err != nil {
		t.Fatal(err)
	}
	if _, err := RecordBid(ctx, db, gameID, "b", 3); err != nil {
		t.Fatal(err)
	}

	outcome, err := ResolveRound(ctx, db, wallet, gameID)
	if err != nil {
		t.Fatal(err)
	}
	if outcome.Round != 1 {
		t.Fatalf("Round = %d, want 1", outcome.Round)
	}

	wantKey := func(userID string) string { return "greedgame:" + gameID + ":r1:" + userID }
	found := false
	for _, c := range wallet.awards {
		if c.userID == "a" {
			found = true
			if c.idemKey != wantKey("a") {
				t.Errorf("award idemKey = %q, want %q", c.idemKey, wantKey("a"))
			}
			if c.amount != 1 {
				t.Errorf("award amount = %d, want 1", c.amount)
			}
		}
	}
	if !found {
		t.Fatal("expected an Award call for player a (the greed-punished winner)")
	}
	found = false
	for _, c := range wallet.stakes {
		if c.userID == "b" {
			found = true
			if c.idemKey != wantKey("b") {
				t.Errorf("stake idemKey = %q, want %q", c.idemKey, wantKey("b"))
			}
			if c.amount != 1 {
				t.Errorf("stake amount = %d, want 1", c.amount)
			}
		}
	}
	if !found {
		t.Fatal("expected a Stake call for player b (the greedy loser)")
	}
}

// TestResolveRound_AdvancesRoundAndResetsBids checks the state transition:
// Round increments, every player's Bid is cleared for the next round, and
// Status stays Active when more rounds remain.
func TestResolveRound_AdvancesRoundAndResetsBids(t *testing.T) {
	users := []string{"a", "b"}
	ctx, db, wallet, gameID := newActiveGame(t, users, 1000)
	if _, err := RecordBid(ctx, db, gameID, "a", 5); err != nil {
		t.Fatal(err)
	}
	if _, err := RecordBid(ctx, db, gameID, "b", 5); err != nil {
		t.Fatal(err)
	}
	outcome, err := ResolveRound(ctx, db, wallet, gameID)
	if err != nil {
		t.Fatal(err)
	}
	if outcome.Finished {
		t.Fatal("session should not be finished after round 1 of the default 5")
	}
	if outcome.NextRound != 2 {
		t.Fatalf("NextRound = %d, want 2", outcome.NextRound)
	}

	entry, err := GetSession(ctx, db, gameID)
	if err != nil {
		t.Fatal(err)
	}
	if entry.Data.Round != 2 {
		t.Fatalf("session.Round = %d, want 2", entry.Data.Round)
	}
	if entry.Data.Status != dal4greedgame.StatusActive {
		t.Fatalf("session.Status = %v, want Active", entry.Data.Status)
	}
	for _, p := range entry.Data.Players {
		if p.Bid != 0 {
			t.Fatalf("player %s Bid = %d after resolve, want 0 (reset for next round)", p.UserID, p.Bid)
		}
	}

	// Round 2 should now accept fresh bids (proves state truly advanced, not
	// just the returned outcome).
	if _, err := RecordBid(ctx, db, gameID, "a", 5); err != nil {
		t.Fatalf("bidding round 2: %v", err)
	}
}

// TestResolveRound_FinishesAfterFixedRounds checks the Rounds boundary: once
// the last configured round resolves, Status becomes Finished and NextRound
// is reported as 0 (no further bidding is possible).
func TestResolveRound_FinishesAfterFixedRounds(t *testing.T) {
	ctx, db := newMemoryDB(t)
	wallet := newFakeWallet(map[string]int{"a": 1000, "b": 1000})

	gameID, err := CreateSession(ctx, db, wallet, Player{UserID: "a"}, 0, 1 /* Rounds */)
	if err != nil {
		t.Fatal(err)
	}
	if err := Join(ctx, db, wallet, gameID, Player{UserID: "b"}); err != nil {
		t.Fatal(err)
	}
	if err := StartSession(ctx, db, gameID); err != nil {
		t.Fatal(err)
	}
	if _, err := RecordBid(ctx, db, gameID, "a", 5); err != nil {
		t.Fatal(err)
	}
	if _, err := RecordBid(ctx, db, gameID, "b", 5); err != nil {
		t.Fatal(err)
	}

	outcome, err := ResolveRound(ctx, db, wallet, gameID)
	if err != nil {
		t.Fatal(err)
	}
	if !outcome.Finished {
		t.Fatal("expected the session to finish after its single configured round")
	}
	if outcome.NextRound != 0 {
		t.Fatalf("NextRound = %d, want 0 once finished", outcome.NextRound)
	}
	entry, _ := GetSession(ctx, db, gameID)
	if entry.Data.Status != dal4greedgame.StatusFinished {
		t.Fatalf("session.Status = %v, want Finished", entry.Data.Status)
	}

	// No further bids should be accepted.
	if _, err := RecordBid(ctx, db, gameID, "a", 5); !errors.Is(err, ErrGameNotActive) {
		t.Fatalf("RecordBid after Finished: err = %v, want ErrGameNotActive", err)
	}
}

// TestResolveRound_MarksNewlySatOutWithoutEndingTheSession forces one of 3
// players to a coin balance below the next round's minimum bid and checks
// they are marked SatOut and reported in NewlySatOut, while the OTHER two
// players (still >= 2 active) keep the session going.
func TestResolveRound_MarksNewlySatOutWithoutEndingTheSession(t *testing.T) {
	ctx, db := newMemoryDB(t)
	wallet := newFakeWallet(map[string]int{"a": 2, "b": 1000, "c": 1000})

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

	// a=2 (its whole stash), b=3 (a loses to b's courage), c=2 (draws with a).
	// a's total loss this round = 2 (its own bid) so the loss cap does not
	// bind: a pays exactly 2 and is left with a balance of 0.
	if _, err := RecordBid(ctx, db, gameID, "a", 2); err != nil {
		t.Fatal(err)
	}
	if _, err := RecordBid(ctx, db, gameID, "b", 3); err != nil {
		t.Fatal(err)
	}
	if _, err := RecordBid(ctx, db, gameID, "c", 2); err != nil {
		t.Fatal(err)
	}

	outcome, err := ResolveRound(ctx, db, wallet, gameID)
	if err != nil {
		t.Fatal(err)
	}
	if outcome.Finished {
		t.Fatal("2 active players remain (b, c) — the session must not finish yet")
	}
	if len(outcome.NewlySatOut) != 1 || outcome.NewlySatOut[0] != "a" {
		t.Fatalf("NewlySatOut = %v, want [a]", outcome.NewlySatOut)
	}
	if wallet.balanceOf("a") != 0 {
		t.Fatalf("a's balance = %d, want 0", wallet.balanceOf("a"))
	}

	entry, _ := GetSession(ctx, db, gameID)
	idx := findPlayerIndex(entry.Data.Players, "a")
	if !entry.Data.Players[idx].SatOut {
		t.Fatal("player a should be marked SatOut")
	}

	// Round 2 must resolve on just b and c's bids — a is excluded and must not
	// be asked to bid (and could not afford to anyway).
	if _, err := RecordBid(ctx, db, gameID, "a", 1); !errors.Is(err, ErrPlayerSatOut) {
		t.Fatalf("bid from a sat-out player: err = %v, want ErrPlayerSatOut", err)
	}
	rb, err := RecordBid(ctx, db, gameID, "b", 1)
	if err != nil {
		t.Fatal(err)
	}
	if rb.ActivePlayerCount != 2 {
		t.Fatalf("ActivePlayerCount = %d, want 2 (a excluded)", rb.ActivePlayerCount)
	}
	if rb.AllBidsIn {
		t.Fatal("c has not bid round 2 yet")
	}
	rc, err := RecordBid(ctx, db, gameID, "c", 1)
	if err != nil {
		t.Fatal(err)
	}
	if !rc.AllBidsIn {
		t.Fatal("both remaining active players have now bid round 2")
	}
}

// TestResolveRound_EndsEarlyWhenFewerThanTwoActivePlayersRemain busts one of
// two players down to 0 coins, which leaves only 1 active player — the
// session must finish immediately even though its configured Rounds has not
// been reached (the "bust-out" ending).
func TestResolveRound_EndsEarlyWhenFewerThanTwoActivePlayersRemain(t *testing.T) {
	ctx, db := newMemoryDB(t)
	wallet := newFakeWallet(map[string]int{"a": 1, "b": 1000})

	gameID, err := CreateSession(ctx, db, wallet, Player{UserID: "a"}, 0, 5)
	if err != nil {
		t.Fatal(err)
	}
	if err := Join(ctx, db, wallet, gameID, Player{UserID: "b"}); err != nil {
		t.Fatal(err)
	}
	if err := StartSession(ctx, db, gameID); err != nil {
		t.Fatal(err)
	}
	// a=1, b=2: 2 <= 2*1, not greedy -> higher (b) wins. delta a:-1, b:+1.
	if _, err := RecordBid(ctx, db, gameID, "a", 1); err != nil {
		t.Fatal(err)
	}
	if _, err := RecordBid(ctx, db, gameID, "b", 2); err != nil {
		t.Fatal(err)
	}

	outcome, err := ResolveRound(ctx, db, wallet, gameID)
	if err != nil {
		t.Fatal(err)
	}
	if !outcome.Finished {
		t.Fatal("only 1 active player (b) remains after a busts out — must finish early")
	}
	if wallet.balanceOf("a") != 0 {
		t.Fatalf("a's balance = %d, want 0", wallet.balanceOf("a"))
	}
	entry, _ := GetSession(ctx, db, gameID)
	if entry.Data.Status != dal4greedgame.StatusFinished {
		t.Fatalf("Status = %v, want Finished", entry.Data.Status)
	}
}

// TestResolveRound_Standings checks the ranking: highest balance first,
// including a sat-out player who still appears (with SatOut=true).
func TestResolveRound_Standings(t *testing.T) {
	users := []string{"a", "b", "c"}
	ctx, db, wallet, gameID := newActiveGame(t, users, 100)
	if _, err := RecordBid(ctx, db, gameID, "a", 2); err != nil {
		t.Fatal(err)
	}
	if _, err := RecordBid(ctx, db, gameID, "b", 3); err != nil {
		t.Fatal(err)
	}
	if _, err := RecordBid(ctx, db, gameID, "c", 2); err != nil {
		t.Fatal(err)
	}
	outcome, err := ResolveRound(ctx, db, wallet, gameID)
	if err != nil {
		t.Fatal(err)
	}
	if len(outcome.Standings) != 3 {
		t.Fatalf("expected 3 standings entries, got %d", len(outcome.Standings))
	}
	for i := 1; i < len(outcome.Standings); i++ {
		if outcome.Standings[i-1].Balance < outcome.Standings[i].Balance {
			t.Fatalf("standings not sorted descending: %+v", outcome.Standings)
		}
	}
}

// TestResolveRound_RejectsWhenNotActive covers the terminal state that must
// refuse a resolve: still in the Lobby.
func TestResolveRound_RejectsWhenNotActive(t *testing.T) {
	ctx, db := newMemoryDB(t)
	wallet := newFakeWallet(map[string]int{"a": 100, "b": 100})
	gameID, err := CreateSession(ctx, db, wallet, Player{UserID: "a"}, 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	if err := Join(ctx, db, wallet, gameID, Player{UserID: "b"}); err != nil {
		t.Fatal(err)
	}
	if _, err := ResolveRound(ctx, db, wallet, gameID); !errors.Is(err, ErrGameNotActive) {
		t.Fatalf("ResolveRound while still in Lobby: err = %v, want ErrGameNotActive", err)
	}
}

// TestResolveRound_PropagatesSettlementErrorWithoutAdvancingRound checks that
// when a coin-ledger call fails partway through settlement, ResolveRound
// returns the error and leaves the round un-advanced (so a caller can retry
// safely once the underlying issue is fixed).
func TestResolveRound_PropagatesSettlementErrorWithoutAdvancingRound(t *testing.T) {
	users := []string{"a", "b"}
	ctx, db, wallet, gameID := newActiveGame(t, users, 1000)
	if _, err := RecordBid(ctx, db, gameID, "a", 1); err != nil {
		t.Fatal(err)
	}
	if _, err := RecordBid(ctx, db, gameID, "b", 3); err != nil {
		t.Fatal(err)
	}

	boom := errors.New("ledger unavailable")
	wallet.stakeErr = boom

	if _, err := ResolveRound(ctx, db, wallet, gameID); !errors.Is(err, boom) {
		t.Fatalf("ResolveRound: err = %v, want wrapping %v", err, boom)
	}

	entry, err := GetSession(ctx, db, gameID)
	if err != nil {
		t.Fatal(err)
	}
	if entry.Data.Round != 1 || entry.Data.Status != dal4greedgame.StatusActive {
		t.Fatalf("round must not advance after a settlement failure: round=%d status=%v", entry.Data.Round, entry.Data.Status)
	}
	// Bids must still be intact too, so a fixed/retried settlement can resolve
	// the SAME round rather than losing the recorded bids.
	idxA := findPlayerIndex(entry.Data.Players, "a")
	if entry.Data.Players[idxA].Bid != 1 {
		t.Fatalf("player a's bid was cleared despite the failed resolve: %d", entry.Data.Players[idxA].Bid)
	}
}
