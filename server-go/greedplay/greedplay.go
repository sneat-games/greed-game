// Package greedplay is the resolution engine for the Greed Game: an N-player
// hidden-bid game resolved by independent pairwise duels.
//
// # The duel rule
//
// Two players make hidden integer bids (each >= 1). In one duel the amount that
// changes hands is always L, the lower of the two bids. The lower bidder wins
// (gains L) UNLESS the higher bid is strictly more than GreedFactor times the
// lower bid ("bold"), in which case the higher (bold) bidder wins instead.
// Equal bids draw and nothing moves. Every duel is zero-sum.
//
// # N players
//
// For N players each single bid duels every other bid independently under the
// two-player rule, and a player's round result is the sum of their pairwise
// deltas. This stays zero-sum across the whole table.
package greedplay

import (
	"errors"
	"fmt"
)

// GreedFactor is the boldness threshold: a duel's higher bid must be strictly
// greater than GreedFactor times the lower bid for the higher (bold) bidder to
// win. At exactly GreedFactor times the lower bid the lower bidder still wins.
const GreedFactor = 2

// Errors returned by Resolve and ResolveMatrix. Use errors.Is to test for them.
var (
	// ErrTooFewBids is returned when fewer than two bids are supplied.
	ErrTooFewBids = errors.New("greedplay: need at least 2 bids")
	// ErrInvalidBid is returned when any bid is less than 1.
	ErrInvalidBid = errors.New("greedplay: each bid must be >= 1")
)

// Winner encodes which side of a duel won.
type Winner int8

const (
	// Draw means the bids were equal and nothing moved.
	Draw Winner = 0
	// First means the first bid (a) won the duel.
	First Winner = 1
	// Second means the second bid (b) won the duel.
	Second Winner = 2
)

// String renders a Winner for logs and test output.
func (w Winner) String() string {
	switch w {
	case Draw:
		return "Draw"
	case First:
		return "First"
	case Second:
		return "Second"
	default:
		return fmt.Sprintf("Winner(%d)", int8(w))
	}
}

// DuelResult describes one duel for rendering a results screen.
type DuelResult struct {
	// Transfer is the amount that changed hands: min(a,b), or 0 on a draw.
	Transfer int
	// Winner is Draw, First (a won) or Second (b won).
	Winner Winner
	// Bold is true when the winner won via the bold >GreedFactor rule, i.e.
	// when the HIGHER bidder won. It is false on a draw and when the lower
	// bidder won.
	Bold bool
}

// Duel resolves one duel between bids a and b (each >= 1). It returns the token
// delta for a and for b. The result is zero-sum (da == -db) and the transfer is
// always min(a, b). Equal bids draw and return (0, 0).
func Duel(a, b int) (da, db int) {
	if a == b {
		return 0, 0
	}
	lo, hi := a, b
	if lo > hi {
		lo, hi = hi, lo
	}
	bold := hi > GreedFactor*lo // higher bid strictly more than 2x the lower

	// Default: the lower bidder wins. Bold flips it to the higher bidder.
	// aIsLower reports whether a is the lower of the two bids.
	aIsLower := a < b
	aWins := aIsLower != bold // lower wins unless bold; higher wins iff bold

	if aWins {
		return lo, -lo
	}
	return -lo, lo
}

// DuelDetail resolves one duel and returns a DuelResult describing it, for a
// detailed results screen. Semantics match Duel.
func DuelDetail(a, b int) DuelResult {
	da, _ := Duel(a, b)
	if da == 0 { // draw (only possible when a == b, since otherwise |da| == min >= 1)
		return DuelResult{Transfer: 0, Winner: Draw, Bold: false}
	}
	lo, hi := a, b
	if lo > hi {
		lo, hi = hi, lo
	}
	winner := First
	if da < 0 { // a lost, so b won
		winner = Second
	}
	return DuelResult{
		Transfer: lo,
		Winner:   winner,
		Bold:     hi > GreedFactor*lo,
	}
}

// Resolve resolves a round of N players. Every bid duels every other bid under
// the two-player rule and deltas[i] is player i's net change summed over all
// pairwise duels; the deltas always sum to zero.
//
// It returns ErrTooFewBids if fewer than two bids are supplied, or ErrInvalidBid
// if any bid is less than 1.
func Resolve(bids []int) (deltas []int, err error) {
	if err = validate(bids); err != nil {
		return nil, err
	}
	n := len(bids)
	deltas = make([]int, n)
	for i := 0; i < n; i++ {
		for j := i + 1; j < n; j++ {
			di, dj := Duel(bids[i], bids[j])
			deltas[i] += di
			deltas[j] += dj
		}
	}
	return deltas, nil
}

// ResolveMatrix resolves a round like Resolve and additionally returns the
// per-pair detail keyed by [2]int{i, j} for every i < j, for a detailed results
// screen. The deltas are identical to Resolve's.
func ResolveMatrix(bids []int) (deltas []int, duels map[[2]int]DuelResult, err error) {
	if err = validate(bids); err != nil {
		return nil, nil, err
	}
	n := len(bids)
	deltas = make([]int, n)
	duels = make(map[[2]int]DuelResult, n*(n-1)/2)
	for i := 0; i < n; i++ {
		for j := i + 1; j < n; j++ {
			di, dj := Duel(bids[i], bids[j])
			deltas[i] += di
			deltas[j] += dj
			duels[[2]int{i, j}] = DuelDetail(bids[i], bids[j])
		}
	}
	return deltas, duels, nil
}

// validate checks the shared preconditions for a round of bids.
func validate(bids []int) error {
	if len(bids) < 2 {
		return fmt.Errorf("%w: got %d", ErrTooFewBids, len(bids))
	}
	for i, b := range bids {
		if b < 1 {
			return fmt.Errorf("%w: bids[%d] = %d", ErrInvalidBid, i, b)
		}
	}
	return nil
}
