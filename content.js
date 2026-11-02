// VeeVee Watch Party Bridge v5.0 - Isolated Content Script Bridge
(function() {
    window.postMessage({ type: 'VEEVEE_EXTENSION_READY', version: '5.0' }, '*');

    window.addEventListener('message', (event) => {
        if (!event.data || typeof event.data !== 'object') return;

        if (event.data.type === 'VEEVEE_EXTENSION_PING') {
            window.postMessage({ type: 'VEEVEE_EXTENSION_READY', version: '5.0' }, '*');
        }

        if (event.data.type === 'VEEVEE_EXTENSION_COMMAND') {
            try {
                chrome.storage.local.set({
                    veeveeCommand: {
                        action: event.data.action,
                        value: event.data.value,
                        timestamp: Date.now() + Math.random()
                    }
                });
            } catch (err) {}
        }

        if (event.data.type === 'VEEVEE_MAIN_WORLD_TELEMETRY' && event.data.payload) {
            try {
                chrome.storage.local.set({
                    veeveeTelemetry: Object.assign({}, event.data.payload, { timestamp: Date.now() })
                });
            } catch (e) {}
        }
    });

    try {
        chrome.storage.onChanged.addListener((changes, areaName) => {
            if (areaName !== 'local') return;

            if (changes.veeveeCommand && changes.veeveeCommand.newValue) {
                if (document.getElementById('main-screen-video') && document.getElementById('stage-container')) {
                    return;
                }
                window.postMessage({
                    type: 'VEEVEE_MAIN_WORLD_EXEC',
                    cmd: changes.veeveeCommand.newValue
                }, '*');
            }

            if (changes.veeveeTelemetry && changes.veeveeTelemetry.newValue) {
                if (document.getElementById('stage-container')) {
                    window.postMessage({
                        type: 'VEEVEE_EXTENSION_TELEMETRY',
                        telemetry: changes.veeveeTelemetry.newValue
                    }, '*');
                }
            }
        });
    } catch (e) {}
})();
