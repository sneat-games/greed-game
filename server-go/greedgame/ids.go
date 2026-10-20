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
	_, _ = rand.Read(b)
	return strings.ToLower(gameIDEncoding.EncodeToString(b))
}
