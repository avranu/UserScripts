// ==UserScript==
// @name         LinkedIn Job Keywords Monitor
// @namespace    https://jmann.me
// @version      0.1.1
// @description  Monitors LinkedIn job postings for configurable keywords and displays match counts
// @author       Jess Mann
// @match        https://www.linkedin.com/jobs/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addStyle
// @run-at       document-idle
// ==/UserScript==

'use strict';

// ============================================================
// CONSTANTS
// ============================================================

const SCRIPT_PREFIX = 'ljkm_';
const JOB_DETAIL_SELECTOR = '[data-sdui-screen="com.linkedin.sdui.flagshipnav.jobs.SemanticJobDetails"]';
const DEBOUNCE_DELAY_MS = 300;
const BADGE_CONTAINER_ID = `${SCRIPT_PREFIX}badge_container`;
const SETTINGS_MODAL_ID = `${SCRIPT_PREFIX}settings_modal`;

/**
 * @typedef {{ id: string, name: string, color: string }} CategoryEntry
 * @typedef {{ phrase: string, categoryId: string }} KeywordEntry
 * @typedef {{ phrase: string, categoryId: string, count: number }} ScanResult
 */

const DEFAULT_CATEGORIES = [
    { id: 'critical', name: 'Critical', color: '#c0392b' },
    { id: 'warning', name: 'Warning', color: '#e67e22' },
    { id: 'info', name: 'Info', color: '#2980b9' },
];

const DEFAULT_KEYWORDS = [
    // --- Critical ---
    { phrase: 'rockstar', categoryId: 'critical' },
    { phrase: 'ninja', categoryId: 'critical' },
    { phrase: 'guru', categoryId: 'critical' },
    { phrase: 'hustle', categoryId: 'critical' },
    { phrase: 'fast-paced', categoryId: 'critical' },
    { phrase: '10x', categoryId: 'critical' },
    { phrase: 'wear many hats', categoryId: 'critical' },
    { phrase: 'unpaid', categoryId: 'critical' },
    { phrase: 'passion', categoryId: 'critical' },
    { phrase: 'no work-life', categoryId: 'critical' },

    // --- Warning ---
    { phrase: 'unlimited pto', categoryId: 'warning' },
    { phrase: 'self-starter', categoryId: 'warning' },
    { phrase: 'must be comfortable with ambiguity', categoryId: 'warning' },
    { phrase: 'dynamic environment', categoryId: 'warning' },
    { phrase: 'competitive salary', categoryId: 'warning' },
    { phrase: 'must have thick skin', categoryId: 'warning' },
    { phrase: 'scrappy', categoryId: 'warning' },
    { phrase: 'startup mentality', categoryId: 'warning' },
    { phrase: 'go-getter', categoryId: 'warning' },

    // --- Info ---
    { phrase: 'hybrid', categoryId: 'info' },
    { phrase: 'on-site', categoryId: 'info' },
    { phrase: 'remote', categoryId: 'info' },
    { phrase: 'relocation required', categoryId: 'info' },
    { phrase: 'clearance required', categoryId: 'info' },
];

// ============================================================
// STYLES
// ============================================================

GM_addStyle(`
    /* ---- Badge Container ---- */
    #${BADGE_CONTAINER_ID} {
        position: fixed;
        bottom: 20px;
        right: 20px;
        z-index: 99999;
        display: flex;
        flex-direction: column;
        gap: 6px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        max-width: 280px;
    }

    .${SCRIPT_PREFIX}badge {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 8px 12px;
        border-radius: 6px;
        color: #fff;
        font-size: 13px;
        font-weight: 600;
        box-shadow: 0 4px 12px rgba(0,0,0,0.25);
        cursor: pointer;
        transition: opacity 0.2s ease, transform 0.2s ease;
        gap: 8px;
        user-select: none;
    }

    .${SCRIPT_PREFIX}badge:hover {
        opacity: 0.9;
        transform: translateX(-2px);
    }

    .${SCRIPT_PREFIX}badge-label {
        flex: 1;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .${SCRIPT_PREFIX}badge-count {
        background: rgba(255,255,255,0.25);
        border-radius: 12px;
        padding: 2px 8px;
        font-size: 12px;
        font-weight: 700;
        white-space: nowrap;
    }

    .${SCRIPT_PREFIX}settings-btn {
        padding: 7px 12px;
        background: #0a66c2;
        color: #fff;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        font-size: 12px;
        font-weight: 600;
        box-shadow: 0 4px 12px rgba(0,0,0,0.25);
        text-align: center;
        transition: background 0.2s;
    }

    .${SCRIPT_PREFIX}settings-btn:hover {
        background: #004182;
    }

    /* ---- Tooltip Popup ---- */
    .${SCRIPT_PREFIX}tooltip {
        position: fixed;
        z-index: 100000;
        background: #1a1a2e;
        color: #eee;
        border-radius: 8px;
        padding: 12px 14px;
        font-size: 12px;
        max-width: 340px;
        box-shadow: 0 8px 24px rgba(0,0,0,0.4);
        pointer-events: none;
        line-height: 1.5;
    }

    .${SCRIPT_PREFIX}tooltip-title {
        font-weight: 700;
        margin-bottom: 6px;
        font-size: 13px;
        border-bottom: 1px solid rgba(255,255,255,0.15);
        padding-bottom: 4px;
    }

    .${SCRIPT_PREFIX}tooltip-item {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        padding: 2px 0;
    }

    .${SCRIPT_PREFIX}tooltip-phrase {
        font-style: italic;
        color: #adf;
    }

    .${SCRIPT_PREFIX}tooltip-hits {
        font-weight: 700;
        color: #ffd;
    }

    /* ---- Settings Modal ---- */
    #${SETTINGS_MODAL_ID}_overlay {
        position: fixed;
        inset: 0;
        background: rgba(0,0,0,0.55);
        z-index: 100001;
        display: flex;
        align-items: center;
        justify-content: center;
    }

    #${SETTINGS_MODAL_ID} {
        background: #fff;
        border-radius: 10px;
        padding: 24px;
        width: 520px;
        max-width: 92vw;
        max-height: 85vh;
        overflow-y: auto;
        box-shadow: 0 12px 48px rgba(0,0,0,0.35);
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        color: #1a1a1a;
        display: flex;
        flex-direction: column;
        gap: 16px;
    }

    #${SETTINGS_MODAL_ID} h2 {
        margin: 0;
        font-size: 18px;
        color: #0a66c2;
    }

    #${SETTINGS_MODAL_ID} p.${SCRIPT_PREFIX}subtitle {
        margin: 0;
        font-size: 13px;
        color: #555;
    }

    .${SCRIPT_PREFIX}section-heading {
        margin: 0 0 8px 0;
        font-size: 14px;
        font-weight: 700;
        color: #0a66c2;
        border-bottom: 1px solid #dde;
        padding-bottom: 4px;
    }

    .${SCRIPT_PREFIX}keyword-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 13px;
    }

    .${SCRIPT_PREFIX}keyword-table th {
        text-align: left;
        padding: 6px 8px;
        background: #f0f4f8;
        border-bottom: 2px solid #ccd;
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0.04em;
    }

    .${SCRIPT_PREFIX}keyword-table td {
        padding: 5px 8px;
        border-bottom: 1px solid #eef;
        vertical-align: middle;
    }

    .${SCRIPT_PREFIX}keyword-table tr:hover td {
        background: #f7faff;
    }

    .${SCRIPT_PREFIX}keyword-table select,
    .${SCRIPT_PREFIX}keyword-table input[type="text"] {
        border: 1px solid #ccd;
        border-radius: 4px;
        padding: 3px 6px;
        font-size: 12px;
        color: #1a1a1a;
        background: #fff;
    }

    .${SCRIPT_PREFIX}keyword-table input[type="text"] {
        width: 100%;
        box-sizing: border-box;
    }

    .${SCRIPT_PREFIX}color-input {
        width: 36px;
        height: 26px;
        padding: 1px 2px;
        border: 1px solid #ccd;
        border-radius: 4px;
        cursor: pointer;
        background: none;
        display: block;
    }

    .${SCRIPT_PREFIX}btn-icon {
        background: none;
        border: none;
        cursor: pointer;
        font-size: 16px;
        padding: 2px 4px;
        border-radius: 4px;
        transition: background 0.15s;
    }

    .${SCRIPT_PREFIX}btn-icon:hover { background: #f0e0e0; }
    .${SCRIPT_PREFIX}btn-icon:disabled { opacity: 0.3; cursor: default; }
    .${SCRIPT_PREFIX}btn-icon:disabled:hover { background: none; }

    .${SCRIPT_PREFIX}add-row {
        display: flex;
        gap: 8px;
        align-items: center;
        margin-top: 6px;
    }

    .${SCRIPT_PREFIX}add-row input[type="text"] {
        flex: 1;
        border: 1px solid #ccd;
        border-radius: 4px;
        padding: 5px 8px;
        font-size: 13px;
    }

    .${SCRIPT_PREFIX}add-row select {
        border: 1px solid #ccd;
        border-radius: 4px;
        padding: 5px 8px;
        font-size: 13px;
        background: #fff;
    }

    .${SCRIPT_PREFIX}modal-actions {
        display: flex;
        gap: 10px;
        justify-content: flex-end;
        flex-wrap: wrap;
    }

    .${SCRIPT_PREFIX}btn {
        padding: 8px 18px;
        border-radius: 6px;
        border: none;
        cursor: pointer;
        font-size: 13px;
        font-weight: 600;
        transition: background 0.2s;
    }

    .${SCRIPT_PREFIX}btn-primary   { background: #0a66c2; color: #fff; }
    .${SCRIPT_PREFIX}btn-primary:hover { background: #004182; }
    .${SCRIPT_PREFIX}btn-danger    { background: #c0392b; color: #fff; }
    .${SCRIPT_PREFIX}btn-danger:hover  { background: #922b21; }
    .${SCRIPT_PREFIX}btn-secondary { background: #eef; color: #333; border: 1px solid #ccd; }
    .${SCRIPT_PREFIX}btn-secondary:hover { background: #ddf; }

    /* ---- Dark Mode ---- */
    @media (prefers-color-scheme: dark) {
        #${SETTINGS_MODAL_ID} {
            background: #1e1f2e;
            color: #e8e8f0;
        }
        #${SETTINGS_MODAL_ID} h2 {
            color: #4d9de0;
        }
        #${SETTINGS_MODAL_ID} p.${SCRIPT_PREFIX}subtitle {
            color: #9090a8;
        }
        .${SCRIPT_PREFIX}section-heading {
            color: #4d9de0;
            border-bottom-color: #444;
        }
        .${SCRIPT_PREFIX}keyword-table th {
            background: #2a2b3d;
            border-bottom-color: #555;
        }
        .${SCRIPT_PREFIX}keyword-table td {
            border-bottom-color: #333;
        }
        .${SCRIPT_PREFIX}keyword-table tr:hover td {
            background: #252636;
        }
        .${SCRIPT_PREFIX}keyword-table select,
        .${SCRIPT_PREFIX}keyword-table input[type="text"] {
            background: #2a2b3d;
            color: #e8e8f0;
            border-color: #555;
        }
        .${SCRIPT_PREFIX}color-input {
            border-color: #555;
            background: #2a2b3d;
        }
        .${SCRIPT_PREFIX}add-row input[type="text"],
        .${SCRIPT_PREFIX}add-row select {
            background: #2a2b3d;
            color: #e8e8f0;
            border-color: #555;
        }
        .${SCRIPT_PREFIX}btn-secondary {
            background: #2a2b3d;
            color: #c8c8d8;
            border-color: #555;
        }
        .${SCRIPT_PREFIX}btn-secondary:hover { background: #353648; }
        .${SCRIPT_PREFIX}btn-icon:hover { background: #3d2a2a; }
    }
`);

// ============================================================
// STORAGE INTERFACE
// ============================================================

const Storage = {
    loadCategories() {
        const raw = GM_getValue(`${SCRIPT_PREFIX}categories`, null);
        if (raw === null) {
            this.saveCategories(DEFAULT_CATEGORIES);
            return DEFAULT_CATEGORIES.map(c => ({ ...c }));
        }
        try {
            return JSON.parse(raw);
        } catch {
            console.warn('[LJKM] Failed to parse stored categories, resetting to defaults.');
            this.saveCategories(DEFAULT_CATEGORIES);
            return DEFAULT_CATEGORIES.map(c => ({ ...c }));
        }
    },

    /** @param {CategoryEntry[]} categories */
    saveCategories(categories) {
        GM_setValue(`${SCRIPT_PREFIX}categories`, JSON.stringify(categories));
    },

    loadKeywords() {
        const raw = GM_getValue(`${SCRIPT_PREFIX}keywords`, null);
        if (raw === null) {
            this.saveKeywords(DEFAULT_KEYWORDS);
            return DEFAULT_KEYWORDS;
        }
        try {
            const parsed = JSON.parse(raw);
            // Migrate old format: { phrase, severity } → { phrase, categoryId }
            let changed = false;
            const migrated = parsed.map(kw => {
                if (kw.severity !== undefined && kw.categoryId === undefined) {
                    changed = true;
                    return { phrase: kw.phrase, categoryId: kw.severity };
                }
                return kw;
            });
            if (changed) this.saveKeywords(migrated);
            return migrated;
        } catch {
            console.warn('[LJKM] Failed to parse stored keywords, resetting to defaults.');
            this.saveKeywords(DEFAULT_KEYWORDS);
            return DEFAULT_KEYWORDS;
        }
    },

    /** @param {KeywordEntry[]} keywords */
    saveKeywords(keywords) {
        GM_setValue(`${SCRIPT_PREFIX}keywords`, JSON.stringify(keywords));
    },
};

// ============================================================
// KEYWORD SCANNER
// ============================================================

const Scanner = {
    /**
     * @param {KeywordEntry[]} keywords
     * @param {CategoryEntry[]} categories
     * @returns {{ byCategory: Record<string, ScanResult[]>, total: number }}
     */
    scan(keywords, categories) {
        const container = document.querySelector(JOB_DETAIL_SELECTOR);
        if (!container) return { byCategory: {}, total: 0 };

        const text = (container.textContent || '').toLowerCase();
        const validIds = new Set(categories.map(c => c.id));

        const results = keywords
            .filter(kw => validIds.has(kw.categoryId))
            .map(({ phrase, categoryId }) => ({
                phrase,
                categoryId,
                count: this._countOccurrences(text, phrase.toLowerCase()),
            }))
            .filter(r => r.count > 0);

        /** @type {Record<string, ScanResult[]>} */
        const byCategory = {};
        for (const result of results) {
            if (!byCategory[result.categoryId]) byCategory[result.categoryId] = [];
            byCategory[result.categoryId].push(result);
        }

        const total = results.reduce((sum, r) => sum + r.count, 0);
        return { byCategory, total };
    },

    /**
     * @param {string} haystack
     * @param {string} needle
     * @returns {number}
     */
    _countOccurrences(haystack, needle) {
        if (!needle) return 0;
        let count = 0;
        let pos = 0;
        while ((pos = haystack.indexOf(needle, pos)) !== -1) {
            count++;
            pos += needle.length;
        }
        return count;
    },
};

// ============================================================
// TOOLTIP CONTROLLER
// ============================================================

const Tooltip = {
    /** @type {HTMLElement | null} */
    _el: null,

    /**
     * @param {HTMLElement} anchor
     * @param {ScanResult[]} items
     * @param {CategoryEntry} category
     */
    show(anchor, items, category) {
        this.hide();

        const el = document.createElement('div');
        el.className = `${SCRIPT_PREFIX}tooltip`;

        const title = document.createElement('div');
        title.className = `${SCRIPT_PREFIX}tooltip-title`;
        title.textContent = `${category.name} Matches`;
        el.appendChild(title);

        for (const item of items) {
            const row = document.createElement('div');
            row.className = `${SCRIPT_PREFIX}tooltip-item`;

            const phrase = document.createElement('span');
            phrase.className = `${SCRIPT_PREFIX}tooltip-phrase`;
            phrase.textContent = `"${item.phrase}"`;

            const hits = document.createElement('span');
            hits.className = `${SCRIPT_PREFIX}tooltip-hits`;
            hits.textContent = `×${item.count}`;

            row.appendChild(phrase);
            row.appendChild(hits);
            el.appendChild(row);
        }

        document.body.appendChild(el);
        this._el = el;
        this._position(anchor, el);
    },

    hide() {
        if (this._el) {
            this._el.remove();
            this._el = null;
        }
    },

    /**
     * @param {HTMLElement} anchor
     * @param {HTMLElement} tooltip
     */
    _position(anchor, tooltip) {
        const rect = anchor.getBoundingClientRect();
        tooltip.style.bottom = `${window.innerHeight - rect.top + 8}px`;
        tooltip.style.right = `${window.innerWidth - rect.right}px`;
        tooltip.style.top = 'auto';
    },
};

// ============================================================
// SETTINGS MODAL
// ============================================================

const SettingsModal = {
    /** @type {HTMLElement | null} */
    _overlay: null,

    /** @param {() => void} onSave */
    open(onSave) {
        if (this._overlay) return;

        const overlay = document.createElement('div');
        overlay.id = `${SETTINGS_MODAL_ID}_overlay`;

        const modal = document.createElement('div');
        modal.id = SETTINGS_MODAL_ID;

        modal.innerHTML = `
            <h2>⚙️ LinkedIn Keywords Monitor</h2>
            <p class="${SCRIPT_PREFIX}subtitle">
                Keywords are matched case-insensitively within job details.
                Changes take effect immediately after saving.
            </p>
        `;

        // ---- Categories section ----
        const catSection = document.createElement('div');

        const catHeading = document.createElement('h3');
        catHeading.className = `${SCRIPT_PREFIX}section-heading`;
        catHeading.textContent = 'Categories';
        catSection.appendChild(catHeading);

        const catTable = document.createElement('table');
        catTable.className = `${SCRIPT_PREFIX}keyword-table`;
        catTable.innerHTML = `
            <thead>
                <tr>
                    <th style="width:52px">Color</th>
                    <th>Name</th>
                    <th style="width:36px"></th>
                </tr>
            </thead>
        `;
        const catTbody = document.createElement('tbody');
        catTable.appendChild(catTbody);
        catSection.appendChild(catTable);

        const addCatRow = document.createElement('div');
        addCatRow.className = `${SCRIPT_PREFIX}add-row`;

        const newCatColor = document.createElement('input');
        newCatColor.type = 'color';
        newCatColor.value = '#0a66c2';
        newCatColor.className = `${SCRIPT_PREFIX}color-input`;

        const newCatName = document.createElement('input');
        newCatName.type = 'text';
        newCatName.placeholder = 'New category name…';

        const addCatBtn = document.createElement('button');
        addCatBtn.className = `${SCRIPT_PREFIX}btn ${SCRIPT_PREFIX}btn-primary`;
        addCatBtn.textContent = '+ Add';
        addCatBtn.addEventListener('click', () => {
            const name = newCatName.value.trim();
            if (!name) return;
            const cats = Storage.loadCategories();
            const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'cat';
            let id = slug;
            let n = 2;
            const existingIds = cats.map(c => c.id);
            while (existingIds.includes(id)) id = `${slug}_${n++}`;
            cats.push({ id, name, color: newCatColor.value });
            Storage.saveCategories(cats);
            newCatName.value = '';
            renderCatRows();
            renderKwRows();
        });
        newCatName.addEventListener('keydown', e => { if (e.key === 'Enter') addCatBtn.click(); });

        addCatRow.appendChild(newCatColor);
        addCatRow.appendChild(newCatName);
        addCatRow.appendChild(addCatBtn);
        catSection.appendChild(addCatRow);
        modal.appendChild(catSection);

        // ---- Keywords section ----
        const kwSection = document.createElement('div');

        const kwHeading = document.createElement('h3');
        kwHeading.className = `${SCRIPT_PREFIX}section-heading`;
        kwHeading.textContent = 'Keywords';
        kwSection.appendChild(kwHeading);

        const kwTable = document.createElement('table');
        kwTable.className = `${SCRIPT_PREFIX}keyword-table`;
        kwTable.innerHTML = `
            <thead>
                <tr>
                    <th>Phrase</th>
                    <th>Category</th>
                    <th style="width:36px"></th>
                </tr>
            </thead>
        `;
        const kwTbody = document.createElement('tbody');
        kwTable.appendChild(kwTbody);
        kwSection.appendChild(kwTable);

        const addKwRow = document.createElement('div');
        addKwRow.className = `${SCRIPT_PREFIX}add-row`;

        const newPhraseInput = document.createElement('input');
        newPhraseInput.type = 'text';
        newPhraseInput.placeholder = 'Add new keyword or phrase…';

        const newCatSelect = document.createElement('select');

        const addKwBtn = document.createElement('button');
        addKwBtn.className = `${SCRIPT_PREFIX}btn ${SCRIPT_PREFIX}btn-primary`;
        addKwBtn.textContent = '+ Add';
        addKwBtn.addEventListener('click', () => {
            const phrase = newPhraseInput.value.trim();
            if (!phrase) return;
            const kws = Storage.loadKeywords();
            kws.push({ phrase, categoryId: newCatSelect.value });
            Storage.saveKeywords(kws);
            newPhraseInput.value = '';
            renderKwRows();
        });
        newPhraseInput.addEventListener('keydown', e => { if (e.key === 'Enter') addKwBtn.click(); });

        addKwRow.appendChild(newPhraseInput);
        addKwRow.appendChild(newCatSelect);
        addKwRow.appendChild(addKwBtn);
        kwSection.appendChild(addKwRow);
        modal.appendChild(kwSection);

        // ---- Action buttons ----
        const actions = document.createElement('div');
        actions.className = `${SCRIPT_PREFIX}modal-actions`;

        const resetBtn = document.createElement('button');
        resetBtn.className = `${SCRIPT_PREFIX}btn ${SCRIPT_PREFIX}btn-danger`;
        resetBtn.textContent = '↺ Reset Defaults';
        resetBtn.addEventListener('click', () => {
            if (confirm('Reset all keywords and categories to defaults? This cannot be undone.')) {
                Storage.saveCategories(DEFAULT_CATEGORIES);
                Storage.saveKeywords(DEFAULT_KEYWORDS);
                renderCatRows();
                renderKwRows();
            }
        });

        const saveBtn = document.createElement('button');
        saveBtn.className = `${SCRIPT_PREFIX}btn ${SCRIPT_PREFIX}btn-primary`;
        saveBtn.textContent = '✓ Save & Close';
        saveBtn.addEventListener('click', () => { this.close(); onSave(); });

        const cancelBtn = document.createElement('button');
        cancelBtn.className = `${SCRIPT_PREFIX}btn ${SCRIPT_PREFIX}btn-secondary`;
        cancelBtn.textContent = 'Cancel';
        cancelBtn.addEventListener('click', () => this.close());

        actions.appendChild(resetBtn);
        actions.appendChild(cancelBtn);
        actions.appendChild(saveBtn);
        modal.appendChild(actions);

        // ---- Render functions ----
        // Declared with let so event handlers defined above can reference them
        // before assignment; closures are only invoked after open() returns.
        let renderCatRows, renderKwRows;

        renderCatRows = () => {
            catTbody.innerHTML = '';
            const cats = Storage.loadCategories();
            cats.forEach((cat, idx) => {
                const tr = document.createElement('tr');

                const tdColor = document.createElement('td');
                const colorInput = document.createElement('input');
                colorInput.type = 'color';
                colorInput.value = cat.color;
                colorInput.className = `${SCRIPT_PREFIX}color-input`;
                colorInput.addEventListener('input', () => {
                    const cs = Storage.loadCategories();
                    cs[idx].color = colorInput.value;
                    Storage.saveCategories(cs);
                });
                tdColor.appendChild(colorInput);

                const tdName = document.createElement('td');
                const nameInput = document.createElement('input');
                nameInput.type = 'text';
                nameInput.value = cat.name;
                nameInput.addEventListener('change', () => {
                    const cs = Storage.loadCategories();
                    cs[idx].name = nameInput.value.trim() || cs[idx].name;
                    Storage.saveCategories(cs);
                    renderKwRows(); // refresh dropdown labels
                });
                tdName.appendChild(nameInput);

                const tdDel = document.createElement('td');
                const btnDel = document.createElement('button');
                btnDel.className = `${SCRIPT_PREFIX}btn-icon`;
                btnDel.textContent = '🗑️';
                btnDel.disabled = cats.length <= 1;
                btnDel.title = cats.length <= 1 ? 'Cannot delete the last category' : 'Remove category';
                btnDel.addEventListener('click', () => {
                    const cs = Storage.loadCategories();
                    if (cs.length <= 1) return;
                    const [removed] = cs.splice(idx, 1);
                    Storage.saveCategories(cs);
                    // Reassign keywords using the deleted category to the first remaining one
                    const kws = Storage.loadKeywords();
                    let kwChanged = false;
                    for (const kw of kws) {
                        if (kw.categoryId === removed.id) {
                            kw.categoryId = cs[0].id;
                            kwChanged = true;
                        }
                    }
                    if (kwChanged) Storage.saveKeywords(kws);
                    renderCatRows();
                    renderKwRows();
                });
                tdDel.appendChild(btnDel);

                tr.appendChild(tdColor);
                tr.appendChild(tdName);
                tr.appendChild(tdDel);
                catTbody.appendChild(tr);
            });
        };

        renderKwRows = () => {
            kwTbody.innerHTML = '';
            const cats = Storage.loadCategories();
            const kws = Storage.loadKeywords();

            // Refresh the add-row category dropdown
            newCatSelect.innerHTML = '';
            for (const cat of cats) {
                const opt = document.createElement('option');
                opt.value = cat.id;
                opt.textContent = cat.name;
                newCatSelect.appendChild(opt);
            }

            kws.forEach((kw, idx) => {
                const tr = document.createElement('tr');

                const tdPhrase = document.createElement('td');
                const phraseInput = document.createElement('input');
                phraseInput.type = 'text';
                phraseInput.value = kw.phrase;
                phraseInput.addEventListener('change', () => {
                    const ks = Storage.loadKeywords();
                    ks[idx].phrase = phraseInput.value.trim();
                    Storage.saveKeywords(ks);
                });
                tdPhrase.appendChild(phraseInput);

                const tdCat = document.createElement('td');
                const catSelect = document.createElement('select');
                for (const cat of cats) {
                    const opt = document.createElement('option');
                    opt.value = cat.id;
                    opt.textContent = cat.name;
                    if (cat.id === kw.categoryId) opt.selected = true;
                    catSelect.appendChild(opt);
                }
                catSelect.addEventListener('change', () => {
                    const ks = Storage.loadKeywords();
                    ks[idx].categoryId = catSelect.value;
                    Storage.saveKeywords(ks);
                });
                tdCat.appendChild(catSelect);

                const tdDel = document.createElement('td');
                const btnDel = document.createElement('button');
                btnDel.className = `${SCRIPT_PREFIX}btn-icon`;
                btnDel.textContent = '🗑️';
                btnDel.title = 'Remove keyword';
                btnDel.addEventListener('click', () => {
                    const ks = Storage.loadKeywords();
                    ks.splice(idx, 1);
                    Storage.saveKeywords(ks);
                    renderKwRows();
                });
                tdDel.appendChild(btnDel);

                tr.appendChild(tdPhrase);
                tr.appendChild(tdCat);
                tr.appendChild(tdDel);
                kwTbody.appendChild(tr);
            });
        };

        renderCatRows();
        renderKwRows();

        overlay.addEventListener('click', e => { if (e.target === overlay) this.close(); });
        overlay.appendChild(modal);
        document.body.appendChild(overlay);
        this._overlay = overlay;
        newPhraseInput.focus();
    },

    close() {
        if (this._overlay) {
            this._overlay.remove();
            this._overlay = null;
        }
    },
};

// ============================================================
// BADGE RENDERER
// ============================================================

const BadgeRenderer = {
    /**
     * @param {{ byCategory: Record<string, ScanResult[]>, total: number }} scanData
     * @param {CategoryEntry[]} categories
     * @param {() => void} onSettingsOpen
     */
    render(scanData, categories, onSettingsOpen) {
        let container = document.getElementById(BADGE_CONTAINER_ID);
        if (!container) {
            container = document.createElement('div');
            container.id = BADGE_CONTAINER_ID;
            document.body.appendChild(container);
        }
        container.innerHTML = '';

        const { byCategory, total } = scanData;
        const hasMatches = Object.keys(byCategory).length > 0;

        if (hasMatches) {
            // Render badges in category definition order
            for (const category of categories) {
                const items = byCategory[category.id];
                if (!items) continue;
                const count = items.reduce((sum, i) => sum + i.count, 0);

                const badge = document.createElement('div');
                badge.className = `${SCRIPT_PREFIX}badge`;
                badge.style.background = category.color;
                badge.title = 'Click to see matched phrases';

                const label = document.createElement('span');
                label.className = `${SCRIPT_PREFIX}badge-label`;
                label.textContent = category.name;

                const countEl = document.createElement('span');
                countEl.className = `${SCRIPT_PREFIX}badge-count`;
                countEl.textContent = `${count} match${count !== 1 ? 'es' : ''}`;

                badge.appendChild(label);
                badge.appendChild(countEl);

                badge.addEventListener('mouseenter', () => Tooltip.show(badge, items, category));
                badge.addEventListener('mouseleave', () => Tooltip.hide());

                container.appendChild(badge);
            }
        }

        const settingsBtn = document.createElement('button');
        settingsBtn.className = `${SCRIPT_PREFIX}settings-btn`;
        settingsBtn.textContent = hasMatches
            ? `⚙️ ${total} flag${total !== 1 ? 's' : ''} · Edit Keywords`
            : '⚙️ No Flags · Edit Keywords';
        settingsBtn.addEventListener('click', onSettingsOpen);
        container.appendChild(settingsBtn);
    },
};

// ============================================================
// MAIN CONTROLLER
// ============================================================

const Monitor = {
    /** @type {MutationObserver | null} */
    _observer: null,
    /** @type {ReturnType<typeof setTimeout> | null} */
    _debounceTimer: null,
    /** @type {WeakSet<Element>} */
    _processedCheckboxes: new WeakSet(),
    /** @type {WeakSet<Element>} */
    _clickedExpandables: new WeakSet(),

    init() {
        this._scheduleUpdate();
        this._startObserver();
        console.info('[LJKM] LinkedIn Job Keywords Monitor initialized.');
    },

    _scheduleUpdate() {
        if (this._debounceTimer) clearTimeout(this._debounceTimer);
        this._debounceTimer = setTimeout(() => this._update(), DEBOUNCE_DELAY_MS);
    },

    _update() {
        const keywords = Storage.loadKeywords();
        const categories = Storage.loadCategories();
        const scanData = Scanner.scan(keywords, categories);
        BadgeRenderer.render(scanData, categories, () => {
            SettingsModal.open(() => this._update());
        });
    },

    /**
     * Uncheck the follow-company checkbox whenever it appears in an added subtree (dialog).
     * @param {MutationRecord[]} mutations
     */
    _handleFollowCheckbox(mutations) {
        for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
                if (node.nodeType !== Node.ELEMENT_NODE) continue;
                const el = /** @type {Element} */ (node);
                const checkbox = el.id === 'follow-company-checkbox'
                    ? el
                    : el.querySelector('#follow-company-checkbox');
                if (!checkbox || this._processedCheckboxes.has(checkbox)) continue;
                this._processedCheckboxes.add(checkbox);
                if (/** @type {HTMLInputElement} */ (checkbox).checked) {
                    /** @type {HTMLInputElement} */ (checkbox).click();
                }
            }
        }
    },

    /**
     * Click any un-clicked expandable "more" buttons inside the job detail container.
     */
    _clickExpandableButtons() {
        const container = document.querySelector(JOB_DETAIL_SELECTOR);
        if (!container) return;
        const buttons = container.querySelectorAll('button[data-testid="expandable-text-button"]');
        for (const btn of buttons) {
            if (this._clickedExpandables.has(btn)) continue;
            const hasMoreSpan = [...btn.querySelectorAll('span')].some(
                s => /^\s*more\s*$/i.test(s.textContent)
            );
            if (hasMoreSpan) {
                this._clickedExpandables.add(btn);
                btn.click();
            }
        }
    },

    _startObserver() {
        if (this._observer) this._observer.disconnect();

        this._observer = new MutationObserver(mutations => {
            this._handleFollowCheckbox(mutations);
            this._clickExpandableButtons();

            // Only re-scan if something relevant changed
            const relevant = mutations.some(m =>
                m.type === 'childList' ||
                (m.type === 'characterData' && m.target.nodeType === Node.TEXT_NODE)
            );
            if (relevant) this._scheduleUpdate();
        });

        // Observe the whole document body to catch SPA navigation
        this._observer.observe(document.body, {
            childList: true,
            subtree: true,
            characterData: true,
        });
    },
};

// ============================================================
// BOOTSTRAP
// ============================================================

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => Monitor.init());
} else {
    Monitor.init();
}
