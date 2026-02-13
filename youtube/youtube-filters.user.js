// ==UserScript==
// @name         YouTube - Feed Filters (Configurable)
// @namespace    http://jmann.me
// @version      0.1.0
// @description  Configurable YouTube feed filters: hide low-views (except subs), old videos, shorts shelves, watched videos.
// @author       Jess Mann
// @match        https://www.youtube.com/*
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_registerMenuCommand
// ==/UserScript==

(() => {
    "use strict";

    // ---------------------------
    // Logging
    // ---------------------------
    const SCRIPT_NAME = "[YT Feed Filters]";
    const log = {
        debug: (...args) => console.debug(SCRIPT_NAME, ...args),
        info: (...args) => console.info(SCRIPT_NAME, ...args),
        warn: (...args) => console.warn(SCRIPT_NAME, ...args),
        error: (...args) => console.error(SCRIPT_NAME, ...args),
    };

    // ---------------------------
    // Settings
    // ---------------------------
    const SETTINGS_KEY = "yt_feed_filters_settings_v1";
    const SUBS_CACHE_KEY = "yt_feed_filters_subscriptions_cache_v1";

    const DEFAULT_SETTINGS = {
        filters: {
            hideLowViews: {
                enabled: true,
                settings: {
                    minViews: 10_000,
                    minWatching: 500,
                    ignoreSubscribedChannels: true,
                    refreshSubscriptions: true,
                },
            },
            hideOldVideos: {
                enabled: true,
                settings: {
                    maxYears: 1,
                },
            },
            hideShelves: {
                enabled: true,
                settings: {
                    enabledOnHome: true,
                },
            },
            hideWatchedVideos: {
                enabled: true,
                settings: {
                    enabledOnHome: true,
                    enabledOnSubscriptions: true,
                },
            },
        },
        ui: {},
    };

    class SettingsStore {
        static load() {
            try {
                const raw = GM_getValue(SETTINGS_KEY, null);
                if (!raw) return structuredClone(DEFAULT_SETTINGS);
                const parsed = JSON.parse(raw);
                return SettingsStore._merge(DEFAULT_SETTINGS, parsed);
            } catch (error) {
                log.error("Failed to load settings; using defaults.", error);
                return structuredClone(DEFAULT_SETTINGS);
            }
        }

        static save(settings) {
            try {
                GM_setValue(SETTINGS_KEY, JSON.stringify(settings));
            } catch (error) {
                log.error("Failed to save settings.", error);
            }
        }

        static reset() {
            try {
                GM_deleteValue(SETTINGS_KEY);
            } catch (error) {
                log.error("Failed to reset settings.", error);
            }
        }

        static _merge(base, override) {
            if (override === null || override === undefined) return base;
            if (Array.isArray(base)) return Array.isArray(override) ? override : base;
            if (typeof base !== "object" || typeof override !== "object") return override;

            const result = { ...base };
            for (const [key, value] of Object.entries(override)) {
                if (key in base) {
                    result[key] = SettingsStore._merge(base[key], value);
                } else {
                    result[key] = value;
                }
            }
            return result;
        }
    }

    // ---------------------------
    // Page predicates
    // ---------------------------
    class Page {
        static isHome() {
            const url = new URL(window.location.href);
            return url.hostname.includes("youtube.com") && url.pathname === "/";
        }

        static isSubscriptionsFeed() {
            const url = new URL(window.location.href);
            return url.pathname.startsWith("/feed/subscriptions");
        }

        static isEligibleFeedPage() {
            return Page.isHome() || Page.isSubscriptionsFeed();
        }
    }

    // ---------------------------
    // Utilities
    // ---------------------------
    class Dom {
        static debounceTick(callback) {
            let pending = false;
            return () => {
                if (pending) return;
                pending = true;
                queueMicrotask(() => {
                    pending = false;
                    callback();
                });
            };
        }

        static safeText(element) {
            return (element?.textContent ?? "").trim();
        }

        static hide(element) {
            if (!element) return false;
            /**
            if (element.style.display === "none") return false;
            element.style.display = "none";
            */
            // check if class applies already
            if (element.classList.contains("hiddenVM")) return false;
            // Add class "hiddenVM"
            element.classList.add("hiddenVM");
            log.debug("Applied 'hiddenVM' class to element:", element);
            return true;
        }

        /**
         * Create an element with attributes and children without innerHTML.
         * @param {string} tagName
         * @param {{className?:string, id?:string, attrs?:Record<string,string>, text?:string}} options
         * @param {(Node|string)[]} children
         * @returns {HTMLElement}
         */
        static create(tagName, options = {}, children = []) {
            const element = document.createElement(tagName);
            if (options.id) element.id = options.id;
            if (options.className) element.className = options.className;
            if (options.text !== undefined) element.textContent = options.text;
            if (options.attrs) {
                for (const [key, value] of Object.entries(options.attrs)) {
                    element.setAttribute(key, value);
                }
            }
            for (const child of children) {
                element.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
            }
            return element;
        }
    }

    class Parsers {
        static parseCount(text) {
            const normalized = (text || "").trim().toLowerCase();
            const match = normalized.match(/([\d.]+)\s*([km])?\s*(views|watching)\b/);
            if (!match) return null;

            let count = Number.parseFloat(match[1]);
            if (!Number.isFinite(count)) count = 0;

            const suffix = match[2];
            if (suffix === "k") count *= 1_000;
            if (suffix === "m") count *= 1_000_000;

            const kind = match[3] === "watching" ? "watching" : "views";
            return { count, kind };
        }

        static parseYearsAgo(text) {
            const normalized = (text || "").trim().toLowerCase();
            const match = normalized.match(/\s(\d+)\s+years\s+ago$/);
            if (!match) return null;
            const years = Number.parseInt(match[1], 10);
            return Number.isFinite(years) ? years : null;
        }
    }

    // ---------------------------
    // Subscription cache
    // ---------------------------
    class SubscriptionCache {
        constructor() {
            this.cached = null;
            this.lastRefreshAtMs = 0;
        }

        load() {
            try {
                const raw = GM_getValue(SUBS_CACHE_KEY, null);
                if (!raw) return null;
                const parsed = JSON.parse(raw);
                if (!Array.isArray(parsed?.channels)) return null;

                this.cached = parsed.channels.filter(Boolean);
                this.lastRefreshAtMs = Number(parsed?.refreshedAtMs || 0) || 0;
                return this.cached;
            } catch (error) {
                log.error("Failed to load subscriptions cache.", error);
                return null;
            }
        }

        save(channels) {
            try {
                GM_setValue(
                    SUBS_CACHE_KEY,
                    JSON.stringify({
                        channels,
                        refreshedAtMs: Date.now(),
                    }),
                );
                this.cached = channels;
                this.lastRefreshAtMs = Date.now();
            } catch (error) {
                log.error("Failed to save subscriptions cache.", error);
            }
        }

        async refreshFromGuide() {
            const section = await this._waitForSubscriptionsSection(10_000);
            if (!section) return null;

            await this._expandIfNeeded(section);
            const channels = this._parseSubscriptions(section);
            if (channels.length > 0) this.save(channels);
            return channels.length > 0 ? channels : null;
        }

        async _waitForSubscriptionsSection(maxWaitMs) {
            const start = performance.now();
            while (performance.now() - start < maxWaitMs) {
                const sections = document.querySelectorAll("ytd-guide-section-renderer");
                for (const section of sections) {
                    const header = section.querySelector("h3 #guide-section-title");
                    if (Dom.safeText(header) === "Subscriptions") return section;
                }
                await new Promise((r) => setTimeout(r, 500));
            }
            return null;
        }

        async _expandIfNeeded(subscriptionsSection) {
            const button = subscriptionsSection.querySelector('a[title="Show more"]');
            if (!button) return;
            button.click();
            await this._waitForStabilize(subscriptionsSection);
        }

        _waitForStabilize(container) {
            return new Promise((resolve) => {
                let previousCount = container.querySelectorAll("ytd-guide-entry-renderer").length;
                const observer = new MutationObserver(() => {
                    const currentCount = container.querySelectorAll("ytd-guide-entry-renderer").length;
                    if (currentCount === previousCount) {
                        observer.disconnect();
                        resolve();
                        return;
                    }
                    previousCount = currentCount;
                });
                observer.observe(container, { childList: true, subtree: true });
                setTimeout(() => {
                    observer.disconnect();
                    resolve();
                }, 3_000);
            });
        }

        _parseSubscriptions(subscriptionsSection) {
            const entries = subscriptionsSection.querySelectorAll("ytd-guide-entry-renderer a[title]");
            return Array.from(entries)
                .map((el) => (el?.title || "").trim())
                .filter(Boolean);
        }
    }

    // ---------------------------
    // Filter framework
    // ---------------------------
    class FilterContext {
        constructor(settings) {
            this.settings = settings;
            this.subscriptions = [];
            this.metrics = { totalHidden: 0 };
        }
    }

    class BaseFilter {
        constructor(meta) {
            this.id = meta.id;
            this.title = meta.title;
            this.description = meta.description;
        }

        isEnabled(context) {
            return Boolean(context.settings.filters?.[this.id]?.enabled);
        }

        getSettings(context) {
            return context.settings.filters?.[this.id]?.settings ?? {};
        }

        appliesToPage(_context) {
            return Page.isEligibleFeedPage();
        }

        apply(_context) {
            throw new Error("Not implemented");
        }

        getSettingsSchema() {
            return [];
        }
    }

    class HideLowViewsFilter extends BaseFilter {
        constructor(subscriptionCache) {
            super({
                id: "hideLowViews",
                title: "Hide low-view videos (except subscriptions)",
                description: "Hides videos with low views or low 'watching' counts, unless from a subscribed channel.",
            });
            this.subscriptionCache = subscriptionCache;
            this._totalHidden = 0;
        }

        appliesToPage() {
            return Page.isHome();
        }

        getSettingsSchema() {
            return [
                { key: "minViews", label: "Minimum views", type: "number", min: 0, step: 1000, help: "Hide if below this (unless subscribed)." },
                { key: "minWatching", label: "Minimum watching", type: "number", min: 0, step: 50, help: "For livestreams using 'watching'." },
                { key: "ignoreSubscribedChannels", label: "Do not hide subscribed channels", type: "toggle" },
                { key: "refreshSubscriptions", label: "Refresh subscription list automatically", type: "toggle" },
            ];
        }

        apply(context) {
            const settings = this.getSettings(context);
            const minViews = Number(settings.minViews ?? 10_000);
            const minWatching = Number(settings.minWatching ?? 500);
            const ignoreSubscribedChannels = Boolean(settings.ignoreSubscribedChannels ?? true);

            const videoBlocks = document.querySelectorAll("ytd-rich-item-renderer");
            let hiddenNow = 0;

            for (const block of videoBlocks) {
                if (!block || block.style.display === "none") continue;

                const channelLink = block.querySelector("ytd-channel-name a.yt-simple-endpoint");
                const metaSpans = block.querySelectorAll("span.inline-metadata-item.style-scope.ytd-video-meta-block");
                const titleEl = block.querySelector("#video-title");

                const channelName = Dom.safeText(channelLink);
                if (ignoreSubscribedChannels && channelName && context.subscriptions.includes(channelName)) continue;

                let countInfo = null;
                for (const span of metaSpans) {
                    countInfo = Parsers.parseCount(Dom.safeText(span));
                    if (countInfo) break;
                }
                if (!countInfo) continue;

                const shouldHide =
                    (countInfo.kind === "views" && countInfo.count < minViews) ||
                    (countInfo.kind === "watching" && countInfo.count < minWatching);

                if (shouldHide && Dom.hide(block)) {
                    hiddenNow += 1;
                    this._totalHidden += 1;

                    if (hiddenNow <= 5) {
                        log.debug(`Hidden: "${Dom.safeText(titleEl)}" by ${channelName || "(unknown)"} (${Math.round(countInfo.count)} ${countInfo.kind})`);
                    }
                }
            }

            if (hiddenNow > 0) {
                context.metrics.totalHidden += hiddenNow;
                log.info(`Low-views filter hid ${hiddenNow} videos (${this._totalHidden} total this session).`);
            } else {
                log.debug("Low-views filter found no videos to hide.");
            }
        }
    }

    class HideOldVideosFilter extends BaseFilter {
        constructor() {
            super({
                id: "hideOldVideos",
                title: "Hide old videos",
                description: "Hides videos older than N years (based on 'X years ago').",
            });
            this._totalHidden = 0;
        }

        appliesToPage() {
            return Page.isHome();
        }

        getSettingsSchema() {
            return [{ key: "maxYears", label: "Maximum years old", type: "number", min: 0, step: 1 }];
        }

        apply(context) {
            const settings = this.getSettings(context);
            const maxYears = Number(settings.maxYears ?? 1);

            const metaSpans = document.querySelectorAll("#primary ytd-rich-item-renderer .yt-content-metadata-view-model__metadata-row");
            let hiddenNow = 0;
            log.debug(`Old-videos filter checking ${metaSpans.length} total videos`);

            for (const span of metaSpans) {
                const years = Parsers.parseYearsAgo(Dom.safeText(span));
                log.debug(`Old-videos filter checking date: "${Dom.safeText(span)}" => ${years} years.`);
                if (years === null) {
                    log.debug(`Old-videos filter skipping unrecognized date: "${Dom.safeText(span)}".`);
                    continue;
                }
                if (years <= maxYears) continue;

                const container = span.closest("ytd-rich-item-renderer");
                if (!container) continue;

                if (Dom.hide(container)) {
                    log.debug(`Old-videos filter hid video older than ${maxYears} years (${years} years).`);
                    hiddenNow += 1;
                    this._totalHidden += 1;
                }
            }

            if (hiddenNow > 0) {
                context.metrics.totalHidden += hiddenNow;
                log.info(`Old-videos filter hid ${hiddenNow} videos (> ${maxYears} years).`);
            } else {
                log.debug(`Old-videos filter found no videos older than ${maxYears} years.`);
            }
        }
    }

    class HideShelvesFilter extends BaseFilter {
        constructor() {
            super({
                id: "hideShelves",
                title: "Hide shelves",
                description: 'Hides specific shelves (like "Shorts") on the home feed.',
            });
            this._totalHidden = 0;
        }

        appliesToPage() {
            return Page.isHome();
        }

        getSettingsSchema() {
            return [{ key: "enabledOnHome", label: "Enabled on Home", type: "toggle" }];
        }

        apply(context) {
            const settings = this.getSettings(context);
            if (!Boolean(settings.enabledOnHome ?? true)) return;

            const titles = document.querySelectorAll("span#title.style-scope.ytd-rich-shelf-renderer");
            let hiddenNow = 0;

            for (const title of titles) {
                // Hide "Shorts", "YouTube Playables"
                const safeText = Dom.safeText(title);
                if (safeText !== "Shorts" && safeText !== "YouTube Playables") continue;
                const section = title.closest("ytd-rich-section-renderer");
                if (!section) continue;

                if (Dom.hide(section)) {
                    hiddenNow += 1;
                    this._totalHidden += 1;
                }
            }

            if (hiddenNow > 0) {
                context.metrics.totalHidden += hiddenNow;
                log.info(`Hide-shelves filter hid ${hiddenNow} sections.`);
            } else {
                log.debug("Hide-shelves filter found no sections to hide.");
            }
        }
    }

    class HideWatchedVideosFilter extends BaseFilter {
        constructor() {
            super({
                id: "hideWatchedVideos",
                title: "Hide watched videos",
                description: "Hides videos with the resume/progress overlay (watched or partially watched).",
            });
            this._totalHidden = 0;
        }

        appliesToPage(context) {
            const settings = this.getSettings(context);
            const onHome = Boolean(settings.enabledOnHome ?? true) && Page.isHome();
            const onSubs = Boolean(settings.enabledOnSubscriptions ?? true) && Page.isSubscriptionsFeed();
            return onHome || onSubs;
        }

        getSettingsSchema() {
            return [
                { key: "enabledOnHome", label: "Enabled on Home", type: "toggle" },
                { key: "enabledOnSubscriptions", label: "Enabled on Subscriptions feed", type: "toggle" },
            ];
        }

        apply(context) {
            const watchedOverlays = document.querySelectorAll("ytd-thumbnail-overlay-resume-playback-renderer");
            let hiddenNow = 0;

            for (const overlay of watchedOverlays) {
                const container = overlay.closest("ytd-rich-item-renderer, ytd-grid-video-renderer, ytd-video-renderer");
                if (!container) continue;

                if (Dom.hide(container)) {
                    hiddenNow += 1;
                    this._totalHidden += 1;
                }
            }

            if (hiddenNow > 0) {
                context.metrics.totalHidden += hiddenNow;
                log.info(`Watched-videos filter hid ${hiddenNow} videos.`);
            } else {
                log.debug("Watched-videos filter found no videos to hide.");
            }
        }
    }

    // ---------------------------
    // Engine
    // ---------------------------
    class FilterEngine {
        constructor(filters) {
            this.filters = filters;
            this.settings = SettingsStore.load();
            this.context = new FilterContext(this.settings);

            this.subscriptionCache = null;
            this.observer = null;

            this._runOnceDebounced = Dom.debounceTick(() => this.runOnce());
        }

        setSubscriptionCache(subscriptionCache) {
            this.subscriptionCache = subscriptionCache;
            return this;
        }

        start() {
            GM_registerMenuCommand("YouTube Feed Filters: Settings", () => SettingsUi.open(this));
            GM_registerMenuCommand("YouTube Feed Filters: Run now", () => this.runOnce());
            GM_registerMenuCommand("YouTube Feed Filters: Reset settings", () => {
                SettingsStore.reset();
                this.reloadSettings();
                this.runOnce();
            });

            if (this.subscriptionCache) {
                const cached = this.subscriptionCache.load();
                if (cached?.length) {
                    this.context.subscriptions = cached;
                    log.info(`Loaded ${cached.length} cached subscriptions.`);
                }
            }

            this._attachObserver();
            this.runOnce();

            this._maybeRefreshSubscriptionsInBackground().catch((error) => {
                log.warn("Subscription refresh failed.", error);
            });

            this._hookSpaNavigation();
        }

        reloadSettings() {
            this.settings = SettingsStore.load();
            this.context = new FilterContext(this.settings);

            if (this.subscriptionCache) {
                const cached = this.subscriptionCache.load();
                if (cached?.length) this.context.subscriptions = cached;
            }
        }

        persistSettings() {
            SettingsStore.save(this.settings);
        }

        _attachObserver() {
            if (this.observer) this.observer.disconnect();

            this.observer = new MutationObserver(() => {
                if (!Page.isEligibleFeedPage()) return;
                this._runOnceDebounced();
            });

            this.observer.observe(document.body, { childList: true, subtree: true });
        }

        _hookSpaNavigation() {
            const originalPushState = history.pushState;
            const originalReplaceState = history.replaceState;

            const onNav = () => {
                this.reloadSettings();
                this.runOnce();
            };

            history.pushState = function (...args) {
                originalPushState.apply(this, args);
                onNav();
            };

            history.replaceState = function (...args) {
                originalReplaceState.apply(this, args);
                onNav();
            };

            window.addEventListener("popstate", onNav);
        }

        async _maybeRefreshSubscriptionsInBackground() {
            const lowViewsState = this.settings.filters.hideLowViews;
            if (!lowViewsState?.enabled) return;

            const refresh = Boolean(lowViewsState.settings?.refreshSubscriptions ?? true);
            if (!refresh) return;

            if (!this.subscriptionCache) return;
            if (!Page.isHome()) return;

            const updated = await this.subscriptionCache.refreshFromGuide();
            if (updated?.length) {
                this.context.subscriptions = updated;
                log.info(`Refreshed subscriptions: ${updated.length} channels.`);
                this.runOnce();
            }
        }

        runOnce() {
            if (!Page.isEligibleFeedPage()) return;

            for (const filter of this.filters) {
                try {
                    if (!filter.isEnabled(this.context)) continue;
                    if (!filter.appliesToPage(this.context)) continue;
                    filter.apply(this.context);
                } catch (error) {
                    log.error(`Filter "${filter.id}" failed.`, error);
                }
            }
        }
    }

    // ---------------------------
    // Settings UI (Trusted Types safe)
    // ---------------------------
    class SettingsUi {
        static open(engine) {
            engine.reloadSettings();

            const existing = document.getElementById("ytff-settings-modal");
            if (existing) existing.remove();

            SettingsUi._ensureStyleInjected();

            const modal = Dom.create("div", { id: "ytff-settings-modal" });
            const panel = Dom.create("div", { className: "ytff-panel", attrs: { role: "dialog", "aria-modal": "true", tabindex: "-1" } });

            // Header
            const header = Dom.create("div", { className: "ytff-header" });
            const headerLeft = Dom.create("div");
            headerLeft.appendChild(Dom.create("h2", { text: "YouTube Feed Filters" }));
            headerLeft.appendChild(Dom.create("div", { className: "ytff-sub", text: "Configure filters. Changes apply immediately after saving." }));

            const headerActions = Dom.create("div", { className: "ytff-actions" });
            headerActions.appendChild(SettingsUi._button("Run now", "run"));
            headerActions.appendChild(SettingsUi._button("Reset", "reset"));
            headerActions.appendChild(SettingsUi._button("Close", "close"));

            header.appendChild(headerLeft);
            header.appendChild(headerActions);

            // Content
            const content = Dom.create("div", { className: "ytff-content" });
            for (const filter of engine.filters) {
                content.appendChild(SettingsUi._renderFilterCard(engine, filter));
            }

            // Footer
            const footer = Dom.create("div", { className: "ytff-footer" });
            const footerLeft = Dom.create("div");
            footerLeft.appendChild(document.createTextNode("Menu: "));
            const code = Dom.create("code", { text: "Tampermonkey → YouTube Feed Filters: Settings" });
            footerLeft.appendChild(code);

            const footerRight = Dom.create("div");
            const saveButton = SettingsUi._button("Save", "save");
            saveButton.classList.add("primary");
            footerRight.appendChild(saveButton);

            footer.appendChild(footerLeft);
            footer.appendChild(footerRight);

            panel.appendChild(header);
            panel.appendChild(content);
            panel.appendChild(footer);
            modal.appendChild(panel);

            document.body.appendChild(modal);
            SettingsUi._wire(modal, panel, engine);
            panel.focus();
        }

        static _button(label, action) {
            return Dom.create("button", { className: "ytff-btn", text: label, attrs: { "data-action": action, type: "button" } });
        }

        static _renderFilterCard(engine, filter) {
            const settings = engine.settings;
            const state = settings.filters[filter.id] ?? { enabled: false, settings: {} };
            const schema = filter.getSettingsSchema();

            const card = Dom.create("section", { className: "ytff-card" });
            const head = Dom.create("div", { className: "ytff-card-head" });

            const titleWrap = Dom.create("div", { className: "ytff-card-title" });
            titleWrap.appendChild(Dom.create("div", { className: "ytff-title", text: filter.title }));
            titleWrap.appendChild(Dom.create("div", { className: "ytff-desc", text: filter.description }));

            const toggleWrap = Dom.create("label", { className: "ytff-toggle" });
            toggleWrap.appendChild(Dom.create("span", { text: "Enabled" }));
            const enabledToggle = Dom.create("input", {
                attrs: { type: "checkbox", "data-filter-enable": filter.id },
            });
            enabledToggle.checked = Boolean(state.enabled);
            toggleWrap.appendChild(enabledToggle);

            head.appendChild(titleWrap);
            head.appendChild(toggleWrap);

            const fields = Dom.create("div", { className: "ytff-fields" });

            if (!schema.length) {
                fields.appendChild(Dom.create("div", { className: "ytff-help", text: "No settings for this filter." }));
            } else {
                for (const field of schema) {
                    fields.appendChild(SettingsUi._renderField(filter.id, state, field));
                }
            }

            card.appendChild(head);
            card.appendChild(fields);
            return card;
        }

        static _renderField(filterId, state, field) {
            const wrapper = Dom.create("div");

            const row = Dom.create("label", { className: "ytff-row" });
            row.appendChild(Dom.create("span", { className: "ytff-label", text: field.label }));

            const value = state.settings?.[field.key];

            if (field.type === "toggle") {
                const input = Dom.create("input", { attrs: { type: "checkbox", "data-filter": filterId, "data-key": field.key } });
                input.checked = value === undefined ? false : Boolean(value);
                row.appendChild(input);
            } else if (field.type === "number") {
                const input = Dom.create("input", {
                    attrs: {
                        type: "number",
                        "data-filter": filterId,
                        "data-key": field.key,
                        min: field.min !== undefined ? String(field.min) : "",
                        max: field.max !== undefined ? String(field.max) : "",
                        step: field.step !== undefined ? String(field.step) : "1",
                    },
                });
                input.value = value === undefined || value === null ? "" : String(value);
                row.appendChild(input);
            }

            wrapper.appendChild(row);

            if (field.help) {
                wrapper.appendChild(Dom.create("div", { className: "ytff-help", text: field.help }));
            }

            return wrapper;
        }

        static _wire(modal, panel, engine) {
            const close = () => modal.remove();

            const saveFromUi = () => {
                const settings = engine.settings;

                for (const toggle of modal.querySelectorAll("input[type='checkbox'][data-filter-enable]")) {
                    const filterId = toggle.getAttribute("data-filter-enable");
                    if (!settings.filters[filterId]) settings.filters[filterId] = { enabled: false, settings: {} };
                    settings.filters[filterId].enabled = Boolean(toggle.checked);
                }

                for (const input of modal.querySelectorAll("input[data-filter][data-key]")) {
                    const filterId = input.getAttribute("data-filter");
                    const key = input.getAttribute("data-key");
                    if (!settings.filters[filterId]) settings.filters[filterId] = { enabled: false, settings: {} };
                    if (!settings.filters[filterId].settings) settings.filters[filterId].settings = {};

                    if (input.type === "checkbox") {
                        settings.filters[filterId].settings[key] = Boolean(input.checked);
                    } else if (input.type === "number") {
                        const parsed = Number(input.value);
                        settings.filters[filterId].settings[key] = Number.isFinite(parsed) ? parsed : input.value;
                    } else {
                        settings.filters[filterId].settings[key] = input.value;
                    }
                }

                engine.persistSettings();
                engine.reloadSettings();
                engine.runOnce();
                close();
            };

            const onAction = (action) => {
                if (action === "close") close();
                if (action === "run") engine.runOnce();
                if (action === "save") saveFromUi();
                if (action === "reset") {
                    SettingsStore.reset();
                    engine.reloadSettings();
                    close();
                    SettingsUi.open(engine);
                }
            };

            modal.addEventListener("click", (event) => {
                if (event.target === modal) close();
                const button = event.target.closest("button[data-action]");
                if (!button) return;
                onAction(button.getAttribute("data-action"));
            });

            window.addEventListener(
                "keydown",
                (event) => {
                    if (event.key === "Escape") close();
                },
                { once: true },
            );

            // Simple focus trap
            modal.addEventListener("keydown", (event) => {
                if (event.key !== "Tab") return;
                const focusables = panel.querySelectorAll("button, input, [tabindex]:not([tabindex='-1'])");
                if (!focusables.length) return;

                const first = focusables[0];
                const last = focusables[focusables.length - 1];
                const active = document.activeElement;

                if (event.shiftKey && active === first) {
                    event.preventDefault();
                    last.focus();
                } else if (!event.shiftKey && active === last) {
                    event.preventDefault();
                    first.focus();
                }
            });
        }

        static _ensureStyleInjected() {
            if (document.getElementById("ytff-style")) {
                log.debug("Styles already injected.");
                return;
            }
            const style = document.createElement("style");
            style.id = "ytff-style";
            style.textContent = `
#ytff-settings-modal{position:fixed;inset:0;z-index:999999;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;padding:24px}
.ytff-panel{width:min(900px,96vw);max-height:90vh;overflow:auto;background:#111;color:#f5f5f5;border:1px solid rgba(255,255,255,.12);border-radius:14px;box-shadow:0 18px 60px rgba(0,0,0,.55);font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif}
.ytff-header{position:sticky;top:0;background:#111;padding:16px 18px;border-bottom:1px solid rgba(255,255,255,.12);display:flex;gap:12px;align-items:center;justify-content:space-between}
.ytff-header h2{margin:0;font-size:16px;font-weight:650;letter-spacing:.2px}
.ytff-header .ytff-sub{font-size:12px;opacity:.8;margin-top:2px}
.ytff-actions{display:flex;gap:8px;align-items:center}
.ytff-btn{background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.14);color:#f5f5f5;border-radius:10px;padding:8px 10px;cursor:pointer;font-size:12px}
.ytff-btn:hover{background:rgba(255,255,255,.12)}
.ytff-btn.primary{background:rgba(66,133,244,.25);border-color:rgba(66,133,244,.55)}
.ytff-btn.primary:hover{background:rgba(66,133,244,.35)}
.ytff-content{padding:16px 18px 20px;display:grid;gap:12px}
.ytff-card{border:1px solid rgba(255,255,255,.12);border-radius:14px;padding:14px;background:rgba(255,255,255,.04)}
.ytff-card-head{display:flex;justify-content:space-between;gap:14px;align-items:flex-start}
.ytff-title{font-size:14px;font-weight:650;margin-bottom:4px}
.ytff-desc{font-size:12px;opacity:.8;line-height:1.35}
.ytff-toggle{display:flex;gap:8px;align-items:center;font-size:12px;opacity:.95;white-space:nowrap}
.ytff-fields{margin-top:12px;display:grid;gap:8px}
.ytff-row{display:flex;justify-content:space-between;gap:10px;align-items:center}
.ytff-label{font-size:12px;opacity:.95}
.ytff-help{font-size:11px;opacity:.75;line-height:1.35;margin-top:-4px}
.ytff-row input[type="number"]{width:160px;background:rgba(0,0,0,.25);border:1px solid rgba(255,255,255,.14);color:#f5f5f5;border-radius:10px;padding:6px 8px}
.ytff-row input[type="checkbox"]{transform:translateY(1px)}
.ytff-footer{position:sticky;bottom:0;background:#111;padding:12px 18px;border-top:1px solid rgba(255,255,255,.12);display:flex;justify-content:space-between;gap:10px;align-items:center;font-size:12px;opacity:.9}
.ytff-footer code{opacity:.85}
.hiddenVM { opacity: 0.1 !important; display: none !important; }
.ytwTalkToRecsHost { display: none !important; }
button[aria-label="Create"] { display: none !important; }
      `;
            document.head.appendChild(style);
            log.info("Injected styles.");
        }
    }

    // ---------------------------
    // Bootstrap
    // ---------------------------
    const subscriptionCache = new SubscriptionCache();
    const engine = new FilterEngine([
        new HideLowViewsFilter(subscriptionCache),
        new HideOldVideosFilter(),
        new HideShelvesFilter(),
        new HideWatchedVideosFilter(),
    ]).setSubscriptionCache(subscriptionCache);

    try {
        SettingsUi._ensureStyleInjected();
        engine.start();
        log.info("Initialized.");
    } catch (error) {
        log.error("Failed to initialize.", error);
    }
})();
