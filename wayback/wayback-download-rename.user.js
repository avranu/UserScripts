// ==UserScript==
// @name         Wayback - Download Images and Rename
// @namespace    http://tampermonkey.net/
// @version      1.2.0
// @description  Download images and rename them based on page text
// @author
// @match        https://web.archive.org/web/*historic51.org/*
// @grant        GM_download
// @date         2024-05-14
// ==/UserScript==

(function () {
	'use strict';

	// Create a button to start the download
	var button = document.createElement('button');
	button.textContent = 'Download Images';
	button.style.position = 'fixed';
	button.style.top = '100px';
	button.style.right = '10px';
	button.style.zIndex = 1000;
	button.style.padding = '10px';
	button.style.backgroundColor = '#28a745';
	button.style.color = 'white';
	button.style.border = 'none';
	button.style.cursor = 'pointer';
	document.body.appendChild(button);

	button.addEventListener('click', downloadImages);

	function downloadImages() {
		// Disable the button to prevent multiple clicks
		button.disabled = true;
		button.textContent = 'Downloading...';
		console.log('Downloading images on this page...');

		// Get all the tables with width="904px"
		var tables = document.querySelectorAll('table[width="904px"]');

		let count = 0;
		for (var table of tables) {
			// Find the image URL
			var imageLink = table.querySelector('a[rel="lightbox"]');
			if (!imageLink) continue;
			var imageURL = imageLink.getAttribute('href');
			imageURL = adjustImageURLForWaybackMachine(imageURL);

			// Get data
			var data = {};
			var rows = table.querySelectorAll('tr');
			for (var row of rows) {
				var tds = row.querySelectorAll('td');
				if (tds.length >= 3) {
					var labelTD = tds[0];
					var valueTD = tds[2];
					var labelSpan = labelTD.querySelector('span.hdrtxt');
					var valueSpan = valueTD.querySelector('span.hdr, span.hdrtxt');
					if (labelSpan && valueSpan) {
						var label = labelSpan.textContent.trim();
						label = label.replace(/^»\s*/, '').replace(/:$/, '');
						var value = valueSpan.textContent.trim();
						data[label] = value;
					}
				}
			}

			// Process Catalog #
			var catalogNumber = data['Catalog #'];
			if (!catalogNumber) catalogNumber = 'Unknown';

			// Construct filename
			var filename = catalogNumber + ' - ' + data['Date'] + ' - ' + data['Title'] + '.jpg';

			// Sanitize filename to remove illegal characters
			filename = filename.replace(/[\\\/:*?"<>|]/g, '_');

			// Download image
			GM_download({
				url: imageURL,
				name: filename,
				saveAs: false,
				onerror: function (err) {
					console.error('Error downloading ' + filename + ': ', err);
				}
			});

			count += 1;
		}

		// Re-enable the button after processing
		button.disabled = false;
		button.textContent = 'Download Images';
		console.log(`Downloaded ${count} images`);
	}

	function adjustImageURLForWaybackMachine(url) {
		var waybackPrefix = 'https://web.archive.org/web/';
		var baseURL = window.location.href;

		// Resolve relative URLs
		var resolvedURL = new URL(url, document.baseURI).href;

		var waybackRegex = /^https:\/\/web\.archive\.org\/web\/(\d+)([a-z_]*)\/(.*)/;
		var match = resolvedURL.match(waybackRegex);

		if (match) {
			// The URL is already a Wayback Machine URL
			var timestamp = match[1];
			var flags = match[2];
			var originalURL = match[3];

			// Ensure 'im_' flag is present
			if (!flags.includes('im_')) {
				flags += 'im_';
				return waybackPrefix + timestamp + flags + '/' + originalURL;
			} else {
				return resolvedURL;
			}
		} else {
			// The URL is not a Wayback Machine URL
			// Get the timestamp from the current page URL
			var pageMatch = baseURL.match(waybackRegex);
			if (pageMatch) {
				var timestamp = pageMatch[1];
				return waybackPrefix + timestamp + 'im_/' + resolvedURL;
			} else {
				// Can't find timestamp, return the original URL
				return resolvedURL;
			}
		}
	}

})();
