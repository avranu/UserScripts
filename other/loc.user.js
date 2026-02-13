// ==UserScript==
// @name         Library of Congress - Download Image
// @namespace    http://jmann.me
// @version      0.1.0
// @description  Download the highest quality images from the Library of Congress and rename them based on metadata
// @author       Jess Mann
// @match        https://www.loc.gov/resource/*
// @match        https://www.loc.gov/item/*
// @grant        GM_download
// ==/UserScript==

(function () {
	'use strict';

	// Configuration
	const SERVICE = "loc-gov";
	const TITLE_TEMPLATE = "{title} - {location} - {date} - {controlNumber} - {service}.{extension}";
	const buttonText = 'Download';

	const metadataSelectors = {
		"title": "#item-title + ul li",
		"contributor": "#item-contributor_names + ul li",
		"date": "#item-created_published + ul li",
		"location": "#item-facet-location + ul li",
		"controlNumber": "#item-control_number + ul li"
	};

	const css = `
		button#download {
			position: fixed;
			top: 10px;
			right: 10px;
			z-index: 1000;
			padding: 10px;
			background-color: #333;
			border-radius: 8px;
			color: white;
			border: 1px solid #ccc;
			cursor: pointer;
			opacity: 0.6;
		}
		button#download:hover {
			opacity: 1;
			background-color: rgba(0, 35, 71, 0.9);
		}
		div.toast {
			padding: 1rem;
			position: absolute;
			bottom: 0.5rem;
			right: 0.5rem;
			background: #1e1e1e;
			color: white;
			text-align: center;
		}
		div.toast .error {
			background-color: #4a2725;
		}
	`;

	function inject_css() {
		console.log('Injecting CSS');
		const style = document.createElement('style');
		style.textContent = css;
		document.head.appendChild(style);
	}
	inject_css();

	function showToast(message, isError = false) {
		console.log(`Toast: ${message}`);
		const toast = document.createElement('div');
		toast.className = 'toast';
		toast.innerText = message;
		if (isError) {
			toast.classList.add('error');
		}
		document.body.appendChild(toast);
		toast.classList.add('show');
		setTimeout(() => {
			toast.classList.remove('show');
			document.body.removeChild(toast);
		}, 5000);
	}

	// Create the download button
	const button = document.createElement('button');
	button.textContent = buttonText;
	button.id = 'download';
	document.body.appendChild(button);

	button.addEventListener('click', () => {
		button.disabled = true;
		button.textContent = 'Downloading...';
		const metadata = collectMetadata();
		const bestFile = findBestDownload();
		if (!bestFile) {
			showToast('No suitable file found for download.', isError = true);
			button.textContent = buttonText;
			button.disabled = false;
			return;
		}
		metadata.extension = bestFile.extension;
		downloadImage(metadata, bestFile.url);
	});

	function collectMetadata() {
		const metadata = { service: SERVICE };

		for (const key in metadataSelectors) {
			const element = document.querySelector(metadataSelectors[key]);
			metadata[key] = element ? element.textContent.trim() : `Unknown ${key}`;
		}

		console.log('Metadata collected:', metadata);
		return metadata;
	}

	function findBestDownload() {
		const options = document.querySelectorAll('.resource-download-form select option');
		let bestFile = null;

		options.forEach(option => {
			const url = option.value;

			// Match file size pattern: ( 4.2 KB ), ( 19.1 MB ), etc.
			const sizeMatch = option.textContent.match(/\(\s*([\d.]+)(\s|.nbsp;)*([KMG]B)\s*\)/);
			// Match image dimension pattern: (2444x1349px)
			const dimensionMatch = option.textContent.match(/\((\d+)x(\d+)px\)/);

			let sizeBytes = 0;
			let width = 0, height = 0;
			if (sizeMatch) {
				const size = parseFloat(sizeMatch[1]);
				const unit = sizeMatch[3];
				sizeBytes = size * (unit === 'KB' ? 1024 : unit === 'MB' ? 1024 * 1024 : 1);
			}

			if (dimensionMatch) {
				width = parseInt(dimensionMatch[1], 10);
				height = parseInt(dimensionMatch[2], 10);
			}

			const extension = url.split('.').pop().toLowerCase();

			// Prioritize TIFF files
			if (!bestFile || extension === 'tif' ||
				(extension === 'jpg' && sizeBytes > (bestFile.sizeBytes || 0)) ||
				(!sizeBytes && width * height > (bestFile.width * bestFile.height || 0))) {
				bestFile = { url, sizeBytes, width, height, extension };
				console.debug('New best file selected:', bestFile);
			}
		});

		console.log('Final best file:', bestFile);
		return bestFile;
	}

	function constructFilename(metadata) {
		let filename = TITLE_TEMPLATE;
		for (const key in metadata) {
			filename = filename.replace(`{${key}}`, metadata[key]);
		}
		return filename.replace(/[\/:*?"<>|]/g, '_');
	}

	function downloadImage(metadata, imageURL) {
		const filename = constructFilename(metadata);

		GM_download({
			url: imageURL,
			name: filename,
			saveAs: false,
			onerror: function (err) {
				showToast('Error downloading ' + filename, isError = true);
				console.error('Err: ', err)
			},
			onload: function () {
				showToast('Download complete');
			}
		});

		button.textContent = buttonText;
		button.disabled = false;
	}
})();
