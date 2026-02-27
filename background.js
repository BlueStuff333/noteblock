let activePasses = {};
let tracking = { tabId: null, hostname: null, startTime: null };

async function savePasses() {
  await chrome.storage.local.set({ activePasses });
}

(async () => {
  const data = await chrome.storage.local.get(['activePasses']);
  if (data.activePasses) activePasses = data.activePasses;
})();

function cleanHostname(h) {
  return h.replace(/^www\./, '');
}

function matchBlocked(url, blockedSites) {
  const hostname = cleanHostname(url.hostname);
  const fullPath = hostname + url.pathname;
  return blockedSites.find(s => {
    if (s.hostname.includes('/')) {
      return fullPath.startsWith(s.hostname) || fullPath.startsWith(s.hostname + '/');
    }
    return hostname === s.hostname || hostname.endsWith('.' + s.hostname);
  });
}

function matchException(url, exceptions) {
  const hostname = cleanHostname(url.hostname);
  const fullPath = hostname + url.pathname;
  return exceptions.some(ex => {
    if (ex.includes('/')) {
      return fullPath.startsWith(ex) || fullPath.startsWith(ex + '/');
    }
    return hostname === ex || hostname.endsWith('.' + ex);
  });
}

// --- Navigation interception ---

chrome.webNavigation.onBeforeNavigate.addListener(async (details) => {
  if (details.frameId !== 0) return;

  let url;
  try { url = new URL(details.url); } catch { return; }
  if (!url.hostname) return;

  const hostname = cleanHostname(url.hostname);
  const data = await chrome.storage.local.get(['blockedSites', 'exceptions']);
  const blockedSites = data.blockedSites || [];
  const exceptions = data.exceptions || [];
  const blocked = matchBlocked(url, blockedSites);
  if (!blocked) return;

  if (matchException(url, exceptions)) return;

  const pass = activePasses[details.tabId];
  if (pass && pass.hostname === blocked.hostname) return;

  if (blocked.indefinite) {
    chrome.tabs.update(details.tabId, { url: 'chrome://newtab/' });
    return;
  }

  const journalUrl = chrome.runtime.getURL(
    `blocked.html?url=${encodeURIComponent(details.url)}&hostname=${encodeURIComponent(blocked.hostname)}`
  );
  chrome.tabs.update(details.tabId, { url: journalUrl });
});

// --- Messaging ---

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'grantPass') {
    const tabId = sender.tab.id;
    chrome.storage.local.get(['blockedSites'], (data) => {
      const sites = data.blockedSites || [];
      const site = sites.find(s => s.hostname === msg.hostname);
      const rejournalSeconds = site ? (site.rejournalSeconds || 900) : 900;
      activePasses[tabId] = {
        hostname: msg.hostname,
        grantedAt: Date.now(),
        accumulatedSeconds: 0,
        rejournalSeconds,
      };
      savePasses();
      chrome.tabs.update(tabId, { url: msg.url });
    });
    sendResponse({ ok: true });
    return;
  }

  if (msg.type === 'getBlockedSites') {
    chrome.storage.local.get(['blockedSites'], (data) => {
      sendResponse(data.blockedSites || []);
    });
    return true;
  }

  if (msg.type === 'getSiteSeconds') {
    chrome.storage.local.get(['blockedSites'], (data) => {
      const sites = data.blockedSites || [];
      const site = sites.find(s => s.hostname === msg.hostname);
      sendResponse(site ? site.minSeconds : 300);
    });
    return true;
  }
});

// --- Time tracking ---

async function startTrackingIfBlocked(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab.url) return;
    let url;
    try { url = new URL(tab.url); } catch { return; }

    const hostname = cleanHostname(url.hostname);
    const data = await chrome.storage.local.get(['blockedSites']);
    const blocked = matchBlocked(url, data.blockedSites || []);
    if (!blocked) return;

    const pass = activePasses[tabId];
    if (!pass || pass.hostname !== blocked.hostname) return;

    tracking = { tabId, hostname: blocked.hostname, startTime: Date.now() };
  } catch (e) { /* tab may not exist */ }
}

async function stopTracking() {
  if (!tracking.startTime) {
    tracking = { tabId: null, hostname: null, startTime: null };
    return;
  }

  const elapsed = Math.floor((Date.now() - tracking.startTime) / 1000);
  const hostname = tracking.hostname;
  const tabId = tracking.tabId;
  tracking = { tabId: null, hostname: null, startTime: null };

  if (activePasses[tabId] && activePasses[tabId].hostname === hostname) {
    activePasses[tabId].accumulatedSeconds += elapsed;
    savePasses();
  }

  if (elapsed < 1) return;

  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  const data = await chrome.storage.local.get(['timeData']);
  const timeData = data.timeData || {};
  if (!timeData[today]) timeData[today] = {};
  timeData[today][hostname] = (timeData[today][hostname] || 0) + elapsed;
  await chrome.storage.local.set({ timeData });
}

async function revokePass(tabId) {
  const pass = activePasses[tabId];
  if (!pass) return;

  delete activePasses[tabId];
  savePasses();

  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab.url) return;
    const journalUrl = chrome.runtime.getURL(
      `blocked.html?url=${encodeURIComponent(tab.url)}&hostname=${encodeURIComponent(pass.hostname)}`
    );
    chrome.tabs.update(tabId, { url: journalUrl });
  } catch (e) { /* tab gone */ }
}

// --- Periodic expiration check (every 10s) ---

setInterval(async () => {
  const data = await chrome.storage.local.get(['blockedSites']);
  const blockedSites = data.blockedSites || [];

  for (const [tabIdStr, pass] of Object.entries(activePasses)) {
    const tabId = parseInt(tabIdStr);
    const site = blockedSites.find(s => s.hostname === pass.hostname);
    if (!site || site.rejournalEnabled === false) continue;
    let currentSession = 0;
    if (tracking.tabId === tabId && tracking.startTime) {
      currentSession = Math.floor((Date.now() - tracking.startTime) / 1000);
    }
    const total = pass.accumulatedSeconds + currentSession;
    if (total >= (site.rejournalSeconds || 900)) {
      if (tracking.tabId === tabId) await stopTracking();
      await revokePass(tabId);
    }
  }
}, 10000);

// --- Tab lifecycle listeners ---

chrome.tabs.onActivated.addListener(async (info) => {
  await stopTracking();
  await startTrackingIfBlocked(info.tabId);
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!changeInfo.url) return;

  if (tracking.tabId === tabId) await stopTracking();

  const pass = activePasses[tabId];
  if (pass) {
    let url;
    try { url = new URL(changeInfo.url); } catch { return; }
    const newHostname = cleanHostname(url.hostname);
    if (newHostname !== pass.hostname && !newHostname.endsWith('.' + pass.hostname)) {
      delete activePasses[tabId];
      savePasses();
      return;
    }
  }

  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (activeTab && activeTab.id === tabId) {
    await startTrackingIfBlocked(tabId);
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  if (tracking.tabId === tabId) await stopTracking();
  delete activePasses[tabId];
  savePasses();
});

chrome.windows.onFocusChanged.addListener(async (windowId) => {
  await stopTracking();
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  const [activeTab] = await chrome.tabs.query({ active: true, windowId });
  if (activeTab) await startTrackingIfBlocked(activeTab.id);
});
