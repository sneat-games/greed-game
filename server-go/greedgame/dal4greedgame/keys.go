package dal4greedgame

import "github.com/dal-go/record"

// newSessionKey builds the ext/greedgame/sessions/{gameID} key, namespacing
// this extension's records below a single "ext/{ExtensionID}" parent key.
func newSessionKey(gameID string) *record.Key {
	extKey := record.NewKeyWithID("ext", ExtensionID)
	return record.NewKeyWithParentAndID(extKey, SessionsCollection, gameID)
}
