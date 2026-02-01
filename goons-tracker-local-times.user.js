// ==UserScript==
// @name            Goons Tracker - Local Times
// @author          Tosox
// @namespace       https://github.com/Tosox
// @homepage        https://github.com/Tosox/Goons-Tracker-Local-Times
// @supportURL      https://github.com/Tosox/Goons-Tracker-Local-Times/issues
// @updateURL       https://github.com/Tosox/Goons-Tracker-Local-Times/releases/latest/download/goons-tracker-local-times.user.js
// @downloadURL     https://github.com/Tosox/Goons-Tracker-Local-Times/releases/latest/download/goons-tracker-local-times.user.js
// @icon            https://github.com/Tosox/Goons-Tracker-Local-Times/blob/master/assets/icon.png?raw=true
// @description     Converts Goons tracker timestamps into your local time
// @version         1.0.0
// @license         MIT
// @copyright       Copyright (c) 2026 Tosox
// @match           https://www.goon-tracker.com/*
// @match           https://www.tarkov-goon-tracker.com/*
// @grant           GM_getValue
// @grant           GM_setValue
// @grant           GM_registerMenuCommand
// ==/UserScript==

(() => {
    "use strict";

    // -----------------------------
    // Settings
    // -----------------------------
    const SETTINGS_KEY = "gt_local_times_settings";
    const DEFAULT_PATTERN = "dd.MM.yyyy, HH:mm:ss";
    const PROCESSED_ATTR = "data-localized-time";

    const ALLOWED_TOKENS = new Set([
        "yyyy", "yy",
        "MM", "M",
        "dd", "d",
        "HH", "H",
        "hh", "h",
        "mm", "m",
        "ss", "s",
        "a"
    ]);

    function readSettings() {
        const raw = GM_getValue(SETTINGS_KEY, null);
        if (!raw) {
            return { pattern: "" };
        }

        try {
            const obj = (typeof raw === "string" ? JSON.parse(raw) : raw);
            return { pattern: (obj?.pattern ?? "") };
        } catch {
            return { pattern: "" };
        }
    }

    function writeSettings(next) {
        const merged = { pattern: (next?.pattern ?? "") };
        GM_setValue(SETTINGS_KEY, JSON.stringify(merged));
        return merged;
    }

    // -----------------------------
    // Default pattern
    // -----------------------------
    function guessLocalePrefersHour12() {
        try {
            return new Intl.DateTimeFormat(undefined, {
                hour: "numeric"
            }).resolvedOptions().hour12 === true;
        } catch {
            return false;
        }
    }

    function guessDefaultPattern() {
        const prefers12h = guessLocalePrefersHour12();
        const sample = new Date(2006, 0, 2, 15, 4, 5);
        const dtf = new Intl.DateTimeFormat(undefined, {
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: prefers12h,
        });

        const parts = dtf.formatToParts(sample);

        const map = {
            year: "yyyy",
            month: "MM",
            day: "dd",
            hour: prefers12h ? "hh" : "HH",
            minute: "mm",
            second: "ss",
            dayPeriod: "a",
        };

        let pattern = "";
        for (const p of parts) {
            if (p.type in map) {
                pattern += map[p.type];
            } else {
                pattern += p.value;
            }
        }

        if (!pattern) {
            return DEFAULT_PATTERN;
        }

        return pattern.trim();
    }

    function getDefaultPattern() {
        const s = readSettings();
        if (s.pattern && s.pattern.trim()) {
            return s.pattern.trim();
        }

        const guessed = guessDefaultPattern();
        const fallback = guessed && guessed.length ? guessed : DEFAULT_PATTERN;
        writeSettings({
            pattern: fallback
        });
        return fallback;
    }

    // -----------------------------
    // Pattern validation
    // -----------------------------
    function pad2(n) {
        return String(n).padStart(2, "0");
    }

    function validatePattern(pattern) {
        if (!pattern) {
            return false;
        }

        const p = pattern.trim();
        if (!p) {
            return false;
        }

        const tokens = Array.from(ALLOWED_TOKENS).sort((a, b) => b.length - a.length);
        if (/[\r\n\t]/.test(p)) {
            return false;
        }

        let stripped = p;
        for (const t of tokens) {
            stripped = stripped.split(t).join("");
        }
        if (/[A-Za-z]/.test(stripped)) {
            return false;
        }

        return true;
    }

    function formatByPattern(date, pattern) {
        const hour24 = date.getHours();
        const hour12 = (hour24 % 12) || 12;
        const ampm = (hour24 < 12 ? "AM" : "PM");

        const map = {
            yyyy: String(date.getFullYear()),
            yy: String(date.getFullYear()).slice(-2),

            MM: pad2(date.getMonth() + 1),
            M: String(date.getMonth() + 1),

            dd: pad2(date.getDate()),
            d: String(date.getDate()),

            HH: pad2(hour24),
            H: String(hour24),

            hh: pad2(hour12),
            h: String(hour12),

            mm: pad2(date.getMinutes()),
            m: String(date.getMinutes()),

            ss: pad2(date.getSeconds()),
            s: String(date.getSeconds()),

            a: ampm,
        };

        const tokens = Object.keys(map).sort((a, b) => b.length - a.length);
        let out = pattern;
        for (const t of tokens) {
            out = out.replaceAll(t, map[t]);
        }

        return out;
    }

    // -----------------------------
    // Seconds-on-demand
    // -----------------------------
    function originalShowsSeconds(originalText) {
        return /(\d{1,2}:\d{2}:\d{2})/.test(originalText);
    }

    function patternHasSeconds(pattern) {
        return pattern.includes("ss") || pattern.includes("s");
    }

    function ensureSecondsInPattern(pattern) {
        if (patternHasSeconds(pattern)) return pattern;

        // Prefer inserting after minutes token
        if (pattern.includes("mm")) return pattern.replace("mm", "mm:ss");
        if (pattern.includes("m")) return pattern.replace("m", "m:s");

        // Fallback: append seconds
        return (pattern.trim().length ? (pattern.trim() + ":ss") : "HH:mm:ss");
    }

    function removeSecondsFromPattern(pattern) {
        if (!patternHasSeconds(pattern)) return pattern;

        // Remove seconds token plus a preceding ":" when present (e.g., "HH:mm:ss" -> "HH:mm")
        let p = pattern.replace(/(:)?(ss|s)\b/g, "");

        // Clean up any dangling separators/spaces created by removal
        p = p.replace(/\s{2,}/g, " ");
        p = p.replace(/,\s*,/g, ", ");
        p = p.replace(/:\s*(?=[,\s]|$)/g, ""); // remove trailing ":" if it ends up before comma/space/end
        return p.trim();
    }

    function formatLocal(date, { showSeconds } = {}) {
        const userPattern = (readSettings().pattern || "").trim();
        const defaultPattern = getDefaultPattern();
        let effective = validatePattern(userPattern) ? userPattern : defaultPattern;

        if (showSeconds) {
            effective = ensureSecondsInPattern(effective);
        } else { 
            effective = removeSecondsFromPattern(effective);
        }

        return formatByPattern(date, effective);
    }

    // -----------------------------
    // Menu
    // -----------------------------
    function registerMenu() {
        GM_registerMenuCommand("Set date pattern", () => {
            const cur = (readSettings().pattern || "").trim();
            const def = getDefaultPattern();

            const input = prompt(
                [
                    "Enter a custom date/time pattern.",
                    "",
                    "Supported tokens:",
                    "  yyyy yy  MM M  dd d  HH H  hh h  mm m  ss s  a",
                    "",
                    "Examples:",
                    "  24h: dd.MM.yyyy, HH:mm:ss",
                    "  12h: dd.MM.yyyy, hh:mm:ss a",
                    "",
                    `Current: ${cur || "(not set)"}`,
                    `Default: ${def}`,
                    "",
                    "If your pattern is invalid, the script falls back to the default."
                ].join("\n"),
                cur || def
            );
            if (input === null) {
                return;
            }

            writeSettings({
                pattern: input.trim()
            });
            run();
        });
    }

    // -----------------------------
    // Parsers
    // -----------------------------
    const MONTHS = {
        Jan: 0,
        Feb: 1,
        Mar: 2,
        Apr: 3,
        May: 4,
        Jun: 5,
        Jul: 6,
        Aug: 7,
        Sep: 8,
        Oct: 9,
        Nov: 10,
        Dec: 11,
    };

    // "Jan 05, 2026 10:20 AM z."
    function parseTarkovGoon(text) {
        if (!text) {
            return null;
        }

        const s = text.trim().replace(/\s+/g, " ").replace(/\.$/, "");
        const m = s.match(/^([A-Za-z]{3})\s+(\d{2}),\s+(\d{4})\s+(\d{2}):(\d{2})\s+(AM|PM)\s+z$/i);
        if (!m) {
            return null;
        }

        const monStr = m[1][0].toUpperCase() + m[1].slice(1, 3).toLowerCase();
        const month = MONTHS[monStr];
        if (month === undefined) {
            return null;
        }

        const day = Number(m[2]);
        const year = Number(m[3]);
        let hour = Number(m[4]);
        const minute = Number(m[5]);
        const ampm = m[6].toUpperCase();

        if (ampm === "AM") {
            if (hour === 12) {
                hour = 0;
            }
        } else {
            if (hour !== 12) {
                hour += 12;
            }
        }

        return {
            year,
            month,
            day,
            hour,
            minute,
            second: 0
        };
    }

    // "2026-01-22 10:30:01" or "2026-01-22 10:30:01 PST"
    function parseSqlDateTime(text) {
        if (!text) {
            return null;
        }

        const s = text.trim().replace(/\s+/g, " ");
        const m = s.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})(?:\s+([A-Za-z]{2,5}))?$/);
        if (!m) {
            return null;
        }

        return {
            year: Number(m[1]),
            month: Number(m[2]) - 1,
            day: Number(m[3]),
            hour: Number(m[4]),
            minute: Number(m[5]),
            second: Number(m[6]),
            tzAbbrev: m[7] ? m[7].toUpperCase() : null,
        };
    }

    // -----------------------------
    // Timezone conversion
    // -----------------------------
    function tzOffsetMs(instantMs, timeZone) {
        const dtf = new Intl.DateTimeFormat("en-US", {
            timeZone,
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false,
        });

        const parts = dtf.formatToParts(new Date(instantMs));
        const get = (type) => parts.find((p) => p.type === type)?.value;

        const y = Number(get("year"));
        const mo = Number(get("month"));
        const d = Number(get("day"));
        const h = Number(get("hour"));
        const mi = Number(get("minute"));
        const s = Number(get("second"));

        const asUtc = Date.UTC(y, mo - 1, d, h, mi, s);
        return asUtc - instantMs;
    }

    function zonedTimeToUtcMs(wallClock, timeZone) {
        const {
            year,
            month,
            day,
            hour,
            minute,
            second = 0
        } = wallClock;

        let guess = Date.UTC(year, month, day, hour, minute, second);
        for (let i = 0; i < 2; i++) {
            const offset = tzOffsetMs(guess, timeZone);
            guess = Date.UTC(year, month, day, hour, minute, second) - offset;
        }

        return guess;
    }

    // -----------------------------
    // DOM helpers
    // -----------------------------
    const q = (sel, root = document) => root.querySelector(sel);
    const qa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

    // -----------------------------
    // Conversion pipeline
    // -----------------------------
    function convertElement(el, {
        parse,
        sourceTz,
        title
    }) {
        if (!el || el.nodeType !== Node.ELEMENT_NODE) {
            return false;
        }

        if (el.getAttribute(PROCESSED_ATTR) === "1") {
            return false;
        }

        const original = (el.textContent || "").trim();
        const parsed = parse(original);
        if (!parsed) {
            return false;
        }

        const showSeconds = originalShowsSeconds(original);

        const utcMs = zonedTimeToUtcMs(parsed, sourceTz);
        const localStr = formatLocal(new Date(utcMs), { showSeconds });

        el.textContent = localStr;
        if (title) {
            el.title = title(original, sourceTz, localStr);
        }

        el.setAttribute(PROCESSED_ATTR, "1");
        return true;
    }

    function convertElements(elements, opts) {
        for (const el of elements) {
            convertElement(el, opts);
        }
    }

    function elementsFrom(selector, mapFn = (el) => el, root = document) {
        return qa(selector, root).map(mapFn).filter(Boolean);
    }

    // -----------------------------
    // Sites
    // -----------------------------
    const SITES = [
        {
            match: (host) => host.includes("tarkov-goon-tracker.com"),
            run: () => {
                const section = q("#trackings");
                if (!section) {
                    return;
                }

                const divs = qa(":scope > div", section);
                if (divs.length < 2) {
                    return;
                }

                const tbody = q("tbody", divs[1]);
                if (!tbody) {
                    return;
                }

                const tds = elementsFrom(":scope > tr", (tr) => qa(":scope > td", tr)[1], tbody);
                convertElements(tds, {
                    parse: parseTarkovGoon,
                    sourceTz: "America/New_York",
                    title: (orig, tz) => `Original: ${orig} (interpreted as ${tz})`
                });
            },
        },
        {
            match: (host) => host.includes("goon-tracker.com"),
            run: () => {
                const tbody = q(".table-container table tbody");
                if (tbody) {
                    const tds = elementsFrom("tr", (tr) => qa("td", tr)[1], tbody);

                    convertElements(tds, {
                        parse: parseSqlDateTime,
                        sourceTz: "America/Los_Angeles",
                        title: (orig, tz) => `Original: ${orig} (interpreted as ${tz})`
                    });
                }

                const lastSeenSpan = q(".last-seen p:nth-of-type(2) span");
                if (lastSeenSpan) {
                    convertElement(lastSeenSpan, {
                        parse: parseSqlDateTime,
                        sourceTz: "America/Los_Angeles",
                        title: (orig, tz) => `Original: ${orig} (interpreted as ${tz})`
                    });
                }
            },
        },
    ];

    function run() {
        try {
            const host = location.hostname;
            for (const site of SITES) {
                if (site.match(host)) {
                    site.run();
                    break;
                }
            }
        } catch(e) {
            console.debug("[Goons Tracker - Local Times] Error:", e);
        }
    }

    registerMenu();
    getDefaultPattern();
    run();

    new MutationObserver(run).observe(document.documentElement, {
        childList: true,
        subtree: true
    });
})();
