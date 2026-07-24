package dal4greedgame

import "fmt"

func errMissingField(name string) error {
	return fmt.Errorf("dal4greedgame: missing required field %q", name)
}

func errIndexedField(collection string, i int, field string) error {
	return fmt.Errorf("dal4greedgame: %s[%d].%s is required", collection, i, field)
}

func errDuplicatePlayer(userID string) error {
	return fmt.Errorf("dal4greedgame: duplicate player userID=%s", userID)
}

func errInvalidStatus(status Status) error {
	return fmt.Errorf("dal4greedgame: invalid status %q", status)
}
