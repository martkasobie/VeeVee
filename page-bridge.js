// VeeVee Watch Party Bridge v3.0 - MAIN World VOD API Bridge (M7375 DRM-Safe)
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

    window.addEventListener('message', (event) => {
        if (!event.data || event.data.type !== 'VEEVEE_MAIN_WORLD_EXEC') return;
        const cmd = event.data.cmd;
        if (!cmd) return;

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

        const videoEl = document.querySelector('video');
        if (!videoEl) return;

        if (cmd.action === 'play') videoEl.play().catch(() => {});
        else if (cmd.action === 'pause') videoEl.pause();
        else if (cmd.action === 'rewind') videoEl.currentTime = Math.max(0, videoEl.currentTime - (Number(cmd.value) || 10));
        else if (cmd.action === 'forward') videoEl.currentTime = Math.min(videoEl.duration || Infinity, videoEl.currentTime + (Number(cmd.value) || 10));
        else if (cmd.action === 'seekTo' && typeof cmd.value === 'number') videoEl.currentTime = cmd.value;
        else if (cmd.action === 'speed' && typeof cmd.value === 'number') videoEl.playbackRate = cmd.value;
        else if (cmd.action === 'setSubtitleTrack' && videoEl.textTracks) {
            for (let i = 0; i < videoEl.textTracks.length; i++) {
                const t = videoEl.textTracks[i];
                t.mode = (t.label === cmd.value || t.language === cmd.value || String(i) === String(cmd.value)) ? 'showing' : 'disabled';
            }
        } else if (cmd.action === 'skipIntro') {
            const selectors = ['.skip__button', '[data-testid="skip-button"]', '.atvwebplayersdk-skipelement-button'];
            for (const s of selectors) {
                const b = document.querySelector(s);
                if (b) { b.click(); break; }
            }
        }
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

        const videoEl = document.querySelector('video');
        if (!videoEl || !videoEl.duration || isNaN(videoEl.duration)) return;

        const subList = [];
        if (videoEl.textTracks) {
            for (let i = 0; i < videoEl.textTracks.length; i++) {
                const tr = videoEl.textTracks[i];
                subList.push({ id: String(i), label: tr.label || tr.language || 'Track ' + (i + 1) });
            }
        }

        window.postMessage({
            type: 'VEEVEE_MAIN_WORLD_TELEMETRY',
            payload: {
                currentTime: videoEl.currentTime || 0,
                duration: videoEl.duration || 0,
                paused: videoEl.paused,
                audioTracks: [],
                subtitleTracks: subList,
                hostname: location.hostname
            }
        }, '*');
    }, 900);
})();
