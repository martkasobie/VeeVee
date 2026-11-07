// VeeVee Watch Party Bridge v5.1 - Isolated Content Script (relay between VeeVee tab and streaming tab)
(function () {
    'use strict';
    if (window.__veeveeContentLoaded) return;
    window.__veeveeContentLoaded = true;

    var VERSION = (function () {
        try { return chrome.runtime.getManifest().version; } catch (e) { return '5.1'; }
    })();

    function isVeeVeePage() {
        return !!(document.getElementById('stage-container') && document.getElementById('main-screen-video'));
    }

    function extensionAlive() {
        try { return !!(chrome.runtime && chrome.runtime.id); } catch (e) { return false; }
    }

    function safeSet(obj) {
        if (!extensionAlive()) return;
        try {
            var p = chrome.storage.local.set(obj);
            if (p && typeof p.catch === 'function') p.catch(function () {});
        } catch (e) {}
    }

    function announce() {
        if (isVeeVeePage()) window.postMessage({ type: 'VEEVEE_EXTENSION_READY', version: VERSION }, '*');
    }

    announce();

    window.addEventListener('message', function (event) {
        if (event.source !== window) return;
        var data = event.data;
        if (!data || typeof data !== 'object') return;

        // VeeVee tab -> extension
        if (data.type === 'VEEVEE_EXTENSION_PING' && isVeeVeePage()) {
            announce();
        } else if (data.type === 'VEEVEE_EXTENSION_COMMAND' && isVeeVeePage()) {
            safeSet({
                veeveeCommand: {
                    action: data.action,
                    value: data.value === undefined ? null : data.value,
                    target: data.target || null,
                    timestamp: Date.now() + Math.random()
                }
            });
        }
        // Streaming tab (page-bridge.js) -> extension
        else if (data.type === 'VEEVEE_MAIN_WORLD_TELEMETRY' && data.payload && !isVeeVeePage()) {
            safeSet({ veeveeTelemetry: Object.assign({}, data.payload, { timestamp: Date.now() }) });
        }
    });

    try {
        chrome.storage.onChanged.addListener(function (changes, areaName) {
            if (areaName !== 'local') return;

            // Command -> streaming tab (page-bridge.js decides if the command is for this tab)
            if (changes.veeveeCommand && changes.veeveeCommand.newValue && !isVeeVeePage()) {
                window.postMessage({ type: 'VEEVEE_MAIN_WORLD_EXEC', cmd: changes.veeveeCommand.newValue }, '*');
            }

            // Telemetry -> VeeVee tab
            if (changes.veeveeTelemetry && changes.veeveeTelemetry.newValue && isVeeVeePage()) {
                window.postMessage({ type: 'VEEVEE_EXTENSION_TELEMETRY', telemetry: changes.veeveeTelemetry.newValue }, '*');
            }
        });
    } catch (e) {}
})();
