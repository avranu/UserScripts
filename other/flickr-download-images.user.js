

// ==UserScript==
// @name         Flickr - Image Downloader with Metadata
// @version      1.2.0
// @description  Add a download button to images on Flickr with proper metadata-based filenames.
// @author       Jess Mann
// @match        *://*flickr.com/photos/*
// @grant        GM_download
// ==/UserScript==

(function () {
	'use strict';

	// Configuration
	const SERVICE = "flickr";
	const TITLE_TEMPLATE = "{title} - {owner} ({username}) - {date} - {service}.{extension}";
	const buttonText = 'Download';

	// Metadata Selectors
	const metadataSelectors = {
		"title": ".photo-title",
		"owner": ".owner-name",
		"username": ".attribution-username",
		"dateTaken": ".date-taken-label",
		"dateUploaded": ".date-posted-label"
	};

	// Inject CSS to improve UI
	const css = `
		div.sidebar-column {
			display: none;
		}
		#search-unified-content {
			max-width: calc(100% - 2rem);
		}
		div.nav-ad-container {
			display: none !important;
		}
		.global-nav-view.desktop-nav-ad .global-nav-content {
			margin-top: 0;
		}
		.search-subnav-slender-view.desktop-nav-ad {
			top: 47px !important;
		}
		#content .search-slender-advanced-panel-view.desktop-nav-ad {
			top: 95px;
		}
		button#download {
			position: absolute;
			top: 0.5rem;
			right: 1rem;
			z-index: 9999;
			padding: 8px;
			background: rgba(255, 255, 255, 0.8);
			color: #000;
			border: 1px solid #ccc;
			border-radius: 5px;
			cursor: pointer;
			line-height: 1rem;
		}
	`;

	function injectCSS() {
		console.log('Injecting CSS');
		const style = document.createElement('style');
		style.textContent = css;
		document.head.appendChild(style);
	}

	function addDownloadButton() {
		const mainPhoto = document.querySelector('.main-photo');
		if (!mainPhoto) {
			console.warn('No main photo found on the page.');
			return;
		}

		// Extract high-resolution image URL
		const imageUrl = mainPhoto.src.replace('_b', '_h'); // Ensure high-resolution version

		// Collect metadata
		const metadata = collectMetadata();
		metadata.extension = imageUrl.split('.').pop().split('?')[0]; // Extract file extension

		// Create download button
		const downloadButton = document.createElement('button');
		downloadButton.textContent = buttonText;
		downloadButton.id = 'download';

		downloadButton.addEventListener('click', () => {
			downloadButton.disabled = true;
			downloadButton.textContent = 'Downloading...';

			const filename = constructFilename(metadata);
			downloadImage(imageUrl, filename, downloadButton);
		});

		document.body.appendChild(downloadButton);
	}

	function collectMetadata() {
		const metadata = { service: SERVICE };

		for (const key in metadataSelectors) {
			const element = document.querySelector(metadataSelectors[key]);
			metadata[key] = element ? element.textContent.trim() : `Unknown ${key}`;
		}

		// Choose the best date: Prefer "Taken on" date, fallback to "Uploaded on" date
		metadata.date = metadata.dateTaken !== `Unknown dateTaken` ? metadata.dateTaken.replace("Taken on ", "")
			: metadata.dateUploaded.replace("Uploaded on ", ""); // Remove labels

		console.log('Metadata collected:', metadata);
		return metadata;
	}

	function constructFilename(metadata) {
		let filename = TITLE_TEMPLATE;
		for (const key in metadata) {
			filename = filename.replace(`{${key}}`, metadata[key]);
		}
		return filename.replace(/[\/:*?"<>|]/g, '_'); // Sanitize filename
	}

	function downloadImage(url, filename, button) {
		GM_download({
			url: url,
			name: filename,
			saveAs: false,
			onerror: function (err) {
				console.error('Error downloading ' + filename + ':', err);
				button.textContent = buttonText;
				button.disabled = false;
			}
		});

		button.textContent = buttonText;
		button.disabled = false;
	}

	// Run functions
	window.addEventListener('load', () => {
		injectCSS();
		addDownloadButton();
	});
})();
