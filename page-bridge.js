// VeeVee Watch Party Bridge v4.0 - Universal VOD Engine (Netflix Cadmium + Disney+ / Max / Prime Shadow-DOM)
(function() {
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

    function findAllVideosDeep(root) {
        let videos = [];
        if (!root) return videos;
        try {
            const direct = root.querySelectorAll ? Array.from(root.querySelectorAll('video')) : [];
            videos.push(...direct);
            const allNodes = root.querySelectorAll ? root.querySelectorAll('*') : [];
            for (let i = 0; i < allNodes.length; i++) {
                const node = allNodes[i];
                if (node.shadowRoot) {
                    videos.push(...findAllVideosDeep(node.shadowRoot));
                }
            }
        } catch (e) {}
        return videos;
    }

    function getActiveMovieVideo() {
        const allVideos = findAllVideosDeep(document);
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

    window.addEventListener('message', (event) => {
        if (!event.data || event.data.type !== 'VEEVEE_MAIN_WORLD_EXEC') return;
        const cmd = event.data.cmd;
        if (!cmd) return;

        if (document.getElementById('stage-container') && document.getElementById('main-screen-video')) return;

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
                        const playBtns = document.querySelectorAll('[data-testid="player-ux-play-pause-button"], .atvwebplayersdk-playpause-button, .play-pause-icon, [aria-label="Play"], [aria-label="Odtwórz"]');
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
            } else if (cmd.action === 'setAudioTrack' && cmd.value && videoEl.audioTracks) {
                for (let i = 0; i < videoEl.audioTracks.length; i++) {
                    const at = videoEl.audioTracks[i];
                    at.enabled = (at.id === cmd.value || at.language === cmd.value || at.label === cmd.value || String(i) === String(cmd.value));
                }
            } else if (cmd.action === 'setSubtitleTrack' && videoEl.textTracks) {
                for (let i = 0; i < videoEl.textTracks.length; i++) {
                    const t = videoEl.textTracks[i];
                    t.mode = (t.label === cmd.value || t.language === cmd.value || String(i) === String(cmd.value)) ? 'showing' : 'disabled';
                }
            } else if (cmd.action === 'skipIntro') {
                const selectors = [
                    '.skip__button',
                    '[data-testid="skip-button"]',
                    '[data-testid="player-ux-skip-button"]',
                    '.atvwebplayersdk-skipelement-button',
                    'button[class*="skip"]'
                ];
                for (const s of selectors) {
                    const b = document.querySelector(s);
                    if (b) { b.click(); break; }
                }
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

        const audioList = [];
        if (videoEl.audioTracks) {
            for (let i = 0; i < videoEl.audioTracks.length; i++) {
                const at = videoEl.audioTracks[i];
                audioList.push({ id: String(i), label: at.label || at.language || 'Audio Track ' + (i + 1) });
            }
        }

        const subList = [];
        if (videoEl.textTracks) {
            for (let i = 0; i < videoEl.textTracks.length; i++) {
                const tr = videoEl.textTracks[i];
                subList.push({ id: String(i), label: tr.label || tr.language || 'Subtitle ' + (i + 1) });
            }
        }

        window.postMessage({
            type: 'VEEVEE_MAIN_WORLD_TELEMETRY',
            payload: {
                currentTime: videoEl.currentTime || 0,
                duration: videoEl.duration || 0,
                paused: videoEl.paused,
                audioTracks: audioList,
                subtitleTracks: subList,
                hostname: location.hostname
            }
        }, '*');
    }, 800);
})();
