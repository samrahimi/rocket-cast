import { WebApp } from 'meteor/webapp';
import { injectIntoHead, injectIntoBody } from '../../ui-master/server';
import { callRestApi } from '../../utils/server/functions/callRestApi';

var tagline = "A free social TV station on the Social Video Network!"
const getOGDescription= (channelJson) => {
	if (channelJson.topic) return channelJson.topic
	if (channelJson.description) return channelJson.description

	return tagline
}

//Sam Rahimi: If it's the Facebook BOT, serve them a special HTML page 
//with the proper OG tags for what they're trying to view... 
WebApp.rawConnectHandlers.use(function(req, res, next) {
	var ua, path, channelName
	try
	{
		path = req.url.split('?')[0];

		if (path.indexOf('/channel') < 0 || path.indexOf('/api') >=0) {
			return next();
		}

		ua = req.headers['user-agent'].toString().toLowerCase()

		//only the social media share bots and the googlebots get this page... everyone else gets the real thing
		if (ua.indexOf('facebookexternalhit')<0 && 
			ua.indexOf('google')<0 &&
			ua.indexOf('twitter')<0 && 
			ua.indexOf('linkedin')<0) {
			
			return next();
		}

		channelName= path.split('/')[path.split('/').length-1]

	}	
	catch(e) {
		return next();
	}
	callRestApi('https://svn.im/api/v1/channels.info?roomName='+channelName, (response) => {
		try {
			var result = JSON.parse(response)
			console.log("Setting OG Tags in HEAD for "+channelName+". Result info: "+JSON.stringify(result))
			console.log(result && result.channel? "found" : "not found")

			if (result && result.channel) {

				var og=`
				<!DOCTYPE html>
				<html>
				<head>
				<title>${channelName} on SVN</title>
				<link rel="stylesheet" type="text/css" class="__meteor-css__" href="/merged-stylesheets.css?hash=5aeae4a27e1896a06233031ec70475b56eeda694">
				<meta charset="utf-8" />
				<meta http-equiv="content-type" content="text/html; charset=utf-8" />
				<meta http-equiv="expires" content="-1" />
				<meta http-equiv="X-UA-Compatible" content="IE=edge" />
				<meta name="distribution" content="global" />
				<meta name="rating" content="general" />
				<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
				<meta name="mobile-web-app-capable" content="yes" />
				<meta name="apple-mobile-web-app-capable" content="yes" />
				
				<meta property="og:title" content="${channelName} on SVN" />
				<meta property="og:url" content="https://svn.im/channel/${channelName}" />
				<meta property="og:image" content="https://samrahimi.com/avatars/${channelName}.png" />
				<meta property="og:description" content="${getOGDescription(result.channel)}" />
				<meta property="og:type" content="video.other" />
				<meta property="fb:app_id" content="404329223839581" />

				<meta name="google-site-verification" content="zo_sk3ixgJLGZoejcO3zgU1WhWp9nod9GPWEGq0_i2w" />
				</head>
				<body>
					<h1>${channelName}</h1>
					<h3>${result.channel.topic ? result.channel.topic : channelName} on SVN</h3>
					<p>
						<img src="https://samrahimi.com/avatars/${channelName}.png" alt="Logo for ${channelName} />
						${result.channel.description ? result.channel.description: ""}
					</p>
					
					<p style="text-align-center"><a href="https://svn.im/channel/${channelName}">Please click here if you are not redirected within 5s</a></p>
				</body>
				</html>`

				console.log("Writing OG mockup")
				res.setHeader('Content-Type', 'text/html; charset=UTF-8');
				res.setHeader('Content-Length', og.length);
				res.write(og);
				res.end();
			
			} 	
			else {
				return next();
			}
		} 
		catch(e) {
			return next()
		}
	})
}); 


