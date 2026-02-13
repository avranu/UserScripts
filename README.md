# Violentmonkey Automation Scripts

This repository contains a collection of custom userscripts designed to enhance and automate specific web browsing tasks using Violentmonkey. These scripts streamline workflows, remove clutter, and add functionality to various websites.

![Instagram Mobile Screenshot with Markup](docs/media/Instagram%20Mobile%20Screenshot%20with%20Markup.png)

## Scripts Overview

### `youtube-filters.user.js`
- **Purpose**: Focus on subscriptions and recent content, not ads.
   * Keeps track of your subscriptions.
   * Hides the "Shorts" section on YouTube's homepage.
   * Hides videos older than a specific number of years.
   * Hides videos already watched.
- **Use Case**: Youtube does not allow hiding the shorts section for more than 30 days. It's also recently pushing 6-10 year old videos into my feed, and is repeatedly suggesting videos I've already watched. This script addresses all of these issues.

### `wayback-download-images.user.js`
- **Purpose**: Downloads images from the Wayback Machine and renames them based on page text.
- **Use Case**: Saves historical images with meaningful filenames.

### `wayback-auto-print-screen.user.js`
- **Purpose**: Automates taking print screens and clicking elements on the Wayback Machine.
- **Use Case**: Efficiently processes multiple archived pages.

### `flickr-image-downloader.user.js`
- **Purpose**: Adds a download button to images on Flickr.
- **Use Case**: Flickr does not allow downloading images.

### `cris-download-attrs.user.js`
- **Purpose**: Automates the process of extracting data and downloading PDFs from CRIS, using MutationObservers.
- **Use Case**: Extracting images from CRIS with attached metadata about each image.

### `loc.user.js`
- **Purpose**: Download the highest quality images from the Library of Congress and rename them based on metadata
- **Use Case**: Downloading and indexing library of congress assets along with their metadata.

### `newspaper-com-download.user.js`
- **Purpose**: Download newspaper clippings and rename them based on metadata
- **Use Case**: Downloading and indexing newspaper clippings along with their metadata.

### `instagram.user.js`
- **Purpose**: Hides recommended/suggested/discovery posts on Instagram home feed, with a focus on those that are likely ads or influencer content. Provides a settings panel to customize behavior and maintain a whitelist of phrases to avoid hiding content you're interested in.
- **Use Case**: Focus on subscriptions, not on advertising. Instagram's algorithm watches your behavior and adapts content to 'string you along' into continuously scrolling. This is exhausting. This script hides things you didn't ask for, while still allowing you to discover new content and see your subscriptions.

![Instagram Mobile Screenshot](docs/media/Instagram%20Mobile%20Screenshot.png)
![Instagram Mobile Settings](docs/media/Instagram%20Mobile%20Settings.png)

This can also be used with Hermit (mobile app) to provide a mobile app experience.
 
## Usage Instructions

1. **Install GreaseMonkey, Violentmonkey, or Tampermonkey**:
   - These extensions are required to run userscripts. Available for most modern browsers. Due to recent changes in Chrome, you may need to install Brave to use Violentmonkey.
2. **Add Scripts**:
   - Copy and paste the content of each `.js` file into a new script in your userscript manager.

## Author
Created and maintained by **Jess Mann**.