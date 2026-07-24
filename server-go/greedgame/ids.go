package greedgame

import (
	"crypto/rand"
	"encoding/base32"
	"strings"
)

// gameIDEncoding renders a random game ID using Telegram start-parameter-safe
// characters only (Telegram restricts /start payloads to [A-Za-z0-9_-]).
// Crockford's alphabet (no padding) satisfies that and avoids the visually
// ambiguous characters a human might need to retype.
var gameIDEncoding = base32.NewEncoding("0123456789ABCDEFGHJKMNPQRSTVWXYZ").WithPadding(base32.NoPadding)

// gameIDBytes is the amount of randomness backing a game ID: 10 bytes (80 bits)
// is comfortably collision-resistant for this game's scale.
const gameIDBytes = 10

// NewGameID returns a new random, URL/deep-link-safe game session ID.
func NewGameID() string {
	b := make([]byte, gameIDBytes)
	if _, err := rand.Read(b); err != nil {
		// crypto/rand.Read on a supported platform practically never errors;
		// panicking here matches the framework's own posture on unrecoverable
		// randomness failures rather than silently handing out a low-entropy
		// fallback ID.
		panic("greedgame: failed to read random bytes for a new game ID: " + err.Error())
	}
	return strings.ToLower(gameIDEncoding.EncodeToString(b))
}
