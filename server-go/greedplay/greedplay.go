// Package greedplay is the resolution engine for the Greed Game: an N-player
// hidden-bid game resolved by independent pairwise duels with a per-player
// settlement cap.
//
// # The duel rule
//
// Two players make hidden integer bids. In one duel the amount at stake is always
// L, the lower of the two bids. The HIGHER bidder wins (courage — takes L) UNLESS
// the higher bid is strictly more than GreedFactor times the lower bid ("greed"),
// in which case the greedy higher bidder is punished and the LOWER bidder wins
// instead. Equal bids draw and nothing moves. Because the stake is the lower bid,
// neither player can win or lose more than their own bid against any one opponent.
//
// # N players and the settlement caps
//
// For N players each bid duels every other bid independently under the two-player
// rule, and a player's beaters are everyone who won their duel against them. The
// round is then settled under two caps:
//
//   - Loss cap: a player's TOTAL loss in a round can never exceed their own bid.
//     If the sum of what they owe across all lost duels exceeds their bid, they
//     pay exactly their bid, split among their beaters in proportion to the
//     beaters' bids (largest-remainder rounding). Otherwise they pay each beater
//     the duel stake in full.
//   - Win cap: a winner never takes more than their own bid from any single
//     opponent (automatic, since a duel only ever moves the lower bid), but may
//     net more than their bid across several opponents.
//
// The settlement is zero-sum: every token a loser pays is received by a beater.
// To keep a capped bid splittable among up to N-1 beaters, each bid must be at
// least N-1 (see Resolve's validation).
package greedplay

import (
	"errors"
	"fmt"
	"sort"
)

// GreedFactor is the greed threshold: when a duel's higher bid is strictly
// greater than GreedFactor times the lower bid, the higher bidder is "greedy"
// and loses (the lower bidder wins). At or below GreedFactor times the lower bid
// the higher bidder is merely courageous and wins.
const GreedFactor = 2

// Errors returned by Resolve and ResolveMatrix. Use errors.Is to test for them.
var (
	// ErrTooFewBids is returned when fewer than two bids are supplied.
	ErrTooFewBids = errors.New("greedplay: need at least 2 bids")
	// ErrInvalidBid is returned when any bid is below the minimum (players-1),
	// so that a capped bid can always be split among the beaters.
	ErrInvalidBid = errors.New("greedplay: each bid must be >= players-1")
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
	// Transfer is the duel stake: min(a,b), or 0 on a draw. This is the notional
	// per-duel amount; the amount actually settled may be smaller when the loser's
	// loss cap binds (see Resolve).
	Transfer int
	// Winner is Draw, First (a won) or Second (b won).
	Winner Winner
	// Greedy is true when the higher bid was greedy (> GreedFactor * the lower
	// bid) and was therefore punished — i.e. the LOWER bidder won. It is false on
	// a draw and when the higher (courageous) bidder won.
	Greedy bool
}

// Duel resolves one duel between bids a and b. It returns the token delta for a
// and for b. The result is zero-sum (da == -db) and the stake is always min(a, b).
// Equal bids draw and return (0, 0).
func Duel(a, b int) (da, db int) {
	if a == b {
		return 0, 0
	}
	lo, hi := a, b
	if lo > hi {
		lo, hi = hi, lo
	}
	greedy := hi > GreedFactor*lo // higher bid strictly more than 2x the lower => greed

	// The HIGHER bidder wins (courage) UNLESS the higher bid is greedy, in which
	// case the greedy bidder is punished and the LOWER bidder wins.
	// aIsHigher reports whether a is the higher of the two bids.
	aIsHigher := a > b
	aWins := aIsHigher != greedy // higher wins unless greedy; when greedy the lower wins

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
		return DuelResult{Transfer: 0, Winner: Draw, Greedy: false}
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
		Greedy:   hi > GreedFactor*lo,
	}
}

// Resolve resolves a round of N players. Every bid duels every other bid under the
// two-player rule; the round is then settled under the loss and win caps described
// on the package. deltas[i] is player i's net change and the deltas always sum to
// zero.
//
// It returns ErrTooFewBids if fewer than two bids are supplied, or ErrInvalidBid
// if any bid is below players-1.
func Resolve(bids []int) (deltas []int, err error) {
	if err = validate(bids); err != nil {
		return nil, err
	}
	deltas, _ = settle(bids, false)
	return deltas, nil
}

// ResolveMatrix resolves a round like Resolve and additionally returns the
// per-pair detail keyed by [2]int{i, j} for every i < j, for a detailed results
// screen. The deltas are identical to Resolve's. Note each DuelResult.Transfer is
// the notional per-duel stake; a player's actual settled loss may be smaller when
// their loss cap binds, so the deltas need not equal the sum of duel transfers.
func ResolveMatrix(bids []int) (deltas []int, duels map[[2]int]DuelResult, err error) {
	if err = validate(bids); err != nil {
		return nil, nil, err
	}
	deltas, duels = settle(bids, true)
	return deltas, duels, nil
}

// settle runs every pairwise duel, then applies the loss cap per loser. When
// wantDuels is true it also records the per-pair DuelResult detail.
func settle(bids []int, wantDuels bool) (deltas []int, duels map[[2]int]DuelResult) {
	n := len(bids)
	deltas = make([]int, n)
	if wantDuels {
		duels = make(map[[2]int]DuelResult, n*(n-1)/2)
	}

	// debt records that some loser owes `winner` the duel stake `amount`.
	type debt struct{ winner, amount int }
	owed := make([][]debt, n) // owed[loser] = every duel that loser lost

	for i := 0; i < n; i++ {
		for j := i + 1; j < n; j++ {
			di, _ := Duel(bids[i], bids[j])
			if wantDuels {
				duels[[2]int{i, j}] = DuelDetail(bids[i], bids[j])
			}
			if di == 0 {
				continue // draw: nothing owed
			}
			amount := bids[i]
			if bids[j] < amount {
				amount = bids[j] // the lower bid is the stake
			}
			if di > 0 { // i won, j lost
				owed[j] = append(owed[j], debt{winner: i, amount: amount})
			} else { // j won, i lost
				owed[i] = append(owed[i], debt{winner: j, amount: amount})
			}
		}
	}

	for loser := 0; loser < n; loser++ {
		debts := owed[loser]
		if len(debts) == 0 {
			continue
		}
		total := 0
		for _, d := range debts {
			total += d.amount
		}
		if total <= bids[loser] {
			// Loss cap does not bind: pay every beater the duel stake in full.
			for _, d := range debts {
				deltas[d.winner] += d.amount
				deltas[loser] -= d.amount
			}
			continue
		}
		// Loss cap binds: pay exactly the bid, split proportionally to beaters' bids.
		weights := make([]int, len(debts))
		for k, d := range debts {
			weights[k] = bids[d.winner]
		}
		shares := apportion(bids[loser], weights)
		for k, d := range debts {
			deltas[d.winner] += shares[k]
			deltas[loser] -= shares[k]
		}
	}
	return deltas, duels
}

// apportion distributes total among recipients in proportion to their weights,
// returning integer shares that sum exactly to total. It uses the largest-remainder
// (Hamilton) method: each recipient gets the floor of its exact share, then the
// leftover units go one each to the largest fractional remainders (ties broken by
// larger weight, then lower index). weights must be positive and total >= 0.
func apportion(total int, weights []int) []int {
	shares := make([]int, len(weights))
	sumW := 0
	for _, w := range weights {
		sumW += w
	}
	if sumW == 0 {
		return shares
	}
	type frac struct{ idx, rem, weight int }
	fracs := make([]frac, len(weights))
	allocated := 0
	for i, w := range weights {
		num := total * w
		shares[i] = num / sumW
		allocated += shares[i]
		fracs[i] = frac{idx: i, rem: num % sumW, weight: w}
	}
	leftover := total - allocated
	sort.Slice(fracs, func(a, b int) bool {
		if fracs[a].rem != fracs[b].rem {
			return fracs[a].rem > fracs[b].rem
		}
		if fracs[a].weight != fracs[b].weight {
			return fracs[a].weight > fracs[b].weight
		}
		return fracs[a].idx < fracs[b].idx
	})
	for k := 0; k < leftover; k++ {
		shares[fracs[k].idx]++
	}
	return shares
}

// validate checks the shared preconditions for a round of bids: at least two
// players, and every bid at least players-1 so a capped bid stays splittable.
func validate(bids []int) error {
	n := len(bids)
	if n < 2 {
		return fmt.Errorf("%w: got %d", ErrTooFewBids, n)
	}
	minBid := n - 1
	for i, b := range bids {
		if b < minBid {
			return fmt.Errorf("%w: bids[%d] = %d (need >= %d with %d players)", ErrInvalidBid, i, b, minBid, n)
		}
	}
	return nil
}
