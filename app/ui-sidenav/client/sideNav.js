import { Meteor } from 'meteor/meteor';
import { ReactiveVar } from 'meteor/reactive-var';
import { FlowRouter } from 'meteor/kadira:flow-router';
import { Template } from 'meteor/templating';

import { lazyloadtick } from '../../lazy-load';
import { SideNav, menu } from '../../ui-utils';
import { settings } from '../../settings';
import { roomTypes, getUserPreference } from '../../utils';
import { Users } from '../../models';

Template.sideNav.helpers({
	flexTemplate() {
		return SideNav.getFlex().template;
	},

	flexData() {
		return SideNav.getFlex().data;
	},

	footer() {
		return String(settings.get('Layout_Sidenav_Footer')).trim();
	},
	roomTypeChannelsOnly() {
		return roomTypes.getTypes().filter(t => t.identifier == 'c').map((roomType) => ({
			id: roomType.identifier,
			template: roomType.customTemplate || 'roomList',
			data: {
				header: roomType.header,
				identifier: roomType.identifier,
				isCombined: roomType.isCombined,
				label: roomType.label,
			},
		}));
	},
	roomType() {
		//The all channels room type is returned in a separate array, roomTypeChannelsOnly (above)
		return roomTypes.getTypes().map((roomType) => ({
			id: roomType.identifier,
			template: roomType.customTemplate || 'roomList',
			data: {
				header: roomType.header,
				identifier: roomType.identifier,
				isCombined: roomType.isCombined,
				label: roomType.label,
			},
		}));
	},

	loggedInUser() {
		return !!Meteor.userId();
	},

	sidebarViewMode() {
		const viewMode = getUserPreference(Meteor.userId(), 'sidebarViewMode');
		return viewMode || 'condensed';
	},

	sidebarHideAvatar() {
		return getUserPreference(Meteor.userId(), 'sidebarHideAvatar');
	},
	allChannels() {
		return Template.instance().allChannels.get()
	}
});

Template.sideNav.events({
	'click .close-flex'() {
		return SideNav.closeFlex();
	},

	'click .arrow'() {
		return SideNav.toggleCurrent();
	},

	'scroll .rooms-list'() {
		lazyloadtick();
		return menu.updateUnreadBars();
	},

	'dropped .sidebar'(e) {
		return e.preventDefault();
	},
	'mouseenter .sidebar-item__link'(e) {
		const element = e.currentTarget;
		setTimeout(() => {
			const ellipsedElement = element.querySelector('.sidebar-item__ellipsis');
			const isTextEllipsed = ellipsedElement.offsetWidth < ellipsedElement.scrollWidth;

			if (isTextEllipsed) {
				element.setAttribute('title', element.getAttribute('aria-label'));
			} else {
				element.removeAttribute('title');
			}
		}, 0);
	},
});

const redirectToDefaultChannelIfNeeded = () => {
	if (!Meteor.userId()) {
		FlowRouter.go(`/login`);
	}
	/*
	const currentRouteState = FlowRouter.current();
	const needToBeRedirect = ['/', '/home'];
	const firstChannelAfterLogin = settings.get('First_Channel_After_Login');
	const room = roomTypes.findRoom('c', firstChannelAfterLogin, Meteor.userId());
	if (room && room._id && needToBeRedirect.includes(currentRouteState.path)) {
		FlowRouter.go(`/channel/${ firstChannelAfterLogin }`);
	} */
};

const listenForRouteChange = ((router, onRouteChange) => {
	onRouteChange(router.getRouteName())
})

const useMobileStyling = () => {
	return window.innerWidth < 800
}

const showTab= (roomType) => {
	var groupSelector = '.channel-tab'
	var selector=`.${roomType}-tab` //d-tab, all-channels-tab, f-tab, popular-channels-tab

	$(groupSelector).removeClass("active")
	$(groupSelector+selector).addClass("active")

	$(".tab-link").removeClass("current")
	$(".tab-link[data-id="+roomType+"]").addClass("current")
}

const getChannelSurferViewerString = (channel) => {
	var html = ''
	   channel.currentViewers.forEach((viewer) => { 
		   html += 
`<img data-name="${viewer.username}" alt="${viewer.display_name}" class="channel_surfer_minithumb" src="${viewer.avatar_url}"  /> &nbsp;`})

   return html;
}
const getChannelSurferHtml = (channels, showViewers = true) => {
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

						   <div class="sidebar-item__message-bottom large-thumb-second-line" style="align-items:flex-start">
						    ${channel.topic ? channel.topic : 'Another great channel on the Social Video Network'}
					   	   </div>
					   </div>	
				   </div>


			   </a>
		   </li>
		   `})

	   return html
}


const initDiscoveryUi = () => {
	//1. Listen for channel surfer dispatches over TRIP and render them as they come
	
	//This is being handled in room.js onrender....
	//stupid place for it but it's not breaking things for mvp

	/*
	if (!window["CHANNEL_SURFER_LOADED"]) {
		$(document).on("SVDispatchReceived", (e) => {
			if (e.detail.type && e.detail.type == "channel_viewers") {
				$(".activeUserThumbs").html(getThumbnailHtml(e.detail.payload, roomInstance))
			}

			if (e.detail.type && e.detail.type == "channel_surfer") {
				var containerDiv = "#sidebar_channel_surfer"

				//render the channels with mini-thumbs of latest viewers... 
				$(containerDiv).html(getChannelSurferHtml(e.detail.payload, true))
				window["CHANNEL_SURFER_LOADED"] = true //so we don't re-bind the event
			}
		})
	} */

	//2. Get a list of all channels from the back end api, and render it once
	var authHeaders =  {'X-Auth-Token': 'VnEl0D4qFue-gobokfNvImOZd16DeYKIEvNxv6Ms69h', 'X-User-ID': 'F6tvjFaf8P2qkMAwJ'}//if wanting to avoid the meteor back-end
	var apiUrl = '/api/v1/channels.list?count=0' //TODO: page this, don't get all!

	$.ajax({
		url: apiUrl,
		headers: authHeaders
	}).done((data) => {
		console.log("sideNav 230: Got all channels from API, will render")
		console.log(JSON.stringify(data, null, 2))

		//It expects an array of CHANNELS in TRIP format 
		//(only the channel_name field is required ATM)
		let tripData = data.channels.filter((c) => c.t && c.t =='c')
		.map((c) => {
			return {channel_name: c.name, topic: c.topic};
		})


		var containerDiv = "#sidebar_all_channels"
		$(containerDiv).html(getChannelSurferHtml(tripData, false))
		$(".all-channels-count").html(tripData.length)

		window["ALL_CHANNELS_LOADED"] = true //so we don't re-bind the event

	})

}

Template.sideNav.onRendered(function() {
	SideNav.init();
	menu.init();
	lazyloadtick();
	redirectToDefaultChannelIfNeeded();

	initDiscoveryUi(); //start the channel surfer

	$(".tab-link").on("click", (event) => {
		showTab($(event.currentTarget).attr("data-id"))
		return false;
	})


	return Meteor.defer(() => menu.updateUnreadBars());
});

Template.sideNav.helpers({
	isMobile() {
		return useMobileStyling();
	}
})

Template.sideNav.onCreated(function() {
	this.groupedByType = new ReactiveVar(false);
	this.showHeader = new ReactiveVar(false);
	this.pageHasSidebar = new ReactiveVar(true);
	this.allChannels = new ReactiveVar([]);
	
		
	this.autorun(() => {
		/*
		setInterval(() => {
			if (!useMobileStyling()) {
				console.log(`Template.sideNav: ${FlowRouter.getRouteName()}`)
				if (FlowRouter.getRouteName() == 'channel') {
					$(".sideNav").hide()
				} else {
					$(".sideNav").show()
				}	
			}
		}, 50) */

		const user = Users.findOne(Meteor.userId(), {
			fields: {
				'settings.preferences.sidebarGroupByType': 1,
			},
		});
		const userPref = getUserPreference(user, 'sidebarGroupByType');
		this.groupedByType.set(userPref || settings.get('UI_Group_Channels_By_Type'));
	});
});
