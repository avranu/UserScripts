// ==UserScript==
// @name         Wayback - Auto Print Screen and Click
// @namespace    http://jmann.me
// @match        https://archive.org/details/*
// @grant        none
// @version      0.1.1
// @author       -
// @date         2024-05-14
// ==/UserScript==

(function () {
	'use strict';

	// Function to simulate key press
	function pressPrintScreen() {
		console.log("Pressing Print Screen");
		const event = new KeyboardEvent('keydown', {
			key: 'PrintScreen',
			code: 'PrintScreen',
			keyCode: 44,
			which: 44,
			bubbles: true,
			cancelable: true
		});
		document.dispatchEvent(event);
	}

	// Function to click in the center of the screen
	function clickCenter() {
		console.log("Clicking center of the screen");
		try {
			const centerX = window.innerWidth / 2;
			const centerY = window.innerHeight / 2;
			const event = new MouseEvent('click', {
				bubbles: true,
				cancelable: true,
				clientX: centerX,
				clientY: centerY,
				view: window
			});
			const element = document.elementFromPoint(centerX, centerY);
			if (element) {
				element.dispatchEvent(event);
				console.log("Clicked element:", element);
			} else {
				console.log("No element found at center position");
			}
		} catch (error) {
			console.error('Error in clickCenter:', error);
		}
	}

	// Function to add the button
	function addButton() {
		console.log("Adding Download Book button");
		const button = document.createElement('button');
		button.textContent = 'Download Book';
		button.style.position = 'fixed';
		button.style.top = '10px';
		button.style.right = '10px';
		button.style.zIndex = 1000;
		button.style.padding = '10px 20px';
		button.style.backgroundColor = '#4CAF50';
		button.style.color = 'white';
		button.style.border = 'none';
		button.style.borderRadius = '5px';
		button.style.cursor = 'pointer';
		button.style.fontSize = '16px';

		document.body.appendChild(button);

		button.addEventListener('click', async () => {
			console.log("Download Book button clicked");
			pressPrintScreen();
			await new Promise(resolve => setTimeout(resolve, 3000)); // Wait for 3 seconds
			clickCenter();
			await new Promise(resolve => setTimeout(resolve, 2000)); // Wait for 2 seconds
		});
	}

	// Add the button when the DOM is fully loaded
	window.addEventListener('load', addButton);

})();
