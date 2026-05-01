package models

import (
	"github.com/pkg/errors"
	"github.com/strongo/app/user"
	"github.com/strongo/db"
	"time"
)

const (
	UserKind = "User"
	//strangerRivalBidKey = "$tranger"
)

type UserEntity struct {
	strongo.AppUserBase
	user.AccountsOfUser

	Name        string `datastore:",noindex,omitempty"`
	Created     time.Time
	AvatarURL   string `datastore:",noindex,omitempty"`
	FirebaseUID string `datastore:",omitempty"`
	Tokens      int
	//
	//
	TournamentIDs []string `datastore:",noindex"`
	BattlesHandler
}

type User struct {
	db.StringID
	*UserEntity
}

var _ db.EntityHolder = (*User)(nil)

func (User) Kind() string {
	return UserKind
}

func (User) NewEntity() interface{} {
	return new(UserEntity)
}

func (u User) Entity() interface{} {
	return u.UserEntity
}

func (u *User) SetEntity(v interface{}) {
	if v == nil {
		u.UserEntity = nil
	} else {
		u.UserEntity = v.(*UserEntity)
	}

}

func (u *UserEntity) SetBotUserID(platform, botID, botUserID string) {
	u.AddAccount(user.Account{
		Provider: platform,
		App:      botID,
		ID:       botUserID,
	})
}

var ErrNotEnoughTokens = errors.New("not enough tokens")
