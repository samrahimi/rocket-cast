//ibroadcast player options for rooms
import { Migrations } from '../../../app/migrations';
import { Rooms, Subscriptions } from '../../../app/models';

Migrations.add({
	version: 167,
	up() {
		Rooms.find({ t: 'c', ibroadcastEnabled: { $exists: false }}).forEach(function(room) {
			Rooms.update({ _id: room._id }, {
				$set: {
                    ibroadcastEnabled: true,
                    ibroadcastRadioView: false
				},
			});
			Subscriptions.update({ rid: room._id }, {
				$set: {
                    ibroadcastEnabled: true,
                    ibroadcastRadioView: false
				},
			}, { multi: true });
		});
	},
});
