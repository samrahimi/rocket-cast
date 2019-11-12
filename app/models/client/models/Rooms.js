//A barebones ORM for Meteor Mongo... 
//If the built in methods don't do it
//you can access the underlying collection
//rooms = new DBCollection('rooms')
//rooms.model.aggregate(... standard mongo syntax ...)

import { Base } from './_Base';

export class Rooms extends Base {
	constructor() {
		super();
		this._initModel('rooms');
	}
}

export default new Rooms();
