// ==UserScript==
// @name     Instagram Hide Nonsense
// @version  1.6
// @match    https://www.instagram.com/
// @description Hides recommended/suggested/discovery posts on Instagram home feed, with a focus on those that are likely ads or influencer content. Provides a settings panel to customize behavior and maintain a whitelist of phrases to avoid hiding content you're interested in.
// ==/UserScript==
(() => {
    'use strict';

    // -------------------------------------------------------------------------
    // Settings
    // -------------------------------------------------------------------------
    const SETTINGS_STORAGE_KEY = 'hermit-ig-settings-v1';
    const DEFAULT_SETTINGS = {
        // "full"   -> collapse entirely
        // "partial"-> collapse to a thin stub row: "Hidden post by <user>"
        hide: 'partial',
        whitelistPhrases: [
            'urbex',
            'urban',
            'bando',
            'ruin',
            'decay',
            'grime_scene',
            'rustlord',
            'lostplace',
            'lost_place',
            'explore',
            'trespas',
        ],
    };

    // --- Route/host guards -----------------------------------------------------
    const isInstagramHost = () => {
        const hostname = window.location.hostname.toLowerCase();
        return (
            hostname === 'instagram.com' ||
            hostname.endsWith('.instagram.com')
        );
    };

    // Home feed should be "/" only (SPA may add query/hash; we ignore those).
    // This intentionally excludes: /<username>/, /reels/, /explore/, /direct/, etc.
    const isInstagramHomeRoute = () => {
        // pathname excludes query/hash; e.g. "https://instagram.com/?x=1" -> "/"
        const path = window.location.pathname;
        return path === '/';
    };

    if (!isInstagramHost() || !isInstagramHomeRoute()) {
        return;
    }

    const CONFIG = {
        // Hide content if this is found inside
        blacklistPhrases: [
            'Ad',
        ],

        // Hide content if whitelisted phrases aren't found.
        greylistPhrases: [
        ],

        // If found, skip greylist (set by settings)
        whitelistPhrases: [],

        // Hide this content under all circumstances
        blacklistRegex: [
            // Hashtag disclosures: #ad, #ads, #advertisement, #spon, #sponsored, #promo, #promoted, #partnered, #partnership
            /^ *(?:# *)?(?:(?:ad(?:verti[sz](?:ement|ing))?s?)?|sponsor(?:ed|ship)?|promo(?:tion|ted)?|partner(?:ed|ship)?) *$/i,

            // Paid/sponsored/promoted/brand partnership language (covers “in collaboration/partnership with”, “sponsored by”, “paid collab”)
            /^ *(?:(?:in|with) )?(?:(?:paid|brand(?:ed|ing)?) )?(?:sponsor(?:s|ed|ship)|partner(?:s|ship)?|promot(?:ed?|ing|ion(?:al)?)|collab(?:oration)?)(?: (?:with|by))? *$/i,

            // End-of-feed / discovery boundary
            /^ *discover(?: (?:new|better|the best|different|original|similar))? content *$/i,
        ],

        // Hide this content if whitelisted phrases aren't found.
        greylistRegex: [
            // Recommended/suggested families + “you may/might like” + “posts/reels/accounts you may like” + “from accounts you may like”
            /^ *(?:recommended|suggested|from)(?: (?:for you|posts?|reels?|accounts?|content|videos?|creators?))(?: (?:(?:we think) )?(?:you(?:'ll)?|you (?:may|might|will)) (?:like|love|enjoy))? *$/i,
            /^ *(?:posts?|reels?|accounts?|content|videos?|creators?)(?: (?:(?:we think) )?(?:you(?:'ll)?|you (?:may|might|will)) (?:like|love|enjoy)) *$/i,

            // Algorithm justification (“based on…” / “inspired by…” / “because you…”)
            /^ *(?:based on|inspired by)(?: your)? (?:(?:recent )?activit(?:y|ies)|interests?|interactions?) *$/i,
            /^ *because you (?:recently )?(?:liked?|watch(?:ed)?|follow(?:ed)?|interact(?:ed)? with|engaged? with|view(?:ed)|visit(?:ed)|search(?:ed) for|sav(?:ed)|comment(?:ed) on|shared?) *$/i,
        ],

        rootSelector: 'main',
        containerSelectors: ['article', 'div[role="presentation"]', 'section'],

        hiddenMarkerAttr: 'data-hermit-ig-hidden',

        // Tracks whether a container is currently "visually hidden"
        hiddenActiveAttr: 'data-hermit-ig-hidden-active',

        scannedAttr: 'data-hermit-ig-scanned',

        // Per-post manual toggle state (true => force shown even when globally hiding)
        forceShownAttr: 'data-hermit-ig-force-shown',

        // Stub UI for partial hide
        stubAttr: 'data-hermit-ig-stub',
        stubClass: 'hermit-ig-stub',
        stubTextClass: 'hermit-ig-stub-text',

        scan: {
            debounceMs: 200,
            periodicMs: 2000,
            maxTextNodesPerScan: 8000,
        },

        ui: {
            widgetId: 'hermit-ig-clean-widget',
            styleId: 'hermit-ig-clean-style',
            userStyleId: 'hermit-ig-user-style',
            settingsId: 'hermit-ig-clean-settings',
        },
    };

    const USER_CSS = `
/* Put your custom CSS here */
`.trim();

    const state = {
        hiddenCount: 0,
        scanScheduled: false,
        enabled: true,
        observer: null,
        intervalId: null,

        // Toggle state for "Hidden: X" click behavior
        hiddenAreShown: false,
    };

    const normalize = (text) =>
        (text || '')
            .replace(/\s+/g, ' ')
            .replace(/[‘’‛´`]/g, "'")
            .trim()
            .toLowerCase();

    const normalizeList = (items) =>
        items
            .map((item) => normalize(item))
            .filter((item) => item && item.length >= 2);

    const loadSettings = () => {
        const stored = localStorage.getItem(SETTINGS_STORAGE_KEY);
        if (!stored) {
            return {
                ...DEFAULT_SETTINGS,
                whitelistPhrases: normalizeList(DEFAULT_SETTINGS.whitelistPhrases),
            };
        }
        try {
            const parsed = JSON.parse(stored);
            return {
                ...DEFAULT_SETTINGS,
                ...parsed,
                whitelistPhrases: normalizeList(
                    Array.isArray(parsed?.whitelistPhrases)
                        ? parsed.whitelistPhrases
                        : DEFAULT_SETTINGS.whitelistPhrases,
                ),
            };
        } catch (error) {
            console.warn('Failed to parse settings, using defaults.', error);
            return {
                ...DEFAULT_SETTINGS,
                whitelistPhrases: normalizeList(DEFAULT_SETTINGS.whitelistPhrases),
            };
        }
    };

    const settings = loadSettings();
    CONFIG.whitelistPhrases = settings.whitelistPhrases;

    const persistSettings = () => {
        localStorage.setItem(
            SETTINGS_STORAGE_KEY,
            JSON.stringify({
                hide: settings.hide,
                whitelistPhrases: settings.whitelistPhrases,
            }),
        );
    };

    const hasBlacklistedPhrase = (text) => {
        const normalizedText = normalize(text);
        if (!normalizedText) {
            return null;
        }

        // If text length < 2, or > 50, skip checks.
        if (normalizedText.length < 2 || normalizedText.length > 50) {
            console.debug('Skipping ', normalizedText);
            return null;
        }

        for (const phrase of CONFIG.blacklistPhrases) {
            if (phrase && normalizedText.includes(phrase)) {
                console.debug('Matched phrase:', phrase);
                return phrase;
            }
        }

        for (const regex of CONFIG.blacklistRegex) {
            regex.lastIndex = 0;
            if (regex.test(normalizedText)) {
                console.debug('Matched regex:', regex.toString());
                return regex.toString();
            }
        }

        console.debug('No blacklist match for:', normalizedText);
        return null;
    };

    const hasWhitelistedPhrase = (fullText) => {
        const normalizedText = normalize(fullText);
        if (!normalizedText) {
            return null;
        }

        // Next, handle whitelist (skip greylist if these are found
        for (const phrase of CONFIG.whitelistPhrases) {
            if (phrase && normalizedText.includes(phrase)) {
                console.debug('Matched whitelist phrase (skipping greylist):', phrase);
                return true;
            }
        }

        console.debug('No whitelist match for:', normalizedText);
        return null;
    };

    const hasGreylistedPhrase = (text) => {
        const normalizedText = normalize(text);
        if (!normalizedText) {
            return null;
        }
        for (const phrase of CONFIG.greylistPhrases) {
            if (phrase && normalizedText.includes(phrase)) {
                console.debug('Matched greylist phrase:', phrase);
                return phrase;
            }
        }

        for (const regex of CONFIG.greylistRegex) {
            regex.lastIndex = 0;
            if (regex.test(normalizedText)) {
                console.debug('Matched greylist regex:', regex.toString());
                return regex.toString();
            }
        }
        console.debug('No greylist match for:', normalizedText);
        return null;
    };

    const ensureStyleTag = (id, cssText) => {
        let styleElement = document.getElementById(id);
        if (!styleElement) {
            styleElement = document.createElement('style');
            styleElement.id = id;
            (document.head || document.documentElement).appendChild(styleElement);
        }
        styleElement.textContent = cssText;
    };

    const buildInternalCss = () => `
/* FULL hide */
[${CONFIG.hiddenMarkerAttr}="true"][${CONFIG.hiddenActiveAttr}="true"][data-hermit-hide-mode="full"] {
  visibility: hidden !important;
  height: 0 !important;
  min-height: 0 !important;
  max-height: 0 !important;
  overflow: hidden !important;
  opacity: 0 !important;
  pointer-events: none !important;
}

/* PARTIAL hide: keep a small stub visible */
[${CONFIG.hiddenMarkerAttr}="true"][${CONFIG.hiddenActiveAttr}="true"][data-hermit-hide-mode="partial"] {
  visibility: visible !important;
  height: auto !important;
  min-height: 0 !important;
  max-height: none !important;
  overflow: visible !important;
  opacity: 1 !important;
  pointer-events: auto !important;
}

/* In partial mode, hide everything except our stub */
[${CONFIG.hiddenMarkerAttr}="true"][${CONFIG.hiddenActiveAttr}="true"][data-hermit-hide-mode="partial"] > :not([${CONFIG.stubAttr}="true"]) {
  display: none !important;
}

[${CONFIG.stubAttr}="true"].${CONFIG.stubClass} {
  display: block !important;
  padding: 8px 10px !important;
  margin: 6px 0 !important;
  border-radius: 10px !important;
  background: rgba(0, 0, 0, 0.35) !important;
  color: #fff !important;
  font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif !important;
  font-size: 12px !important;
  line-height: 1.2 !important;
  cursor: pointer !important;
  user-select: none !important;
  -webkit-user-select: none !important;
  opacity: 0.2;
}

[${CONFIG.stubAttr}="true"].${CONFIG.stubClass}:hover {
  background: rgba(255, 255, 255, 0.1) !important;
  opacity: 0.8;
}

[${CONFIG.stubAttr}="true"].${CONFIG.stubClass} .${CONFIG.stubTextClass} {
  opacity: 0.9 !important;
  white-space: nowrap !important;
  overflow: hidden !important;
  text-overflow: ellipsis !important;
}

/* Widget */
#${CONFIG.ui.widgetId} {
  position: fixed;
  right: 50px;
  top: 10px;
  z-index: 2147483647;
  font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
  font-size: 12px;
  line-height: 1;
  user-select: none;
  -webkit-user-select: none;
  pointer-events: none;
}

#${CONFIG.ui.widgetId} .box {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  box-shadow: 0 6px 18px rgba(0,0,0,0.25);
  pointer-events: auto;
}

#${CONFIG.ui.widgetId} .dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #2ecc71;
  box-shadow: 0 0 0 2px rgba(46, 204, 113, 0.25);
}

#${CONFIG.ui.widgetId} .label {
  opacity: 0.95;
  letter-spacing: 0.2px;
}

#${CONFIG.ui.widgetId} .count {
  font-variant-numeric: tabular-nums;
  opacity: 0.95;
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 2px;
}

#${CONFIG.ui.widgetId} .count:hover {
  opacity: 1;
}

#${CONFIG.ui.widgetId} .settings {
  cursor: pointer;
  padding: 4px;
  border-radius: 999px;
  opacity: 0.85;
}

#${CONFIG.ui.widgetId} .settings:hover {
  opacity: 1;
  background: rgba(255, 255, 255, 0.1);
}

#${CONFIG.ui.settingsId} {
  position: fixed;
  right: 20px;
  top: 60px;
  z-index: 2147483647;
  width: min(420px, 90vw);
  background: rgba(20, 20, 20, 0.95);
  color: #fff;
  border-radius: 12px;
  box-shadow: 0 12px 30px rgba(0, 0, 0, 0.4);
  padding: 16px;
  font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
  display: none;
}

#${CONFIG.ui.settingsId}.open {
  display: block;
}

#${CONFIG.ui.settingsId} h2 {
  margin: 0 0 12px;
  font-size: 14px;
}

#${CONFIG.ui.settingsId} .section {
  margin-bottom: 12px;
}

#${CONFIG.ui.settingsId} label {
  display: block;
  margin-bottom: 6px;
  font-size: 12px;
  opacity: 0.9;
}

#${CONFIG.ui.settingsId} textarea {
  width: 100%;
  min-height: 120px;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  color: #fff;
  padding: 8px;
  font-size: 12px;
  resize: vertical;
}

#${CONFIG.ui.settingsId} .actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

#${CONFIG.ui.settingsId} button {
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
  border: none;
  padding: 6px 10px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 12px;
}

#${CONFIG.ui.settingsId} button.primary {
  background: #2ecc71;
  color: #0c0c0c;
  font-weight: 600;
}

#${CONFIG.ui.settingsId} .radio-group {
  display: flex;
  gap: 12px;
  font-size: 12px;
}
`.trim();

    const ensureWidget = () => {
        let widget = document.getElementById(CONFIG.ui.widgetId);
        if (widget) return widget;

        widget = document.createElement('div');
        widget.id = CONFIG.ui.widgetId;

        const box = document.createElement('div');
        box.className = 'box';

        const dot = document.createElement('span');
        dot.className = 'dot';

        const label = document.createElement('span');
        label.className = 'label';
        label.textContent = '';

        const count = document.createElement('span');
        count.className = 'count';
        count.textContent = 'Hidden: 0';
        count.setAttribute('role', 'button');
        count.setAttribute('tabindex', '0');
        count.setAttribute('aria-label', 'Toggle hidden items');

        // Toggle by click / keyboard
        const onToggle = (evt) => {
            evt.preventDefault();
            evt.stopPropagation();
            toggleHiddenVisibility();
        };
        count.addEventListener('click', onToggle);
        count.addEventListener('keydown', (evt) => {
            if (evt.key === 'Enter' || evt.key === ' ') {
                onToggle(evt);
            }
        });

        const settingsButton = document.createElement('span');
        settingsButton.className = 'settings';
        settingsButton.setAttribute('role', 'button');
        settingsButton.setAttribute('tabindex', '0');
        settingsButton.setAttribute('aria-label', 'Open settings');
        settingsButton.textContent = '⚙️';
        settingsButton.addEventListener('click', (evt) => {
            evt.preventDefault();
            evt.stopPropagation();
            toggleSettingsPanel();
        });
        settingsButton.addEventListener('keydown', (evt) => {
            if (evt.key === 'Enter' || evt.key === ' ') {
                evt.preventDefault();
                toggleSettingsPanel();
            }
        });

        box.appendChild(dot);
        box.appendChild(label);
        box.appendChild(count);
        box.appendChild(settingsButton);
        widget.appendChild(box);

        (document.body || document.documentElement).appendChild(widget);
        return widget;
    };

    const updateWidgetCount = () => {
        const widget = document.getElementById(CONFIG.ui.widgetId);
        if (!widget) return;
        const countElement = widget.querySelector('.count');
        if (!countElement) return;

        // Keep label stable, but include state hint
        const mode = state.hiddenAreShown ? ' (shown)' : '';
        countElement.textContent = `Hidden: ${state.hiddenCount}${mode}`;
    };

    const syncSettingsPanel = (panel) => {
        if (!panel) return;
        const partialRadio = panel.querySelector('input[name="hermit-hide-mode"][value="partial"]');
        const fullRadio = panel.querySelector('input[name="hermit-hide-mode"][value="full"]');
        const whitelistTextarea = panel.querySelector(`#${CONFIG.ui.settingsId}-whitelist`);
        if (partialRadio) partialRadio.checked = settings.hide === 'partial';
        if (fullRadio) fullRadio.checked = settings.hide === 'full';
        if (whitelistTextarea) whitelistTextarea.value = settings.whitelistPhrases.join('\n');
    };

    const ensureSettingsPanel = () => {
        let panel = document.getElementById(CONFIG.ui.settingsId);
        if (panel) return panel;

        panel = document.createElement('div');
        panel.id = CONFIG.ui.settingsId;

        const title = document.createElement('h2');
        title.textContent = 'Instagram Hide Nonsense';

        const modeSection = document.createElement('div');
        modeSection.className = 'section';
        const modeLabel = document.createElement('label');
        modeLabel.textContent = 'Hide mode';
        const modeGroup = document.createElement('div');
        modeGroup.className = 'radio-group';

        const partialOption = document.createElement('label');
        const partialRadio = document.createElement('input');
        partialRadio.type = 'radio';
        partialRadio.name = 'hermit-hide-mode';
        partialRadio.value = 'partial';
        partialOption.appendChild(partialRadio);
        partialOption.appendChild(document.createTextNode(' Partial (show stub)'));

        const fullOption = document.createElement('label');
        const fullRadio = document.createElement('input');
        fullRadio.type = 'radio';
        fullRadio.name = 'hermit-hide-mode';
        fullRadio.value = 'full';
        fullOption.appendChild(fullRadio);
        fullOption.appendChild(document.createTextNode(' Full (collapse)'));

        modeGroup.appendChild(partialOption);
        modeGroup.appendChild(fullOption);
        modeSection.appendChild(modeLabel);
        modeSection.appendChild(modeGroup);

        const whitelistSection = document.createElement('div');
        whitelistSection.className = 'section';
        const whitelistLabel = document.createElement('label');
        whitelistLabel.textContent = 'Whitelist (one phrase per line)';
        const whitelistTextarea = document.createElement('textarea');
        whitelistTextarea.id = `${CONFIG.ui.settingsId}-whitelist`;
        whitelistSection.appendChild(whitelistLabel);
        whitelistSection.appendChild(whitelistTextarea);

        const actions = document.createElement('div');
        actions.className = 'actions';
        const resetButton = document.createElement('button');
        resetButton.type = 'button';
        resetButton.textContent = 'Reset';
        const cancelButton = document.createElement('button');
        cancelButton.type = 'button';
        cancelButton.textContent = 'Cancel';
        const saveButton = document.createElement('button');
        saveButton.type = 'button';
        saveButton.className = 'primary';
        saveButton.textContent = 'Save';

        actions.appendChild(resetButton);
        actions.appendChild(cancelButton);
        actions.appendChild(saveButton);

        panel.appendChild(title);
        panel.appendChild(modeSection);
        panel.appendChild(whitelistSection);
        panel.appendChild(actions);

        (document.body || document.documentElement).appendChild(panel);

        const closePanel = () => panel.classList.remove('open');

        cancelButton.addEventListener('click', () => {
            syncSettingsPanel(panel);
            closePanel();
        });

        resetButton.addEventListener('click', () => {
            settings.hide = DEFAULT_SETTINGS.hide;
            settings.whitelistPhrases = normalizeList(DEFAULT_SETTINGS.whitelistPhrases);
            CONFIG.whitelistPhrases = settings.whitelistPhrases;
            persistSettings();
            syncSettingsPanel(panel);
            resetScans();
            scanOnce();
        });

        saveButton.addEventListener('click', () => {
            settings.hide = partialRadio.checked ? 'partial' : 'full';
            settings.whitelistPhrases = normalizeList(
                whitelistTextarea.value.split(/\r?\n/),
            );
            CONFIG.whitelistPhrases = settings.whitelistPhrases;
            persistSettings();
            applyHideModeToAll();
            resetScans();
            scanOnce();
            closePanel();
        });

        syncSettingsPanel(panel);
        return panel;
    };

    const toggleSettingsPanel = () => {
        const panel = ensureSettingsPanel();
        syncSettingsPanel(panel);
        panel.classList.toggle('open');
    };

    const getUsernameFromArticle = (article) => {
        if (!article || !(article instanceof Element)) return 'unknown';

        // Heuristic: prefer links to /<username>/ that are not obviously /p/ or /reel/ etc.
        const anchors = Array.from(article.querySelectorAll('a[href^="/"]'));
        for (const a of anchors) {
            const href = a.getAttribute('href') || '';
            // Matches "/username/" but excludes "/p/..", "/reels/..", "/reel/..", "/explore/..", "/stories/.."
            const m = href.match(/^\/([^\/?#]+)\/$/);
            if (!m) continue;

            const candidate = (m[1] || '').trim();
            if (!candidate) continue;

            const lowered = candidate.toLowerCase();
            if (['p', 'reel', 'reels', 'explore', 'stories', 'direct'].includes(lowered)) continue;

            return candidate;
        }

        return 'unknown';
    };

    const ensureStub = (container) => {
        if (!(container instanceof Element)) return null;

        let stub = container.querySelector(`[${CONFIG.stubAttr}="true"]`);
        if (stub) return stub;

        stub = document.createElement('div');
        stub.setAttribute(CONFIG.stubAttr, 'true');
        stub.className = CONFIG.stubClass;
        stub.setAttribute('role', 'button');
        stub.setAttribute('tabindex', '0');
        stub.setAttribute('aria-label', 'Toggle this post');

        const text = document.createElement('div');
        text.className = CONFIG.stubTextClass;
        text.textContent = 'Hidden post';

        stub.appendChild(text);

        // Click to toggle this specific post
        const onStubToggle = (evt) => {
            evt.preventDefault();
            evt.stopPropagation();
            toggleSinglePost(container);
        };
        stub.addEventListener('click', onStubToggle);
        stub.addEventListener('keydown', (evt) => {
            if (evt.key === 'Enter' || evt.key === ' ') onStubToggle(evt);
        });

        container.insertBefore(stub, container.firstChild);
        return stub;
    };

    const updateStubText = (container, username) => {
        if (!(container instanceof Element)) return;

        const stub = ensureStub(container);
        if (!stub) return;

        const text = stub.querySelector(`.${CONFIG.stubTextClass}`);
        if (!text) return;

        const forced = container.getAttribute(CONFIG.forceShownAttr) === 'true';
        text.textContent = forced ? `Showing post by ${username} (click to hide)` : `Hidden post by ${username}`;
    };

    const applyHideMode = (container) => {
        const username = getUsernameFromArticle(container);
        const mode = (username !== 'unknown' && settings.hide === 'partial') ? 'partial' : 'full';
        container.setAttribute('data-hermit-hide-mode', mode);
        if (mode === 'partial') {
            updateStubText(container, username);
        }
    };

    const applyHideModeToAll = () => {
        const root = document.querySelector(CONFIG.rootSelector) || document.body || document.documentElement;
        if (!root) return;
        const containers = root.querySelectorAll(`[${CONFIG.hiddenMarkerAttr}="true"]`);
        for (const el of containers) {
            if (!(el instanceof Element)) continue;
            applyHideMode(el);
            if (settings.hide === 'partial') {
                const username = getUsernameFromArticle(el);
                updateStubText(el, username);
            }
        }
    };

    const applyHiddenStyles = (container) => {
        const username = getUsernameFromArticle(container);
        applyHideMode(container);

        container.setAttribute(CONFIG.hiddenActiveAttr, 'true');
        container.setAttribute('aria-hidden', 'true');

        // Full mode also uses inline styles; partial mode relies mostly on CSS selectors
        if (settings.hide !== 'partial' && username !== 'unknown') {
            container.style.setProperty('visibility', 'hidden', 'important');
            container.style.setProperty('height', '0', 'important');
            container.style.setProperty('min-height', '0', 'important');
            container.style.setProperty('max-height', '0', 'important');
            container.style.setProperty('overflow', 'hidden', 'important');
            container.style.setProperty('opacity', '0', 'important');
            container.style.setProperty('pointer-events', 'none', 'important');
        } else {
            // In partial mode, avoid collapsing the container; let CSS show stub and hide children.
            container.style.removeProperty('visibility');
            container.style.removeProperty('height');
            container.style.removeProperty('min-height');
            container.style.removeProperty('max-height');
            container.style.removeProperty('overflow');
            container.style.removeProperty('opacity');
            container.style.removeProperty('pointer-events');
            updateStubText(container, username);
        }
    };

    const clearHiddenStyles = (container) => {
        container.setAttribute(CONFIG.hiddenActiveAttr, 'false');
        container.removeAttribute('aria-hidden');
        container.removeAttribute('data-hermit-hide-mode');

        // Remove the inline styles we set (important included)
        container.style.removeProperty('visibility');
        container.style.removeProperty('height');
        container.style.removeProperty('min-height');
        container.style.removeProperty('max-height');
        container.style.removeProperty('overflow');
        container.style.removeProperty('opacity');
        container.style.removeProperty('pointer-events');

        // Keep stub around (cheap), but update its label if we ever re-hide
        if (settings.hide === 'partial') {
            updateStubText(container);
        }
    };

    const shouldForceShow = (container) => container.getAttribute(CONFIG.forceShownAttr) === 'true';

    const toggleSinglePost = (container) => {
        if (!(container instanceof Element)) return;

        // Only applies to containers we've already tagged as hideable
        if (container.getAttribute(CONFIG.hiddenMarkerAttr) !== 'true') return;

        const isForced = shouldForceShow(container);
        if (isForced) {
            container.removeAttribute(CONFIG.forceShownAttr);
        } else {
            container.setAttribute(CONFIG.forceShownAttr, 'true');
        }

        // Recompute visibility for this container only
        const mustShow = state.hiddenAreShown || shouldForceShow(container);
        const username = getUsernameFromArticle(container);
        if (mustShow) {
            clearHiddenStyles(container);
        } else {
            applyHiddenStyles(container);
        }
        updateStubText(container, username);
    };

    const hideContainerNonDestructively = (container) => {
        if (!state.enabled) return false;
        if (!container || container.nodeType !== Node.ELEMENT_NODE) return false;

        // Track that this container is under our control
        if (container.getAttribute(CONFIG.hiddenMarkerAttr) !== 'true') {
            container.setAttribute(CONFIG.hiddenMarkerAttr, 'true');
            state.hiddenCount += 1;
            updateWidgetCount();
        }

        // If globally shown, or manually forced shown, don't hide
        if (state.hiddenAreShown || shouldForceShow(container)) {
            container.setAttribute(CONFIG.hiddenActiveAttr, 'false');
            applyHideMode(container); // ensures stub exists/updates if partial
            clearHiddenStyles(container);
            return true;
        }

        // Apply hide if not already active
        if (container.getAttribute(CONFIG.hiddenActiveAttr) === 'true') return false;
        applyHiddenStyles(container);
        return true;
    };

    const setAllHiddenVisibility = (show) => {
        const root = document.querySelector(CONFIG.rootSelector) || document.body || document.documentElement;
        if (!root) return;

        const containers = root.querySelectorAll(`[${CONFIG.hiddenMarkerAttr}="true"]`);
        for (const el of containers) {
            if (!(el instanceof Element)) continue;

            // If forcing show, keep shown even when globally hiding
            const mustShow = show || shouldForceShow(el);
            if (mustShow) {
                clearHiddenStyles(el);
            } else {
                applyHiddenStyles(el);
            }

            if (settings.hide === 'partial') {
                const username = getUsernameFromArticle(el);
                updateStubText(el, username);
            }
        }
    };

    const toggleHiddenVisibility = () => {
        state.hiddenAreShown = !state.hiddenAreShown;

        // Show previously hidden OR hide them again.
        setAllHiddenVisibility(state.hiddenAreShown);
        updateWidgetCount();

        // If toggling back to hiding, do a scan soon to catch newly loaded content.
        if (!state.hiddenAreShown) {
            scheduleScan();
        }
    };

    const resetScans = () => {
        const root = document.querySelector(CONFIG.rootSelector) || document.body || document.documentElement;
        if (!root) return;
        const containers = root.querySelectorAll(`[${CONFIG.scannedAttr}="true"]`);
        for (const el of containers) {
            el.removeAttribute(CONFIG.scannedAttr);
        }
    };

    const scanArticle = (article) => {
        if (!(article instanceof Element)) return;
        if (article.getAttribute(CONFIG.hiddenMarkerAttr) === 'true') return;
        if (article.getAttribute(CONFIG.scannedAttr) === 'true') return;

        const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT, null);
        let processed = 0;

        const hasWhitelist = hasWhitelistedPhrase(article.textContent);

        while (walker.nextNode()) {
            processed += 1;
            if (processed > CONFIG.scan.maxTextNodesPerScan) {
                break;
            }

            const textNode = walker.currentNode;
            const hit = hasBlacklistedPhrase(textNode.nodeValue);
            if (hit) {
                hideContainerNonDestructively(article);
                return;
            }

            if (!hasWhitelist) {
                const greyHit = hasGreylistedPhrase(textNode.nodeValue);
                if (greyHit) {
                    console.debug('Greylist hit:', greyHit, 'in', textNode.nodeValue);
                    hideContainerNonDestructively(article);
                    return;
                }
            }
        }

        article.setAttribute(CONFIG.scannedAttr, 'true');
    };

    const scanOnce = () => {
        if (!state.enabled) return;

        // If you navigated away from home (SPA), stop doing work.
        if (!isInstagramHost() || !isInstagramHomeRoute()) {
            disable();
            return;
        }

        const root = document.querySelector(CONFIG.rootSelector) || document.body || document.documentElement;
        if (!root) return;

        const articles = root.querySelectorAll('article');
        for (const article of articles) {
            scanArticle(article);
        }
    };

    const scheduleScan = () => {
        if (!state.enabled) return;
        if (state.scanScheduled) return;
        state.scanScheduled = true;

        setTimeout(() => {
            state.scanScheduled = false;

            // If user toggled to "shown", don't waste time hiding new stuff.
            if (state.hiddenAreShown) return;
            scanOnce();
        }, CONFIG.scan.debounceMs);
    };

    const enable = () => {
        if (state.enabled) return;
        state.enabled = true;
        ensureWidget();
        scheduleScan();
    };

    const disable = () => {
        if (!state.enabled) return;
        state.enabled = false;

        // Keep widget as a subtle “stopped” indicator (optional).
        const widget = document.getElementById(CONFIG.ui.widgetId);
        if (widget) {
            const dot = widget.querySelector('.dot');
            if (dot) dot.style.background = '#e74c3c';
            const count = widget.querySelector('.count');
            if (count) count.textContent = 'Paused (not home)';
        }

        // Optional: remove widget entirely when not on home.
        // if (widget && widget.parentElement) widget.parentElement.removeChild(widget);
    };

    const hookSpaNavigation = () => {
        const originalPushState = history.pushState;
        const originalReplaceState = history.replaceState;

        const onNav = () => {
            // Run/stop based on current route.
            if (isInstagramHost() && isInstagramHomeRoute()) {
                enable();
            } else {
                disable();
            }
        };

        history.pushState = function (...args) {
            originalPushState.apply(this, args);
            setTimeout(onNav, 0);
        };

        history.replaceState = function (...args) {
            originalReplaceState.apply(this, args);
            setTimeout(onNav, 0);
        };

        window.addEventListener('popstate', () => setTimeout(onNav, 0));
    };

    const initialize = () => {
        ensureStyleTag(CONFIG.ui.styleId, buildInternalCss());
        ensureStyleTag(CONFIG.ui.userStyleId, USER_CSS || '');

        ensureWidget();
        updateWidgetCount();

        hookSpaNavigation();

        scanOnce();
        setTimeout(scanOnce, 500);
        setTimeout(scanOnce, 1500);

        const observeTarget =
            document.querySelector(CONFIG.rootSelector) || document.body || document.documentElement;

        state.observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (!(node instanceof Element)) continue;
                    if (node.matches?.('article')) {
                        scanArticle(node);
                    }
                    const articles = node.querySelectorAll?.('article');
                    if (articles && articles.length) {
                        for (const article of articles) {
                            scanArticle(article);
                        }
                    }
                    if (node.getAttribute?.(CONFIG.hiddenMarkerAttr) === 'true') {
                        if (!state.hiddenAreShown) {
                            applyHiddenStyles(node);
                        } else {
                            clearHiddenStyles(node);
                        }
                    }
                }
            }
            scheduleScan();
        });
        state.observer.observe(observeTarget, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['style', 'class'],
        });

        window.addEventListener('scroll', scheduleScan, { passive: true });
        document.addEventListener('click', () => setTimeout(scanOnce, 150));

        state.intervalId = window.setInterval(scanOnce, CONFIG.scan.periodicMs);
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize, { once: true });
    } else {
        initialize();
    }
})();
