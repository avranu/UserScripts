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

### `instagram.user.js`

**Purpose**  
Remove recommended, suggested, and discovery posts from the Instagram home feed. With this turned on, you should only see content from accounts you follow, and suggested content that contains whitelisted keywords you specify.

**Features**
- Hides ads, and suggested posts outside of your interests.
- Settings panel for customization.
- Whitelist keywords so they're never hidden.

**Why**  
Constantly feel unsatisfied when scrolling instagram? Instagram optimizes for engagement loops designed to make you feel disatisfied, so you scroll forever, only getting an occasional trickle of content you actually want. This script removes content you did not explicitly opt into.

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

### `youtube-filters.user.js`

**Purpose**  
Prioritize subscriptions and recent content while eliminating distractions.

**Features**
- Remembers your subscriptions, and never hides them.
- Hides the *Shorts* section.
- Hides videos older than a configurable number of years.
- Hides previously watched videos.
- Reduces algorithmic resurfacing of stale content.

**Why**  
YouTube increasingly pushes older content, Shorts, and repeat suggestions. This script restores a subscription-first browsing experience.

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
Add a download button to Flickr image pages, along with image metadata, making attribution easier.

**Use case**  
Enable image downloads where direct download functionality is restricted.

---

### `loc.user.js`

**Purpose**  
Download the highest-quality images from the Library of Congress and rename them using official metadata, making attribution easier.

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
Download newspaper clippings and rename them using structured metadata, making attribution easier.

**Use case**  
Historical research and indexed archival workflows.

---


### `instagram-download.user.js`

**Purpose**
Allows downloading instagram photos along with the post metadata, and supports automatic downloading of all photos in a profile feed. This should theoretically be a higher quality photo than a screenshot, and since photo metadata is saved, that makes it easy to attribute the photo to the photographer down the road.

**Use case**
- Archive posts from a user who has died. 
- Create side-by-side comparisons of a user's photo and old historic photos of the same scene.
- Use an instagram photo in google lens

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
