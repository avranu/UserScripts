// ==UserScript==
// @name         Instagram Downloader
// @namespace    https://jmann.me
// @version      0.1.1
// @description  Adds a download button to Instagram posts, automatically naming photos with the post metadata. Also supports automatic downloading of all photos in a profile feed.
// @author       Jess Mann
// @match        *://www.instagram.com/*
// @match        *://instagram.com/*
// @grant        GM_download
// ==/UserScript==

(function () {
	'use strict';
	console.log('ViolentMonkey IG Download Script Running...');
	const automatic = false;
	let currentPage = null;
	let pageType = 'other';
	let profileUsername = null;
	let action = null;

	let downloaded_images = [];

	const BUILTIN_PAGES = [
		'',
		'/explore',
		'/reels',
	];

	const css = `
        #ig-download-button {
            background-color: #333;
            opacity: 0.4;
            border-radius: 5px;
            position: fixed;
            top: 10px;
            right: 4em;
            z-index: 1000;
            padding: 10px;
            color: white;
            border: none;
            cursor: pointer;
        }
        #ig-download-button:hover {
            background-color: #343;
            opacity: 1;
        }
        #ig-download-button.disabled {
            display: none;
            background-color: #333;
            opacity: 0.2;
            cursor: not-allowed;
        }
        div.ig-download-notification {
            position: fixed;
            bottom: 10px;
            right: 10px;
            z-index: 1000;
            padding: 10px;
            background-color: #007bff;
            color: white;
            border: none;
            border-radius: 5px;
        }
    `;

	async function waitFor(ms) {
		return new Promise(resolve => setTimeout(resolve, ms));
	}

	function createNotification(message) {
		try {
			// Pop up a notification at the bottom right of the screen that there is a carosel
			const notification = document.createElement('div');
			notification.classList.add('ig-download-notification');
			notification.textContent = message;
			document.body.appendChild(notification);

			// After 3 seconds, remove the notification
			setTimeout(() => {
				notification.remove();
			}, 3000);
		} catch (e) {
			console.error('Error creating notification: ', e);
			console.log('Message: ', message);
		}
	}

	function createDownloadButton() {
		if (document.querySelector('#ig-download-button')) return;

		const button = document.createElement('button');
		button.id = 'ig-download-button';
		button.textContent = 'Download';
		document.body.appendChild(button);

		button.addEventListener('click', handleDownloadClick);

		return button;
	}

	function enableButton(button = null) {
		if (!button) button = getButton();
		console.debug('Enabling button');
		if (button) {
			button.textContent = 'Download';
			button.classList.remove('disabled');
		} else {
			createDownloadButton();
		}
	}

	function disableButton(button = null) {
		if (!button) button = getButton();
		console.debug('Disabling button');
		if (button) {
			button.textContent = 'Stop';
			button.classList.add('disabled');
		}
	}

	function buttonIsDisabled() {
		const button = getButton();
		if (button) {
			// If button is hidden, it's disabled
			if (button.style.display === 'none') {
				return true;
			}
			return button.classList.contains('disabled');
		}
		return false;
	}

	function getButton() {
		return document.querySelector('#ig-download-button');
	}

	function hideButton(button = null) {
		if (!button) button = getButton();
		console.log('Hiding button');
		if (button) {
			button.style.display = 'none';
		}
	}

	function showButton(button = null) {
		if (!button) button = getButton();
		console.log('Showing button');
		if (button) {
			button.style.display = 'block';
		} else {
			createDownloadButton();
		}
	}

	function removeButton(button = null) {
		if (!button) button = getButton();
		console.log('Removing button');
		if (button) {
			button.remove();
		}
	}

	function detectCarosel(container) {
		if (!container) container = document;

		try {
			// Find li that contains div[role=button], which has a child img alt beginning with "Photo"
			// The alt is sometimes "Photo by" and other times "Photo shared by"
			let imageElement = container.querySelector('div[role="button"] li img[alt^="Photo"]');

			if (imageElement) {
				// Pop up a notification at the bottom right of the screen that there is a carosel
				createNotification('Carosel detected!');
			}
		}
		catch (e) {
			console.error('Error getting image in li: ', e);
		}

		return null;
	}

	function findFeedContainer() {
		// Find a <span> with the text that is exactly "Posts"
		const postsLabel = [...document.querySelectorAll('span')]
			.find(l => l.textContent.trim() === "Posts");

		if (!postsLabel) {
			console.debug('Unable to find posts label');
			return null;
		}

		// Find a parent with role=tablist
		const tabList = postsLabel.closest('[role="tablist"]');
		if (!tabList) {
			console.debug('Unable to find tab list');
			return null;
		}

		// Get the next sibling div
		const container = tabList.nextElementSibling;

		if (!container) {
			console.debug('Unable to find feed container');
			return null;
		}

		return container;
	}

	function getUsername() {
		const usernameElement = document.querySelector('header img[alt$=" profile picture"]');
		if (usernameElement) {
			return usernameElement.alt.replace("'s profile picture", '').trim();
		}
		return null;
	}

	function scrollToBottom() {
		window.scrollTo(0, document.body.scrollHeight);
	}

	function getImages(container) {
		if (!container) container = document;

		detectCarosel(container);

		try {
			// Find div[role=button] which has a child img alt beginning with "Photo"
			// The alt is sometimes "Photo by" and other times "Photo shared by"
			let imageElement = container.querySelectorAll('div[role="button"] img[alt^="Photo"]');

			if (imageElement) {
				return imageElement;
			}
		}
		catch (e) {
			console.error('Error getting image in li: ', e);
		}

		return null;
	}

	function handleDownloadClick() {
		if (!buttonIsDisabled()) {
			disableButton();

			if (action === 'automatic_download') {
				console.log('Stopping automatic downloads');
				action = 'stop';
			}

			if (pageType === 'feed') {
				beginAutomaticDownloads();
				return;
			}

			downloadPhotos();
			enableButton();
		} else {
			action = 'stop';
			enableButton();
		}
	}

	function downloadPhotos(imageElements = null) {
		const button = getButton();

		if (!imageElements) {
			imageElements = getImages();
			if (!imageElements) {
				console.error('Image not found');
				//enableButton();
				return;
			}
		}

		console.log('Downloading all images');
		imageElements?.forEach((imageElement) => {
			downloadSinglePhoto(imageElement);
		});
	}

	function downloadSinglePhoto(imageElement) {
		const imageURL = imageElement.src;

		if (!imageURL) {
			console.error('Image URL not found for image element: ', imageElement);
			console.error('ImageURL: ', imageURL);
			return;
		}

		// Check if the image was already downloaded
		if (downloaded_images.includes(imageURL)) {
			console.log('Image already downloaded');
			return;
		}

		console.log(`Downloading image from ${imageURL}`);

		const imageAlt = imageElement.alt;
		const pageTitle = document.title;

		let username = getUsername();

		// Retrieve the post title from the pagetitle, which is formatted "{username} | {post title} | Instagram"
		const urlSuffix = imageURL.substr(-10);
		let postTitle = pageTitle.split('|')
		if (postTitle.length > 1) {
			postTitle = postTitle[1].trim();
		} else {
			postTitle = null;
		}
		if (postTitle) {
			// Remove everything after first hashtag #
			postTitle = postTitle.split('#')[0].trim();
			// Limit to 50 characters
			if (postTitle.length > 50) {
				postTitle = postTitle.substring(0, 50);
			}
		}
		if (!postTitle || postTitle.length < 10) {
			// username + Get the last 10 characters from the url
			postTitle = `${username} - ${urlSuffix}`;
		}

		let filename_stem = `${postTitle} - IG ${imageAlt}`;
		// Replace everything except \w+
		filename_stem = filename_stem.replace(/[^\w -]/g, '');
		filename_stem = filename_stem.replace(/\s+/g, ' ');
		const filename = `${filename_stem}.jpg`;

		GM_download({
			url: imageURL,
			name: filename,
			saveAs: false,
			onerror: function (err) {
				console.error('Error downloading ' + filename + ': ', err);
			}
		});

		downloaded_images.push(imageURL);

		// enableButton();
	}

	function update_page_type() {
		if (window.location.href === 'https://www.instagram.com/push/web/settings/' || window.location.href === 'https://www.instagram.com/emails/settings/') {
			pageType = 'settings';
			return pageType;
		}

		// Strip "#" and "/" from end of url
		const url = window.location.pathname.replace(/[#/]+$/, '');
		const feedContainer = findFeedContainer();

		// if url is one of BUILTIN_PAGES, then treat it like the homepage
		if (BUILTIN_PAGES.includes(url)) {
			pageType = 'homepage';
			return pageType;
		}

		// Match /p/ and /username/p/
		if (url.startsWith('/p/') || url.match(/\/[^/]+\/p\//)) {
			console.debug('Page changed to a post');
			pageType = 'post';
			return pageType;
		}

		if (feedContainer) {
			pageType = 'feed';
			return pageType;
		}

		// Everything else
		pageType = 'other';
		return pageType;
	}

	async function beginAutomaticDownloads() {
		if (action == 'automatic_download') {
			console.log('Automatic downloads already in progress');
			return;
		}
		action = 'automatic_download';
		console.log('Beginning automatic downloads');
		await waitFor(1000);

		// Start by downloading what is on screen now
		const feedImages = document.querySelectorAll(`a[href^="/${profileUsername}/p/"] img[alt^="Photo"]`);
		if (feedImages) {
			downloadPhotos(feedImages);
		}

		while (true) {
			await waitFor(2000);

			if (action === 'stop') {
				console.log('Stopping automatic downloads');
				break;
			}

			// If already at bottom of page
			if (window.innerHeight + window.scrollY >= document.body.scrollHeight) {
				break;
			}

			scrollToBottom();
			await waitFor(2000);
		}

		action = null;
		enableButton();
		console.log('Automatic downloads complete');
	}

	function observePageChanges() {
		console.log('Observing page changes');
		const observer = new MutationObserver(() => {
			update_page_type();

			if (pageType == 'settings') {
				showSettingsButton();
				hideButton();
				return;
			} else {
				hideSettingsButton();
			}

			if (pageType === 'feed') {
				profileUsername = getUsername();
				showButton();
				return;
			}

			// Everything else doesn't have a profile name
			profileUsername = null;

			if (pageType === 'post') {
				showButton();
				return;
			}

			// For homepage, and other pages, hide the button
			hideButton();
		});

		observer.observe(document.body, { childList: true, subtree: true });
	}

	function observePhotoAdded() {
		const observer = new MutationObserver((mutationsList) => {
			// Nothing to do for homepage and other pages
			if (pageType === 'homepage' || pageType === 'other') {
				return;
			}

			for (const mutation of mutationsList) {
				if (mutation.type === 'childList') {
					for (const node of mutation.addedNodes) {
						if (node.nodeType === Node.ELEMENT_NODE) {
							// FEED IMAGES
							if (action === 'automatic_download') {
								if (pageType === 'feed' && profileUsername) {
									// Find <a> tags with a src that begins with "/{profileUsername}/p/"
									const feedImages = node.querySelectorAll(`a[href^="/${profileUsername}/p/"] img[alt^="Photo"]`);
									if (feedImages) {
										console.log('Feed images found: ', feedImages);
										downloadPhotos(feedImages);
									}
									continue;
								}
							}

							// SINGLE IMAGES
							let node_prefix = 'article';
							if (node.closest('article')) {
								node_prefix = '';
								if (node.tagName === 'IMG' && node.alt.startsWith('Photo')) {
									console.log('New image added: ', node);
									enableButton();
									if (automatic) {
										downloadSinglePhoto(node);
									}
									continue;
								}
							}

							// Check if any added node contains matching <img> elements
							const matchingImages = node.querySelectorAll?.(`${node_prefix} img[alt^="Photo"]`);
							if (matchingImages) {
								console.log('Matching images found: ', matchingImages);
								enableButton();
								if (automatic) {
									matchingImages?.forEach(img => downloadPhotos(matchingImages));
								}
							}
						}
					}
				}
			}
		});

		observer.observe(document.body, {
			childList: true,
			subtree: true
		});
	}

	function clickOff() {
		(() => {
			const candidates = Array.from(document.querySelectorAll('div[role="button"][tabindex="0"]'));

			candidates.forEach(button => {
				const label = button.textContent.trim().toLowerCase();
				const checked = button.getAttribute('aria-checked') === 'true';

				if (label === 'off' && !checked) {
					button.click();
				}
			});

			console.log('Clicked all unselected "Off" radio buttons.');
		})();
	}

	function addSettingsButton() {
		// Check if button exists
		const existingButton = document.querySelector('#click-off-button');
		if (existingButton) {
			showSettingsButton();
			return;
		}

		console.log('On settings page, adjusting settings...');
		// Add a button to trigger clickOff
		const button = document.createElement('button');
		button.id = 'click-off-button';
		button.textContent = 'Click Off';
		button.style.position = 'fixed';
		button.style.top = '10px';
		button.style.right = '10px';
		button.style.zIndex = 1000;
		button.style.padding = '10px';
		button.style.backgroundColor = '#007bff';
		button.style.color = 'white';
		button.style.border = 'none';
		button.style.cursor = 'pointer';
		button.style.borderRadius = '5px';
		document.body.appendChild(button);

		button.addEventListener('click', clickOff);
		console.log('Click Off button added and event listener attached.');
	}

	function showSettingsButton() {
		const button = document.querySelector('#click-off-button');
		if (button) {
			button.style.display = 'block';
			console.log('Click Off button shown.');
		} else {
			addSettingsButton();
		}
	}

	function hideSettingsButton() {
		const button = document.querySelector('#click-off-button');
		if (button) {
			button.style.display = 'none';
			console.log('Click Off button hidden.');
		}
	}

	function inject_css() {
		const style = document.createElement('style');
		style.textContent = css;
		document.head.appendChild(style);
	}

	inject_css();
	createDownloadButton();
	observePageChanges();
	observePhotoAdded();
})();
