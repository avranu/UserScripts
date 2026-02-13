// ==UserScript==
// @name         Download Clipping from Newspapers.com
// @namespace    http://jmann.me
// @version      0.1.1
// @description  Download newspaper clippings and rename them based on metadata
// @author       Jess Mann
// @match        https://www.newspapers.com/article/*
// @grant        GM_download
// ==/UserScript==

(function () {
	'use strict';

	// Configuration
	// Website we are downloading from
	const SERVICE = "newspaper-com"
	// The template to name downloaded files
	const TITLE_TEMPLATE = "{publication}{date}{pageNumber} - {title} - {service}{articleId}.jpg";
	// CSS selectors for textual metadata. See collect_special_metadata() for others.
	const metadata_selectors = {
		"publication": ".PublicationInfo_Publisher__wEodg",
		"location": ".PublicationInfo_Location__F_Xhd",
		"title": ".page_Title__pOw42",
	}
	const css = ``;

	// Create a button to start the download
	const button = document.createElement('button');
	button.textContent = 'Download Asset';
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

	button.addEventListener('click', () => {
		button.disabled = true;
		button.textContent = 'Downloading...';
		const metadata = collect_metadata();
		download_asset(metadata);
	});

	function collect_special_metadata(metadata) {
		console.log('Collecting special metadata. Metadata is currently: ', metadata);
		const timeElement = document.querySelector('.PublicationInfo_Location__F_Xhd time');
		let dateStr = '';
		if (timeElement) {
			dateStr = timeElement.getAttribute('datetime');
			try {
				// Parse into YYYY-MM-DD format
				const dateObj = new Date(dateStr);
				dateStr = dateObj.toISOString().split('T')[0];
			} catch (e) {
				console.error('Error parsing date: ', e);
			}
		} else {
			dateStr = 'Unknown Date';
		}
		metadata.date = ` - ${dateStr}`;

		const pageMatch = metadata.location.match(/Page\s+(\d+)/);
		if (pageMatch) {
			metadata.pageNumber = ` - Page ${pageMatch[1]}`;
		} else {
			metadata.pageNumber = '';
		}

		const urlMatch = window.location.href.match(/article\/[^\/]+\/(\d+)/);
		if (urlMatch) {
			metadata.articleId = ` ID ${urlMatch[1]}`;
		} else {
			metadata.articleId = '';
		}

		metadata.imageURL = document.querySelector('.ClippingImage_ClipImage__SHeiV')?.src || '';
		console.log('Special metadata collected. Metadata is now: ', metadata);
		return metadata;
	}

	function collect_metadata() {
		const metadata = {
			"service": SERVICE,
		};
		for (const key in metadata_selectors) {
			metadata[key] = document.querySelector(metadata_selectors[key])?.textContent.trim() || 'Unknown ' + key.charAt(0).toUpperCase() + key.slice(1);
		}

		return collect_special_metadata(metadata);
	}

	function construct_name(metadata) {
		let filename = TITLE_TEMPLATE;
		for (const key in metadata) {
			filename = filename.replace(`{${key}}`, metadata[key]);
		}
		return filename.replace(/[\/:*?"<>|]/g, '_');
	}

	function download_asset(metadata) {
		if (!metadata.imageURL) {
			console.error('Image URL not found');
			button.textContent = 'Download Asset';
			button.disabled = false;
			return;
		}

		const filename = construct_name(metadata);

		GM_download({
			url: metadata.imageURL,
			name: filename,
			saveAs: false,
			onerror: function (err) {
				console.error('Error downloading ' + filename + ': ', err);
			}
		});

		button.textContent = 'Download Asset';
		button.disabled = false;
	}

	function hide_elements() {
		// Find elements with a className that begins TrialBanner_Container
		const elements = document.querySelectorAll('[class^="TrialBanner_Container"]');
		elements.forEach(element => {
			element.style.display = 'none';
		});
	}

	function inject_css() {
		const style = document.createElement('style');
		style.textContent = css;
		document.head.appendChild(style);
	}

	function adjust_style() {
		hide_elements();
		inject_css();
	}

	adjust_style();
})();
