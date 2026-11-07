// VeeVee Watch Party Bridge v5.1 - Universal VOD Engine (MAIN world)
// Netflix Cadmium API + Disney+ / Max / Prime Video (DOM + Shadow-DOM audio & subtitle menus)
(function () {
    'use strict';

    // Never run inside the VeeVee app itself
    if (document.getElementById('stage-container') && document.getElementById('main-screen-video')) return;
    if (window.__veeveeBridgeLoaded) return;
    window.__veeveeBridgeLoaded = true;

    var SOURCE_ID = Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
    var HOST = location.hostname;
    var IS_NETFLIX = /(^|\.)netflix\.com$/.test(HOST);
    var IS_PRIME = /(^|\.)primevideo\.com$/.test(HOST) || /(^|\.)amazon\./.test(HOST);

    var AUDIO_RE = /audio|d[zź]wi[eę]k|lektor|dubbing|soundtrack|tonspur/i;
    var SUBS_RE = /subtit|caption|napis|untertitel|\bcc\b/i;
    var MENU_HINT_RE = /audio|subtit|caption|napis|d[zź]wi[eę]k|lektor|language|j[eę]zyk|untertitel|\bcc\b/i;
    var OFF_RE = /^(off|none|brak|wy[lł][aą]czon[eay]?|wy[lł][aą]cz|aus|disabled)\b/i;
    var CLOSE_RE = /close|zamknij|dismiss|schlie/i;

    var OPTION_SEL = '[role="menuitemradio"],[role="radio"],[role="option"],[role="menuitem"],input[type="radio"],[aria-checked],' +
        '[data-testid*="track" i],[class*="audiooption" i],[class*="subtitleoption" i],[class*="track-item" i],[class*="trackitem" i]';
    var OPTION_ROLE_SEL = '[role="menuitemradio"],[role="radio"],[role="option"],input[type="radio"]';

    var cachedAudio = [];
    var cachedSubs = [];
    var cachedAudioCurrent = '';
    var cachedSubCurrent = '';
    var primeOffset = null;
    var primeDuration = 0;
    var menuBusy = false;
    var lastCmdStamp = 0;
    var tickCount = 0;

    // ---------- Capture Handle: lets VeeVee know exactly WHICH tab is being shared ----------
    try {
        if (window.top === window && navigator.mediaDevices && typeof navigator.mediaDevices.setCaptureHandleConfig === 'function') {
            navigator.mediaDevices.setCaptureHandleConfig({
                exposeOrigin: true,
                handle: 'veevee:' + SOURCE_ID,
                permittedOrigins: ['*']
            });
        }
    } catch (e) {}

    // ---------- Small helpers ----------
    function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

    async function waitFor(fn, timeout) {
        var end = Date.now() + timeout;
        while (Date.now() < end) {
            var r = fn();
            if (r) return r;
            await sleep(120);
        }
        return fn() || null;
    }

    function attr(el, name) {
        return el && el.getAttribute ? el.getAttribute(name) : null;
    }

    function classStr(el) {
        if (!el) return '';
        if (typeof el.className === 'string') return el.className;
        return attr(el, 'class') || '';
    }

    function cssEsc(v) {
        return (window.CSS && typeof CSS.escape === 'function') ? CSS.escape(v) : String(v).replace(/"/g, '\\"');
    }

    function parentOf(el) {
        if (!el) return null;
        if (el.parentElement) return el.parentElement;
        var root = el.getRootNode ? el.getRootNode() : null;
        return root && root.host ? root.host : null;
    }

    function queryAllDeep(selector, root) {
        root = root || document;
        var results = [];
        try {
            if (root.querySelectorAll) {
                var direct = root.querySelectorAll(selector);
                for (var i = 0; i < direct.length; i++) results.push(direct[i]);
                var all = root.querySelectorAll('*');
                for (var j = 0; j < all.length; j++) {
                    if (all[j].shadowRoot) results = results.concat(queryAllDeep(selector, all[j].shadowRoot));
                }
            }
        } catch (e) {}
        return results;
    }

    function isVisible(el) {
        try {
            if (!el || !el.getBoundingClientRect) return false;
            var r = el.getBoundingClientRect();
            if (r.width <= 0 || r.height <= 0) return false;
            var node = el;
            for (var d = 0; node && d < 6; d++) {
                if (node.nodeType === 1) {
                    var cs = getComputedStyle(node);
                    if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) < 0.05) return false;
                }
                node = parentOf(node);
            }
            return true;
        } catch (e) { return false; }
    }

    function makeMouseEvent(type, x, y) {
        var o = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, button: 0, buttons: 1, pointerId: 1, isPrimary: true, pointerType: 'mouse' };
        if (type.indexOf('pointer') === 0 && typeof PointerEvent === 'function') return new PointerEvent(type, o);
        return new MouseEvent(type, o);
    }

    function centerOf(el) {
        var r = el.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }

    // Plain click (works for most React/Lit menus and radio inputs)
    function clickEl(el) {
        try {
            if (typeof el.click === 'function') el.click();
            else { var c = centerOf(el); el.dispatchEvent(makeMouseEvent('click', c.x, c.y)); }
        } catch (e) {}
    }

    // Pointer/mouse down+up (for players that react to pointer events instead of click)
    function pressEl(el) {
        try {
            var c = centerOf(el);
            ['pointerdown', 'mousedown', 'pointerup', 'mouseup'].forEach(function (t) { el.dispatchEvent(makeMouseEvent(t, c.x, c.y)); });
        } catch (e) {}
    }

    // Wakes up auto-hidden player controls so menu buttons / progress bars are rendered
    function wakePlayerUi() {
        try {
            var v = getActiveMovieVideo();
            var target = v || document.body;
            var c = centerOf(target);
            ['pointermove', 'mousemove', 'mouseover'].forEach(function (t) {
                try { target.dispatchEvent(makeMouseEvent(t, c.x, c.y)); } catch (e) {}
                try { document.dispatchEvent(makeMouseEvent(t, c.x, c.y)); } catch (e) {}
            });
        } catch (e) {}
    }

    // ---------- Netflix (official Cadmium player API, DRM-safe) ----------
    function getNetflixPlayer() {
        try {
            if (window.netflix && window.netflix.appContext) {
                var vp = window.netflix.appContext.state.playerApp.getAPI().videoPlayer;
                var ids = vp.getAllPlayerSessionIds() || [];
                if (!ids.length) return null;
                var watchId = null;
                for (var i = 0; i < ids.length; i++) {
                    if (String(ids[i]).indexOf('watch') === 0) { watchId = ids[i]; break; }
                }
                return vp.getVideoPlayerBySessionId(watchId || ids[ids.length - 1]);
            }
        } catch (e) {}
        return null;
    }

    function netflixTrackId(t) { return String(t.trackId || t.id || t.displayName || ''); }

    function netflixLists(p) {
        var audio = (p.getAudioTrackList() || []).map(function (t) {
            return { id: netflixTrackId(t), label: t.displayName || t.language || 'Audio' };
        });
        var subs = (p.getTimedTextTrackList() || []).filter(function (t) {
            return !(t.isForcedNarrative && !t.isNoneTrack);
        }).map(function (t) {
            return { id: netflixTrackId(t), label: t.isNoneTrack ? 'Off' : (t.displayName || t.language || 'Subtitles') };
        });
        var ca = p.getAudioTrack ? p.getAudioTrack() : null;
        var cs = p.getTimedTextTrack ? p.getTimedTextTrack() : null;
        return { audio: audio, subs: subs, curAudio: ca ? netflixTrackId(ca) : '', curSub: cs ? netflixTrackId(cs) : '' };
    }

    function netflixFindTrack(list, value, isSub) {
        if (isSub && (value === '__off__' || value === '' || value === null)) {
            return list.find(function (t) { return t.isNoneTrack || OFF_RE.test(t.displayName || ''); }) || null;
        }
        return list.find(function (t) { return netflixTrackId(t) === String(value) || t.displayName === value; }) || null;
    }

    function runNetflixCommand(cmd) {
        var p = getNetflixPlayer();
        if (!p) return;
        try {
            var dur = p.getDuration() || 0;
            if (cmd.action === 'play') p.play();
            else if (cmd.action === 'pause') p.pause();
            else if (cmd.action === 'rewind' || cmd.action === 'forward') {
                var off = (Number(cmd.value) || 10) * 1000 * (cmd.action === 'rewind' ? -1 : 1);
                p.seek(Math.max(0, Math.min(dur || Infinity, p.getCurrentTime() + off)));
            } else if (cmd.action === 'seekTo' && typeof cmd.value === 'number') {
                p.seek(Math.max(0, Math.min(dur || Infinity, Math.round(cmd.value * 1000))));
            } else if (cmd.action === 'setAudioTrack' && cmd.value) {
                var a = netflixFindTrack(p.getAudioTrackList() || [], cmd.value, false);
                if (a) p.setAudioTrack(a);
            } else if (cmd.action === 'setSubtitleTrack') {
                var s = netflixFindTrack(p.getTimedTextTrackList() || [], cmd.value, true);
                if (s) p.setTimedTextTrack(s);
            } else if (cmd.action === 'skipIntro') {
                var skip = document.querySelector('[data-uia="player-skip-intro"], [data-uia="player-skip-recap"], [data-uia="next-episode-seamless-button"]');
                if (skip) skip.click();
            }
        } catch (e) {}
        setTimeout(postTelemetry, 450);
    }

    // ---------- Generic HTML5 video (Disney+, Max, Prime Video, others) ----------
    function getActiveMovieVideo() {
        var vids = Array.prototype.slice.call(document.querySelectorAll('video'));
        if (!vids.length) vids = queryAllDeep('video');
        if (!vids.length) return null;
        if (vids.length === 1) return vids[0];
        var best = vids[0];
        var bestScore = -1;
        vids.forEach(function (v) {
            var score = 0;
            var r = v.getBoundingClientRect ? v.getBoundingClientRect() : { width: 0, height: 0 };
            if (r.width > 200 && r.height > 120) score += 50;
            if (v.readyState >= 1) score += 30;
            if (v.duration && isFinite(v.duration) && v.duration > 60) score += 100;
            if (!v.paused) score += 40;
            if (score > bestScore) { bestScore = score; best = v; }
        });
        return best;
    }

    function parseClock(str) {
        var parts = String(str).trim().split(':').map(Number);
        if (parts.some(isNaN)) return NaN;
        var s = 0;
        for (var i = 0; i < parts.length; i++) s = s * 60 + parts[i];
        return s;
    }

    // Prime Video: the <video> timeline is offset from the real movie time -> calibrate from the on-screen clock
    function calibratePrime(v) {
        if (!IS_PRIME) return;
        try {
            var el = queryAllDeep('.atvwebplayersdk-timeindicator-text, [class*="timeindicator" i]')[0];
            if (!el) return;
            var m = (el.textContent || '').match(/(\d{1,2}(?::\d{1,2}){1,2})\s*\/\s*(\d{1,2}(?::\d{1,2}){1,2})/);
            if (!m) return;
            var uiCur = parseClock(m[1]);
            var uiDur = parseClock(m[2]);
            if (!isFinite(uiCur) || !isFinite(uiDur) || uiDur <= 0) return;
            var off = (v.currentTime || 0) - uiCur;
            if (primeOffset === null || Math.abs(off - primeOffset) > 2) primeOffset = off;
            primeDuration = uiDur;
        } catch (e) {}
    }

    function getEffectiveTimes(v) {
        calibratePrime(v);
        var cur = v.currentTime || 0;
        var dur = v.duration;
        if (IS_PRIME && primeOffset !== null) cur = Math.max(0, cur - primeOffset);
        if (IS_PRIME && primeDuration > 0) dur = primeDuration;
        if (!isFinite(dur) || isNaN(dur)) dur = 0;
        return { cur: cur, dur: dur };
    }

    function toVideoTime(contentSec) {
        return (IS_PRIME && primeOffset !== null) ? contentSec + primeOffset : contentSec;
    }

    function clickProgressAt(frac) {
        wakePlayerUi();
        var cands = queryAllDeep('[role="slider"],[class*="progress" i],[class*="scrubber" i],[class*="seekbar" i],[class*="timeline" i],progress-bar');
        var best = null;
        var bestW = 0;
        cands.forEach(function (el) {
            var r = el.getBoundingClientRect();
            if (r.width < 150 || r.height <= 0 || r.height > 80) return;
            var d = classStr(el) + ' ' + (attr(el, 'aria-label') || '') + ' ' + (attr(el, 'data-testid') || '');
            if (/volume|g[lł]o[sś]no/i.test(d)) return;
            if (r.width > bestW) { bestW = r.width; best = el; }
        });
        if (!best) return;
        var r = best.getBoundingClientRect();
        var x = r.left + r.width * Math.min(1, Math.max(0, frac));
        var y = r.top + r.height / 2;
        ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(function (t) {
            try { best.dispatchEvent(makeMouseEvent(t, x, y)); } catch (e) {}
        });
    }

    function seekGeneric(v, targetSec) {
        var t = getEffectiveTimes(v);
        var target = Math.max(0, t.dur > 0 ? Math.min(targetSec, t.dur - 0.5) : targetSec);
        var mapped = toVideoTime(target);
        try { v.currentTime = mapped; } catch (e) {}
        // Fallback: some players revert direct currentTime changes -> click their own progress bar
        setTimeout(function () {
            try {
                if (Math.abs((v.currentTime || 0) - mapped) > 4 && t.dur > 0) clickProgressAt(target / t.dur);
            } catch (e) {}
            postTelemetry();
        }, 1000);
    }

    // ---------- Audio / subtitle menus (DOM + Shadow DOM) ----------
    function descriptor(el) {
        return [el.tagName || '', el.id || '', attr(el, 'aria-label') || '', attr(el, 'data-testid') || '',
            attr(el, 'name') || '', classStr(el)].join(' ');
    }

    function classify(text) {
        var a = AUDIO_RE.test(text);
        var s = SUBS_RE.test(text);
        if (a && s) return 'both';
        if (a) return 'audio';
        if (s) return 'subs';
        return '';
    }

    function headingText(container) {
        var out = '';
        try {
            var kids = container.children || [];
            for (var i = 0; i < kids.length; i++) {
                var ch = kids[i];
                if (ch.matches && ch.matches('h1,h2,h3,h4,h5,h6,legend,[role="heading"],[class*="title" i],[class*="header" i],[class*="heading" i]')) {
                    var t = (ch.textContent || '').replace(/\s+/g, ' ').trim();
                    if (t && t.length <= 40) out += ' ' + t;
                }
            }
        } catch (e) {}
        return out;
    }

    function classifyOption(el) {
        var node = el;
        for (var depth = 0; node && depth < 10; depth++) {
            var c = classify(descriptor(node));
            if (!c && depth > 0) c = classify(headingText(node));
            if (c === 'audio' || c === 'subs') return c;
            if (c === 'both') return '';
            node = parentOf(node);
        }
        return '';
    }

    function optionLabelEl(el) {
        if (el.tagName === 'INPUT') {
            var root = el.getRootNode ? el.getRootNode() : document;
            if (el.id && root.querySelector) {
                var lab = root.querySelector('label[for="' + cssEsc(el.id) + '"]');
                if (lab) return lab;
            }
            return el.closest('label') || el.parentElement || el;
        }
        return el;
    }

    function optionLabel(el) {
        var t = '';
        if (el.tagName === 'INPUT') {
            var labEl = optionLabelEl(el);
            t = labEl && labEl !== el ? (labEl.textContent || '') : '';
            if (!t.trim()) t = attr(el, 'aria-label') || el.value || '';
        } else {
            t = el.textContent || '';
            if (!t.trim()) t = attr(el, 'aria-label') || attr(el, 'title') || '';
        }
        return t.replace(/\s+/g, ' ').replace(/^[^\p{L}\p{N}(\[]+|[^\p{L}\p{N})\]]+$/gu, '').trim();
    }

    function isSelectedOption(el) {
        try {
            if (el.tagName === 'INPUT') return !!el.checked;
            if (attr(el, 'aria-checked') === 'true' || attr(el, 'aria-selected') === 'true' || attr(el, 'aria-current') === 'true') return true;
            var inp = el.querySelector ? el.querySelector('input[type="radio"]') : null;
            if (inp && inp.checked) return true;
            var cls = classStr(el);
            return /(^|[\s_-])(selected|checked|is-active|active)($|[\s_-])/i.test(cls) && !/inactive|unselected|unchecked/i.test(cls);
        } catch (e) { return false; }
    }

    function collectTrackOptions(includeUnknown) {
        var nodes = queryAllDeep(OPTION_SEL);
        var seen = {};
        var out = [];
        nodes.forEach(function (el) {
            var role = attr(el, 'role');
            if (role === 'switch' || role === 'checkbox') return;
            if (el.tagName === 'INPUT' && el.type !== 'radio') return;
            if (!isVisible(optionLabelEl(el))) return;
            var label = optionLabel(el);
            if (!label || label.length > 60) return;
            var group = classifyOption(el);
            if (!group && !includeUnknown) return;
            var key = (group || '?') + '|' + label.toLowerCase();
            if (seen[key]) return;
            seen[key] = true;
            out.push({ el: el, label: label, group: group, selected: isSelectedOption(el) });
        });
        return out;
    }

    function buildLists(opts) {
        var known = opts.filter(function (o) { return o.group; });
        var use = known.length ? known : opts;
        var res = { audio: [], subs: [], curAudio: '', curSub: '' };
        use.forEach(function (o) {
            var groups = o.group ? [o.group] : ['audio', 'subs'];
            groups.forEach(function (g) {
                var id = 'dom:' + g + ':' + o.label;
                if (g === 'audio') { res.audio.push({ id: id, label: o.label }); if (o.selected) res.curAudio = id; }
                else { res.subs.push({ id: id, label: o.label }); if (o.selected) res.curSub = id; }
            });
        });
        return res;
    }

    function storeLists(lists) {
        if (lists.audio.length) { cachedAudio = lists.audio; if (lists.curAudio) cachedAudioCurrent = lists.curAudio; }
        if (lists.subs.length) { cachedSubs = lists.subs; if (lists.curSub) cachedSubCurrent = lists.curSub; }
    }

    function nativeLists(v) {
        var res = { audio: [], subs: [], curAudio: '', curSub: '' };
        if (!v) return res;
        try {
            if (v.audioTracks && v.audioTracks.length > 1) {
                for (var i = 0; i < v.audioTracks.length; i++) {
                    var at = v.audioTracks[i];
                    var aid = 'native-audio-' + i;
                    res.audio.push({ id: aid, label: at.label || at.language || ('Audio ' + (i + 1)) });
                    if (at.enabled) res.curAudio = aid;
                }
            }
            if (v.textTracks && v.textTracks.length) {
                for (var j = 0; j < v.textTracks.length; j++) {
                    var tt = v.textTracks[j];
                    if (tt.kind !== 'subtitles' && tt.kind !== 'captions') continue;
                    var sid = 'native-sub-' + j;
                    res.subs.push({ id: sid, label: tt.label || tt.language || ('Subtitles ' + (j + 1)) });
                    if (tt.mode === 'showing') res.curSub = sid;
                }
                if (res.subs.length && !res.curSub) res.curSub = '__off__';
            }
        } catch (e) {}
        return res;
    }

    function findTrackMenuButton() {
        var v = getActiveMovieVideo();
        var vr = v ? v.getBoundingClientRect() : null;
        var cands = queryAllDeep('button,[role="button"],[aria-haspopup],[data-testid],[class*="subtitle" i],[class*="audio" i],[class*="caption" i]');
        var best = null;
        var bestScore = -1;
        cands.forEach(function (el) {
            if (el.matches && el.matches(OPTION_ROLE_SEL)) return;
            var d = descriptor(el) + ' ' + (attr(el, 'title') || '');
            if (!MENU_HINT_RE.test(d)) return;
            var score = 1;
            if (AUDIO_RE.test(d) && SUBS_RE.test(d)) score += 4;
            else if (SUBS_RE.test(d)) score += 2;
            else if (AUDIO_RE.test(d)) score += 1;
            if (el.tagName === 'BUTTON' || attr(el, 'role') === 'button') score += 3;
            if (attr(el, 'aria-haspopup') !== null || attr(el, 'aria-expanded') !== null) score += 1;
            if (vr) {
                var r = el.getBoundingClientRect();
                if (r.width > 0 && r.height > 0 && r.left < vr.right && r.right > vr.left && r.top < vr.bottom && r.bottom > vr.top) score += 2;
            }
            if (score > bestScore) { bestScore = score; best = el; }
        });
        return best;
    }

    function menuStillOpen() {
        return collectTrackOptions(false).length > 0;
    }

    async function closeTrackMenu(btn, sampleOption) {
        await sleep(250);
        if (!menuStillOpen()) return;
        if (btn && attr(btn, 'aria-expanded') !== 'false') {
            clickEl(btn);
            await sleep(300);
            if (!menuStillOpen()) return;
        }
        // Look for a close (X) button INSIDE the menu panel only
        var panel = sampleOption ? parentOf(sampleOption) : null;
        for (var up = 0; panel && up < 6; up++) {
            var closeBtns = queryAllDeep('button,[role="button"]', panel).filter(function (b) {
                return CLOSE_RE.test(descriptor(b) + ' ' + (attr(b, 'title') || '')) && isVisible(b);
            });
            if (closeBtns.length) { clickEl(closeBtns[0]); return; }
            panel = parentOf(panel);
        }
    }

    async function withTrackMenu(fn) {
        if (menuBusy) return null;
        menuBusy = true;
        var result = null;
        var opened = false;
        var btn = null;
        try {
            wakePlayerUi();
            await sleep(150);
            var opts = collectTrackOptions(false);
            if (!opts.length) {
                btn = findTrackMenuButton();
                if (btn) {
                    var baseUnknown = collectTrackOptions(true).length;
                    var probe = function () {
                        var known = collectTrackOptions(false);
                        if (known.length) return known;
                        var all = collectTrackOptions(true);
                        return all.length > baseUnknown ? all : null;
                    };
                    clickEl(btn);
                    opened = true;
                    var got = await waitFor(probe, 1000);
                    if (!got) { pressEl(btn); got = await waitFor(probe, 1200); }
                    opts = got || [];
                }
            }
            result = await fn(opts);
            if (opened) await closeTrackMenu(btn, opts.length ? opts[0].el : null);
        } catch (e) {}
        menuBusy = false;
        return result;
    }

    async function scanTracksActive() {
        if (IS_NETFLIX) { postTelemetry(); return; }
        await withTrackMenu(function (opts) {
            if (opts.length) storeLists(buildLists(opts));
            return true;
        });
        if (!cachedAudio.length && !cachedSubs.length) storeLists(nativeLists(getActiveMovieVideo()));
        postTelemetry();
    }

    function scanTracksPassive() {
        if (IS_NETFLIX || menuBusy) return;
        var opts = collectTrackOptions(false);
        if (opts.length) storeLists(buildLists(opts));
        else if (!cachedAudio.length && !cachedSubs.length) storeLists(nativeLists(getActiveMovieVideo()));
    }

    async function applyTrack(kind, value) {
        var v = getActiveMovieVideo();
        var isSub = kind === 'setSubtitleTrack';
        var val = value === null || value === undefined ? '' : String(value);

        // Native HTML5 tracks
        if (val.indexOf('native-audio-') === 0 && v && v.audioTracks) {
            var ai = parseInt(val.replace('native-audio-', ''), 10);
            for (var i = 0; i < v.audioTracks.length; i++) v.audioTracks[i].enabled = (i === ai);
            cachedAudioCurrent = val;
            postTelemetry();
            return;
        }
        if (isSub && v && v.textTracks && (val.indexOf('native-sub-') === 0 || (val === '__off__' && cachedSubs.length && cachedSubs[0].id.indexOf('native-sub-') === 0))) {
            var si = val === '__off__' ? -1 : parseInt(val.replace('native-sub-', ''), 10);
            for (var j = 0; j < v.textTracks.length; j++) v.textTracks[j].mode = (j === si) ? 'showing' : 'disabled';
            cachedSubCurrent = val;
            postTelemetry();
            return;
        }

        // Platform menus
        var wantGroup = isSub ? 'subs' : 'audio';
        var wantOff = isSub && (val === '' || val === '__off__');
        var wantLabel = '';
        if (val.indexOf('dom:') === 0) {
            var rest = val.slice(4);
            var idx = rest.indexOf(':');
            wantLabel = idx >= 0 ? rest.slice(idx + 1) : rest;
        } else {
            wantLabel = val;
        }
        var wl = wantLabel.toLowerCase();

        await withTrackMenu(async function (opts) {
            var pool = opts.filter(function (o) { return o.group === wantGroup; });
            if (!pool.length) pool = opts.filter(function (o) { return !o.group; });
            var target = null;
            if (wantOff) target = pool.find(function (o) { return OFF_RE.test(o.label); }) || null;
            else {
                target = pool.find(function (o) { return o.label.toLowerCase() === wl; }) ||
                    pool.find(function (o) { return o.label.toLowerCase().indexOf(wl) === 0; }) || null;
            }
            if (!target) return false;
            clickEl(target.el);
            await sleep(350);
            if (target.el.isConnected && !isSelectedOption(target.el)) {
                pressEl(target.el);
                await sleep(300);
            }
            if (isSub) cachedSubCurrent = wantOff ? (cachedSubs.find(function (t) { return OFF_RE.test(t.label); }) || { id: '__off__' }).id : 'dom:subs:' + target.label;
            else cachedAudioCurrent = 'dom:audio:' + target.label;
            return true;
        });
        setTimeout(function () { scanTracksPassive(); postTelemetry(); }, 500);
    }

    function runGenericCommand(cmd) {
        var v = getActiveMovieVideo();
        if (cmd.action === 'setAudioTrack' || cmd.action === 'setSubtitleTrack') { applyTrack(cmd.action, cmd.value); return; }
        if (cmd.action === 'skipIntro') {
            var skips = queryAllDeep('.skip__button, [data-testid="skip-button"], [data-testid="player-ux-skip-button"], .atvwebplayersdk-skipelement-button, button[class*="skip" i], [data-testid*="skip" i]');
            var vis = skips.filter(isVisible);
            if (vis.length) clickEl(vis[0]);
            else if (skips.length) clickEl(skips[0]);
            return;
        }
        if (!v) return;
        try {
            if (cmd.action === 'play') {
                var pp = v.play();
                if (pp && typeof pp.catch === 'function') {
                    pp.catch(function () {
                        var btns = queryAllDeep('[data-testid="player-ux-play-pause-button"], .atvwebplayersdk-playpause-button, .play-pause-icon, [aria-label="Play"], [aria-label="Odtwórz"]');
                        if (btns.length) clickEl(btns[0]);
                    });
                }
            } else if (cmd.action === 'pause') {
                v.pause();
            } else if (cmd.action === 'rewind' || cmd.action === 'forward') {
                var off = (Number(cmd.value) || 10) * (cmd.action === 'rewind' ? -1 : 1);
                seekGeneric(v, getEffectiveTimes(v).cur + off);
            } else if (cmd.action === 'seekTo' && typeof cmd.value === 'number') {
                seekGeneric(v, cmd.value);
            } else if (cmd.action === 'speed' && typeof cmd.value === 'number') {
                v.playbackRate = cmd.value;
            }
        } catch (e) {}
        setTimeout(postTelemetry, 300);
    }

    // ---------- Telemetry -> VeeVee ----------
    function postTelemetry() {
        try {
            var payload = null;
            if (IS_NETFLIX) {
                var p = getNetflixPlayer();
                if (!p) return;
                var dur = (p.getDuration() || 0) / 1000;
                if (dur <= 0) return;
                var nl = netflixLists(p);
                payload = {
                    currentTime: (p.getCurrentTime() || 0) / 1000,
                    duration: dur,
                    paused: p.isPaused ? !!p.isPaused() : false,
                    audioTracks: nl.audio,
                    subtitleTracks: nl.subs,
                    currentAudioId: nl.curAudio,
                    currentSubtitleId: nl.curSub
                };
            } else {
                var v = getActiveMovieVideo();
                if (!v || v.readyState < 1) return;
                var t = getEffectiveTimes(v);
                if (t.dur > 0 && t.dur < 5) return;
                payload = {
                    currentTime: t.cur,
                    duration: t.dur,
                    paused: !!v.paused,
                    audioTracks: cachedAudio,
                    subtitleTracks: cachedSubs,
                    currentAudioId: cachedAudioCurrent,
                    currentSubtitleId: cachedSubCurrent
                };
            }
            payload.sourceId = SOURCE_ID;
            payload.hostname = HOST;
            payload.title = String(document.title || '').slice(0, 80);
            payload.bridgeVersion = '5.1';
            window.postMessage({ type: 'VEEVEE_MAIN_WORLD_TELEMETRY', payload: payload }, '*');
        } catch (e) {}
    }

    // ---------- Commands from VeeVee ----------
    window.addEventListener('message', function (event) {
        if (event.source !== window) return;
        var data = event.data;
        if (!data || data.type !== 'VEEVEE_MAIN_WORLD_EXEC' || !data.cmd) return;
        var cmd = data.cmd;
        if (cmd.target && cmd.target !== SOURCE_ID) return;              // command meant for another tab
        if (cmd.timestamp && Date.now() - cmd.timestamp > 8000) return;  // stale
        if (cmd.timestamp && cmd.timestamp === lastCmdStamp) return;      // duplicate
        lastCmdStamp = cmd.timestamp || 0;

        if (cmd.action === 'scanTracks') { scanTracksActive(); return; }
        if (IS_NETFLIX) runNetflixCommand(cmd);
        else runGenericCommand(cmd);
    });

    setInterval(function () {
        tickCount++;
        if (!IS_NETFLIX && tickCount % 3 === 0) scanTracksPassive();
        postTelemetry();
    }, 800);
})();
