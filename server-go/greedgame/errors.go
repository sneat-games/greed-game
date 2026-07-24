package greedgame

import "errors"

// Sentinel errors returned by the session/round API. Use errors.Is to test.
var (
	// ErrGameNotFound is returned when gameID does not identify a session.
	ErrGameNotFound = errors.New("greedgame: session not found")

	// ErrGameNotInLobby is returned by Join when the session has already
	// started (v1 does not support joining mid-game — see package doc).
	ErrGameNotInLobby = errors.New("greedgame: session is no longer accepting new players")

	// ErrGameFinished is returned by operations that require an active/lobby
	// session once the session has reached its terminal state.
	ErrGameFinished = errors.New("greedgame: session has finished")

	// ErrGameNotActive is returned by RecordBid when the session has not been
	// started yet (still in the lobby) or has already finished.
	ErrGameNotActive = errors.New("greedgame: session is not accepting bids right now")

	// ErrAlreadyJoined is returned by Join when userID is already a player.
	ErrAlreadyJoined = errors.New("greedgame: player has already joined this session")

	// ErrNotEnoughPlayers is returned by StartSession when fewer than two
	// players have joined.
	ErrNotEnoughPlayers = errors.New("greedgame: at least 2 players are required to start")

	// ErrPlayerNotInGame is returned when userID is not a participant.
	ErrPlayerNotInGame = errors.New("greedgame: you are not a player in this session")

	// ErrPlayerSatOut is returned by RecordBid when the player can no longer
	// afford the minimum bid and is sitting out the rest of the session.
	ErrPlayerSatOut = errors.New("greedgame: you are sitting out the rest of this session (insufficient coins)")

	// ErrAlreadyBid is returned by RecordBid when the player already has a
	// locked-in bid for the current round — bids cannot be changed once placed.
	ErrAlreadyBid = errors.New("greedgame: your bid for this round is already locked in")

	// ErrBidTooLow is returned when a bid is below the round's minimum
	// (active players - 1, per the greedplay engine's splittability rule).
	ErrBidTooLow = errors.New("greedgame: bid is below the minimum for this round")

	// ErrBidTooHigh is returned when a bid exceeds the player's coin balance.
	ErrBidTooHigh = errors.New("greedgame: bid exceeds your current coin balance")
)
