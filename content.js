// 1. Informujemy stronę VeeVee, że wtyczka jest zainstalowana i aktywna
window.postMessage({ type: 'VEEVEE_EXTENSION_READY' }, '*');

window.addEventListener('message', (event) => {
    if (!event.data) return;

    if (event.data.type === 'VEEVEE_EXTENSION_PING') {
        window.postMessage({ type: 'VEEVEE_EXTENSION_READY' }, '*');
    }

    // 2. Odbieramy kliknięcie Start / Pause / -10s / +10s z karty VeeVee i zapisujemy do wspólnej pamięci Chrome
    if (event.data.type === 'VEEVEE_EXTENSION_COMMAND') {
        chrome.storage.local.set({
            veeveeCommand: {
                action: event.data.action,
                value: event.data.value,
                timestamp: Date.now()
            }
        });
    }
});

// 3. Na karcie z filmem (Netflix, Disney+, Max, Prime) nasłuchujemy komendy i sterujemy wideo
chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !changes.veeveeCommand) return;

    const cmd = changes.veeveeCommand.newValue;
    if (!cmd) return;

    const videoEl = document.querySelector('video');
    if (!videoEl) return;

    if (cmd.action === 'play') {
        videoEl.play().catch(() => {});
    } else if (cmd.action === 'pause') {
        videoEl.pause();
    } else if (cmd.action === 'rewind') {
        videoEl.currentTime = Math.max(0, videoEl.currentTime - (cmd.value || 10));
    } else if (cmd.action === 'forward') {
        videoEl.currentTime = Math.min(videoEl.duration || Infinity, videoEl.currentTime + (cmd.value || 10));
    } else if (cmd.action === 'seekTo' && typeof cmd.value === 'number') {
        videoEl.currentTime = cmd.value;
    }
});
