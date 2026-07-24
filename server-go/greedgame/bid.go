package greedgame

import (
	"context"
	"fmt"

	"github.com/dal-go/dalgo/dal"

	"github.com/sneat-games/greed-game/server-go/greedgame/dal4greedgame"
)

// PlaceBid is the entry point a host calls when a player submits a bid (e.g.
// from a bid wizard's OnComplete). It checks the player's current coin
// balance via wallet BEFORE opening any transaction (an external call — see
// package doc), then delegates the atomic record-and-check to RecordBid.
//
// A balance read this far ahead of the transaction is inherently best-effort:
// it can change between this check and the round actually settling (e.g. the
// same player stakes coins in another game concurrently). That is fine — the
// AUTHORITATIVE enforcement of "never go negative" is wallet.Stake itself at
// settlement time (ResolveRound), which is expected to fail loudly on
// insufficient funds; this check only exists to give a bidder immediate,
// friendly feedback instead of a confusing failure minutes later when the
// round resolves.
func PlaceBid(ctx context.Context, db dal.DB, wallet CoinWallet, gameID, userID string, bid int) (BidResult, error) {
	if bid <= 0 {
		return BidResult{}, ErrBidTooLow
	}
	balance, err := wallet.Balance(ctx, userID)
	if err != nil {
		return BidResult{}, fmt.Errorf("greedgame: PlaceBid: read balance for %s: %w", userID, err)
	}
	if bid > balance {
		return BidResult{}, ErrBidTooHigh
	}
	return RecordBid(ctx, db, gameID, userID, bid)
}

// RecordBid records userID's secret bid for gameID's CURRENT round and reports
// whether every active player has now bid — ALL inside one
// db.RunReadwriteTransaction, which is the crux of the "resolve only when all
// bids are in, exactly once" correctness requirement: the session is read,
// this player's bid is written, and the "every active player has bid" check
// is evaluated, all against the SAME consistent snapshot inside the SAME
// transaction. If two players submit the last two outstanding bids
// concurrently, the backend serializes their transactions (Firestore
// transactions retry on conflicting writes; a strict in-memory test DB takes
// an exclusive lock for the whole transaction) — so only ONE of them ever
// computes AllBidsIn=true. Callers MUST treat AllBidsIn as a trigger to
// resolve the round exactly once, never re-derive it from a separate read
// afterwards.
//
// It does not call into the CoinWallet (see package doc) — balance validation
// is PlaceBid's job, performed before this function is called. RecordBid only
// enforces the round's minimum bid (active players - 1).
func RecordBid(ctx context.Context, db dal.DB, gameID, userID string, bid int) (result BidResult, err error) {
	err = db.RunReadwriteTransaction(ctx, func(ctx context.Context, tx dal.ReadwriteTransaction) error {
		entry, gErr := dal4greedgame.GetSessionTx(ctx, tx, gameID)
		if gErr != nil {
			return mapNotFound(gErr)
		}
		session := entry.Data
		if session.Status != dal4greedgame.StatusActive {
			return ErrGameNotActive
		}
		idx := findPlayerIndex(session.Players, userID)
		if idx < 0 {
			return ErrPlayerNotInGame
		}
		player := &session.Players[idx]
		if player.SatOut {
			return ErrPlayerSatOut
		}
		if player.Bid != 0 {
			return ErrAlreadyBid
		}
		minBid := minBidFor(activePlayerCount(session.Players))
		if bid < minBid {
			return ErrBidTooLow
		}

		player.Bid = bid

		result = BidResult{
			GameID:            gameID,
			Round:             session.Round,
			ActivePlayerCount: activePlayerCount(session.Players),
			AllBidsIn:         allActiveBidsIn(session.Players),
		}
		return tx.Set(ctx, entry.Record)
	})
	if err != nil {
		return BidResult{}, err
	}
	return result, nil
}
