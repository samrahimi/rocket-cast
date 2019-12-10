import { Meteor } from 'meteor/meteor';
import { ReactiveVar } from 'meteor/reactive-var';
import { FlowRouter } from 'meteor/kadira:flow-router';
import { Template } from 'meteor/templating';

import { popover, AccountBox, menu, SideNav, modal } from '../../ui-utils';
import { t, getUserPreference, handleError } from '../../utils';
import { callbacks } from '../../callbacks';
import { settings } from '../../settings';
import { hasAtLeastOnePermission } from '../../authorization';
import { userStatus } from '../../user-status';

const setStatus = (status, statusText) => {
	AccountBox.setStatus(status, statusText);
	callbacks.run('userStatusManuallySet', status);
	popover.close();
};

const viewModeIcon = {
	extended: 'th-list',
	medium: 'list',
	condensed: 'list-alt',
};

const extendedViewOption = (user) => {
	if (settings.get('Store_Last_Message')) {
		return {
			icon: viewModeIcon.extended,
			name: t('Extended'),
			modifier: getUserPreference(user, 'sidebarViewMode') === 'extended' ? 'bold' : null,
			action: () => {
				Meteor.call('saveUserPreferences', { sidebarViewMode: 'extended' }, function(error) {
					if (error) {
						return handleError(error);
					}
				});
			},
		};
	}
};

const showToolbar = new ReactiveVar(false);

export const toolbarSearch = {
	shortcut: false,
	show(fromShortcut) {
		menu.open();
		showToolbar.set(true);
		this.shortcut = fromShortcut;
	},
	close() {
		showToolbar.set(false);
		if (this.shortcut) {
			menu.close();
		}
	},
};
/*
const showTab= (roomType) => {
	var groupSelector = '.channel-tab'
	var selector=`${roomType}-tab` //d-tab, all-channels-tab, f-tab, popular-channels-tab

	$(groupSelector).removeClass("active")
	$(groupSelector+selector).addClass("active")
} */

const toolbarButtons = (user) => [
{
		name: 'Popular Right Now',
		icon: 'eye',
		action: () => {
			showTab('popular-channels')
		},
},

{
	name: 'All Channels',
	icon: 'discover',
	action: () => {
		showTab('all-channels')
	},
},

{
	name: 'Favorites',
	icon: 'star-filled',
	action: () => {
		showTab('f')
	},
},	
{
	name: 'Inbox',
	icon: 'chat',
	action: () => {
		showTab('d'); //DMs
	}
} ]; 
Template.sidebarFooter.helpers({
	mainNav() {
		return this.overlay != null;

	},
	myUserInfo() {
		const id = Meteor.userId();

		if (id == null && settings.get('Accounts_AllowAnonymousRead')) {
			return {
				username: 'anonymous',
				status: 'online',
			};
		}
		return id && Meteor.users.findOne(id, { fields: {
			username: 1, status: 1, statusText: 1,
		} });
	},
	toolbarButtons() {
		return toolbarButtons(Meteor.userId()).filter((button) => !button.condition || button.condition());
	},
	showToolbar() {
		return showToolbar.get();
	},
});

Template.sidebarFooter.events({
	'click .js-button'(e) {
		if (document.activeElement === e.currentTarget) {
			e.currentTarget.blur();
		}
		return this.action && this.action.apply(this, [e]);
	},
});
