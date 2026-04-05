// ==UserScript==
// @name         YouTube - Feed Filters (Configurable)
// @namespace    http://jmann.me
// @version      0.2.0
// @description  Configurable YouTube feed filters: hide low-views (except subs), old videos, shorts shelves, watched videos, and keyword-blocked titles/channels.
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
                settings: { maxYears: 1 },
            },
            hideShelves: {
                enabled: true,
                settings: { enabledOnHome: true },
            },
            hideWatchedVideos: {
                enabled: true,
                settings: {
                    enabledOnHome: true,
                    enabledOnSubscriptions: true,
                },
            },
            hideKeywords: {
                enabled: false,
                settings: {
                    keywords: [],   // array of { text, matchTitle, matchChannel, caseSensitive }
                    enabledOnHome: true,
                    enabledOnSubscriptions: true,
                    enabledOnSearch: false,
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
                return SettingsStore._merge(DEFAULT_SETTINGS, JSON.parse(raw));
            } catch (err) {
                log.error("Failed to load settings; using defaults.", err);
                return structuredClone(DEFAULT_SETTINGS);
            }
        }

        static save(settings) {
            try { GM_setValue(SETTINGS_KEY, JSON.stringify(settings)); }
            catch (err) { log.error("Failed to save settings.", err); }
        }

        static reset() {
            try { GM_deleteValue(SETTINGS_KEY); }
            catch (err) { log.error("Failed to reset settings.", err); }
        }

        static _merge(base, override) {
            if (override == null) return base;
            if (Array.isArray(base)) return Array.isArray(override) ? override : base;
            if (typeof base !== "object" || typeof override !== "object") return override;
            const result = { ...base };
            for (const [k, v] of Object.entries(override)) {
                result[k] = k in base ? SettingsStore._merge(base[k], v) : v;
            }
            return result;
        }
    }

    // ---------------------------
    // Page predicates
    // ---------------------------
    class Page {
        static isHome() { return new URL(location.href).pathname === "/"; }
        static isSubscriptionsFeed() { return location.pathname.startsWith("/feed/subscriptions"); }
        static isSearch() { return location.pathname.startsWith("/results"); }
        static isEligibleFeedPage() { return Page.isHome() || Page.isSubscriptionsFeed(); }
    }

    // ---------------------------
    // Utilities
    // ---------------------------
    class Dom {
        static debounceTick(fn) {
            let pending = false;
            return () => {
                if (pending) return;
                pending = true;
                queueMicrotask(() => { pending = false; fn(); });
            };
        }

        static safeText(el) { return (el?.textContent ?? "").trim(); }

        static hide(el) {
            if (!el || el.classList.contains("ytff-hidden")) return false;
            el.classList.add("ytff-hidden");
            return true;
        }

        static show(el) {
            if (!el) return;
            el.classList.remove("ytff-hidden");
        }

        static create(tag, opts = {}, children = []) {
            const el = document.createElement(tag);
            if (opts.id) el.id = opts.id;
            if (opts.className) el.className = opts.className;
            if (opts.text !== undefined) el.textContent = opts.text;
            if (opts.attrs) for (const [k, v] of Object.entries(opts.attrs)) el.setAttribute(k, v);
            for (const c of children) el.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
            return el;
        }
    }

    class Parsers {
        static parseCount(text) {
            const m = (text || "").trim().toLowerCase().match(/([\d.]+)\s*([km])?\s*(views|watching)\b/);
            if (!m) return null;
            let count = parseFloat(m[1]);
            if (!isFinite(count)) count = 0;
            if (m[2] === "k") count *= 1_000;
            if (m[2] === "m") count *= 1_000_000;
            return { count, kind: m[3] === "watching" ? "watching" : "views" };
        }

        static parseYearsAgo(text) {
            const m = (text || "").trim().toLowerCase().match(/\s(\d+)\s+years\s+ago$/);
            if (!m) return null;
            const y = parseInt(m[1], 10);
            return isFinite(y) ? y : null;
        }
    }

    // ---------------------------
    // Subscription cache
    // ---------------------------
    class SubscriptionCache {
        constructor() { this.cached = null; this.lastRefreshAtMs = 0; }

        load() {
            try {
                const raw = GM_getValue(SUBS_CACHE_KEY, null);
                if (!raw) return null;
                const p = JSON.parse(raw);
                if (!Array.isArray(p?.channels)) return null;
                this.cached = p.channels.filter(Boolean);
                this.lastRefreshAtMs = Number(p?.refreshedAtMs || 0) || 0;
                return this.cached;
            } catch (err) { log.error("Failed to load subs cache.", err); return null; }
        }

        save(channels) {
            try {
                GM_setValue(SUBS_CACHE_KEY, JSON.stringify({ channels, refreshedAtMs: Date.now() }));
                this.cached = channels;
                this.lastRefreshAtMs = Date.now();
            } catch (err) { log.error("Failed to save subs cache.", err); }
        }

        async refreshFromGuide() {
            const section = await this._waitForSubscriptionsSection(10_000);
            if (!section) return null;
            await this._expandIfNeeded(section);
            const channels = this._parseSubscriptions(section);
            if (channels.length > 0) this.save(channels);
            return channels.length > 0 ? channels : null;
        }

        async _waitForSubscriptionsSection(maxMs) {
            const start = performance.now();
            while (performance.now() - start < maxMs) {
                for (const s of document.querySelectorAll("ytd-guide-section-renderer")) {
                    if (Dom.safeText(s.querySelector("h3 #guide-section-title")) === "Subscriptions") return s;
                }
                await new Promise(r => setTimeout(r, 500));
            }
            return null;
        }

        async _expandIfNeeded(section) {
            const btn = section.querySelector('a[title="Show more"]');
            if (!btn) return;
            btn.click();
            await this._waitForStabilize(section);
        }

        _waitForStabilize(container) {
            return new Promise(resolve => {
                let prev = container.querySelectorAll("ytd-guide-entry-renderer").length;
                const obs = new MutationObserver(() => {
                    const cur = container.querySelectorAll("ytd-guide-entry-renderer").length;
                    if (cur === prev) { obs.disconnect(); resolve(); return; }
                    prev = cur;
                });
                obs.observe(container, { childList: true, subtree: true });
                setTimeout(() => { obs.disconnect(); resolve(); }, 3_000);
            });
        }

        _parseSubscriptions(section) {
            return Array.from(section.querySelectorAll("ytd-guide-entry-renderer a[title]"))
                .map(el => (el?.title || "").trim()).filter(Boolean);
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
        constructor(meta) { this.id = meta.id; this.title = meta.title; this.description = meta.description; }
        isEnabled(ctx) { return Boolean(ctx.settings.filters?.[this.id]?.enabled); }
        getSettings(ctx) { return ctx.settings.filters?.[this.id]?.settings ?? {}; }
        appliesToPage(_ctx) { return Page.isEligibleFeedPage(); }
        apply(_ctx) { throw new Error("Not implemented"); }
        getSettingsSchema() { return []; }
    }

    // ---- Filter: Hide Low Views ----
    class HideLowViewsFilter extends BaseFilter {
        constructor(subscriptionCache) {
            super({
                id: "hideLowViews",
                title: "Hide low-view videos",
                description: "Hides videos with low views or low 'watching' counts, unless from a subscribed channel.",
            });
            this.subscriptionCache = subscriptionCache;
            this._totalHidden = 0;
        }

        appliesToPage() { return Page.isHome(); }

        getSettingsSchema() {
            return [
                { key: "minViews", label: "Minimum views", type: "number", min: 0, step: 1000, help: "Hide if below this (unless subscribed)." },
                { key: "minWatching", label: "Minimum watching (livestreams)", type: "number", min: 0, step: 50 },
                { key: "ignoreSubscribedChannels", label: "Do not hide subscribed channels", type: "toggle" },
                { key: "refreshSubscriptions", label: "Refresh subscription list automatically", type: "toggle" },
            ];
        }

        apply(ctx) {
            const s = this.getSettings(ctx);
            const minViews = Number(s.minViews ?? 10_000);
            const minWatch = Number(s.minWatching ?? 500);
            const ignoreSubs = Boolean(s.ignoreSubscribedChannels ?? true);
            let hidden = 0;

            for (const block of document.querySelectorAll("ytd-rich-item-renderer")) {
                if (!block || block.classList.contains("ytff-hidden")) continue;

                const channelEl = block.querySelector("ytd-channel-name a.yt-simple-endpoint");
                const channelName = Dom.safeText(channelEl);
                if (ignoreSubs && channelName && ctx.subscriptions.includes(channelName)) continue;

                let countInfo = null;
                for (const span of block.querySelectorAll("span.inline-metadata-item.style-scope.ytd-video-meta-block")) {
                    countInfo = Parsers.parseCount(Dom.safeText(span));
                    if (countInfo) break;
                }
                if (!countInfo) continue;

                const shouldHide =
                    (countInfo.kind === "views" && countInfo.count < minViews) ||
                    (countInfo.kind === "watching" && countInfo.count < minWatch);

                if (shouldHide && Dom.hide(block)) {
                    hidden++;
                    this._totalHidden++;
                }
            }

            if (hidden > 0) {
                ctx.metrics.totalHidden += hidden;
                log.info(`Low-views: hid ${hidden} (${this._totalHidden} total).`);
            }
        }
    }

    // ---- Filter: Hide Old Videos ----
    class HideOldVideosFilter extends BaseFilter {
        constructor() {
            super({ id: "hideOldVideos", title: "Hide old videos", description: "Hides videos older than N years." });
            this._totalHidden = 0;
        }

        appliesToPage() { return Page.isHome(); }

        getSettingsSchema() {
            return [{ key: "maxYears", label: "Maximum years old", type: "number", min: 0, step: 1 }];
        }

        apply(ctx) {
            const maxYears = Number(this.getSettings(ctx).maxYears ?? 1);
            let hidden = 0;

            for (const span of document.querySelectorAll("#primary ytd-rich-item-renderer .yt-content-metadata-view-model__metadata-row")) {
                const years = Parsers.parseYearsAgo(Dom.safeText(span));
                if (years === null || years <= maxYears) continue;
                const container = span.closest("ytd-rich-item-renderer");
                if (container && Dom.hide(container)) { hidden++; this._totalHidden++; }
            }

            if (hidden > 0) {
                ctx.metrics.totalHidden += hidden;
                log.info(`Old-videos: hid ${hidden} (> ${maxYears} yr).`);
            }
        }
    }

    // ---- Filter: Hide Shelves ----
    class HideShelvesFilter extends BaseFilter {
        constructor() {
            super({ id: "hideShelves", title: "Hide shelves (Shorts, Playables)", description: 'Hides Shorts and YouTube Playables shelves on the home feed.' });
            this._totalHidden = 0;
        }

        appliesToPage() { return Page.isHome(); }

        getSettingsSchema() {
            return [{ key: "enabledOnHome", label: "Enabled on Home", type: "toggle" }];
        }

        apply(ctx) {
            if (!Boolean(this.getSettings(ctx).enabledOnHome ?? true)) return;
            let hidden = 0;

            for (const title of document.querySelectorAll("span#title.style-scope.ytd-rich-shelf-renderer")) {
                const t = Dom.safeText(title);
                if (t !== "Shorts" && t !== "YouTube Playables") continue;
                const section = title.closest("ytd-rich-section-renderer");
                if (section && Dom.hide(section)) { hidden++; this._totalHidden++; }
            }

            if (hidden > 0) {
                ctx.metrics.totalHidden += hidden;
                log.info(`Shelves: hid ${hidden}.`);
            }
        }
    }

    // ---- Filter: Hide Watched Videos ----
    class HideWatchedVideosFilter extends BaseFilter {
        constructor() {
            super({ id: "hideWatchedVideos", title: "Hide watched videos", description: "Hides videos with a progress bar (watched or partially watched)." });
            this._totalHidden = 0;
        }

        appliesToPage(ctx) {
            const s = this.getSettings(ctx);
            return (Boolean(s.enabledOnHome ?? true) && Page.isHome()) ||
                (Boolean(s.enabledOnSubscriptions ?? true) && Page.isSubscriptionsFeed());
        }

        getSettingsSchema() {
            return [
                { key: "enabledOnHome", label: "Enabled on Home", type: "toggle" },
                { key: "enabledOnSubscriptions", label: "Enabled on Subscriptions feed", type: "toggle" },
            ];
        }

        apply(ctx) {
            let hidden = 0;
            for (const overlay of document.querySelectorAll("ytd-thumbnail-overlay-resume-playback-renderer")) {
                const container = overlay.closest("ytd-rich-item-renderer, ytd-grid-video-renderer, ytd-video-renderer");
                if (container && Dom.hide(container)) { hidden++; this._totalHidden++; }
            }
            if (hidden > 0) {
                ctx.metrics.totalHidden += hidden;
                log.info(`Watched: hid ${hidden}.`);
            }
        }
    }

    // ---- Filter: Hide by Keywords ----
    class HideKeywordsFilter extends BaseFilter {
        constructor() {
            super({
                id: "hideKeywords",
                title: "Hide by keywords",
                description: "Hides videos whose title or channel name contains any blocked keyword or phrase.",
            });
            this._totalHidden = 0;
        }

        appliesToPage(ctx) {
            const s = this.getSettings(ctx);
            return (Boolean(s.enabledOnHome ?? true) && Page.isHome()) ||
                (Boolean(s.enabledOnSubscriptions ?? true) && Page.isSubscriptionsFeed()) ||
                (Boolean(s.enabledOnSearch ?? false) && Page.isSearch());
        }

        getSettingsSchema() {
            // Keywords have their own dedicated UI, not a generic schema field.
            return [
                { key: "enabledOnHome", label: "Active on Home", type: "toggle" },
                { key: "enabledOnSubscriptions", label: "Active on Subscriptions feed", type: "toggle" },
                { key: "enabledOnSearch", label: "Active on Search results", type: "toggle" },
            ];
        }

        apply(ctx) {
            const s = this.getSettings(ctx);
            const keywords = Array.isArray(s.keywords) ? s.keywords.filter(k => k?.text?.trim()) : [];
            if (!keywords.length) return;

            const selectors = [
                "ytd-rich-item-renderer",
                "ytd-video-renderer",
                "ytd-grid-video-renderer",
                "ytd-compact-video-renderer",
            ].join(", ");

            let hidden = 0;
            for (const block of document.querySelectorAll(selectors)) {
                if (block.classList.contains("ytff-hidden")) continue;

                const titleEl = block.querySelector("#video-title, #title-wrapper yt-formatted-string, h3 a");
                const channelEl = block.querySelector("ytd-channel-name a, .ytd-channel-name a");

                const titleText = Dom.safeText(titleEl);
                const channelText = Dom.safeText(channelEl);

                for (const kw of keywords) {
                    const needle = kw.caseSensitive ? kw.text.trim() : kw.text.trim().toLowerCase();
                    const title = kw.caseSensitive ? titleText : titleText.toLowerCase();
                    const channel = kw.caseSensitive ? channelText : channelText.toLowerCase();
                    const matchTitle = kw.matchTitle !== false;
                    const matchChannel = kw.matchChannel !== false;

                    if ((matchTitle && title.includes(needle)) || (matchChannel && channel.includes(needle))) {
                        if (Dom.hide(block)) {
                            hidden++;
                            this._totalHidden++;
                            log.debug(`Keyword "${kw.text}" matched: "${titleText}" by "${channelText}"`);
                        }
                        break;
                    }
                }
            }

            if (hidden > 0) {
                ctx.metrics.totalHidden += hidden;
                log.info(`Keywords: hid ${hidden} (${this._totalHidden} total).`);
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

        setSubscriptionCache(cache) { this.subscriptionCache = cache; return this; }

        start() {
            GM_registerMenuCommand("YouTube Feed Filters: Settings", () => SettingsUi.open(this));
            GM_registerMenuCommand("YouTube Feed Filters: Run now", () => this.runOnce());
            GM_registerMenuCommand("YouTube Feed Filters: Reset", () => { SettingsStore.reset(); this.reloadSettings(); this.runOnce(); });

            if (this.subscriptionCache) {
                const cached = this.subscriptionCache.load();
                if (cached?.length) { this.context.subscriptions = cached; log.info(`Loaded ${cached.length} cached subs.`); }
            }

            this._attachObserver();
            this.runOnce();
            this._maybeRefreshSubscriptionsInBackground().catch(err => log.warn("Sub refresh failed.", err));
            this._hookSpaNavigation();
            SettingsUi.injectToolbarButton(this);
        }

        reloadSettings() {
            this.settings = SettingsStore.load();
            this.context = new FilterContext(this.settings);
            if (this.subscriptionCache) {
                const cached = this.subscriptionCache.load();
                if (cached?.length) this.context.subscriptions = cached;
            }
        }

        persistSettings() { SettingsStore.save(this.settings); }

        _attachObserver() {
            if (this.observer) this.observer.disconnect();
            this.observer = new MutationObserver(() => { if (Page.isEligibleFeedPage()) this._runOnceDebounced(); });
            this.observer.observe(document.body, { childList: true, subtree: true });
        }

        _hookSpaNavigation() {
            const onNav = () => { this.reloadSettings(); this.runOnce(); };
            const orig_push = history.pushState.bind(history);
            const orig_replace = history.replaceState.bind(history);
            history.pushState = (...a) => { orig_push(...a); onNav(); };
            history.replaceState = (...a) => { orig_replace(...a); onNav(); };
            window.addEventListener("popstate", onNav);
        }

        async _maybeRefreshSubscriptionsInBackground() {
            const lv = this.settings.filters.hideLowViews;
            if (!lv?.enabled || !Boolean(lv.settings?.refreshSubscriptions ?? true)) return;
            if (!this.subscriptionCache || !Page.isHome()) return;
            const updated = await this.subscriptionCache.refreshFromGuide();
            if (updated?.length) { this.context.subscriptions = updated; log.info(`Refreshed subs: ${updated.length}.`); this.runOnce(); }
        }

        runOnce() {
            if (!Page.isEligibleFeedPage() && !Page.isSearch()) return;
            const before = this.context.metrics.totalHidden;
            for (const filter of this.filters) {
                try {
                    if (!filter.isEnabled(this.context)) continue;
                    if (!filter.appliesToPage(this.context)) continue;
                    filter.apply(this.context);
                } catch (err) { log.error(`Filter "${filter.id}" failed.`, err); }
            }
            const delta = this.context.metrics.totalHidden - before;
            if (delta > 0) SettingsUi.showToast(this.context.metrics.totalHidden);
        }
    }

    // ---------------------------
    // Settings UI
    // ---------------------------
    class SettingsUi {
        static open(engine) {
            engine.reloadSettings();
            document.getElementById("ytff-modal")?.remove();
            SettingsUi._ensureStyles();

            // Modal skeleton
            const modal = Dom.create("div", { id: "ytff-modal", attrs: { role: "dialog", "aria-modal": "true", "aria-label": "YouTube Feed Filters Settings" } });
            const panel = Dom.create("div", { className: "ytff-panel" });

            // ---- Header ----
            const header = Dom.create("div", { className: "ytff-header" });
            const logo = Dom.create("div", { className: "ytff-logo" });
            logo.appendChild(SettingsUi._svgIcon());
            const headText = Dom.create("div", { className: "ytff-head-text" });
            headText.appendChild(Dom.create("span", { className: "ytff-head-title", text: "Feed Filters" }));
            headText.appendChild(Dom.create("span", { className: "ytff-head-sub", text: "YouTube • Tampermonkey" }));
            logo.appendChild(headText);

            const headerRight = Dom.create("div", { className: "ytff-header-right" });
            const closeBtn = Dom.create("button", { className: "ytff-close", attrs: { type: "button", "aria-label": "Close", "data-action": "close" }, text: "✕" });
            headerRight.appendChild(closeBtn);

            header.appendChild(logo);
            header.appendChild(headerRight);

            // ---- Tabs ----
            const tabBar = Dom.create("div", { className: "ytff-tabs" });
            const tabContent = Dom.create("div", { className: "ytff-tab-content" });

            const tabs = [
                { id: "filters", label: "Filters" },
                { id: "keywords", label: "Keywords" },
            ];

            const tabPanels = {};
            for (const t of tabs) {
                const btn = Dom.create("button", { className: "ytff-tab" + (t.id === "filters" ? " active" : ""), text: t.label, attrs: { type: "button", "data-tab": t.id } });
                tabBar.appendChild(btn);
                const pane = Dom.create("div", { className: "ytff-pane" + (t.id === "filters" ? " active" : ""), attrs: { "data-pane": t.id } });
                tabContent.appendChild(pane);
                tabPanels[t.id] = pane;
            }

            // ---- Filters pane ---- (keywords has its own dedicated tab)
            for (const filter of engine.filters) {
                if (filter.id === "hideKeywords") continue;
                tabPanels.filters.appendChild(SettingsUi._renderFilterCard(engine, filter));
            }

            // ---- Keywords pane ----
            tabPanels.keywords.appendChild(SettingsUi._renderKeywordsPane(engine));

            // ---- Footer ----
            const footer = Dom.create("div", { className: "ytff-footer" });
            const footerLeft = Dom.create("div", { className: "ytff-footer-left" });
            const runBtn = Dom.create("button", { className: "ytff-btn ghost", text: "Run now", attrs: { type: "button", "data-action": "run" } });
            const resetBtn = Dom.create("button", { className: "ytff-btn ghost", text: "Reset all", attrs: { type: "button", "data-action": "reset" } });
            footerLeft.appendChild(runBtn);
            footerLeft.appendChild(resetBtn);

            const saveBtn = Dom.create("button", { className: "ytff-btn primary", text: "Save & Apply", attrs: { type: "button", "data-action": "save" } });
            footer.appendChild(footerLeft);
            footer.appendChild(saveBtn);

            panel.appendChild(header);
            panel.appendChild(tabBar);
            panel.appendChild(tabContent);
            panel.appendChild(footer);
            modal.appendChild(panel);
            document.body.appendChild(modal);

            SettingsUi._wireTabs(modal);
            SettingsUi._wire(modal, engine);
            panel.focus();
        }

        static _svgIcon() {
            const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
            svg.setAttribute("viewBox", "0 0 24 24");
            svg.setAttribute("width", "22");
            svg.setAttribute("height", "22");
            svg.setAttribute("fill", "none");
            svg.setAttribute("stroke", "currentColor");
            svg.setAttribute("stroke-width", "2");
            svg.setAttribute("stroke-linecap", "round");
            svg.setAttribute("stroke-linejoin", "round");
            const paths = [
                "M3 6h18M7 12h10M10 18h4"
            ];
            for (const d of paths) {
                const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
                p.setAttribute("d", d);
                svg.appendChild(p);
            }
            return svg;
        }

        static _renderFilterCard(engine, filter) {
            const state = engine.settings.filters[filter.id] ?? { enabled: false, settings: {} };
            const schema = filter.getSettingsSchema();

            const card = Dom.create("div", { className: "ytff-card" });

            // Card header row
            const head = Dom.create("div", { className: "ytff-card-head" });
            const info = Dom.create("div", { className: "ytff-card-info" });
            info.appendChild(Dom.create("div", { className: "ytff-card-title", text: filter.title }));
            info.appendChild(Dom.create("div", { className: "ytff-card-desc", text: filter.description }));

            const toggleLabel = Dom.create("label", { className: "ytff-switch", attrs: { title: "Enable/disable this filter" } });
            const toggleInput = Dom.create("input", { attrs: { type: "checkbox", "data-filter-enable": filter.id } });
            toggleInput.checked = Boolean(state.enabled);
            const slider = Dom.create("span", { className: "ytff-slider" });
            toggleLabel.appendChild(toggleInput);
            toggleLabel.appendChild(slider);

            head.appendChild(info);
            head.appendChild(toggleLabel);
            card.appendChild(head);

            // Settings fields
            if (schema.length > 0) {
                const fields = Dom.create("div", { className: "ytff-fields" });
                for (const field of schema) {
                    if (field.type === "keywords") continue; // keywords handled separately
                    fields.appendChild(SettingsUi._renderField(filter.id, state, field));
                }
                card.appendChild(fields);
            }

            return card;
        }

        static _renderField(filterId, state, field) {
            const wrapper = Dom.create("div", { className: "ytff-field-wrap" });
            const row = Dom.create("div", { className: "ytff-row" });
            const labelEl = Dom.create("div", { className: "ytff-label" });
            labelEl.appendChild(Dom.create("span", { text: field.label }));
            if (field.help) labelEl.appendChild(Dom.create("span", { className: "ytff-help", text: field.help }));

            const value = state.settings?.[field.key];

            if (field.type === "toggle") {
                const lbl = Dom.create("label", { className: "ytff-switch small" });
                const input = Dom.create("input", { attrs: { type: "checkbox", "data-filter": filterId, "data-key": field.key } });
                input.checked = value === undefined ? false : Boolean(value);
                const slider = Dom.create("span", { className: "ytff-slider" });
                lbl.appendChild(input);
                lbl.appendChild(slider);
                row.appendChild(labelEl);
                row.appendChild(lbl);
            } else if (field.type === "number") {
                const input = Dom.create("input", {
                    className: "ytff-number",
                    attrs: {
                        type: "number",
                        "data-filter": filterId,
                        "data-key": field.key,
                        min: field.min !== undefined ? String(field.min) : "",
                        max: field.max !== undefined ? String(field.max) : "",
                        step: field.step !== undefined ? String(field.step) : "1",
                    },
                });
                input.value = value == null ? "" : String(value);
                row.appendChild(labelEl);
                row.appendChild(input);
            }

            wrapper.appendChild(row);
            return wrapper;
        }

        static _renderKeywordsPane(engine) {
            const s = engine.settings.filters.hideKeywords ?? { enabled: false, settings: { keywords: [] } };
            const keywords = Array.isArray(s.settings?.keywords) ? s.settings.keywords : [];

            const pane = Dom.create("div", { className: "ytff-keywords-pane" });

            // Top: enable toggle + page options
            const topCard = Dom.create("div", { className: "ytff-card" });
            const topHead = Dom.create("div", { className: "ytff-card-head" });
            const topInfo = Dom.create("div", { className: "ytff-card-info" });
            topInfo.appendChild(Dom.create("div", { className: "ytff-card-title", text: "Keyword Filter" }));
            topInfo.appendChild(Dom.create("div", { className: "ytff-card-desc", text: "Hide any video whose title or channel name contains a blocked word or phrase." }));

            const toggleLabel = Dom.create("label", { className: "ytff-switch", attrs: { title: "Enable/disable keyword filter" } });
            const toggleInput = Dom.create("input", { attrs: { type: "checkbox", "data-filter-enable": "hideKeywords" } });
            toggleInput.checked = Boolean(s.enabled);
            toggleLabel.appendChild(toggleInput);
            toggleLabel.appendChild(Dom.create("span", { className: "ytff-slider" }));
            topHead.appendChild(topInfo);
            topHead.appendChild(toggleLabel);
            topCard.appendChild(topHead);

            // Page toggles
            const optFields = Dom.create("div", { className: "ytff-fields" });
            for (const [key, label] of [
                ["enabledOnHome", "Active on Home"],
                ["enabledOnSubscriptions", "Active on Subscriptions"],
                ["enabledOnSearch", "Active on Search results"],
            ]) {
                optFields.appendChild(SettingsUi._renderField("hideKeywords", s, { key, label, type: "toggle" }));
            }
            topCard.appendChild(optFields);
            pane.appendChild(topCard);

            // Keyword list card
            const listCard = Dom.create("div", { className: "ytff-card ytff-kw-card" });
            listCard.appendChild(Dom.create("div", { className: "ytff-card-title", text: "Blocked keywords & phrases" }));

            // Add-new row
            const addRow = Dom.create("div", { className: "ytff-kw-add-row" });
            const kwInput = Dom.create("input", {
                id: "ytff-kw-input",
                className: "ytff-kw-input",
                attrs: { type: "text", placeholder: "Enter keyword or phrase…", "aria-label": "New keyword" },
            });

            const matchWrap = Dom.create("div", { className: "ytff-kw-opts" });
            const mkToggle = (key, labelText, defaultOn) => {
                const lbl = Dom.create("label", { className: "ytff-kw-opt" });
                const cb = Dom.create("input", { attrs: { type: "checkbox", "data-kw-opt": key } });
                cb.checked = defaultOn;
                lbl.appendChild(cb);
                lbl.appendChild(Dom.create("span", { text: labelText }));
                return lbl;
            };
            matchWrap.appendChild(mkToggle("matchTitle", "Match title", true));
            matchWrap.appendChild(mkToggle("matchChannel", "Match channel", true));
            matchWrap.appendChild(mkToggle("caseSensitive", "Case sensitive", false));

            const addBtn = Dom.create("button", { className: "ytff-btn primary small", text: "+ Add", attrs: { type: "button", id: "ytff-kw-add-btn" } });
            addRow.appendChild(kwInput);
            addRow.appendChild(matchWrap);
            addRow.appendChild(addBtn);
            listCard.appendChild(addRow);

            // Keyword list container
            const listEl = Dom.create("div", { className: "ytff-kw-list", id: "ytff-kw-list" });
            if (keywords.length === 0) {
                listEl.appendChild(SettingsUi._kwEmptyMsg());
            } else {
                for (const kw of keywords) listEl.appendChild(SettingsUi._kwChip(kw));
            }
            listCard.appendChild(listEl);
            pane.appendChild(listCard);

            // Wire add button
            addBtn.addEventListener("click", () => {
                const text = kwInput.value.trim();
                if (!text) return;
                const matchTitle = pane.querySelector('[data-kw-opt="matchTitle"]')?.checked ?? true;
                const matchChannel = pane.querySelector('[data-kw-opt="matchChannel"]')?.checked ?? true;
                const caseSensitive = pane.querySelector('[data-kw-opt="caseSensitive"]')?.checked ?? false;
                const kw = { text, matchTitle, matchChannel, caseSensitive };

                // Remove empty message if present
                const emptyMsg = listEl.querySelector(".ytff-kw-empty");
                if (emptyMsg) emptyMsg.remove();

                listEl.appendChild(SettingsUi._kwChip(kw));
                kwInput.value = "";
                kwInput.focus();
            });

            // Allow Enter key in the input
            kwInput.addEventListener("keydown", e => { if (e.key === "Enter") addBtn.click(); });

            return pane;
        }

        static _kwEmptyMsg() {
            return Dom.create("div", { className: "ytff-kw-empty", text: "No keywords added yet. Add one above." });
        }

        static _kwChip(kw) {
            const chip = Dom.create("div", { className: "ytff-kw-chip" });
            chip.dataset.kwText = kw.text;
            chip.dataset.kwMatchTitle = String(kw.matchTitle !== false);
            chip.dataset.kwMatchChannel = String(kw.matchChannel !== false);
            chip.dataset.kwCaseSensitive = String(Boolean(kw.caseSensitive));

            const label = Dom.create("span", { className: "ytff-kw-chip-text", text: kw.text });
            const tags = Dom.create("span", { className: "ytff-kw-chip-tags" });

            if (kw.matchTitle !== false) tags.appendChild(Dom.create("span", { className: "ytff-tag", text: "title" }));
            if (kw.matchChannel !== false) tags.appendChild(Dom.create("span", { className: "ytff-tag", text: "channel" }));
            if (kw.caseSensitive) tags.appendChild(Dom.create("span", { className: "ytff-tag accent", text: "Aa" }));

            const del = Dom.create("button", { className: "ytff-kw-del", text: "✕", attrs: { type: "button", "aria-label": `Remove ${kw.text}` } });
            del.addEventListener("click", () => {
                chip.remove();
                if (!document.querySelector(".ytff-kw-chip")) {
                    document.getElementById("ytff-kw-list")?.appendChild(SettingsUi._kwEmptyMsg());
                }
            });

            chip.appendChild(label);
            chip.appendChild(tags);
            chip.appendChild(del);
            return chip;
        }

        static _wireTabs(modal) {
            modal.addEventListener("click", e => {
                const tab = e.target.closest("[data-tab]");
                if (!tab) return;
                const id = tab.getAttribute("data-tab");
                modal.querySelectorAll(".ytff-tab").forEach(t => t.classList.toggle("active", t.getAttribute("data-tab") === id));
                modal.querySelectorAll(".ytff-pane").forEach(p => p.classList.toggle("active", p.getAttribute("data-pane") === id));
            });
        }

        static _wire(modal, engine) {
            const close = () => modal.remove();

            const collectKeywords = () => {
                return Array.from(modal.querySelectorAll(".ytff-kw-chip")).map(chip => ({
                    text: chip.dataset.kwText,
                    matchTitle: chip.dataset.kwMatchTitle !== "false",
                    matchChannel: chip.dataset.kwMatchChannel !== "false",
                    caseSensitive: chip.dataset.kwCaseSensitive === "true",
                }));
            };

            const saveFromUi = () => {
                const settings = engine.settings;

                // Enable toggles
                for (const toggle of modal.querySelectorAll("input[type='checkbox'][data-filter-enable]")) {
                    const id = toggle.getAttribute("data-filter-enable");
                    if (!settings.filters[id]) settings.filters[id] = { enabled: false, settings: {} };
                    settings.filters[id].enabled = Boolean(toggle.checked);
                }

                // Generic fields
                for (const input of modal.querySelectorAll("input[data-filter][data-key]")) {
                    const id = input.getAttribute("data-filter");
                    const key = input.getAttribute("data-key");
                    if (!settings.filters[id]) settings.filters[id] = { enabled: false, settings: {} };
                    if (!settings.filters[id].settings) settings.filters[id].settings = {};

                    if (input.type === "checkbox") {
                        settings.filters[id].settings[key] = Boolean(input.checked);
                    } else if (input.type === "number") {
                        const n = Number(input.value);
                        settings.filters[id].settings[key] = isFinite(n) ? n : input.value;
                    } else {
                        settings.filters[id].settings[key] = input.value;
                    }
                }

                // Keywords
                if (!settings.filters.hideKeywords) settings.filters.hideKeywords = { enabled: false, settings: {} };
                if (!settings.filters.hideKeywords.settings) settings.filters.hideKeywords.settings = {};
                settings.filters.hideKeywords.settings.keywords = collectKeywords();

                engine.persistSettings();
                engine.reloadSettings();
                engine.runOnce();
                close();
            };

            modal.addEventListener("click", e => {
                if (e.target === modal) close();
                const btn = e.target.closest("button[data-action]");
                if (!btn) return;
                const action = btn.getAttribute("data-action");
                if (action === "close") close();
                if (action === "run") engine.runOnce();
                if (action === "save") saveFromUi();
                if (action === "reset") {
                    if (!confirm("Reset all settings to defaults?")) return;
                    SettingsStore.reset();
                    engine.reloadSettings();
                    close();
                    SettingsUi.open(engine);
                }
            });

            window.addEventListener("keydown", e => { if (e.key === "Escape") close(); }, { once: true });

            // Basic focus trap
            modal.addEventListener("keydown", e => {
                if (e.key !== "Tab") return;
                const focusables = [...modal.querySelectorAll("button, input, [tabindex]:not([tabindex='-1'])")];
                if (!focusables.length) return;
                const first = focusables[0], last = focusables[focusables.length - 1], active = document.activeElement;
                if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
                else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
            });
        }

        static injectToolbarButton(engine) {
            // YouTube's right-side header buttons (notifications, profile) are ~88px wide total.
            // We inject a fixed-position button that sits just to the left of them.
            const BTN_ID = "ytff-toolbar-btn";
            if (document.getElementById(BTN_ID)) return;

            const btn = Dom.create("button", {
                id: BTN_ID,
                attrs: { type: "button", title: "YouTube Feed Filters — click to open settings", "aria-label": "Open Feed Filters settings" },
            });

            // Filter icon SVG
            const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
            svg.setAttribute("viewBox", "0 0 24 24");
            svg.setAttribute("width", "18");
            svg.setAttribute("height", "18");
            svg.setAttribute("fill", "none");
            svg.setAttribute("stroke", "currentColor");
            svg.setAttribute("stroke-width", "2.2");
            svg.setAttribute("stroke-linecap", "round");
            svg.setAttribute("stroke-linejoin", "round");
            for (const d of ["M3 6h18", "M7 12h10", "M10 18h4"]) {
                const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
                p.setAttribute("d", d);
                svg.appendChild(p);
            }
            btn.appendChild(svg);
            btn.addEventListener("click", () => SettingsUi.open(engine));
            document.body.appendChild(btn);
        }

        static showToast(totalHidden) {
            const TOAST_ID = "ytff-toast";
            const existing = document.getElementById(TOAST_ID);
            if (existing) { existing.remove(); }

            const toast = Dom.create("div", { id: TOAST_ID });
            // Filter icon
            const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
            svg.setAttribute("viewBox", "0 0 24 24");
            svg.setAttribute("width", "14");
            svg.setAttribute("height", "14");
            svg.setAttribute("fill", "none");
            svg.setAttribute("stroke", "currentColor");
            svg.setAttribute("stroke-width", "2.5");
            svg.setAttribute("stroke-linecap", "round");
            for (const d of ["M3 6h18", "M7 12h10", "M10 18h4"]) {
                const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
                p.setAttribute("d", d);
                svg.appendChild(p);
            }
            toast.appendChild(svg);
            toast.appendChild(Dom.create("span", { text: `${totalHidden} video${totalHidden !== 1 ? "s" : ""} hidden` }));
            document.body.appendChild(toast);

            // Auto-dismiss after 3s with fade
            const dismiss = () => {
                toast.classList.add("ytff-toast-out");
                toast.addEventListener("animationend", () => toast.remove(), { once: true });
            };
            setTimeout(dismiss, 15000);
            toast.addEventListener("click", dismiss);
        }

        static _ensureStyles() {
            if (document.getElementById("ytff-style")) return;
            const style = document.createElement("style");
            style.id = "ytff-style";
            style.textContent = `
/* ---- Hide class ---- */
.ytff-hidden { display: none !important; }
.ytwTalkToRecsHost, button[aria-label="Create"] { display: none !important; }

/* ---- Toolbar button ---- */
/* YouTube header right section is ~88px: profile (~40px) + notifications (~40px) + spacing */
#ytff-toolbar-btn {
  position: fixed;
  top: 10px;
  right: 140px;
  z-index: 999990;
  display: flex; align-items: center; justify-content: center;
  width: 36px; height: 36px;
  background: rgba(255,255,255,.06);
  border: 1px solid rgba(255,255,255,.1);
  border-radius: 50%;
  color: rgba(255,255,255,.45);
  cursor: pointer;
  transition: opacity .2s, color .2s, background .2s, border-color .2s;
  opacity: 0.45;
  padding: 0;
}
#ytff-toolbar-btn:hover {
  opacity: 1;
  color: #fff;
  background: rgba(255,255,255,.12);
  border-color: rgba(255,255,255,.25);
}

/* ---- Toast ---- */
#ytff-toast {
  position: fixed;
  bottom: 24px;
  right: 24px;
  z-index: 999991;
  display: flex; align-items: center; gap: 7px;
  background: rgba(20,20,20,.92);
  border: 1px solid rgba(255,255,255,.12);
  border-radius: 10px;
  padding: 9px 14px;
  color: rgba(255,255,255,.85);
  font-family: "Segoe UI", system-ui, sans-serif;
  font-size: 13px;
  font-weight: 500;
  backdrop-filter: blur(8px);
  box-shadow: 0 4px 24px rgba(0,0,0,.5);
  cursor: pointer;
  animation: ytff-toast-in .25s cubic-bezier(.16,1,.3,1);
  user-select: none;
}
#ytff-toast svg { color: #ff4444; flex-shrink: 0; }
@keyframes ytff-toast-in {
  from { transform: translateY(12px); opacity: 0; }
  to   { transform: none; opacity: 1; }
}
.ytff-toast-out {
  animation: ytff-toast-out .3s ease forwards !important;
}
@keyframes ytff-toast-out {
  from { transform: none; opacity: 1; }
  to   { transform: translateY(8px); opacity: 0; }
}

/* ---- Modal backdrop ---- */
#ytff-modal {
  position: fixed; inset: 0; z-index: 9999999;
  background: rgba(0,0,0,.72);
  backdrop-filter: blur(4px);
  display: flex; align-items: center; justify-content: center; padding: 20px;
  animation: ytff-fade-in .15s ease;
}
@keyframes ytff-fade-in { from { opacity: 0 } to { opacity: 1 } }

/* ---- Panel ---- */
.ytff-panel {
  width: min(820px, 96vw);
  max-height: 88vh;
  display: flex; flex-direction: column;
  background: #0f0f0f;
  border: 1px solid rgba(255,255,255,.1);
  border-radius: 16px;
  box-shadow: 0 24px 80px rgba(0,0,0,.7), 0 0 0 1px rgba(255,255,255,.04) inset;
  overflow: hidden;
  font-family: "Segoe UI", system-ui, -apple-system, sans-serif;
  color: #e8e8e8;
  animation: ytff-panel-in .2s cubic-bezier(.16,1,.3,1);
}
@keyframes ytff-panel-in {
  from { transform: translateY(12px) scale(.97); opacity: 0 }
  to   { transform: none; opacity: 1 }
}

/* ---- Header ---- */
.ytff-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 18px;
  border-bottom: 1px solid rgba(255,255,255,.08);
  background: rgba(255,255,255,.02);
  flex-shrink: 0;
}
.ytff-logo { display: flex; align-items: center; gap: 10px; color: #ff4444; }
.ytff-head-text { display: flex; flex-direction: column; gap: 1px; }
.ytff-head-title { font-size: 15px; font-weight: 700; letter-spacing: -.2px; color: #f0f0f0; }
.ytff-head-sub   { font-size: 11px; color: rgba(255,255,255,.4); letter-spacing: .3px; }
.ytff-close {
  background: none; border: none; color: rgba(255,255,255,.4);
  font-size: 16px; cursor: pointer; padding: 4px 6px; border-radius: 6px;
  line-height: 1; transition: color .15s, background .15s;
}
.ytff-close:hover { color: #fff; background: rgba(255,255,255,.1); }

/* ---- Tabs ---- */
.ytff-tabs {
  display: flex; gap: 2px; padding: 10px 18px 0;
  border-bottom: 1px solid rgba(255,255,255,.08);
  background: rgba(255,255,255,.01);
  flex-shrink: 0;
}
.ytff-tab {
  background: none; border: none; color: rgba(255,255,255,.45);
  font-size: 13px; font-weight: 500; padding: 8px 14px;
  cursor: pointer; border-bottom: 2px solid transparent; margin-bottom: -1px;
  border-radius: 6px 6px 0 0; transition: color .15s, border-color .15s;
}
.ytff-tab:hover { color: rgba(255,255,255,.75); }
.ytff-tab.active { color: #fff; border-bottom-color: #ff4444; }

/* ---- Tab content ---- */
.ytff-tab-content { flex: 1; overflow-y: auto; padding: 16px 18px; display: flex; flex-direction: column; gap: 10px; }
.ytff-pane { display: none; flex-direction: column; gap: 10px; }
.ytff-pane.active { display: flex; }

/* ---- Card ---- */
.ytff-card {
  border: 1px solid rgba(255,255,255,.09);
  border-radius: 12px; padding: 14px 16px;
  background: rgba(255,255,255,.03);
}
.ytff-card-head {
  display: flex; justify-content: space-between; align-items: flex-start; gap: 12px;
}
.ytff-card-info { flex: 1; min-width: 0; }
.ytff-card-title { font-size: 13.5px; font-weight: 650; color: #f0f0f0; margin-bottom: 3px; }
.ytff-card-desc  { font-size: 12px; color: rgba(255,255,255,.5); line-height: 1.4; }

/* ---- Fields ---- */
.ytff-fields { display: flex; flex-direction: column; gap: 8px; margin-top: 12px; padding-top: 12px; border-top: 1px solid rgba(255,255,255,.06); }
.ytff-field-wrap { display: flex; flex-direction: column; gap: 3px; }
.ytff-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.ytff-label { display: flex; flex-direction: column; gap: 1px; }
.ytff-label > span:first-child { font-size: 12.5px; color: rgba(255,255,255,.8); }
.ytff-help { font-size: 11px; color: rgba(255,255,255,.35); line-height: 1.3; }
.ytff-number {
  width: 130px; background: rgba(0,0,0,.3); border: 1px solid rgba(255,255,255,.14);
  color: #f0f0f0; border-radius: 8px; padding: 6px 10px; font-size: 12.5px;
  outline: none; transition: border-color .15s;
}
.ytff-number:focus { border-color: rgba(255,68,68,.6); }

/* ---- Toggle switch ---- */
.ytff-switch {
  position: relative; display: inline-block;
  width: 40px; height: 22px; flex-shrink: 0; cursor: pointer;
}
.ytff-switch.small { width: 34px; height: 18px; }
.ytff-switch input { opacity: 0; width: 0; height: 0; position: absolute; }
.ytff-slider {
  position: absolute; inset: 0; border-radius: 999px;
  background: rgba(255,255,255,.12);
  transition: background .2s;
}
.ytff-slider::before {
  content: ""; position: absolute;
  left: 3px; bottom: 3px;
  width: 16px; height: 16px; border-radius: 50%;
  background: #fff; transition: transform .2s;
}
.ytff-switch.small .ytff-slider::before { width: 12px; height: 12px; }
.ytff-switch input:checked + .ytff-slider { background: #ff4444; }
.ytff-switch input:checked + .ytff-slider::before { transform: translateX(18px); }
.ytff-switch.small input:checked + .ytff-slider::before { transform: translateX(16px); }

/* ---- Keywords pane ---- */
.ytff-keywords-pane { display: flex; flex-direction: column; gap: 10px; }
.ytff-kw-card { display: flex; flex-direction: column; gap: 12px; }
.ytff-kw-add-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.ytff-kw-input {
  flex: 1; min-width: 160px;
  background: rgba(0,0,0,.3); border: 1px solid rgba(255,255,255,.14);
  color: #f0f0f0; border-radius: 8px; padding: 8px 12px; font-size: 13px;
  outline: none; transition: border-color .15s;
}
.ytff-kw-input:focus { border-color: rgba(255,68,68,.55); }
.ytff-kw-opts { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
.ytff-kw-opt {
  display: flex; align-items: center; gap: 4px;
  font-size: 11.5px; color: rgba(255,255,255,.6); cursor: pointer;
  background: rgba(255,255,255,.06); border-radius: 6px; padding: 4px 8px;
  user-select: none; transition: background .15s;
}
.ytff-kw-opt:hover { background: rgba(255,255,255,.1); }
.ytff-kw-opt input { width: 12px; height: 12px; accent-color: #ff4444; cursor: pointer; }

/* ---- Keyword chip list ---- */
.ytff-kw-list {
  display: flex; flex-direction: column; gap: 6px;
  max-height: 260px; overflow-y: auto;
  padding-right: 2px;
}
.ytff-kw-empty { font-size: 12px; color: rgba(255,255,255,.3); text-align: center; padding: 18px 0; }
.ytff-kw-chip {
  display: flex; align-items: center; gap: 8px;
  background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.09);
  border-radius: 8px; padding: 8px 10px;
  transition: background .15s;
}
.ytff-kw-chip:hover { background: rgba(255,255,255,.08); }
.ytff-kw-chip-text { flex: 1; font-size: 13px; color: #f0f0f0; word-break: break-all; }
.ytff-kw-chip-tags { display: flex; gap: 4px; flex-shrink: 0; }
.ytff-tag {
  font-size: 10px; color: rgba(255,255,255,.45);
  background: rgba(255,255,255,.08); border-radius: 4px; padding: 2px 5px; letter-spacing: .2px;
}
.ytff-tag.accent { color: rgba(255,180,0,.75); background: rgba(255,180,0,.1); }
.ytff-kw-del {
  background: none; border: none; color: rgba(255,255,255,.3);
  cursor: pointer; padding: 2px 4px; border-radius: 4px; font-size: 13px; line-height: 1;
  transition: color .15s, background .15s; flex-shrink: 0;
}
.ytff-kw-del:hover { color: #ff6666; background: rgba(255,68,68,.12); }

/* ---- Buttons ---- */
.ytff-btn {
  border: 1px solid rgba(255,255,255,.12); border-radius: 8px;
  color: #e8e8e8; cursor: pointer; font-size: 12.5px; font-weight: 500;
  padding: 8px 14px; transition: background .15s, border-color .15s;
}
.ytff-btn.ghost { background: rgba(255,255,255,.06); }
.ytff-btn.ghost:hover { background: rgba(255,255,255,.1); }
.ytff-btn.primary { background: rgba(255,68,68,.2); border-color: rgba(255,68,68,.4); color: #ffaaaa; }
.ytff-btn.primary:hover { background: rgba(255,68,68,.3); }
.ytff-btn.small { padding: 5px 10px; font-size: 11.5px; }

/* ---- Footer ---- */
.ytff-footer {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  padding: 12px 18px; border-top: 1px solid rgba(255,255,255,.08);
  background: rgba(255,255,255,.01); flex-shrink: 0;
}
.ytff-footer-left { display: flex; gap: 8px; }
`;
            document.head.appendChild(style);
            log.info("Styles injected.");
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
        new HideKeywordsFilter(),
    ]).setSubscriptionCache(subscriptionCache);

    try {
        SettingsUi._ensureStyles();
        engine.start();
        log.info("Initialized v0.4.0.");
    } catch (err) {
        log.error("Failed to initialize.", err);
    }
})();