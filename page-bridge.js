// VeeVee Watch Party Bridge v5.0 - Universal VOD Engine (Netflix Cadmium + Disney+ / Max / Prime Audio & Subtitle Scraper)
(function() {
    let cachedDomAudioTracks = [];
    let cachedDomSubtitleTracks = [];

    function getNetflixPlayer() {
        try {
            if (window.netflix && window.netflix.appContext) {
                const videoPlayer = window.netflix.appContext.state.playerApp.getAPI().videoPlayer;
                const sessionIds = videoPlayer.getAllPlayerSessionIds();
                if (sessionIds && sessionIds.length > 0) {
                    return videoPlayer.getVideoPlayerBySessionId(sessionIds[0]);
                }
            }
        } catch (e) {}
        return null;
    }

    function queryAllDeep(selector, root = document) {
        let results = [];
        if (!root) return results;
        try {
            if (root.querySelectorAll) {
                results.push(...Array.from(root.querySelectorAll(selector)));
                const allNodes = root.querySelectorAll('*');
                for (let i = 0; i < allNodes.length; i++) {
                    if (allNodes[i].shadowRoot) {
                        results.push(...queryAllDeep(selector, allNodes[i].shadowRoot));
                    }
                }
            }
        } catch (e) {}
        return results;
    }

    function getActiveMovieVideo() {
        const allVideos = queryAllDeep('video');
        if (allVideos.length === 0) return null;
        if (allVideos.length === 1) return allVideos[0];

        let bestVideo = allVideos[0];
        let bestScore = -1;

        for (const v of allVideos) {
            let score = 0;
            const rect = v.getBoundingClientRect ? v.getBoundingClientRect() : { width: 0, height: 0 };
            if (rect.width > 200 && rect.height > 120) score += 50;
            if (v.readyState >= 1) score += 30;
            if (v.duration && !isNaN(v.duration) && v.duration > 60) score += 100;
            if (!v.paused) score += 40;
            if (score > bestScore) {
                bestScore = score;
                bestVideo = v;
            }
        }
        return bestVideo;
    }

    function scanUniversalPlatformTracks(openMenuIfNeeded = false) {
        if (location.hostname.includes('netflix.com')) return;

        if (openMenuIfNeeded) {
            const menuBtnSelectors = [
                'button[aria-label*="Audio"]',
                'button[aria-label*="Subtitles"]',
                'button[aria-label*="Subtitle"]',
                '[data-testid*="audio-subtitles"]',
                '[data-testid*="subtitle"]',
                '.atvwebplayersdk-subtitleaudio-button',
                'quick-settings'
            ];
            for (const sel of menuBtnSelectors) {
                const btns = queryAllDeep(sel);
                if (btns.length > 0 && typeof btns[0].click === 'function') {
                    try { btns[0].click(); } catch (e) {}
                    break;
                }
            }
        }

        const videoEl = getActiveMovieVideo();
        const foundAudio = [];
        const foundSubs = [];

        if (videoEl) {
            if (videoEl.audioTracks && videoEl.audioTracks.length > 0) {
                for (let i = 0; i < videoEl.audioTracks.length; i++) {
                    const at = videoEl.audioTracks[i];
                    foundAudio.push({ id: 'native-audio-' + i, label: at.label || at.language || ('Audio ' + (i + 1)) });
                }
            }
            if (videoEl.textTracks && videoEl.textTracks.length > 0) {
                for (let i = 0; i < videoEl.textTracks.length; i++) {
                    const tt = videoEl.textTracks[i];
                    foundSubs.push({ id: 'native-sub-' + i, label: tt.label || tt.language || ('Subtitle ' + (i + 1)) });
                }
            }
        }

        const candidateItems = queryAllDeep('[role="menuitemradio"], [role="option"], [data-testid*="track"], .atvwebplayersdk-audiooption-button, .atvwebplayersdk-subtitleoption-button, input[type="radio"] + label, li[role="menuitem"]');
        const seenLabels = new Set();

        candidateItems.forEach((el) => {
            const text = (el.textContent || el.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ');
            if (!text || text.length > 45 || seenLabels.has(text)) return;
            seenLabels.add(text);

            const parentContext = ((el.closest('[aria-label], [data-testid], section, div')?.getAttribute('aria-label') || '') + ' ' +
                                  (el.closest('[data-testid]')?.getAttribute('data-testid') || '') + ' ' +
                                  (el.className || '')).toLowerCase();

            if (parentContext.includes('audio') || parentContext.includes('language')) {
                foundAudio.push({ id: 'dom-track:' + text, label: text });
            } else if (parentContext.includes('sub') || parentContext.includes('caption') || parentContext.includes('cc')) {
                foundSubs.push({ id: 'dom-track:' + text, label: text });
            } else {
                foundAudio.push({ id: 'dom-track:' + text, label: text });
                foundSubs.push({ id: 'dom-track:' + text, label: text });
            }
        });

        if (foundAudio.length > 0) cachedDomAudioTracks = foundAudio;
        if (foundSubs.length > 0) cachedDomSubtitleTracks = foundSubs;
    }

    function applyUniversalDomTrack(trackValue) {
        const videoEl = getActiveMovieVideo();
        if (!trackValue) return;

        if (trackValue.startsWith('native-audio-') && videoEl && videoEl.audioTracks) {
            const idx = parseInt(trackValue.replace('native-audio-', ''), 10);
            for (let i = 0; i < videoEl.audioTracks.length; i++) {
                videoEl.audioTracks[i].enabled = (i === idx);
            }
            return;
        }

        if (trackValue.startsWith('native-sub-') && videoEl && videoEl.textTracks) {
            const idx = parseInt(trackValue.replace('native-sub-', ''), 10);
            for (let i = 0; i < videoEl.textTracks.length; i++) {
                videoEl.textTracks[i].mode = (i === idx) ? 'showing' : 'disabled';
            }
            return;
        }

        const targetLabel = trackValue.replace('dom-track:', '').trim().toLowerCase();
        const candidateItems = queryAllDeep('[role="menuitemradio"], [role="option"], [data-testid*="track"], button, label, li');
        for (const el of candidateItems) {
            const text = (el.textContent || el.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').toLowerCase();
            if (text === targetLabel) {
                try { el.click(); } catch (e) {}
                break;
            }
        }
    }

    window.addEventListener('message', (event) => {
        if (!event.data || event.data.type !== 'VEEVEE_MAIN_WORLD_EXEC') return;
        const cmd = event.data.cmd;
        if (!cmd) return;

        if (document.getElementById('stage-container') && document.getElementById('main-screen-video')) return;

        if (cmd.action === 'scanTracks') {
            scanUniversalPlatformTracks(true);
            return;
        }

        const isNetflix = location.hostname.includes('netflix.com');
        if (isNetflix) {
            const nfPlayer = getNetflixPlayer();
            if (!nfPlayer) return;

            try {
                if (cmd.action === 'play') {
                    nfPlayer.play();
                } else if (cmd.action === 'pause') {
                    nfPlayer.pause();
                } else if (cmd.action === 'rewind') {
                    const offsetMs = (Number(cmd.value) || 10) * 1000;
                    nfPlayer.seek(Math.max(0, nfPlayer.getCurrentTime() - offsetMs));
                } else if (cmd.action === 'forward') {
                    const offsetMs = (Number(cmd.value) || 10) * 1000;
                    nfPlayer.seek(Math.min(nfPlayer.getDuration(), nfPlayer.getCurrentTime() + offsetMs));
                } else if (cmd.action === 'seekTo' && typeof cmd.value === 'number') {
                    nfPlayer.seek(Math.round(cmd.value * 1000));
                } else if (cmd.action === 'setAudioTrack' && cmd.value) {
                    const tracks = nfPlayer.getAudioTrackList() || [];
                    const found = tracks.find(t => t.trackId === cmd.value || t.displayName === cmd.value);
                    if (found) nfPlayer.setAudioTrack(found);
                } else if (cmd.action === 'setSubtitleTrack' && cmd.value !== undefined) {
                    const tracks = nfPlayer.getTimedTextTrackList() || [];
                    const found = tracks.find(t => t.trackId === cmd.value || t.displayName === cmd.value);
                    if (found) nfPlayer.setTimedTextTrack(found);
                } else if (cmd.action === 'skipIntro') {
                    const skipBtn = document.querySelector('[data-uia="player-skip-intro"], [data-uia="player-skip-recap"]');
                    if (skipBtn) skipBtn.click();
                }
            } catch (e) {}
            return;
        }

        const videoEl = getActiveMovieVideo();
        if (!videoEl) return;

        try {
            if (cmd.action === 'play') {
                const playPromise = videoEl.play();
                if (playPromise && typeof playPromise.catch === 'function') {
                    playPromise.catch(() => {
                        const playBtns = queryAllDeep('[data-testid="player-ux-play-pause-button"], .atvwebplayersdk-playpause-button, .play-pause-icon, [aria-label="Play"], [aria-label="Odtwórz"]');
                        if (playBtns.length > 0) playBtns[0].click();
                    });
                }
            } else if (cmd.action === 'pause') {
                videoEl.pause();
            } else if (cmd.action === 'rewind') {
                const offset = Number(cmd.value) || 10;
                videoEl.currentTime = Math.max(0, videoEl.currentTime - offset);
            } else if (cmd.action === 'forward') {
                const offset = Number(cmd.value) || 10;
                videoEl.currentTime = Math.min(videoEl.duration || Infinity, videoEl.currentTime + offset);
            } else if (cmd.action === 'seekTo' && typeof cmd.value === 'number') {
                videoEl.currentTime = cmd.value;
            } else if (cmd.action === 'speed' && typeof cmd.value === 'number') {
                videoEl.playbackRate = cmd.value;
            } else if (cmd.action === 'setAudioTrack' && cmd.value) {
                applyUniversalDomTrack(cmd.value);
            } else if (cmd.action === 'setSubtitleTrack' && cmd.value !== undefined) {
                applyUniversalDomTrack(cmd.value);
            } else if (cmd.action === 'skipIntro') {
                const skipBtns = queryAllDeep('.skip__button, [data-testid="skip-button"], [data-testid="player-ux-skip-button"], .atvwebplayersdk-skipelement-button, button[class*="skip"]');
                if (skipBtns.length > 0) skipBtns[0].click();
            }
        } catch (e) {}
    });

    setInterval(() => {
        if (document.getElementById('stage-container')) return;

        const isNetflix = location.hostname.includes('netflix.com');
        if (isNetflix) {
            const nfPlayer = getNetflixPlayer();
            if (!nfPlayer) return;
            try {
                const curSec = (nfPlayer.getCurrentTime() || 0) / 1000;
                const durSec = (nfPlayer.getDuration() || 0) / 1000;
                if (durSec <= 0) return;

                const audioList = (nfPlayer.getAudioTrackList() || []).map(t => ({
                    id: t.trackId || t.displayName,
                    label: t.displayName || t.language || 'Audio'
                }));
                const subList = (nfPlayer.getTimedTextTrackList() || []).map(t => ({
                    id: t.trackId || t.displayName,
                    label: t.displayName || t.language || 'Off'
                }));
                const curAudio = nfPlayer.getAudioTrack ? (nfPlayer.getAudioTrack()?.trackId || '') : '';
                const curSub = nfPlayer.getTimedTextTrack ? (nfPlayer.getTimedTextTrack()?.trackId || '') : '';

                window.postMessage({
                    type: 'VEEVEE_MAIN_WORLD_TELEMETRY',
                    payload: {
                        currentTime: curSec,
                        duration: durSec,
                        paused: nfPlayer.isPaused ? nfPlayer.isPaused() : false,
                        audioTracks: audioList,
                        subtitleTracks: subList,
                        currentAudioId: curAudio,
                        currentSubtitleId: curSub,
                        hostname: location.hostname
                    }
                }, '*');
            } catch (e) {}
            return;
        }

        const videoEl = getActiveMovieVideo();
        if (!videoEl || !videoEl.duration || isNaN(videoEl.duration) || videoEl.duration < 5) return;

        scanUniversalPlatformTracks(false);

        window.postMessage({
            type: 'VEEVEE_MAIN_WORLD_TELEMETRY',
            payload: {
                currentTime: videoEl.currentTime || 0,
                duration: videoEl.duration || 0,
                paused: videoEl.paused,
                audioTracks: cachedDomAudioTracks,
                subtitleTracks: cachedDomSubtitleTracks,
                hostname: location.hostname
            }
        }, '*');
    }, 800);
})();
