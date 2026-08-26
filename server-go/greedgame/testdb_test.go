package greedgame

import (
	"context"
	"testing"

	"github.com/dal-go/dalgo/dal"
	"github.com/sneat-co/sneat-go-core/sneatcoretesting"
)

// newMemoryDB creates a strict (Firestore-compatible) in-memory dalgo
// database for tests: a transaction cannot read after its own write. This
// makes TestRecordBid_ConcurrentLastTwoBids_ExactlyOneObservesAllBidsIn a
// meaningful test — concurrent callers are genuinely serialized against each
// other exactly like a production transactional backend would (Firestore
// transactions retry on conflicting writes).
func newMemoryDB(t *testing.T) (context.Context, dal.DB) {
	t.Helper()
	return context.Background(), sneatcoretesting.NewInMemoryTestDB()
}
