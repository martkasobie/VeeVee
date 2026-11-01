// Nasłuchiwacz komunikatów z VeeVee
window.addEventListener('message', (event) => {
    if (!event.data || event.data.type !== 'VEEVEE_EXTENSION_COMMAND') return;

    const action = event.data.action;
    console.log('[VeeVee Bridge] Otrzymano komendę:', action);

    // Szukamy uniwersalnego znacznika wideo na stronach VOD (Netflix, Disney+, YouTube, Max)
    const videoEl = document.querySelector('video');
    if (!videoEl) {
        console.warn('[VeeVee Bridge] Nie znaleziono elementu video na stronie.');
        return;
    }

    if (action === 'play') {
        videoEl.play().catch(() => {});
    } else if (action === 'pause') {
        videoEl.pause();
    } else if (action === 'rewind') {
        videoEl.currentTime = Math.max(0, videoEl.currentTime - 10);
    } else if (action === 'forward') {
        videoEl.currentTime = Math.min(videoEl.duration, videoEl.currentTime + 10);
    }
});
