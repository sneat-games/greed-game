package greedgame

import (
	"net/url"
	"regexp"
	"testing"
)

var telegramStartParamRe = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)

func TestNewGameID_IsStartParamSafeAndUnique(t *testing.T) {
	seen := make(map[string]bool)
	for i := 0; i < 1000; i++ {
		id := NewGameID()
		if !telegramStartParamRe.MatchString(id) {
			t.Fatalf("NewGameID() = %q is not a valid Telegram /start payload", id)
		}
		if seen[id] {
			t.Fatalf("NewGameID() produced a duplicate: %q", id)
		}
		seen[id] = true

		// Must also survive a round-trip through the exact deep-link shape a
		// Telegram bot host builds (join_<gameID>), i.e. remain a single path
		// segment.
		u, err := url.Parse("https://t.me/GreedGameBot?start=join_" + id)
		if err != nil {
			t.Fatalf("deep link with id %q failed to parse: %v", id, err)
		}
		if got := u.Query().Get("start"); got != "join_"+id {
			t.Fatalf("round-tripped start param = %q, want %q", got, "join_"+id)
		}
	}
}
