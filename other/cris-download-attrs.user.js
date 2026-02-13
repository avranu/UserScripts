// ==UserScript==
// @name         CRIS Inventory Downloader (Revised)
// @namespace    http://jmann.me
// @version      0.1.1
// @description  Automates the process of extracting data and downloading PDFs from CRIS, using MutationObservers.
// @match        https://cris.parks.ny.gov/Default.aspx
// @grant        GM_download
// @grant        none
// ==/UserScript==

// NOT WORKING

(function () {
	'use strict';

	/************************************************************
	 * HELPER FUNCTIONS
	 ************************************************************/

	/**
	 * Wait for a DOM element to appear using a MutationObserver.
	 * @param {string} selector - A valid CSS selector for the target element.
	 * @param {Element|Document} [root=document] - Root element or document to observe for changes.
	 * @param {number} [timeout=5000] - Maximum wait time in milliseconds.
	 * @returns {Promise<Element>}
	 */
	function waitForElement(selector, root = document, timeout = 5000, textContent = null) {
		return new Promise((resolve, reject) => {
			// If the element already exists, resolve immediately
			const initialElement = root.querySelector(selector);
			if (initialElement) {
				return resolve(initialElement);
			}

			const observer = new MutationObserver(() => {
				const element = root.querySelector(selector);
				if (element) {
					// Ensure text inside element is "USN Details"
					if (textContent && element.textContent.trim() !== textContent) {
						return;
					}
					observer.disconnect();
					resolve(element);
				}
			});

			// Observe childList & subtree changes
			observer.observe(root instanceof Document ? root.body : root, {
				childList: true,
				subtree: true
			});

			// Set a timeout to reject if the element doesn't appear
			setTimeout(() => {
				observer.disconnect();
				reject(new Error(`Timeout: Element not found: ${selector}`));
			}, timeout);
		});
	}

	/**
	 * Pause execution for a specified amount of time (ms).
	 * @param {number} ms - Milliseconds to sleep.
	 * @returns {Promise<void>}
	 */
	function sleep(ms) {
		return new Promise(resolve => setTimeout(resolve, ms));
	}

	/**
	 * Sanitizes a string to be safe for use as a file name.
	 * @param {string} filename - The name to sanitize.
	 * @returns {string} - A sanitized file name.
	 */
	function sanitizeFilename(filename) {
		return filename.replace(/[<>:"/\\|?*]+/g, '').trim();
	}

	/************************************************************
	 * MAIN AUTOMATION FUNCTION
	 ************************************************************/

	async function automateCRIS() {
		console.log('Starting CRIS automation...');

		// Collect all "View" buttons
		const viewButtons = Array.from(document.querySelectorAll('span.dijitButtonText')).filter(button => button.textContent.trim() === 'View');
		if (!viewButtons.length) {
			alert('No "View" buttons found. Aborting script.');
			return;
		}

		for (const [index, viewButton] of viewButtons.entries()) {
			try {
				console.log(`Processing row ${index + 1} of ${viewButtons.length}`);

				// 1. Click the "View" button
				viewButton.click();
				console.log('Clicked "View" button. Waiting for the dialog...');

				// 2. Wait for the USN Details dialog to appear
				await waitForElement('span.dijitDialogTitle', document, 8000, "USN Details");
				console.log('Dialog appeared.');
				await sleep(100);

				// 3. Extract the building name from data-dojo-attach-point="line1"
				const line1Element = document.querySelector('[data-dojo-attach-point="line1"]');
				let buildingName = line1Element ? line1Element.textContent.trim() : 'Unknown_Building';
				console.log(`Extracted building name: "${buildingName}"`);

				// 4. Find "Inventory Form" button
				// <span class="dijitReset dijitInline dijitButtonText" id="dijit_form_Button_61_label" data-dojo-attach-point="containerNode">Inventory Form</span>
				const inventoryButton = [...document.querySelectorAll('span.dijitButtonText')].find(label => label.textContent.trim() === "Inventory Form");
				if (!inventoryButton) {
					throw new Error('Inventory Form button not found.');
				}

				// 7. Simulate clicking the "Inventory Form" button to reveal the direct link
				//    or trigger any dynamic link generation
				inventoryButton.click();

				await sleep(500);

				// 10. Close the dialog
				// Find parent dialog element .dijitDialogPaneContent
				const dialog = inventoryButton.closest('.dijitDialogPaneContent');
				// <span data-dojo-attach-point="closeButtonNode" class="dijitDialogCloseIcon" data-dojo-attach-event="ondijitclick: onCancel" title="Cancel" role="button" tabindex="-1"><span data-dojo-attach-point="closeText" class="closeText" title="Cancel">x</span>
				const closeButton = [...dialog.querySelectorAll('span.dijitButtonText')].find(label => label.textContent.trim() === "Close");
				if (closeButton) {
					closeButton.click();
					console.log('Dialog closed.');
				} else {
					console.warn('Close button not found.');
				}

				// 11. Brief pause before processing the next item
				await sleep(3000);

			} catch (err) {
				console.error(`Error in row ${index + 1}:`, err);
				await sleep(100000);
				// Optionally continue with the next item instead of throwing
			}
		}
		alert('Process completed for all rows!');
	}

	/************************************************************
	 * UI SETUP
	 ************************************************************/

	// Create a button in the top-right corner to start the automation
	const button = document.createElement('button');
	button.textContent = 'Download CRIS PDFs';
	Object.assign(button.style, {
		position: 'fixed',
		top: '10px',
		right: '10px',
		zIndex: '9999',
		backgroundColor: '#007bff',
		color: '#fff',
		border: 'none',
		padding: '10px 15px',
		cursor: 'pointer',
		borderRadius: '5px'
	});

	// Inject the button into the DOM
	document.body.appendChild(button);

	// Attach the click event to trigger the main automation
	button.addEventListener('click', automateCRIS);
})();
