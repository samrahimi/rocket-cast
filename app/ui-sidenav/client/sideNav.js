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


Template.sideNav.onRendered(function() {
	SideNav.init();
	menu.init();
	lazyloadtick();
	redirectToDefaultChannelIfNeeded();

	var authHeaders =  {'X-Auth-Token': 'VnEl0D4qFue-gobokfNvImOZd16DeYKIEvNxv6Ms69h', 'X-User-ID': 'F6tvjFaf8P2qkMAwJ'}//if wanting to avoid the meteor back-end
	var apiUrl = '/api/v1/directory'

	$.ajax({
		url: apiUrl,
		headers: authHeaders
	}).done((data) => {
		this.allChannels.set(data)
		console.log("sideNav 134: Set allChannels")
		console.log(JSON.stringify(data, null, 2))
	})

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
