package greedgame

import (
	"context"
	"fmt"
	"sort"

	"github.com/dal-go/dalgo/dal"

	"github.com/sneat-games/greed-game/server-go/greedgame/dal4greedgame"
	"github.com/sneat-games/greed-game/server-go/greedplay"
)

// ResolveRound resolves gameID's current round once every active player has
// bid (RecordBid's AllBidsIn==true is the trigger a caller waits for, ideally
// handing off to a delayed/background task so the triggering webhook still
// returns immediately — this function makes several external CoinWallet
// calls and is not meant to run inline on a request path). It:
//
//  1. Loads the session and every active player's bid (plain read; the
//     transaction that just recorded the last bid has already committed).
//  2. Resolves the round via greedplay.Resolve — the engine is the ONLY place
//     the pairwise/two-cap rule is implemented; this package never re-derives it.
//  3. Settles each player's delta through wallet with idempotent keys
//     ("greedgame:<gameID>:r<round>:<userID>"), so a retried call after a
//     partial failure never double-moves value.
//  4. Advances the session to the next round (marking players who can no
//     longer afford the next minimum bid as sitting out) or to Finished, in one
//     more read-write transaction.
//
// Steps 3 and 4 are intentionally NOT one atomic unit — see the package doc on
// why CoinWallet calls never happen inside a dal transaction. If a wallet call
// fails partway through step 3, ResolveRound returns an error without
// advancing the round; retrying is safe (already-settled players' idempotency
// keys make their Stake/Award calls no-op replays) but is a caller
// responsibility (e.g. the delayed task's own retry policy).
func ResolveRound(ctx context.Context, db dal.DB, wallet CoinWallet, gameID string) (outcome RoundOutcome, err error) {
	entry, err := dal4greedgame.GetSession(ctx, db, gameID)
	if err != nil {
		return RoundOutcome{}, mapNotFound(err)
	}
	session := entry.Data
	if session.Status != dal4greedgame.StatusActive {
		return RoundOutcome{}, ErrGameNotActive
	}
	round := session.Round

	active := activePlayers(session.Players)
	if len(active) < 2 {
		return RoundOutcome{}, fmt.Errorf("greedgame: ResolveRound: gameID=%s has fewer than 2 active players", gameID)
	}
	bids := make([]int, len(active))
	for i, p := range active {
		bids[i] = p.Bid
	}
	deltas, resolveErr := greedplay.Resolve(bids)
	if resolveErr != nil {
		return RoundOutcome{}, fmt.Errorf("greedgame: ResolveRound: greedplay.Resolve: %w", resolveErr)
	}

	// Settle every active player's delta, and capture their post-settlement
	// balance for the reveal — both are external CoinWallet calls, so this
	// entire loop deliberately runs OUTSIDE any dal transaction.
	balances := make(map[string]int, len(session.Players))
	results := make([]PlayerRoundResult, len(active))
	for i, p := range active {
		delta := deltas[i]
		key := settlementIdemKey(gameID, round, p.UserID)
		var settleErr error
		switch {
		case delta < 0:
			settleErr = wallet.Stake(ctx, p.UserID, -delta, key)
		case delta > 0:
			settleErr = wallet.Award(ctx, p.UserID, delta, key)
		}
		if settleErr != nil {
			return RoundOutcome{}, fmt.Errorf("greedgame: ResolveRound: settle player %s (delta=%d): %w", p.UserID, delta, settleErr)
		}
		balance, balErr := wallet.Balance(ctx, p.UserID)
		if balErr != nil {
			return RoundOutcome{}, fmt.Errorf("greedgame: ResolveRound: read post-settlement balance for %s: %w", p.UserID, balErr)
		}
		balances[p.UserID] = balance
		results[i] = PlayerRoundResult{UserID: p.UserID, Name: p.Name, Bid: p.Bid, Delta: delta, Balance: balance}
	}
	// Balances for players who sat out THIS round too (unchanged, but needed
	// for standings) — they were skipped by the loop above.
	for _, p := range session.Players {
		if _, ok := balances[p.UserID]; ok {
			continue
		}
		b, balErr := wallet.Balance(ctx, p.UserID)
		if balErr != nil {
			return RoundOutcome{}, fmt.Errorf("greedgame: ResolveRound: read balance for %s: %w", p.UserID, balErr)
		}
		balances[p.UserID] = b
	}

	nextRound := round + 1
	finished := nextRound > session.Rounds

	txErr := db.RunReadwriteTransaction(ctx, func(ctx context.Context, tx dal.ReadwriteTransaction) error {
		e2, gErr := dal4greedgame.GetSessionTx(ctx, tx, gameID)
		if gErr != nil {
			return mapNotFound(gErr)
		}
		s2 := e2.Data
		if s2.Status != dal4greedgame.StatusActive || s2.Round != round {
			// The round was already advanced (e.g. ResolveRound was invoked twice
			// for the same round) — refuse to advance it a second time.
			return fmt.Errorf("greedgame: ResolveRound: gameID=%s round advanced concurrently (expected round=%d, status=active; got round=%d, status=%s)",
				gameID, round, s2.Round, s2.Status)
		}

		// Minimum bid for the NEXT round is based on the active count BEFORE any
		// new sit-outs from this pass, matching how the round that just resolved
		// computed its own minimum (see RecordBid/minBidFor).
		minNext := minBidFor(activePlayerCount(s2.Players))
		var newlySatOut []string
		for i := range s2.Players {
			p := &s2.Players[i]
			p.Bid = 0
			if !p.SatOut && balances[p.UserID] < minNext {
				p.SatOut = true
				newlySatOut = append(newlySatOut, p.UserID)
			}
		}
		if !finished && activePlayerCount(s2.Players) < 2 {
			finished = true // bust-out ending: too few players left to continue
		}
		if finished {
			s2.Status = dal4greedgame.StatusFinished
		} else {
			s2.Round = nextRound
		}

		outcome = RoundOutcome{
			GameID:      gameID,
			Round:       round,
			Finished:    finished,
			Results:     results,
			NewlySatOut: newlySatOut,
			Standings:   buildStandings(s2.Players, balances),
		}
		if !finished {
			outcome.NextRound = nextRound
		}
		return tx.Set(ctx, e2.Record)
	})
	if txErr != nil {
		return RoundOutcome{}, txErr
	}
	return outcome, nil
}

// buildStandings ranks every player (including those sitting out) by balance,
// highest first, stably preserving join order among equal balances.
func buildStandings(players []dal4greedgame.PlayerDbo, balances map[string]int) []Standing {
	standings := make([]Standing, len(players))
	for i, p := range players {
		standings[i] = Standing{UserID: p.UserID, Name: p.Name, Balance: balances[p.UserID], SatOut: p.SatOut}
	}
	sort.SliceStable(standings, func(i, j int) bool { return standings[i].Balance > standings[j].Balance })
	return standings
}

// settlementIdemKey is the idempotency key one player's one round of coin
// settlement is keyed by, so a retried ResolveRound never double-moves value.
func settlementIdemKey(gameID string, round int, userID string) string {
	return fmt.Sprintf("greedgame:%s:r%d:%s", gameID, round, userID)
}
