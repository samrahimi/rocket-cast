import url from 'url';

import { Meteor } from 'meteor/meteor';
import { WebApp, WebAppInternals } from 'meteor/webapp';
import _ from 'underscore';

import { settings } from '../../settings';
import { Logger } from '../../logger';


const logger = new Logger('CORS', {});

WebApp.rawConnectHandlers.use(Meteor.bindEnvironment(function(req, res, next) {
	if (req._body) {
		return next();
	}
	if (req.headers['transfer-encoding'] === undefined && isNaN(req.headers['content-length'])) {
		return next();
	}
	if (req.headers['content-type'] !== '' && req.headers['content-type'] !== undefined) {
		return next();
	}
	if (req.url.indexOf(`${ __meteor_runtime_config__.ROOT_URL_PATH_PREFIX }/ufs/`) === 0) {
		return next();
	}

	let buf = '';
	req.setEncoding('utf8');
	req.on('data', function(chunk) {
		buf += chunk;
	});

	req.on('end', function() {
		logger.debug('[request]'.green, req.method, req.url, '\nheaders ->', req.headers, '\nbody ->', buf);

		try {
			req.body = JSON.parse(buf);
		} catch (error) {
			req.body = buf;
		}
		req._body = true;

		return next();
	});
}));

let Support_Cordova_App = false;
settings.get('Support_Cordova_App', (key, value) => {
	Support_Cordova_App = value;
});

WebApp.rawConnectHandlers.use(function(req, res, next) {
	// XSS Protection for old browsers (IE)
	res.setHeader('X-XSS-Protection', '1');

	if (Support_Cordova_App !== true) {
		return next();
	}

	if (/^\/(api|_timesync|sockjs|tap-i18n)(\/|$)/.test(req.url)) {
		res.setHeader('Access-Control-Allow-Origin', '*');
	}
	if (settings.get('Iframe_Restrict_Access')) {
		res.setHeader('X-Frame-Options', settings.get('Iframe_X_Frame_Options'));
	}

	const { setHeader } = res;
	res.setHeader = function(key, val, ...args) {
		if (key.toLowerCase() === 'access-control-allow-origin' && val === 'http://meteor.local') {
			return;
		}
		return setHeader.apply(this, [key, val, ...args]);
	};

	return next();
});

const _staticFilesMiddleware = WebAppInternals.staticFilesMiddleware;

WebAppInternals._staticFilesMiddleware = function(staticFiles, req, res, next) {
	res.setHeader('Access-Control-Allow-Origin', '*');
	return _staticFilesMiddleware(staticFiles, req, res, next);
};

const oldHttpServerListeners = WebApp.httpServer.listeners('request').slice(0);

WebApp.httpServer.removeAllListeners('request');

WebApp.httpServer.addListener('request', function(req, res, ...args) {
	const next = () => {
		for (const oldListener of oldHttpServerListeners) {
			oldListener.apply(WebApp.httpServer, [req, res, ...args]);
		}
	};
	next();

	// Rocket.Chat 2.3 had this highly toxic bug where you can force SSL
	// but there's no logic here to load certificates or listen on 443... turning on the setting
	// locks out the app, even if you use a reverse proxy / LB to 
	// enabled HTTPS over the wire.

	// TODO: actually finish SSL support. No way this code and undocumentation is what the 
	// enterprise customers get

	/*
	if (settings.get('Force_SSL') !== true) {
		next();
		return;
	}

	const remoteAddress = req.connection.remoteAddress || req.socket.remoteAddress;
	const localhostRegexp = /^\s*(127\.0\.0\.1|::1)\s*$/;
	const localhostTest = function(x) {
		return localhostRegexp.test(x);
	};

	const isLocal = localhostRegexp.test(remoteAddress) && (!req.headers['x-forwarded-for'] || _.all(req.headers['x-forwarded-for'].split(','), localhostTest));
	const isSsl = req.connection.pair || (req.headers['x-forwarded-proto'] && req.headers['x-forwarded-proto'].indexOf('https') !== -1);

	logger.debug('req.url', req.url);
	logger.debug('remoteAddress', remoteAddress);
	logger.debug('isLocal', isLocal);
	logger.debug('isSsl', isSsl);
	logger.debug('req.headers', req.headers);

	if (!isLocal && !isSsl) {
		let host = req.headers.host || url.parse(Meteor.absoluteUrl()).hostname;
		host = host.replace(/:\d+$/, '');
		res.writeHead(302, {
			Location: `https://${ host }${ req.url }`,
		});
		res.end();
		return;
	}

	return next(); */
});
