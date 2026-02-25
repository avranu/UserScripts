# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

A collection of Violentmonkey/Tampermonkey/Greasemonkey userscripts that automate and clean up web browsing workflows. Scripts are plain JavaScript — no build system, no package manager, no tests. Each `.user.js` file runs directly in a browser extension.

## Directory Structure

- `youtube/` — YouTube feed filter script
- `wayback/` — Wayback Machine / archive.org scripts
- `other/` — Scripts for LOC, Flickr, Newspapers.com, LinkedIn, CRIS
- `docs/media/` — Screenshots used in README.md

## Installation and Testing

Scripts have no build step. To test changes:
1. Open Violentmonkey (or Tampermonkey) in the browser
2. Create a new script or edit the existing one
3. Paste/update the `.user.js` content and save
4. Navigate to the matching URL specified in `@match`

To verify the `@match` URL patterns, check the `==UserScript==` header at the top of each file.

## Userscript Header Format

Every script must begin with a metadata block:

```js
// ==UserScript==
// @name         Script Name
// @namespace    https://jmann.me
// @version      0.1.x
// @description  Short description
// @author       Jess Mann
// @match        https://example.com/*
// @grant        GM_download        // or GM_getValue, GM_setValue, GM_addStyle
// ==/UserScript==
```

Grant only the permissions actually used. Common grants: `GM_download`, `GM_getValue`, `GM_setValue`, `GM_deleteValue`, `GM_addStyle`, `GM_registerMenuCommand`.

## Common Architectural Patterns

### Script isolation
Most scripts wrap everything in an IIFE (`(function() { ... })()` or `(() => { ... })()`). This is the standard pattern and should be maintained.

### Metadata-based file naming
Download scripts collect page metadata via CSS selectors and apply it to a filename template with `{variable}` placeholders:

```js
const TITLE_TEMPLATE = "{title} - {date} - {service}.{extension}";
// Variables replaced by iterating metadata keys, then illegal chars sanitized:
filename = filename.replace(/[\/:*?"<>|]/g, '_');
```

### Settings persistence
Scripts with configurable settings use `GM_getValue`/`GM_setValue` with a prefixed key, defaulting to constants if no stored value exists. More complex scripts (LinkedIn, YouTube) use a `Storage` or `SettingsStore` class that handles JSON serialization, parse errors, and format migration.

### DOM observation for SPAs
Scripts that run on single-page apps (YouTube, LinkedIn) use `MutationObserver` on `document.body` with `childList: true, subtree: true` to detect navigation and content changes. Debouncing is applied (via `setTimeout` or `queueMicrotask`) to avoid redundant runs.

### SPA navigation hooks
The YouTube script patches `history.pushState` and `history.replaceState` and listens for `popstate` to re-run filters on navigation — necessary because YouTube never triggers a full page load.

### UI injection
Buttons and modals are created via `document.createElement` (never `innerHTML` in the more recent scripts, to avoid Trusted Types issues) and injected into `document.body`. CSS is injected via `GM_addStyle` (LinkedIn) or by appending a `<style>` element to `document.head`.

## Script Complexity Tiers

**Simple scripts** (LOC, Flickr, Newspapers.com, Wayback): flat IIFE with a button, metadata collection via selectors, and `GM_download`.

**Complex scripts** (YouTube, LinkedIn): class-based architecture with distinct layers:
- `Storage` / `SettingsStore` — load/save/reset settings from `GM_getValue`/`GM_setValue`
- Scanner / Filter classes — stateless logic that reads DOM and returns results
- Renderer / BadgeRenderer — updates injected UI elements
- Controller / Engine / Monitor — wires everything together, manages observer and debounce

## Notes

- Scripts use `console.log/warn/error/info/debug` for runtime diagnostics; prefix log messages with a script tag (e.g. `[LJKM]`, `[YT Feed Filters]`) to make them easy to filter in DevTools.
