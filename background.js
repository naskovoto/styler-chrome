// this is a clone and migration to v3 of https://github.com/lukestateson/styler-chrome

var debug = false;

function pandaTestsScript(script, host) {
    return "if($('body').hasClass('pandastylerloaded') === false && window.location.hostname == '"+host+"') { $('body').addClass('pandastylerloaded'); " + script + " }";
}

function cl(data) {
    console.log(data);
}

function onError(error) {
    console.log(`Error: ${error}`);
}

function AP(data) {
    $('body').append(data);
}

function get_hostname(url) {
    var hostname;
    //find & remove protocol (http, ftp, etc.) and get hostname

    if (url.indexOf("://") > -1) {
        hostname = url.split('/')[2];
    }
    else {
        hostname = url.split('/')[0];
    }

    //find & remove port number
    hostname = hostname.split(':')[0];
    //find & remove "?"
    hostname = hostname.split('?')[0];

    return hostname;
}

async function updateCspRules() {
    const rules = [];
    let values;
    if (debug) {
        values = await chrome.storage.local.get(null);
    } else {
        values = await chrome.storage.sync.get(null);
    }
    let id = 1;
    for (const host in values) {
        const settings = values[host];
        if (settings && settings.js && settings.js.trim()) {  // Only for hosts with JS
            const urlFilter = `||${host}^`;  // Matches http(s)://host/*
            rules.push({
                id: id++,
                priority: 1,
                action: {
                    type: 'modifyHeaders',
                    responseHeaders: [
                        { header: 'content-security-policy', operation: 'remove' },
                        { header: 'content-security-policy-report-only', operation: 'remove' }
                    ]
                },
                condition: {
                    urlFilter: urlFilter,
                    resourceTypes: [
                        chrome.declarativeNetRequest.ResourceType.MAIN_FRAME,
                        chrome.declarativeNetRequest.ResourceType.SUB_FRAME
                    ]
                }
            });
        }
    }
    // Clear existing dynamic rules and add new ones
    const currentRules = await chrome.declarativeNetRequest.getDynamicRules();
    const removeIds = currentRules.map(r => r.id);
    await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: removeIds,
        addRules: rules
    }).catch(onError);
}

async function save_settings(hostname, settings) {
    var values = {};
    values[hostname] = settings;
    const promise = debug ? chrome.storage.local.set(values) : chrome.storage.sync.set(values);
    await promise;
    await updateCspRules();  // Rebuild rules after save
}

chrome.tabs.onUpdated.addListener(async function(tabId, changeInfo, tab) {
    if (changeInfo.status !== 'loading') return;

    var url = tab.url;

    if (! /^https?.*$/.test(url)) {
        return;
    }

    var data = {};
    data.host = get_hostname(url);

    let values;
    if(debug) {
        values = await chrome.storage.local.get(data.host);
    } else {
        values = await chrome.storage.sync.get(data.host);
    }

    if(typeof values[data.host]  !== "undefined") {
        var settings_css = values[data.host].css;
        var settings_js = values[data.host].js;
        var willit = Math.random();  // Unused; consider removing
        if(settings_css) {
            try {
                await chrome.scripting.insertCSS({
                    target: { tabId: tabId },
                    css: settings_css
                });
            } catch (error) {
                onError('CSS injection error: ' + error);
            }
        }
        if(settings_js) {
            try {
                // Inject jQuery to MAIN world (CSP removed, so OK)
                await chrome.scripting.executeScript({
                    target: { tabId: tabId },
                    world: 'MAIN',
                    files: ["jquery.js"]
                });
                // Inject custom JS via <script> tag (no eval)
                const codeToInject = `$(document).ready(function() {${pandaTestsScript(settings_js, data.host)}})`;
                await chrome.scripting.executeScript({
                    target: { tabId: tabId },
                    world: 'MAIN',
                    func: (code) => {
                        const script = document.createElement('script');
                        script.textContent = code;
                        (document.head || document.documentElement).appendChild(script);
                        script.remove();  // Cleanup
                    },
                    args: [codeToInject]
                });
            } catch (error) {
                onError('Script execution error: ' + error);
            }
        }
    } else {
        cl('No settings');
    }
});

function save_background(deferred) {
    if (deferred.host) {
        save_settings(deferred.host, deferred.settings).catch(onError);
    }
}

// Initialize rules on startup/install
chrome.runtime.onInstalled.addListener(updateCspRules);
chrome.runtime.onStartup.addListener(updateCspRules);