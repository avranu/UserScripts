# Violentmonkey Automation Scripts

A collection of userscripts designed to enhance and automate web browsing workflows using **Violentmonkey** (compatible with Tampermonkey and Greasemonkey).

These scripts reduce clutter, streamline repetitive tasks, and restore control over algorithm-driven interfaces.

<p align="center">
  <img src="docs/media/Instagram%20Mobile%20Screenshot%20with%20Markup.png"
       alt="Instagram Mobile Screenshot with Markup"
       width="420">
</p>

---

## Overview

This repository contains scripts for these platforms:

- YouTube
- Instagram
- Flickr
- Library of Congress
- Wayback Machine
- Newspaper archives
- CRIS

Each script is designed to solve a specific friction point.

---

## Scripts

### `youtube-filters.user.js`

**Purpose**  
Prioritize subscriptions and recent content while eliminating distractions.

**Features**
- Hides the *Shorts* section.
- Hides videos older than a configurable number of years.
- Hides previously watched videos.
- Reduces algorithmic resurfacing of stale content.

**Why**  
YouTube increasingly pushes older content, Shorts, and repeat suggestions. This script restores a subscription-first browsing experience.

---

### `instagram.user.js`

**Purpose**  
Remove recommended, suggested, and discovery posts from the Instagram home feed.

**Features**
- Hides algorithm-driven content.
- Settings panel for customization.
- Phrase whitelist support.
- Focus on subscription-based content only.

**Why**  
Instagram optimizes for engagement loops. This script removes content you did not explicitly opt into while preserving control over discovery.

<p align="center">
  <img src="docs/media/Instagram%20Mobile%20Screenshot.png"
       alt="Instagram Home Feed with Suggested Content Hidden"
       width="380">
</p>

<p align="center">
  <img src="docs/media/Instagram%20Mobile%20Settings.png"
       alt="Instagram Settings Panel"
       width="380">
</p>

**Mobile usage**  
Works well with the **Hermit** mobile app to provide a lightweight mobile app experience.

---

### `wayback-download-images.user.js`

**Purpose**  
Download images from the Wayback Machine and rename them using contextual page text.

**Use case**  
Preserve historical content with meaningful filenames for archival workflows.

---

### `wayback-auto-print-screen.user.js`

**Purpose**  
Automate screenshot capture and interaction within the Wayback Machine.

**Use case**  
Efficiently process large sets of archived pages.

---

### `flickr-image-downloader.user.js`

**Purpose**  
Add a download button to Flickr image pages.

**Use case**  
Enable image downloads where direct download functionality is restricted.

---

### `cris-download-attrs.user.js`

**Purpose**  
Extract metadata and automate PDF downloads from CRIS using `MutationObserver`.

**Use case**  
Bulk extraction of images and associated structured metadata.

---

### `loc.user.js`

**Purpose**  
Download the highest-quality images from the Library of Congress and rename them using official metadata.

**Use case**  
Archival indexing and structured digital asset management.

Screenshot of the interface (new button at top right):
<p align="center">
  <img src="docs/media/LOC%20Screenshot.png"
       alt="Library of Congress Downloaded File Screenshot"
       width="380">
</p>

Screenshot of the retrieved metadata from another file (as reported in the console):
<p align="center">
   <img src="docs/media/LOC%20Metadata.png"
          alt="Library of Congress Metadata Screenshot"
          width="380">
</p>

Screenshot of the final downloaded file:
<p align="center">
   <img src="docs/media/LOC%20Results.png"
            alt="Library of Congress Downloaded File Screenshot"
            width="380">
</p>

---

### `newspaper-com-download.user.js`

**Purpose**  
Download newspaper clippings and rename them using structured metadata.

**Use case**  
Historical research and indexed archival workflows.

---

## Installation

1. Install a userscript manager:
   - **Violentmonkey** (recommended)
   - Tampermonkey
   - Greasemonkey

   > Note: Due to Chrome extension policy changes, Brave may be required to use Violentmonkey.

2. Add a script:
   - Open your userscript manager.
   - Create a new script.
   - Paste the contents of the desired `.user.js` file.
   - Save and enable.

---

## Philosophy

Modern web platforms optimize for engagement, not user intent.

These scripts are designed to:
- Restore focus
- Reduce manipulation
- Eliminate repetitive friction
- Support archival and research workflows

They prioritize control and clarity over algorithmic distraction.

---

## Author

Maintained by **Jess Mann**
