const URL = require('url');
const ENTITIES = require('html-entities').AllHtmlEntities;

const PLAYLIST_URL = 'https://www.youtube.com/playlist?list=';

// eslint-disable-next-line max-len
const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_13_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/79.0.3945.117 Safari/537.36';
const DEFAULT_HEADERS = { 'user-agent': DEFAULT_USER_AGENT };
const DEFAULT_OPTIONS = { limit: 100, headers: DEFAULT_HEADERS };

// Guarantee that all arguments are valid
exports.checkArgs = (linkOrId, options) => {
  // Validation
  if (!linkOrId) {
    throw new Error('linkOrId is mandatory');
  }

  // Normalisation
  let obj = Object.assign({}, DEFAULT_OPTIONS, options);
  if (isNaN(obj.limit) || obj.limit <= 0) obj.limit = DEFAULT_OPTIONS.limit;
  return obj;
};

exports.URLquery = '&hl=en&disable_polymer=true';

// eslint-disable-next-line max-len
const AUTHOR_REFLINK_REGEXP = /<ul class="pl-header-details"><li>(.*?(?=<\/li>))<\/li><li>(.*?)(?=<\/li>)<\/li><li>(.*?(?=<\/li>))<\/li>(<li>(.*?(?=<\/li>))<\/li>)?/;
// eslint-disable-next-line max-len
const PLAYLIST_NAME_REGEXP = /<h1 class="pl-header-title[^"]*" tabindex="0">\r?\n[\s]*(.*?(?=\r?\n))\r?\n[\s]+(<\/h1>|<div)/;

var get = function (obj, path, def) {

	var stringToPath = function (path) {
		// If the path isn't a string, return it
		if (typeof path !== 'string') return path;
		// Create new array
		var output = [];
		// Split to an array with dot notation
		path.split('.').forEach(function (item, index) {
			// Split to an array with bracket notation
			item.split(/\[([^}]+)\]/g).forEach(function (key) {
				// Push to the new array
				if (key.length > 0) {
					output.push(key);
				}
			});
		});
		return output;
	};
	// Get the path as an array
	path = stringToPath(path);
	// Cache the current object
	var current = obj;
	// For each item in the path, dig into the object
	for (var i = 0; i < path.length; i++) {
		// If the item isn't found, return the default (or null)
		if (!current[path[i]]) return def;
		// Otherwise, update the current  value
		current = current[path[i]];
	}
	return current;
};

// Parses the header information of a playlist
exports.getGeneralInfo = (body, plistID) => {
  const splitedText = between(body, 'window["ytInitialData"] = ', 'window["ytInitialPlayerResponse"]')
  console.tron.log('splitedText', body);

  const importantTxt = JSON.parse(splitedText);

  const playlistDetails = get(importantTxt, 'microformat.microformatDataRenderer')
  const playlistStats = get(importantTxt, 'sidebar.playlistSidebarRenderer.items[0].playlistSidebarPrimaryInfoRenderer.stats')
  const playlistAuthorStats = get(importantTxt, 'sidebar.playlistSidebarRenderer.items[1].playlistSidebarSecondaryInfoRenderer.videoOwner.videoOwnerRenderer')

  const total_items = playlistStats[0].runs[0].text
  const last_updated = playlistStats[2].runs

  const playlistItems = get(importantTxt, 'contents.twoColumnBrowseResultsRenderer.tabs[0].tabRenderer.content.sectionListRenderer.contents[0].itemSectionRenderer.contents[0].playlistVideoListRenderer.contents')

  let formatedPlaylistItems = [];
  if(Array.isArray(playlistItems) && playlistItems.length > 0) {
    playlistItems.forEach(track => {
      const trackDetails = get(track, 'playlistVideoRenderer')
      if(trackDetails) {
        const thumbnails = trackDetails?.thumbnail?.thumbnails
      formatedPlaylistItems = [...formatedPlaylistItems, {
          id: trackDetails?.videoId || '',
          title: trackDetails?.title?.runs[0]?.text || '',
          artwork: thumbnails[thumbnails.length - 1]?.url || '',
          artist: trackDetails?.shortBylineText?.runs[0]?.text || '',
          duration: trackDetails.lengthText?.simpleText || '',
          seconds: +trackDetails?.lengthSeconds || 0
      }]
      }
    })
  }

  console.tron.log('playlistItems', playlistItems);

  return {
    id: plistID,
    url: PLAYLIST_URL + plistID,
    title: playlistDetails.title,
    visibility: 'everyone',
    description: playlistDetails.description || '',
    total_items: Number(total_items),
    views: 0,
    last_updated: `${last_updated.reduce((prev, crr, index) => { return index === 0 ? `${crr.text}` : `${prev} ${crr.text}`} ,'')}`,
    author: {
      name: playlistAuthorStats ? playlistAuthorStats?.title?.runs[0]?.text : 'YouTube',
    },
    nextpage: null,
    items: formatedPlaylistItems,
  };
};

// Splits out the video container
exports.getVideoContainers = body => body
  .substring(body.indexOf('<tr class="'), body.lastIndexOf('</tr>'))
  .split('<tr')
  .splice(1);

exports.buildVideoObject = videoString => {
  const authorBox = between(videoString, '<div class="pl-video-owner">', '</div>');
  const baseUrl = URL.resolve(PLAYLIST_URL, removeHtml(between(videoString, 'href="', '"')));
  const authorMatch = authorBox.match(/<a[^>]*>(.*)(?=<\/a>)/);
  return {
    id: URL.parse(baseUrl, true).query.v,
    url: baseUrl,
    url_simple: `https://www.youtube.com/watch?v=${URL.parse(baseUrl, true).query.v}`,
    title: removeHtml(between(videoString, 'data-title="', '"')),
    thumbnail: URL.resolve(PLAYLIST_URL, between(videoString, 'data-thumb="', '"').split('?')[0]),
    duration: videoString.includes('<div class="timestamp">') ?
      videoString.match(/<span aria-label="[^"]+">(.*?(?=<\/span>))<\/span>/)[1] :
      null,
    author: !authorMatch ? null : {
      name: removeHtml(authorMatch[0]),
      ref: URL.resolve(PLAYLIST_URL, between(authorBox, 'href="', '"')),
    },
  };
};

// Taken from https://github.com/fent/node-ytdl-core/
const between = (haystack, left, right) => {
  let pos;
  pos = haystack.indexOf(left);
  if (pos === -1) { return ''; }
  haystack = haystack.slice(pos + left.length);
  if (!right) { return haystack; }
  pos = haystack.indexOf(right);
  if (pos === -1) { return ''; }
  haystack = haystack.slice(0, pos);
  return haystack;
};

exports.between = between;

// Cleans up html text
const removeHtml = exports.removeHtml = string => new ENTITIES().decode(
  string.replace(/\n\r?/g, ' ')
    .replace(/\s*<\s*br\s*\/?\s*>\s*/gi, '\n')
    .replace(/<\s*\/\s*p\s*>\s*<\s*p[^>]*>/gi, '\n')
    .replace(/<.*?>/gi, '')).trim();
