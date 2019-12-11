import { WebApp } from 'meteor/webapp';
import { injectIntoHead } from '../../ui-master/server';

//Sam Rahimi: Inject the appropriate OG tags for Facebook bot if this is a channel page
WebApp.rawConnectHandlers.use(function(req, res, next) {
	const path = req.url.split('?')[0];
	if (path.indexOf('/channel') < 0) {
		return next();
	}
	let channelName= path.split('/')[path.split('/').length-1]

	injectIntoHead('oghamster2',`<meta property="og:hamster" content="${channelName}">`)
});

