import { Meteor } from 'meteor/meteor';
import _ from 'underscore';

import { Base } from './models/_Base';
import DBRooms from './models/Rooms';
import Avatars from './models/Avatars';
import Uploads from './models/Uploads';
import UserDataFiles from './models/UserDataFiles';
import { Roles } from './models/Roles';
import { Subscriptions as subscriptions } from './models/Subscriptions';
import { Users as users } from './models/Users';
import { CachedChannelList } from './models/CachedChannelList';
import { CachedChatRoom } from './models/CachedChatRoom';
import { CachedChatSubscription } from './models/CachedChatSubscription';
import { CachedUserList } from './models/CachedUserList';
import { ChatRoom } from './models/ChatRoom';
import { ChatSubscription } from './models/ChatSubscription';
import { ChatMessage } from './models/ChatMessage';
import { RoomRoles } from './models/RoomRoles';
import { UserAndRoom } from './models/UserAndRoom';
import { UserRoles } from './models/UserRoles';
import { AuthzCachedCollection, ChatPermissions } from './models/ChatPermissions';
import { WebdavAccounts } from './models/WebdavAccounts';
import CustomSounds from './models/CustomSounds';
import CustomUserStatus from './models/CustomUserStatus';
import EmojiCustom from './models/EmojiCustom';

const Users = _.extend({}, users, Meteor.users);
const Subscriptions = _.extend({}, subscriptions, ChatSubscription);
const Messages = _.extend({}, ChatMessage);
const Rooms = _.extend({}, ChatRoom);

export {
	Base,
	DBRooms,
	Rooms,
	Avatars,
	Uploads,
	UserDataFiles,
	Roles,
	Subscriptions,
	Users,
	Messages,
	CachedChannelList,
	CachedChatRoom,
	CachedChatSubscription,
	CachedUserList,
	ChatRoom,
	RoomRoles,
	UserAndRoom,
	UserRoles,
	AuthzCachedCollection,
	ChatPermissions,
	ChatMessage,
	ChatSubscription,
	CustomSounds,
	CustomUserStatus,
	EmojiCustom,
	WebdavAccounts,
};
