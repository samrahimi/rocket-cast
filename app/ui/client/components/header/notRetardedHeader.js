import { Template } from 'meteor/templating';

import { TabBar, fireGlobalEvent } from '../../../../ui-utils';
import './notRetardedHeader.html';

Template.notRetardedHeader.helpers({
	back() {
		return Template.instance().data.back;
	},
	buttons() {
		return TabBar.getButtons();
	},
});

Template.notRetardedHeader.events({
	'click .iframe-toolbar .js-iframe-action'(e) {
		fireGlobalEvent('click-toolbar-button', { id: this.id });
		e.currentTarget.querySelector('button').blur();
		return false;
	},
});
