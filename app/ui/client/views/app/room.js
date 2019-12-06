import _ from 'underscore';
import moment from 'moment';
import Clipboard from 'clipboard';
import { Meteor } from 'meteor/meteor';
import { Tracker } from 'meteor/tracker';
import { ReactiveDict } from 'meteor/reactive-dict';
import { ReactiveVar } from 'meteor/reactive-var';
import { Random } from 'meteor/random';
import { Blaze } from 'meteor/blaze';
import { FlowRouter } from 'meteor/kadira:flow-router';
import { Session } from 'meteor/session';
import { Template } from 'meteor/templating';

import { t, roomTypes, getUserPreference, handleError } from '../../../../utils';
import { WebRTC } from '../../../../webrtc/client';
import { ChatMessage, RoomRoles, Users, Subscriptions, Rooms } from '../../../../models';
import {
	fireGlobalEvent,
	RoomHistoryManager,
	RoomManager,
	readMessage,
	popover,
	modal,
	Layout,
	MessageAction,
	RocketChatTabBar,
} from '../../../../ui-utils';
import { messageContext } from '../../../../ui-utils/client/lib/messageContext';
import { renderMessageBody } from '../../../../ui-utils/client/lib/renderMessageBody';
import { messageArgs } from '../../../../ui-utils/client/lib/messageArgs';
import { getConfig } from '../../../../ui-utils/client/config';
import { call } from '../../../../ui-utils/client/lib/callMethod';
import { settings } from '../../../../settings';
import { callbacks } from '../../../../callbacks';
import { promises } from '../../../../promises/client';
import { hasAllPermission, hasRole } from '../../../../authorization';
import { lazyloadtick } from '../../../../lazy-load';
import { ChatMessages } from '../../lib/chatMessages';
import { fileUpload } from '../../lib/fileUpload';
import { isURL } from '../../../../utils/lib/isURL';
import { mime } from '../../../../utils/lib/mimeTypes';

export const chatMessages = {};

const userCanDrop = (_id) => !roomTypes.readOnly(_id, Users.findOne({ _id: Meteor.userId() }, { fields: { username: 1 } }));

const openMembersListTab = (instance, group) => {
	instance.userDetail.set(null);
	instance.groupDetail.set(group);
	instance.tabBar.setTemplate('membersList');
	instance.tabBar.open();
};

const openProfileTab = (e, instance, username) => {
	if (Layout.isEmbedded()) {
		fireGlobalEvent('click-user-card-message', { username });
		e.preventDefault();
		e.stopPropagation();
		return;
	}

	const roomData = Session.get(`roomData${ RoomManager.openedRoom }`);
	if (roomTypes.roomTypes[roomData.t].enableMembersListProfile()) {
		instance.userDetail.set(username);
	}

	instance.groupDetail.set(null);
	instance.tabBar.setTemplate('membersList');
	instance.tabBar.open();
};

const openProfileTabOrOpenDM = (e, instance, username) => {
	if (settings.get('UI_Click_Direct_Message')) {
		Meteor.call('createDirectMessage', username, (error, result) => {
			if (error) {
				if (error.isClientSafe) {
					openProfileTab(e, instance, username);
				} else {
					handleError(error);
				}
			}

			if (result && result.rid) {
				FlowRouter.go('direct', { username }, FlowRouter.current().queryParams);
			}
		});
	} else {
		openProfileTab(e, instance, username);
	}
	e.stopPropagation();
};

const mountPopover = (e, i, outerContext) => {
	let context = $(e.target).parents('.message').data('context');
	if (!context) {
		context = 'message';
	}

	const messageContext = messageArgs(outerContext);

	let menuItems = MessageAction.getButtons(messageContext, context, 'menu').map((item) => ({
		icon: item.icon,
		name: t(item.label),
		type: 'message-action',
		id: item.id,
		modifier: item.color,
	}));

	if (window.matchMedia('(max-width: 500px)').matches) {
		const messageItems = MessageAction.getButtons(messageContext, context, 'message').map((item) => ({
			icon: item.icon,
			name: t(item.label),
			type: 'message-action',
			id: item.id,
			modifier: item.color,
		}));

		menuItems = menuItems.concat(messageItems);
	}

	const [items, deleteItem] = menuItems.reduce((result, value) => { result[value.id === 'delete-message' ? 1 : 0].push(value); return result; }, [[], []]);
	const groups = [{ items }];

	if (deleteItem.length) {
		groups.push({ items: deleteItem });
	}

	const config = {
		columns: [
			{
				groups,
			},
		],
		instance: i,
		currentTarget: e.currentTarget,
		data: outerContext,
		activeElement: $(e.currentTarget).parents('.message')[0],
		onRendered: () => new Clipboard('.rc-popover__item'),
	};

	popover.open(config);
};

const wipeFailedUploads = () => {
	const uploads = Session.get('uploading');

	if (uploads) {
		Session.set('uploading', uploads.filter((upload) => !upload.error));
	}
};

function roomHasGlobalPurge(room) {
	if (!settings.get('RetentionPolicy_Enabled')) {
		return false;
	}

	switch (room.t) {
		case 'c':
			return settings.get('RetentionPolicy_AppliesToChannels');
		case 'p':
			return settings.get('RetentionPolicy_AppliesToGroups');
		case 'd':
			return settings.get('RetentionPolicy_AppliesToDMs');
	}
	return false;
}

function roomHasPurge(room) {
	if (!room || !settings.get('RetentionPolicy_Enabled')) {
		return false;
	}

	if (room.retention && room.retention.enabled !== undefined) {
		return room.retention.enabled;
	}

	return roomHasGlobalPurge(room);
}

function roomFilesOnly(room) {
	if (!room) {
		return false;
	}

	if (room.retention && room.retention.overrideGlobal) {
		return room.retention.filesOnly;
	}

	return settings.get('RetentionPolicy_FilesOnly');
}

function roomExcludePinned(room) {
	if (!room) {
		return false;
	}

	if (room.retention && room.retention.overrideGlobal) {
		return room.retention.excludePinned;
	}

	return settings.get('RetentionPolicy_ExcludePinned');
}

function roomMaxAge(room) {
	if (!room) {
		return;
	}
	if (!roomHasPurge(room)) {
		return;
	}

	if (room.retention && room.retention.overrideGlobal) {
		return room.retention.maxAge;
	}

	if (room.t === 'c') {
		return settings.get('RetentionPolicy_MaxAge_Channels');
	}
	if (room.t === 'p') {
		return settings.get('RetentionPolicy_MaxAge_Groups');
	}
	if (room.t === 'd') {
		return settings.get('RetentionPolicy_MaxAge_DMs');
	}
}


/* Returns an array of real time user data, each element looks like this: 
	{
		"anonymous": false,
		"user_id": "8EGJZh3RdjwNZWtvd",
		"profile_url": "https://chat.socvid.net/direct/alex.hartman.adams",
		"system_id": "socvid.chat",
		"username": "alex.hartman.adams",
		"display_name": "Alex Hartman Adams",
		"avatar_url": "https://chat.socvid.net/avatar/alex.hartman.adams",
		"last_activity": 1575250227380 
	} */

const getChannelSurferViewerString = (channel) => {
 	var html = ''
		channel.currentViewers.forEach((viewer) => { html += `<img data-name="${viewer.username}" alt="${viewer.display_name}" class="channel_surfer_minithumb" src="${viewer.avatar_url}"  /> &nbsp;`})

	return html;

}
	const getChannelSurferHtml = (channels) => {
		var html = ""

		channels.forEach(channel => 
			{
				html+= `
		<li class="sidebar-item js-sidebar-type-c" data-id="" style="height:64px">
				<a class="sidebar-item__link" href="/channel/${channel.channel_name}" aria-label="${channel.channel_name}" style="align-items: start; -webkit-box-align: start">
			
			
					<div class="sidebar-item__picture" style="flex: 0 0 48px; width:48px; height:48px">
			
						<div class="sidebar-item__user-thumb" style="width:48px; height:48px">
			
							<div class="avatar">
			
								<img src="https://samrahimi.com/avatars/${channel.channel_name}.png" class="avatar-image">
			
							</div>
			
						</div>
			
					</div>
			
					<div class="sidebar-item__body">
						<div class="sidebar-item__message" style="height:48px">



							<div class="sidebar-item__message-top">
								<div class="sidebar-item__name">
									<div class="sidebar-item__room-type">
										<svg class="rc-icon rc-icon--default-size sidebar-item__icon sidebar-item__icon--hashtag"
											aria-hidden="true">
											<use xlink:href="#icon-hashtag"></use>
										</svg>
									</div>
			
									<div class="sidebar-item__ellipsis">
										${channel.channel_name}
									</div>
			
								</div>
								<span class="sidebar-item__time"></span>
							</div>

							<div class="sidebar-item__message-bottom" style="width:100%">
							${getChannelSurferViewerString(channel)}
						</div>



						</div>	
					</div>


				</a>
			</li>
			`})

		return html
	}
	
const getThumbnailHtml = (viewers) => {
	let maxAge = 86400 * 1000
	let thumbs = ``

	viewers.forEach(viewer => {
		thumbs += 
		`<a title="${viewer.display_name}" href="${viewer.profile_url}" target="_blank">
			<img alt="Picture of ${viewer.display_name}" src="${viewer.avatar_url}" />
			${false ? '<div class="greenDot"></div>': ''}
		</a>`
	})

	return `			
	<style>
	.nowWatching {
		width:100%;
		height: 100%;
		padding:10px;
	}
	.nowWatching .headerText {
		font-size:14px; color:#eeeeee; font-weight:bold;
	}
	.nowWatching .greenDot {
		background-color: lawngreen;
		border-radius: 50%;
		width: 7px;
		height: 7px;
		position: relative;
		/* left: 10px; */
		top: 45px;
		left: 45px;	
	}
	.nowWatching img {
		width: 64px; 
		height: 64px; 
		padding: ${screen.width >= 800 ? '10px': '5px'}; 
		float: left;
		border: none; 
		cursor: pointer;
	}
	</style>

	<div class="nowWatching">
		<div class="headerText">👁️‍🗨️ Recent Viewers (${viewers.length} Watching Now)</div>
		${thumbs}
	</div>`
}



const onSVDispatch = (e) => {
	console.log("*** SVDispatchReceived ")
	console.log(JSON.stringify(e, null, 2))
}

//when channel_viewers events come down the socket
//we can update the viewer gallery. no need for REST calls!
const startWhosWatchingUI = (rid) => {

	$(document).off("SVDispatchReceived")
	$(document).on("SVDispatchReceived", (e) => {
		if (e.detail.type && e.detail.type == "channel_viewers") {
			var containerDiv = (screen.width >= 800 ? "#desktop-jitsi-container" : "#mobile-viewer-thumbs")
			$(containerDiv).html(getThumbnailHtml(e.detail.payload))
		}

		if (e.detail.type && e.detail.type == "channel_surfer") {
			var containerDiv = "#sidebar_channel_surfer"
			$(containerDiv).html(getChannelSurferHtml(e.detail.payload))
		}
	})

	/*
	
	Meteor.clearInterval(window["SV_NOW_WATCHING_THREAD"])
	window["SV_NOW_WATCHING_THREAD"] = 0

	updateWhosWatchingGallery(rid, containerDiv)
	window["SV_NOW_WATCHING_THREAD"] = Meteor.setInterval(() => {
		updateWhosWatchingGallery(rid,containerDiv)
	}, 10000) */
}

//Random DOM-related stuff to do when
//loading the socvid player and the socvid-specific Jisti embed
//basically stuff that is being done outside of Meteor
const initSocvidUI = (roomInstance) => {
	const { _id: rid } = roomInstance.data;

	/* iBroadcast responsive player */
	$("#the-player").height(parseInt(
		$("#the-player").width() * 9 / 16))

	$("window").on("resize", (e) => { 
		$("#the-player").height(parseInt(
			$("#the-player").width() * 9 / 16))
	})


	/* Jitsi desktop embed */

	/*
	if (screen.width >= 800){
		const domain = 'meet.jit.si';
		const options = {
			roomName: roomInstance.data.name || rid,
			width: '100%',
			height:'100%',
			parentNode: document.querySelector('#desktop-jitsi-container'),
			interfaceConfigOverride: jitsiInterfaceConfig
		};
		window["JITSI_CURRENT_ROOM"] = new JitsiMeetExternalAPI(domain, options);
	} */

	//get current+recent viewers and set update timer
	//todo: pubsub over socket.io


}
//Create a generic SocVid user object from the currently logged in user
//The SocVid servers have no idea about Meteor or the chat.socvid.net database
//and expect user data to have everything it needs for rendering 
//current viewers, who's online, and channel surfer data
const getGenericUserObject= () => {
	if (!Meteor.userId()) {
		return {
			anonymous: true,
			user_id: "ANONYMOUS",
			profile_url: "#",
			system_id: "socvid.chat",
			username: "anonymous",
			display_name: "Anonymous User",
			avatar_url: "https://chat.socvid.net/images/socvid/unknown_user.png"
		}
	} else {
		let u = Meteor.user()
		return {
			anonymous: false,
			user_id: u._id,
			profile_url: "https://chat.socvid.net/direct/"+ u.username,
			system_id: "socvid.chat",
			username: u.username,
			display_name: u.name,
			avatar_url: "https://chat.socvid.net/avatar/"+u.username
		}
	}
}

//Create a generic socvid room object
//so that external systems can render channel guides etc
//comprised of rooms from this system and many others, 
//without knowing anything about their workings
const getGenericRoomObject = (rid) => {
	const roomData = Session.get(`roomData${ rid }`);
	var roomName= roomData ? roomTypes.getRoomName(roomData.t, roomData) : '';
	if (roomName == '') {
		return {
			anonymous: true,
			channel_id: rid,
		}
	} else {
		return {
			anonymous: false,
			channel_id: rid,
			channel_type: roomData.t,
			channel_name: roomName,
			channel_url: "https://chat.socvid.net/channel/"+roomName,
			avatar_url: "https://samrahimi.com/avatars/"+roomName+".png",
		}
	}
}
const stopSocvidUserPresence = () => {
	//UserPresenceDaemon.getDefaultInstance(true, getGenericUserObject(), getGenericRoomObject(rid))
	//clearInterval(window["SV_PRESENCE"])
}
const updateSocvidUserPresence = (rid) => {

	//gets or creates the user presence monitor, gives it the latest user and room info, and starts the update thread
	var presence = UserPresenceDaemon.getDefaultInstance(true, getGenericUserObject(), getGenericRoomObject(rid))

	//DEBUG: dump the state of the user presence daemon
	console.log("*** ROOM: updated state of UserPresenceDaemon global instance, new state is below")
	//console.log(JSON.stringify(presence, null, 2))

	//We create a global instance of the Dispatcher 
	//which creates a socket connection to the SocVid Admin server
	//that we use to send user presence updates.
	//
	//At the time this code was written, there was no need to handle 
	//any incoming dispatches, but in case that need arises in the future
	//we instantiate the Dispatcher with a handler function that passes the message along 
	//to any handlers that may be listening for SVDispatchReceived on document.body
	//
	//Therefore, handlers may be added in the future without touching this code or knowing
	//anything about Dispatchers and websockets, e.g. $("body").on("SVDispatchReceived", (e) => {
	//	console.log(e.detail)
	//})

	/*
	window["SV_DISPATCH"] = new Dispatcher(
	'socvid.chat', 
	rid, 
	(message) => {
		console.log("*** SocVid WS Dispatch received in Chat Client ***")
		console.log(JSON.stringify(message))
		console.log("*** Raising body.SVDispatchReceived event ***")
		$("body").dispatchEvent(new CustomEvent("SVDispatchReceived", {
			bubbles: true,
			detail: message
		}));
	}) */

	//Every 30 seconds, tell the socvid server that the user is 
	//still on the page and therefore is watching the channel... 
	//
	//There is no need to tell the server when the user leaves the room;
	//just call clearInterval to make sure it stops sending "i'm still here" 

	/*
	window["SV_PRESENCE"] = setInterval(() => {
        
		window["SV_DISPATCH"].Dispatch(
				"user_presence", 
				{
					user: getGenericUserObject(), 
					channel: getGenericRoomObject(rid), 
					lastActivity: Date.now
				}, 
				null, 'socvid.server')
		
		console.log("*** Sent User Presence Update ***") 
		console.log(JSON.stringify({
			user: getGenericUserObject(), 
			channel: getGenericRoomObject(rid), 
			lastActivity: Date.now
		}))
		
	}, 30000) */
}

callbacks.add('enter-room', wipeFailedUploads);

const ignoreReplies = getConfig('ignoreReplies') === 'true';

Template.room.helpers({
	useNrr() {
		const useNrr = getConfig('useNrr');
		return useNrr === 'true' || useNrr !== 'false';
	},
	isTranslated() {
		const { state } = Template.instance();
		return settings.get('AutoTranslate_Enabled')
			&& (state.get('autoTranslate') === true)
			&& !!state.get('autoTranslateLanguage');
	},

	embeddedVersion() {
		return Layout.isEmbedded();
	},

	subscribed() {
		const { state } = Template.instance();
		return state.get('subscribed');
	},

	messagesHistory() {
		const { rid } = Template.instance();
		const hideMessagesOfType = [];
		settings.collection.find({ _id: /Message_HideType_.+/ }).forEach(function(record) {
			let types;
			const type = record._id.replace('Message_HideType_', '');
			switch (type) {
				case 'mute_unmute':
					types = ['user-muted', 'user-unmuted'];
					break;
				default:
					types = [type];
			}
			return types.forEach(function(type) {
				const index = hideMessagesOfType.indexOf(type);

				if ((record.value === true) && (index === -1)) {
					hideMessagesOfType.push(type);
				} else if (index > -1) {
					hideMessagesOfType.splice(index, 1);
				}
			});
		});

		const modes = ['', 'cozy', 'compact'];
		const viewMode = getUserPreference(Meteor.userId(), 'messageViewMode');
		const query = {
			rid,
			_hidden: { $ne: true },
			...(ignoreReplies || modes[viewMode] === 'compact') && { tmid: { $exists: 0 } },
		};

		if (hideMessagesOfType.length > 0) {
			query.t =				{ $nin: hideMessagesOfType };
		}

		const options = {
			sort: {
				ts: 1,
			},
		};

		return ChatMessage.find(query, options);
	},

	hasMore() {
		return RoomHistoryManager.hasMore(this._id);
	},

	hasMoreNext() {
		return RoomHistoryManager.hasMoreNext(this._id);
	},

	isLoading() {
		return RoomHistoryManager.isLoading(this._id);
	},

	windowId() {
		return `chat-window-${ this._id }`;
	},

	uploading() {
		return Session.get('uploading');
	},

	roomLeader() {
		const roles = RoomRoles.findOne({ rid: this._id, roles: 'leader', 'u._id': { $ne: Meteor.userId() } });
		if (roles) {
			const leader = Users.findOne({ _id: roles.u._id }, { fields: { status: 1, statusText: 1 } }) || {};

			return {
				...roles.u,
				name: settings.get('UI_Use_Real_Name') ? roles.u.name || roles.u.username : roles.u.username,
				status: leader.status || 'offline',
				statusDisplay: leader.statusText || t(leader.status || 'offline'),
			};
		}
	},

	chatNowLink() {
		return roomTypes.getRouteLink('d', { name: this.username });
	},

	announcement() {
		return Template.instance().state.get('announcement');
	},

	messageboxData() {
		const { sendToBottomIfNecessaryDebounced, subscription } = Template.instance();
		const { _id: rid } = this;
		const isEmbedded = Layout.isEmbedded();
		const showFormattingTips = settings.get('Message_ShowFormattingTips');

		return {
			rid,
			subscription: subscription.get(),
			isEmbedded,
			showFormattingTips: showFormattingTips && !isEmbedded,
			onInputChanged: (input) => {
				if (!chatMessages[rid]) {
					return;
				}

				chatMessages[rid].initializeInput(input, { rid });
			},
			onResize: () => sendToBottomIfNecessaryDebounced && sendToBottomIfNecessaryDebounced(),
			onKeyUp: (...args) => chatMessages[rid] && chatMessages[rid].keyup.apply(chatMessages[rid], args),
			onKeyDown: (...args) => chatMessages[rid] && chatMessages[rid].keydown.apply(chatMessages[rid], args),
			onSend: (...args) => chatMessages[rid] && chatMessages[rid].send.apply(chatMessages[rid], args),
		};
	},

	getAnnouncementStyle() {
		const { room } = Template.instance();
		if (!room) { return ''; }
		return room.announcementDetails && room.announcementDetails.style !== undefined ? room.announcementDetails.style : '';
	},
	isChannel() {
		const roomData = Session.get(`roomData${ this._id }`);
        if (!roomData) { return false; }

		return (roomData.t =='c')
	},
	roomIcon() {
		const { room } = Template.instance();
		if (!(room != null ? room.t : undefined)) { return ''; }

		const roomIcon = roomTypes.getIcon(room);

		// Remove this 'codegueira' on header redesign
		if (!roomIcon) {
			return 'at';
		}

		return roomIcon;
	},

	maxMessageLength() {
		return settings.get('Message_MaxAllowedSize');
	},

	unreadData() {
		const data = { count: Template.instance().state.get('count') };

		const room = RoomManager.getOpenedRoomByRid(this._id);
		if (room) {
			data.since = room.unreadSince.get();
		}

		return data;
	},

	containerBarsShow(unreadData, uploading) {
		const hasUnreadData = unreadData && (unreadData.count && unreadData.since);
		const isUploading = uploading && uploading.length;

		if (hasUnreadData || isUploading) {
			return 'show';
		}
	},

	formatUnreadSince() {
		if (!this.since) {
			return;
		}

		return moment(this.since).calendar(null, { sameDay: 'LT' });
	},

	flexData() {
		const flexData = {
			tabBar: Template.instance().tabBar,
			data: {
				rid: this._id,
				userDetail: Template.instance().userDetail.get(),
				groupDetail: Template.instance().groupDetail.get(),
				clearUserDetail: Template.instance().clearUserDetail,
			},
		};

		return flexData;
	},

	adminClass() {
		if (hasRole(Meteor.userId(), 'admin')) { return 'admin'; }
	},

	showToggleFavorite() {
		const { state } = Template.instace();
		return state.get('subscribed') && settings.get('Favorite_Rooms');
	},

	widescreen() {
		return window.innerWidth >= 800;
	},

	messageViewMode() {
		const viewMode = getUserPreference(Meteor.userId(), 'messageViewMode');
		const modes = ['', 'cozy', 'compact'];
		return modes[viewMode] || modes[0];
	},

	selectable() {
		return Template.instance().selectable.get();
	},

	hideUsername() {
		return getUserPreference(Meteor.userId(), 'hideUsernames') ? 'hide-usernames' : undefined;
	},

	hideAvatar() {
		return getUserPreference(Meteor.userId(), 'hideAvatars') ? 'hide-avatars' : undefined;
	},

	userCanDrop() {
		return userCanDrop(this._id);
	},

	toolbarButtons() {
		const toolbar = Session.get('toolbarButtons') || { buttons: {} };
		const buttons = Object.keys(toolbar.buttons).map((key) => ({
			id: key,
			...toolbar.buttons[key],
		}));
		return { buttons };
	},

	canPreview() {
		const { room, state } = Template.instance();

		if (room && room.t !== 'c') {
			return true;
		}

		if (settings.get('Accounts_AllowAnonymousRead') === true) {
			return true;
		}

		if (hasAllPermission('preview-c-room')) {
			return true;
		}

		return state.get('subscribed');
	},
	hideLeaderHeader() {
		return Template.instance().hideLeaderHeader.get() ? 'animated-hidden' : '';
	},
	hasLeader() {
		if (RoomRoles.findOne({ rid: this._id, roles: 'leader', 'u._id': { $ne: Meteor.userId() } }, { fields: { _id: 1 } })) {
			return 'has-leader';
		}
	},
	hasPurge() {
		const { room } = Template.instance();
		return roomHasPurge(room);
	},
	filesOnly() {
		const { room } = Template.instance();
		return roomFilesOnly(room);
	},
	excludePinned() {
		const { room } = Template.instance();
		return roomExcludePinned(room);
	},
	purgeTimeout() {
		const { room } = Template.instance();
		moment.relativeTimeThreshold('s', 60);
		moment.relativeTimeThreshold('ss', 0);
		moment.relativeTimeThreshold('m', 60);
		moment.relativeTimeThreshold('h', 24);
		moment.relativeTimeThreshold('d', 31);
		moment.relativeTimeThreshold('M', 12);

		return moment.duration(roomMaxAge(room) * 1000 * 60 * 60 * 24).humanize();
	},
	socvidPlayerUrl() {
        const roomData = Session.get(`roomData${ this._id }`);
        if (!roomData) { return ''; }

        var roomName= roomTypes.getRoomName(roomData.t, roomData);
		console.log(JSON.stringify(roomData, null, 2))
    
		return `<iframe id="the-player" src="https://samrahimi.com/client/video.html?channel=${roomName}&dev=false" allow="autoplay" style="border:0;overflow:hidden;width:100%"></iframe>`;
    },
	jistiRoomUrl() {
		const roomData = Session.get(`roomData${ this._id }`);
        if (!roomData) { return ''; }

		var roomName= roomTypes.getRoomName(roomData.t, roomData);
		

		//each room, discussion, or direct message convo
		//should have its corresponding jitsi room
		//it is recommended that the jitsi module be displayed 
		//only if actually being used. when the user tabs elsewhere 
		//the iframe should have its src set to ## to prevent bandwidth leaks
		return `https://meet.jit.si/SocVidTV-${roomName}`
	},

	messageContext,
});
let jitsiInterfaceConfig = {
    // TO FIX: this needs to be handled from SASS variables. There are some
    // methods allowing to use variables both in css and js.
    DEFAULT_BACKGROUND: '#474747',

    /**
     * Whether or not the blurred video background for large video should be
     * displayed on browsers that can support it.
     */
    DISABLE_VIDEO_BACKGROUND: false,

    INITIAL_TOOLBAR_TIMEOUT: 20000,
    TOOLBAR_TIMEOUT: 4000,
    TOOLBAR_ALWAYS_VISIBLE: false,
    DEFAULT_REMOTE_DISPLAY_NAME: 'Fellow Jitster',
    DEFAULT_LOCAL_DISPLAY_NAME: 'me',
    SHOW_JITSI_WATERMARK: true,
    JITSI_WATERMARK_LINK: 'https://jitsi.org',

    // if watermark is disabled by default, it can be shown only for guests
    SHOW_WATERMARK_FOR_GUESTS: true,
    SHOW_BRAND_WATERMARK: false,
    BRAND_WATERMARK_LINK: '',
    SHOW_POWERED_BY: false,
    SHOW_DEEP_LINKING_IMAGE: false,
    GENERATE_ROOMNAMES_ON_WELCOME_PAGE: true,
    DISPLAY_WELCOME_PAGE_CONTENT: true,
    DISPLAY_WELCOME_PAGE_TOOLBAR_ADDITIONAL_CONTENT: false,
    APP_NAME: 'Jitsi Meet',
    NATIVE_APP_NAME: 'Jitsi Meet',
    PROVIDER_NAME: 'Jitsi',
    LANG_DETECTION: false, // Allow i18n to detect the system language
    INVITATION_POWERED_BY: true,

    /**
     * If we should show authentication block in profile
     */
    AUTHENTICATION_ENABLE: true,

    /**
     * The name of the toolbar buttons to display in the toolbar. If present,
     * the button will display. Exceptions are "livestreaming" and "recording"
     * which also require being a moderator and some values in config.js to be
     * enabled. Also, the "profile" button will not display for user's with a
     * jwt.
     */
    TOOLBAR_BUTTONS: [
        'microphone', 'camera', 'closedcaptions', 'desktop', 'fullscreen',
        'fodeviceselection', 'hangup', 'profile', 'info', 'chat', 'recording',
        'livestreaming', 'etherpad', 'sharedvideo', 'settings', 'raisehand',
        'videoquality', 'filmstrip', 'invite', 'feedback', 'stats', 'shortcuts',
        'tileview', 'videobackgroundblur', 'download', 'help'
    ],

    SETTINGS_SECTIONS: [ 'devices', 'language', 'moderator', 'profile', 'calendar' ],

    // Determines how the video would fit the screen. 'both' would fit the whole
    // screen, 'height' would fit the original video height to the height of the
    // screen, 'width' would fit the original video width to the width of the
    // screen respecting ratio.
    VIDEO_LAYOUT_FIT: 'both',

    /**
     * Whether to only show the filmstrip (and hide the toolbar).
     */
    filmStripOnly: false,

    /**
     * Whether to show thumbnails in filmstrip as a column instead of as a row.
     */
    VERTICAL_FILMSTRIP: true,

    // A html text to be shown to guests on the close page, false disables it
    CLOSE_PAGE_GUEST_HINT: false,
    RANDOM_AVATAR_URL_PREFIX: false,
    RANDOM_AVATAR_URL_SUFFIX: false,
    FILM_STRIP_MAX_HEIGHT: 120,

    // Enables feedback star animation.
    ENABLE_FEEDBACK_ANIMATION: false,
    DISABLE_FOCUS_INDICATOR: false,
    DISABLE_DOMINANT_SPEAKER_INDICATOR: false,

    /**
     * Whether the speech to text transcription subtitles panel is disabled.
     * If {@code undefined}, defaults to {@code false}.
     *
     * @type {boolean}
     */
    DISABLE_TRANSCRIPTION_SUBTITLES: false,

    /**
     * Whether the ringing sound in the call/ring overlay is disabled. If
     * {@code undefined}, defaults to {@code false}.
     *
     * @type {boolean}
     */
    DISABLE_RINGING: false,
    AUDIO_LEVEL_PRIMARY_COLOR: 'rgba(255,255,255,0.4)',
    AUDIO_LEVEL_SECONDARY_COLOR: 'rgba(255,255,255,0.2)',
    POLICY_LOGO: null,
    LOCAL_THUMBNAIL_RATIO: 16 / 9, // 16:9
    REMOTE_THUMBNAIL_RATIO: 1, // 1:1
    // Documentation reference for the live streaming feature.
    LIVE_STREAMING_HELP_LINK: 'https://jitsi.org/live',

    /**
     * Whether the mobile app Jitsi Meet is to be promoted to participants
     * attempting to join a conference in a mobile Web browser. If
     * {@code undefined}, defaults to {@code true}.
     *
     * @type {boolean}
     */
    MOBILE_APP_PROMO: true,

    /**
     * Maximum coeficient of the ratio of the large video to the visible area
     * after the large video is scaled to fit the window.
     *
     * @type {number}
     */
    MAXIMUM_ZOOMING_COEFFICIENT: 1.3,

    /*
     * If indicated some of the error dialogs may point to the support URL for
     * help.
     */
    SUPPORT_URL: 'https://github.com/jitsi/jitsi-meet/issues/new',

    /**
     * Whether the connection indicator icon should hide itself based on
     * connection strength. If true, the connection indicator will remain
     * displayed while the participant has a weak connection and will hide
     * itself after the CONNECTION_INDICATOR_HIDE_TIMEOUT when the connection is
     * strong.
     *
     * @type {boolean}
     */
    CONNECTION_INDICATOR_AUTO_HIDE_ENABLED: true,

    /**
     * How long the connection indicator should remain displayed before hiding.
     * Used in conjunction with CONNECTION_INDICATOR_AUTOHIDE_ENABLED.
     *
     * @type {number}
     */
    CONNECTION_INDICATOR_AUTO_HIDE_TIMEOUT: 5000,

    /**
     * If true, hides the connection indicators completely.
     *
     * @type {boolean}
     */
    CONNECTION_INDICATOR_DISABLED: false,

    /**
     * If true, hides the video quality label indicating the resolution status
     * of the current large video.
     *
     * @type {boolean}
     */
    VIDEO_QUALITY_LABEL_DISABLED: false,

    /**
     * If true, will display recent list
     *
     * @type {boolean}
     */
    RECENT_LIST_ENABLED: true,

    // Names of browsers which should show a warning stating the current browser
    // has a suboptimal experience. Browsers which are not listed as optimal or
    // unsupported are considered suboptimal. Valid values are:
    // chrome, chromium, edge, electron, firefox, nwjs, opera, safari
    OPTIMAL_BROWSERS: [ 'chrome', 'chromium', 'firefox', 'nwjs', 'electron' ],

    // Browsers, in addition to those which do not fully support WebRTC, that
    // are not supported and should show the unsupported browser page.
    UNSUPPORTED_BROWSERS: [],

    /**
     * A UX mode where the last screen share participant is automatically
     * pinned. Valid values are the string "remote-only" so remote participants
     * get pinned but not local, otherwise any truthy value for all participants,
     * and any falsy value to disable the feature.
     *
     * Note: this mode is experimental and subject to breakage.
     */
    AUTO_PIN_LATEST_SCREEN_SHARE: 'remote-only'

    /**
     * How many columns the tile view can expand to. The respected range is
     * between 1 and 5.
     */
    // TILE_VIEW_MAX_COLUMNS: 5,

    /**
     * Specify custom URL for downloading android mobile app.
     */
    // MOBILE_DOWNLOAD_LINK_ANDROID: 'https://play.google.com/store/apps/details?id=org.jitsi.meet',

    /**
     * Specify URL for downloading ios mobile app.
     */
    // MOBILE_DOWNLOAD_LINK_IOS: 'https://itunes.apple.com/us/app/jitsi-meet/id1165103905',

    /**
     * Specify mobile app scheme for opening the app from the mobile browser.
     */
    // APP_SCHEME: 'org.jitsi.meet',

    /**
     * Specify the Android app package name.
     */
    // ANDROID_APP_PACKAGE: 'org.jitsi.meet',

    /**
     * Override the behavior of some notifications to remain displayed until
     * explicitly dismissed through a user action. The value is how long, in
     * milliseconds, those notifications should remain displayed.
     */
    // ENFORCE_NOTIFICATION_AUTO_DISMISS_TIMEOUT: 15000,

    // List of undocumented settings
    /**
     INDICATOR_FONT_SIZES
     MOBILE_DYNAMIC_LINK
     PHONE_NUMBER_REGEX
    */
};

$("document").ready(() => {
})
let isSocialSharingOpen = false;
let touchMoved = false;
let lastTouchX = null;
let lastTouchY = null;
let lastScrollTop;

export const dropzoneEvents = {
	'dragenter .dropzone'(e) {
		const types = e.originalEvent && e.originalEvent.dataTransfer && e.originalEvent.dataTransfer.types;
		if (types != null && types.length > 0 && _.every(types, (type) => type.indexOf('text/') === -1 || type.indexOf('text/uri-list') !== -1) && userCanDrop(this._id)) {
			e.currentTarget.classList.add('over');
		}
		e.stopPropagation();
	},

	'dragleave .dropzone-overlay'(e) {
		e.currentTarget.parentNode.classList.remove('over');
		e.stopPropagation();
	},

	'dragover .dropzone-overlay'(e) {
		e = e.originalEvent || e;
		if (['move', 'linkMove'].includes(e.dataTransfer.effectAllowed)) {
			e.dataTransfer.dropEffect = 'move';
		} else {
			e.dataTransfer.dropEffect = 'copy';
		}
		e.stopPropagation();
	},

	'dropped .dropzone-overlay'(event, instance) {
		event.currentTarget.parentNode.classList.remove('over');

		const e = event.originalEvent || event;

		e.stopPropagation();

		const files = (e.dataTransfer != null ? e.dataTransfer.files : undefined) || [];

		const filesToUpload = Array.from(files).map((file) => {
			Object.defineProperty(file, 'type', { value: mime.lookup(file.name) });
			return {
				file,
				name: file.name,
			};
		});

		return instance.onFile && instance.onFile(filesToUpload);
	},
};

Template.room.events({
	...dropzoneEvents,
	'click .js-follow-thread'() {
		const { msg } = messageArgs(this);
		call('followMessage', { mid: msg._id });
	},
	'click .js-unfollow-thread'() {
		const { msg } = messageArgs(this);
		call('unfollowMessage', { mid: msg._id });
	},
	'click .js-open-thread'(event) {
		event.preventDefault();
		event.stopPropagation();

		const { tabBar, subscription } = Template.instance();

		const { msg, msg: { rid, _id, tmid } } = messageArgs(this);
		const $flexTab = $('.flex-tab-container .flex-tab');
		$flexTab.attr('template', 'thread');

		tabBar.setData({
			subscription: subscription.get(),
			msg,
			rid,
			jump: tmid && tmid !== _id && _id,
			mid: tmid || _id,
			label: 'Threads',
			icon: 'thread',
		});

		tabBar.open('thread');
	},
	'click .js-reply-broadcast'() {
		const { msg } = messageArgs(this);
		roomTypes.openRouteLink('d', { name: msg.u.username }, { ...FlowRouter.current().queryParams, reply: msg._id });
	},
	'click, touchend'(e, t) {
		setTimeout(() => t.sendToBottomIfNecessaryDebounced && t.sendToBottomIfNecessaryDebounced(), 100);
	},

	'click .messages-container-main'() {
		if (Template.instance().tabBar.getState() === 'opened' && getUserPreference(Meteor.userId(), 'hideFlexTab')) {
			Template.instance().tabBar.close();
		}
	},

	'touchstart .message'(e, t) {
		const { touches } = e.originalEvent;
		if (touches && touches.length) {
			lastTouchX = touches[0].pageX;
			lastTouchY = touches[0].pagey;
		}
		touchMoved = false;
		isSocialSharingOpen = false;
		if (e.originalEvent.touches.length !== 1) {
			return;
		}

		if ($(e.currentTarget).hasClass('system')) {
			return;
		}

		if (e.target && (e.target.nodeName === 'AUDIO')) {
			return;
		}

		if (e.target && (e.target.nodeName === 'A') && isURL(e.target.getAttribute('href'))) {
			e.preventDefault();
			e.stopPropagation();
		}

		const doLongTouch = () => {
			mountPopover(e, t, this);
		};

		clearTimeout(t.touchtime);
		t.touchtime = setTimeout(doLongTouch, 500);
	},

	'click .message img'(e, t) {
		clearTimeout(t.touchtime);
		if ((isSocialSharingOpen === true) || (touchMoved === true)) {
			e.preventDefault();
			e.stopPropagation();
		}
	},

	'touchend .message'(e, t) {
		clearTimeout(t.touchtime);
		if (isSocialSharingOpen === true) {
			e.preventDefault();
			e.stopPropagation();
			return;
		}

		if (e.target && (e.target.nodeName === 'A') && isURL(e.target.getAttribute('href'))) {
			if (touchMoved === true) {
				e.preventDefault();
				e.stopPropagation();
				return;
			}

			window.open(e.target.href);
		}
	},

	'touchmove .message'(e, t) {
		const { touches } = e.originalEvent;
		if (touches && touches.length) {
			const deltaX = Math.abs(lastTouchX - touches[0].pageX);
			const deltaY = Math.abs(lastTouchY - touches[0].pageY);
			if (deltaX > 5 || deltaY > 5) {
				touchMoved = true;
			}
		}
		clearTimeout(t.touchtime);
	},

	'touchcancel .message'(e, t) {
		clearTimeout(t.touchtime);
	},

	'click .upload-progress-close'(e) {
		e.preventDefault();
		Session.set(`uploading-cancel-${ this.id }`, true);
	},

	'click .unread-bar > button.mark-read'() {
		readMessage.readNow(true);
	},

	'click .unread-bar > button.jump-to'(e, t) {
		const { _id } = t.data;
		const room = RoomHistoryManager.getRoom(_id);
		let message = room && room.firstUnread.get();
		if (!message) {
			const subscription = Subscriptions.findOne({ rid: _id });
			message = ChatMessage.find({ rid: _id, ts: { $gt: subscription != null ? subscription.ls : undefined } }, { sort: { ts: 1 }, limit: 1 }).fetch()[0];
		}
		RoomHistoryManager.getSurroundingMessages(message, 50);
	},

	'click .toggle-favorite'(event) {
		event.stopPropagation();
		event.preventDefault();
		Meteor.call('toggleFavorite', this._id, !$('i', event.currentTarget).hasClass('favorite-room'), function(err) {
			if (err) {
				handleError(err);
			}
		});
	},

	'click .user-image, click .rc-member-list__user'(e, instance) {
		if (!Meteor.userId()) {
			return;
		}

		openProfileTabOrOpenDM(e, instance, this.user.username);
	},

	'click .user-card-message'(e, instance) {
		const { msg } = messageArgs(this);
		if (!Meteor.userId()) {
			return;
		}

		const { username } = msg.u;

		openProfileTabOrOpenDM(e, instance, username);
	},

	'scroll .wrapper': _.throttle(function(e, t) {
		lazyloadtick();

		const $roomLeader = $('.room-leader');
		if ($roomLeader.length) {
			if (e.target.scrollTop < lastScrollTop) {
				t.hideLeaderHeader.set(false);
			} else if (t.isAtBottom(100) === false && e.target.scrollTop > $roomLeader.height()) {
				t.hideLeaderHeader.set(true);
			}
		}
		lastScrollTop = e.target.scrollTop;
		const height = e.target.clientHeight;
		const isLoading = RoomHistoryManager.isLoading(this._id);
		const hasMore = RoomHistoryManager.hasMore(this._id);
		const hasMoreNext = RoomHistoryManager.hasMoreNext(this._id);

		if ((isLoading === false && hasMore === true) || hasMoreNext === true) {
			if (hasMore === true && lastScrollTop <= height / 3) {
				RoomHistoryManager.getMore(this._id);
			} else if (hasMoreNext === true && Math.ceil(lastScrollTop) >= e.target.scrollHeight - height) {
				RoomHistoryManager.getMoreNext(this._id);
			}
		}
	}, 500),

	'click .new-message'(event, instance) {
		instance.atBottom = true;
		chatMessages[RoomManager.openedRoom].input.focus();
	},
	'click .message-actions__menu'(e, i) {
		const messageContext = messageArgs(this);
		const { msg: message, context: ctx } = messageContext;
		const context = ctx || message.context || message.actionContext || 'message';

		const allItems = MessageAction.getButtons(messageContext, context, 'menu').map((item) => ({
			icon: item.icon,
			name: t(item.label),
			type: 'message-action',
			id: item.id,
			modifier: item.color,
		}));

		const itemsBelowDivider = [
			'delete-message',
			'report-message',
		];
		const [items, alertsItem] = allItems.reduce((result, value) => { result[itemsBelowDivider.includes(value.id) ? 1 : 0].push(value); return result; }, [[], []]);
		const groups = [{ items }];

		if (alertsItem.length) {
			groups.push({ items: alertsItem });
		}
		const config = {
			columns: [
				{
					groups,
				},
			],
			instance: i,
			data: this,
			currentTarget: e.currentTarget,
			activeElement: $(e.currentTarget).parents('.message')[0],
			onRendered: () => new Clipboard('.rc-popover__item'),
		};

		popover.open(config);
	},
	'click .time a'(e) {
		e.preventDefault();
		const { msg } = messageArgs(this);
		const repliedMessageId = msg.attachments[0].message_link.split('?msg=')[1];
		FlowRouter.go(FlowRouter.current().context.pathname, null, { msg: repliedMessageId, hash: Random.id() });
	},
	'click .mention-link'(e, instance) {
		if (!Meteor.userId()) {
			return;
		}

		const { currentTarget: { dataset: { channel, group, username } } } = e;

		if (channel) {
			if (Layout.isEmbedded()) {
				fireGlobalEvent('click-mention-link', { path: FlowRouter.path('channel', { name: channel }), channel });
			}
			FlowRouter.goToRoomById(channel);
			return;
		}

		if (group) {
			e.stopPropagation();
			e.preventDefault();
			openMembersListTab(instance, group);
			return;
		}

		if (username) {
			openProfileTabOrOpenDM(e, instance, username);
		}
	},

	'click .image-to-download'(event) {
		const { msg } = messageArgs(this);
		ChatMessage.update({ _id: msg._id, 'urls.url': $(event.currentTarget).data('url') }, { $set: { 'urls.$.downloadImages': true } });
		ChatMessage.update({ _id: msg._id, 'attachments.image_url': $(event.currentTarget).data('url') }, { $set: { 'attachments.$.downloadImages': true } });
	},

	'click .collapse-switch'(e) {
		const { msg } = messageArgs(this);
		const index = $(e.currentTarget).data('index');
		const collapsed = $(e.currentTarget).data('collapsed');
		const id = msg._id;

		if ((msg != null ? msg.attachments : undefined) != null) {
			ChatMessage.update({ _id: id }, { $set: { [`attachments.${ index }.collapsed`]: !collapsed } });
		}

		if ((msg != null ? msg.urls : undefined) != null) {
			ChatMessage.update({ _id: id }, { $set: { [`urls.${ index }.collapsed`]: !collapsed } });
		}
	},
	'load img'(e, template) {
		return typeof template.sendToBottomIfNecessary === 'function' ? template.sendToBottomIfNecessary() : undefined;
	},

	'click .jump-recent button'(e, template) {
		e.preventDefault();
		template.atBottom = true;
		RoomHistoryManager.clear(template && template.data && template.data._id);
	},

	'click .message'(e, template) {
		if (template.selectable.get()) {
			(document.selection != null ? document.selection.empty() : undefined) || (typeof window.getSelection === 'function' ? window.getSelection().removeAllRanges() : undefined);
			const data = Blaze.getData(e.currentTarget);
			const { msg: { _id } } = messageArgs(data);

			if (!template.selectablePointer) {
				template.selectablePointer = _id;
			}

			if (!e.shiftKey) {
				template.selectedMessages = template.getSelectedMessages();
				template.selectedRange = [];
				template.selectablePointer = _id;
			}

			template.selectMessages(_id);

			const selectedMessages = $('.messages-box .message.selected').map((i, message) => message.id);
			const removeClass = _.difference(selectedMessages, template.getSelectedMessages());
			const addClass = _.difference(template.getSelectedMessages(), selectedMessages);
			removeClass.forEach((message) => $(`.messages-box #${ message }`).removeClass('selected'));
			addClass.forEach((message) => $(`.messages-box #${ message }`).addClass('selected'));
		}
	},
	'click .announcement'() {
		const roomData = Session.get(`roomData${ this._id }`);
		if (!roomData) { return false; }
		if (roomData.announcementDetails != null && roomData.announcementDetails.callback != null) {
			return callbacks.run(roomData.announcementDetails.callback, this._id);
		}

		modal.open({
			title: t('Announcement'),
			text: renderMessageBody({ msg: roomData.announcement }),
			html: true,
			showConfirmButton: false,
			showCancelButton: true,
			cancelButtonText: t('Close'),
		});
	},
	'click .toggle-hidden'(e) {
		const id = e.currentTarget.dataset.message;
		document.querySelector(`#${ id }`).classList.toggle('message--ignored');
	},
	async 'click .js-actionButton-sendMessage'(event, instance) {
		const rid = instance.data._id;
		const msg = event.currentTarget.value;
		let msgObject = { _id: Random.id(), rid, msg };
		if (!msg) {
			return;
		}

		msgObject = await promises.run('onClientBeforeSendMessage', msgObject);

		const _chatMessages = chatMessages[rid];
		if (_chatMessages && await _chatMessages.processSlashCommand(msgObject)) {
			return;
		}

		await call('sendMessage', msgObject);
	},
	'click .js-actionButton-respondWithMessage'(event, instance) {
		const rid = instance.data._id;
		const msg = event.currentTarget.value;
		if (!msg) {
			return;
		}

		const { input } = chatMessages[rid];
		input.value = msg;
		input.focus();
	},
	'click .js-navigate-to-discussion'(event) {
		event.preventDefault();
		const { msg: { drid } } = messageArgs(this);
		FlowRouter.goToRoomById(drid);
	},
});


Template.room.onCreated(function() {
	// this.scrollOnBottom = true
	// this.typing = new msgTyping this.data._id

	lazyloadtick();
	const rid = this.data._id;

	this.onFile = (filesToUpload) => {
		fileUpload(filesToUpload, chatMessages[rid].input, { rid });
	};

	this.rid = rid;

	this.subscription = new ReactiveVar();
	this.state = new ReactiveDict();

	this.autorun(() => {
		const rid = Template.currentData()._id;
		this.state.set('announcement', Rooms.findOne({ _id: rid }, { fields: { announcement: 1 } }).announcement);
	});

	this.autorun(() => {
		const subscription = Subscriptions.findOne({ rid });
		this.subscription.set(subscription);
		this.state.set({
			subscribed: !!subscription,
			autoTranslate: subscription && subscription.autoTranslate,
			autoTranslateLanguage: subscription && subscription.autoTranslateLanguage,
		});
	});

	this.showUsersOffline = new ReactiveVar(false);
	this.atBottom = !FlowRouter.getQueryParam('msg');
	this.unreadCount = new ReactiveVar(0);

	this.selectable = new ReactiveVar(false);
	this.selectedMessages = [];
	this.selectedRange = [];
	this.selectablePointer = null;

	this.flexTemplate = new ReactiveVar();

	this.userDetail = new ReactiveVar(FlowRouter.getParam('username'));
	this.groupDetail = new ReactiveVar();

	this.tabBar = new RocketChatTabBar();
	this.tabBar.showGroup(FlowRouter.current().route.name);

	this.hideLeaderHeader = new ReactiveVar(false);

	this.resetSelection = (enabled) => {
		this.selectable.set(enabled);
		$('.messages-box .message.selected').removeClass('selected');
		this.selectedMessages = [];
		this.selectedRange = [];
		this.selectablePointer = null;
	};

	this.selectMessages = (to) => {
		if ((this.selectablePointer === to) && (this.selectedRange.length > 0)) {
			this.selectedRange = [];
		} else {
			const message1 = ChatMessage.findOne(this.selectablePointer);
			const message2 = ChatMessage.findOne(to);

			const minTs = _.min([message1.ts, message2.ts]);
			const maxTs = _.max([message1.ts, message2.ts]);

			this.selectedRange = _.pluck(ChatMessage.find({ rid: message1.rid, ts: { $gte: minTs, $lte: maxTs } }).fetch(), '_id');
		}
	};

	this.getSelectedMessages = () => {
		let previewMessages;
		const messages = this.selectedMessages;
		let addMessages = false;
		for (const message of Array.from(this.selectedRange)) {
			if (messages.indexOf(message) === -1) {
				addMessages = true;
				break;
			}
		}

		if (addMessages) {
			previewMessages = _.compact(_.uniq(this.selectedMessages.concat(this.selectedRange)));
		} else {
			previewMessages = _.compact(_.difference(this.selectedMessages, this.selectedRange));
		}

		return previewMessages;
	};

	this.setUserDetail = (username) => {
		this.userDetail.set(username);
	};

	this.clearUserDetail = () => {
		this.userDetail.set(null);
	};

	Meteor.call('getRoomRoles', this.data._id, function(error, results) {
		if (error) {
			handleError(error);
		}

		return Array.from(results).forEach((record) => {
			delete record._id;
			RoomRoles.upsert({ rid: record.rid, 'u._id': record.u._id }, record);
		});
	});

	this.rolesObserve = RoomRoles.find({ rid: this.data._id }).observe({
		added: (role) => {
			if (!role.u || !role.u._id) {
				return;
			}
			ChatMessage.update({ rid: this.data._id, 'u._id': role.u._id }, { $addToSet: { roles: role._id } }, { multi: true });
		}, // Update message to re-render DOM
		changed: (role) => {
			if (!role.u || !role.u._id) {
				return;
			}
			ChatMessage.update({ rid: this.data._id, 'u._id': role.u._id }, { $inc: { rerender: 1 } }, { multi: true });
		}, // Update message to re-render DOM
		removed: (role) => {
			if (!role.u || !role.u._id) {
				return;
			}
			ChatMessage.update({ rid: this.data._id, 'u._id': role.u._id }, { $pull: { roles: role._id } }, { multi: true });
		},
	});

	this.sendToBottomIfNecessary = () => {};
}); // Update message to re-render DOM

Template.room.onDestroyed(function() {
	if (this.messageObserver) {
		this.messageObserver.stop();
	}
	if (this.rolesObserve) {
		this.rolesObserve.stop();
	}

	stopSocvidUserPresence();

	readMessage.off(this.data._id);

	window.removeEventListener('resize', this.onWindowResize);

	const chatMessage = chatMessages[this.data._id];
	return chatMessage.onDestroyed && chatMessage.onDestroyed(this.data._id);
});

Template.room.onRendered(function() {
	const { _id: rid } = this.data;

	if (!chatMessages[rid]) {
		chatMessages[rid] = new ChatMessages();
	}
	chatMessages[rid].initializeWrapper(this.find('.wrapper'));
	chatMessages[rid].initializeInput(this.find('.js-input-message'), { rid });

	const wrapper = this.find('.wrapper');
	const wrapperUl = this.find('.wrapper > ul');
	const newMessage = this.find('.new-message');

	const template = this;

	const messageBox = $('.messages-box');

	template.isAtBottom = function(scrollThreshold = 0) {
		if (wrapper.scrollTop + scrollThreshold >= wrapper.scrollHeight - wrapper.clientHeight) {
			newMessage.className = 'new-message background-primary-action-color color-content-background-color not';
			return true;
		}
		return false;
	};

	template.sendToBottom = function() {
		wrapper.scrollTop = wrapper.scrollHeight - wrapper.clientHeight;
		newMessage.className = 'new-message background-primary-action-color color-content-background-color not';
	};

	template.checkIfScrollIsAtBottom = function() {
		template.atBottom = template.isAtBottom(100);
	};

	template.sendToBottomIfNecessary = function() {
		if (template.atBottom === true && template.isAtBottom() !== true) {
			template.sendToBottom();
		}

		lazyloadtick();
	};

	template.sendToBottomIfNecessaryDebounced = _.debounce(template.sendToBottomIfNecessary, 10);

	template.sendToBottomIfNecessary();

	if (window.MutationObserver) {
		const observer = new MutationObserver(() => template.sendToBottomIfNecessaryDebounced());

		observer.observe(wrapperUl, { childList: true });
	} else {
		wrapperUl.addEventListener('DOMSubtreeModified', () => template.sendToBottomIfNecessaryDebounced());
	}
	// observer.disconnect()

	template.onWindowResize = () =>
		Meteor.defer(() => template.sendToBottomIfNecessaryDebounced());
	window.addEventListener('resize', template.onWindowResize);

	const wheelHandler = (() => {
		const fn = _.throttle(function() {
			template.checkIfScrollIsAtBottom();
		}, 50);
		return () => {
			template.atBottom = false;
			fn();
		};
	})();
	wrapper.addEventListener('mousewheel', wheelHandler);

	wrapper.addEventListener('wheel', wheelHandler);

	wrapper.addEventListener('touchstart', () => { template.atBottom = false; });

	wrapper.addEventListener('touchend', function() {
		template.checkIfScrollIsAtBottom();
		setTimeout(() => template.checkIfScrollIsAtBottom(), 1000);
		setTimeout(() => template.checkIfScrollIsAtBottom(), 2000);
	});

	wrapper.addEventListener('scroll', wheelHandler);

	lastScrollTop = $('.messages-box .wrapper').scrollTop();

	const rtl = $('html').hasClass('rtl');

	//do a bunch of hacky shit required to setup the video player etc
	initSocvidUI(this);	

	//inform the user presence module that we've loaded a new channel
	//the delay is needed so that the browser can finish loading the page 
	//and provide a correct location.href when asked by the user presence updater
	Meteor.setTimeout(() => {
		startWhosWatchingUI(rid)
		updateSocvidUserPresence(rid);
	}, 2000)	

	const getElementFromPoint = function(topOffset = 0) {
		const messageBoxOffset = messageBox.offset();

		let element;
		if (rtl) {
			element = document.elementFromPoint((messageBoxOffset.left + messageBox.width()) - 1, messageBoxOffset.top + topOffset + 1);
		} else {
			element = document.elementFromPoint(messageBoxOffset.left + 1, messageBoxOffset.top + topOffset + 1);
		}

		if (element && element.classList.contains('message')) {
			return element;
		}
	};

	const updateUnreadCount = _.throttle(() => {
		Tracker.afterFlush(() => {
			const lastInvisibleMessageOnScreen = getElementFromPoint(0) || getElementFromPoint(20) || getElementFromPoint(40);

			if (!lastInvisibleMessageOnScreen || !lastInvisibleMessageOnScreen.id) {
				return this.unreadCount.set(0);
			}

			const lastMessage = ChatMessage.findOne(lastInvisibleMessageOnScreen.id);
			if (!lastMessage) {
				return this.unreadCount.set(0);
			}

			this.state.set('lastMessage', lastMessage.ts);
		});
	}, 300);

	this.autorun(() => {
		const subscription = Subscriptions.findOne({ rid }, { fields: { alert: 1, unread: 1 } });
		readMessage.read();
		return subscription && (subscription.alert || subscription.unread) && readMessage.refreshUnreadMark(rid);
	});

	this.autorun(() => {
		const lastMessage = this.state.get('lastMessage');

		const subscription = Subscriptions.findOne({ rid }, { fields: { ls: 1 } });
		if (!subscription) {
			this.unreadCount.set(0);
			return;
		}

		const count = ChatMessage.find({ rid, ts: { $lte: lastMessage, $gt: subscription && subscription.ls } }).count();

		this.unreadCount.set(count);
	});


	this.autorun(() => {
		const count = RoomHistoryManager.getRoom(rid).unreadNotLoaded.get() + this.unreadCount.get();
		this.state.set('count', count);
	});


	this.autorun(() => {
		Rooms.findOne(rid);
		const count = this.state.get('count');
		if (count === 0) {
			return readMessage.read();
		}
		readMessage.refreshUnreadMark(rid);
	});

	readMessage.on(template.data._id, () => this.unreadCount.set(0));

	wrapper.addEventListener('scroll', updateUnreadCount);
	// salva a data da renderização para exibir alertas de novas mensagens
	$.data(this.firstNode, 'renderedAt', new Date());

	const webrtc = WebRTC.getInstanceByRoomId(template.data._id);
	if (webrtc) {
		this.autorun(() => {
			const remoteItems = webrtc.remoteItems.get();
			if (remoteItems && remoteItems.length > 0) {
				this.tabBar.setTemplate('membersList');
				this.tabBar.open();
			}

			if (webrtc.localUrl.get()) {
				this.tabBar.setTemplate('membersList');
				this.tabBar.open();
			}
		});
	}
	callbacks.add('streamMessage', (msg) => {
		if (rid !== msg.rid || msg.editedAt) {
			return;
		}
		if (!template.isAtBottom()) {
			newMessage.classList.remove('not');
		}
	});

	this.autorun(function() {
		if (template.data._id !== RoomManager.openedRoom) {
			return;
		}

		const room = Rooms.findOne({ _id: template.data._id });
		if (!room) {
			FlowRouter.go('home');
		}
	});
});

callbacks.add('enter-room', (sub) => {
	const isAReplyInDMFromChannel = FlowRouter.getQueryParam('reply') && sub.t === 'd';
	if (isAReplyInDMFromChannel && chatMessages[sub.rid]) {
		chatMessages[sub.rid].restoreReplies();
	}
	readMessage.refreshUnreadMark(sub.rid);
});
