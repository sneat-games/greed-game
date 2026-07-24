package greedgame

import (
	"context"
	"sync"
)

// walletCall records one call to fakeWallet's Stake or Award.
type walletCall struct {
	userID  string
	amount  int
	idemKey string
}

// fakeWallet is a CoinWallet test double: balances are seeded/mutated in
// place (safe for concurrent use, since RecordBid's concurrency test drives
// PlaceBid-adjacent balance reads from goroutines), and every Stake/Award
// call is recorded for assertions. stakeErr/awardErr, when set, make every
// subsequent Stake/Award call fail — used to test ResolveRound's error
// propagation.
type fakeWallet struct {
	mu       sync.Mutex
	balances map[string]int
	stakes   []walletCall
	awards   []walletCall
	stakeErr error
	awardErr error
}

func newFakeWallet(balances map[string]int) *fakeWallet {
	if balances == nil {
		balances = map[string]int{}
	}
	return &fakeWallet{balances: balances}
}

func (w *fakeWallet) EnsureDailyAllowance(_ context.Context, userID string) error {
	w.mu.Lock()
	defer w.mu.Unlock()
	if _, ok := w.balances[userID]; !ok {
		w.balances[userID] = 0
	}
	return nil
}

func (w *fakeWallet) Balance(_ context.Context, userID string) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.balances[userID], nil
}

func (w *fakeWallet) Stake(_ context.Context, userID string, amount int, idemKey string) error {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.stakeErr != nil {
		return w.stakeErr
	}
	w.stakes = append(w.stakes, walletCall{userID, amount, idemKey})
	w.balances[userID] -= amount
	return nil
}

func (w *fakeWallet) Award(_ context.Context, userID string, amount int, idemKey string) error {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.awardErr != nil {
		return w.awardErr
	}
	w.awards = append(w.awards, walletCall{userID, amount, idemKey})
	w.balances[userID] += amount
	return nil
}

// balanceOf is a small test helper reading a balance without an error check.
func (w *fakeWallet) balanceOf(userID string) int {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.balances[userID]
}

var _ CoinWallet = (*fakeWallet)(nil)
