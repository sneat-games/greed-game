package greedplay

import (
	"errors"
	"math/rand"
	"testing"
)

// --- Duel -------------------------------------------------------------------

func TestDuel_CloseCase_LowerWins(t *testing.T) {
	// 15 <= 2*10, so the lower (10) bidder wins +10; higher (15) loses.
	da, db := Duel(10, 15)
	if da != 10 || db != -10 {
		t.Fatalf("Duel(10,15) = (%d,%d), want (10,-10)", da, db)
	}
}

func TestDuel_BoldCase_HigherWins(t *testing.T) {
	// 25 > 2*10, so the higher (bold) bidder wins; the 10-bidder is -10.
	da, db := Duel(10, 25)
	if da != -10 || db != 10 {
		t.Fatalf("Duel(10,25) = (%d,%d), want (-10,10)", da, db)
	}
}

func TestDuel_LowerWinsWhenHigherIsFirstArg(t *testing.T) {
	// 6 <= 2*3, so the lower (3) bidder wins +3; the 6-bidder loses.
	da, db := Duel(6, 3)
	if da != -3 || db != 3 {
		t.Fatalf("Duel(6,3) = (%d,%d), want (-3,3)", da, db)
	}
}

func TestDuel_Draw(t *testing.T) {
	da, db := Duel(10, 10)
	if da != 0 || db != 0 {
		t.Fatalf("Duel(10,10) = (%d,%d), want (0,0)", da, db)
	}
}

// The exactly-2x boundary: H == 2L is NOT bold (lower wins); H == 2L+1 IS bold
// (higher wins). Verify the winner flips across the boundary.
func TestDuel_ExactlyDoubleBoundary(t *testing.T) {
	// H == 2L: not bold, lower (10) wins.
	da, db := Duel(10, 20)
	if da != 10 || db != -10 {
		t.Fatalf("Duel(10,20) [H==2L] = (%d,%d), want (10,-10) lower wins", da, db)
	}
	// H == 2L+1: bold, higher (21) wins, lower (10) loses.
	da, db = Duel(10, 21)
	if da != -10 || db != 10 {
		t.Fatalf("Duel(10,21) [H==2L+1] = (%d,%d), want (-10,10) higher wins", da, db)
	}
}

func TestDuel_ZeroSum_And_Symmetry(t *testing.T) {
	rng := rand.New(rand.NewSource(1))
	for i := 0; i < 5000; i++ {
		a := rng.Intn(1_000_000) + 1
		b := rng.Intn(1_000_000) + 1
		da, db := Duel(a, b)
		if da != -db {
			t.Fatalf("Duel(%d,%d) not zero-sum: (%d,%d)", a, b, da, db)
		}
		// Symmetry: swapping the arguments swaps the deltas.
		sa, sb := Duel(b, a)
		if sa != db || sb != da {
			t.Fatalf("Duel not symmetric: Duel(%d,%d)=(%d,%d), Duel(%d,%d)=(%d,%d)",
				a, b, da, db, b, a, sa, sb)
		}
	}
}

// --- DuelDetail -------------------------------------------------------------

func TestDuelDetail(t *testing.T) {
	cases := []struct {
		a, b int
		want DuelResult
	}{
		{10, 15, DuelResult{Transfer: 10, Winner: First, Bold: false}}, // close, lower(a) wins
		{10, 25, DuelResult{Transfer: 10, Winner: Second, Bold: true}}, // bold, higher(b) wins
		{6, 3, DuelResult{Transfer: 3, Winner: Second, Bold: false}},   // close, lower(b) wins
		{25, 10, DuelResult{Transfer: 10, Winner: First, Bold: true}},  // bold, higher(a) wins
		{10, 10, DuelResult{Transfer: 0, Winner: Draw, Bold: false}},   // draw
		{10, 20, DuelResult{Transfer: 10, Winner: First, Bold: false}}, // boundary H==2L, lower(a) wins
		{10, 21, DuelResult{Transfer: 10, Winner: Second, Bold: true}}, // boundary H==2L+1, higher(b) wins
	}
	for _, c := range cases {
		got := DuelDetail(c.a, c.b)
		if got != c.want {
			t.Errorf("DuelDetail(%d,%d) = %+v, want %+v", c.a, c.b, got, c.want)
		}
	}
}

func TestDuelDetail_BoldIffHigherWon(t *testing.T) {
	rng := rand.New(rand.NewSource(2))
	for i := 0; i < 5000; i++ {
		a := rng.Intn(500) + 1
		b := rng.Intn(500) + 1
		got := DuelDetail(a, b)
		lo := a
		if b < lo {
			lo = b
		}
		hi := a
		if b > hi {
			hi = b
		}
		// Transfer is always min on a non-draw, 0 on a draw.
		if a == b {
			if got.Winner != Draw || got.Transfer != 0 || got.Bold {
				t.Fatalf("DuelDetail(%d,%d) draw wrong: %+v", a, b, got)
			}
			continue
		}
		if got.Transfer != lo {
			t.Fatalf("DuelDetail(%d,%d).Transfer=%d, want %d", a, b, got.Transfer, lo)
		}
		// Which value actually won?
		var winVal int
		switch got.Winner {
		case First:
			winVal = a
		case Second:
			winVal = b
		default:
			t.Fatalf("DuelDetail(%d,%d) unexpected Draw", a, b)
		}
		higherWon := winVal == hi
		if got.Bold != higherWon {
			t.Fatalf("DuelDetail(%d,%d): Bold=%v but higherWon=%v (%+v)", a, b, got.Bold, higherWon, got)
		}
		// Bold must be exactly the >2x condition.
		if got.Bold != (hi > GreedFactor*lo) {
			t.Fatalf("DuelDetail(%d,%d): Bold=%v, want hi>2*lo=%v", a, b, got.Bold, hi > GreedFactor*lo)
		}
	}
}

// --- Resolve ----------------------------------------------------------------

func TestResolve_Oracle(t *testing.T) {
	deltas, err := Resolve([]int{10, 15, 40})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	want := []int{0, -25, 25}
	if !equalInts(deltas, want) {
		t.Fatalf("Resolve([10,15,40]) = %v, want %v", deltas, want)
	}
}

func TestResolve_HandComputedTables(t *testing.T) {
	cases := []struct {
		bids []int
		want []int
	}{
		{[]int{1, 1}, []int{0, 0}},               // draw
		{[]int{5, 5, 5}, []int{0, 0, 0}},         // all draws
		{[]int{3, 6}, []int{3, -3}},              // close, lower(3) wins
		{[]int{2, 5}, []int{-2, 2}},              // bold, higher(5) wins
		{[]int{10, 20}, []int{10, -10}},          // boundary H==2L, lower wins
		{[]int{10, 15, 40}, []int{0, -25, 25}},   // the oracle
		{[]int{1, 2, 3, 4}, []int{-1, 3, 2, -4}}, // 4-player hand-computed
	}
	for _, c := range cases {
		got, err := Resolve(c.bids)
		if err != nil {
			t.Fatalf("Resolve(%v) error: %v", c.bids, err)
		}
		if !equalInts(got, c.want) {
			t.Errorf("Resolve(%v) = %v, want %v", c.bids, got, c.want)
		}
	}
}

func TestResolve_N2MatchesDuel(t *testing.T) {
	rng := rand.New(rand.NewSource(3))
	for i := 0; i < 2000; i++ {
		a := rng.Intn(10_000) + 1
		b := rng.Intn(10_000) + 1
		deltas, err := Resolve([]int{a, b})
		if err != nil {
			t.Fatalf("Resolve error: %v", err)
		}
		da, db := Duel(a, b)
		if deltas[0] != da || deltas[1] != db {
			t.Fatalf("Resolve([%d,%d])=%v, want [%d,%d]", a, b, deltas, da, db)
		}
	}
}

func TestResolve_ZeroSumRandom(t *testing.T) {
	rng := rand.New(rand.NewSource(4))
	for i := 0; i < 3000; i++ {
		n := rng.Intn(8) + 2 // 2..9 players
		bids := make([]int, n)
		for j := range bids {
			bids[j] = rng.Intn(1_000_000) + 1
		}
		deltas, err := Resolve(bids)
		if err != nil {
			t.Fatalf("Resolve(%v) error: %v", bids, err)
		}
		sum := 0
		for _, d := range deltas {
			sum += d
		}
		if sum != 0 {
			t.Fatalf("Resolve(%v) sum=%d, want 0 (deltas=%v)", bids, sum, deltas)
		}
	}
}

func TestResolve_LargeBidsZeroSum(t *testing.T) {
	// Up to ~1e9 bids across many players: int is 64-bit, no overflow, zero-sum holds.
	bids := []int{1_000_000_000, 999_999_999, 500_000_000, 1, 2_000_000_000}
	deltas, err := Resolve(bids)
	if err != nil {
		t.Fatalf("Resolve error: %v", err)
	}
	sum := 0
	for _, d := range deltas {
		sum += d
	}
	if sum != 0 {
		t.Fatalf("large-bid round not zero-sum: deltas=%v sum=%d", deltas, sum)
	}
}

func TestResolve_Errors(t *testing.T) {
	if _, err := Resolve(nil); !errors.Is(err, ErrTooFewBids) {
		t.Errorf("Resolve(nil) err=%v, want ErrTooFewBids", err)
	}
	if _, err := Resolve([]int{5}); !errors.Is(err, ErrTooFewBids) {
		t.Errorf("Resolve([5]) err=%v, want ErrTooFewBids", err)
	}
	if _, err := Resolve([]int{5, 0}); !errors.Is(err, ErrInvalidBid) {
		t.Errorf("Resolve([5,0]) err=%v, want ErrInvalidBid", err)
	}
	if _, err := Resolve([]int{-1, 5}); !errors.Is(err, ErrInvalidBid) {
		t.Errorf("Resolve([-1,5]) err=%v, want ErrInvalidBid", err)
	}
}

// --- ResolveMatrix ----------------------------------------------------------

func TestResolveMatrix_DeltasMatchResolve(t *testing.T) {
	bids := []int{10, 15, 40}
	deltas, duels, err := ResolveMatrix(bids)
	if err != nil {
		t.Fatalf("ResolveMatrix error: %v", err)
	}
	if !equalInts(deltas, []int{0, -25, 25}) {
		t.Fatalf("ResolveMatrix deltas=%v, want [0,-25,25]", deltas)
	}
	// One entry per i<j pair: C(3,2) = 3.
	if len(duels) != 3 {
		t.Fatalf("len(duels)=%d, want 3", len(duels))
	}
	// Spot-check a pair: 15 vs 40 -> 40 bold wins (Second), transfer 15.
	got := duels[[2]int{1, 2}]
	want := DuelResult{Transfer: 15, Winner: Second, Bold: true}
	if got != want {
		t.Fatalf("duels[1,2]=%+v, want %+v", got, want)
	}
	// Every pair detail must equal DuelDetail of the two bids.
	for key, dr := range duels {
		i, j := key[0], key[1]
		if i >= j {
			t.Fatalf("matrix key %v is not i<j", key)
		}
		if exp := DuelDetail(bids[i], bids[j]); dr != exp {
			t.Fatalf("duels[%v]=%+v, want %+v", key, dr, exp)
		}
	}
}

func TestResolveMatrix_Errors(t *testing.T) {
	if _, _, err := ResolveMatrix([]int{1}); !errors.Is(err, ErrTooFewBids) {
		t.Errorf("ResolveMatrix([1]) err=%v, want ErrTooFewBids", err)
	}
	if _, _, err := ResolveMatrix([]int{1, 0, 3}); !errors.Is(err, ErrInvalidBid) {
		t.Errorf("ResolveMatrix([1,0,3]) err=%v, want ErrInvalidBid", err)
	}
}

func TestResolveMatrix_ConsistentWithResolve(t *testing.T) {
	rng := rand.New(rand.NewSource(5))
	for i := 0; i < 1000; i++ {
		n := rng.Intn(6) + 2
		bids := make([]int, n)
		for j := range bids {
			bids[j] = rng.Intn(100) + 1
		}
		d1, err := Resolve(bids)
		if err != nil {
			t.Fatal(err)
		}
		d2, _, err := ResolveMatrix(bids)
		if err != nil {
			t.Fatal(err)
		}
		if !equalInts(d1, d2) {
			t.Fatalf("Resolve=%v vs ResolveMatrix=%v for %v", d1, d2, bids)
		}
	}
}

// --- helpers ----------------------------------------------------------------

func equalInts(a, b []int) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
