let viewYear, viewMonth;
let selectedDate = null;
let timeData = {};
let journals = [];

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

async function loadData() {
  const data = await chrome.storage.local.get(['timeData', 'journals']);
  timeData = data.timeData || {};
  journals = data.journals || [];
}

function formatSeconds(s) {
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const sec = s % 60;
  if (m < 60) return `${m}m ${sec}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function dateKey(y, m, d) {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function totalSecondsForDate(dk) {
  const day = timeData[dk];
  if (!day) return 0;
  return Object.values(day).reduce((a, b) => a + b, 0);
}

// --- Calendar ---

function renderCalendar() {
  document.getElementById('monthLabel').textContent = `${MONTHS[viewMonth]} ${viewYear}`;
  const grid = document.getElementById('calGrid');
  grid.innerHTML = '';

  DAYS.forEach(d => {
    const el = document.createElement('div');
    el.className = 'cal-header';
    el.textContent = d;
    grid.appendChild(el);
  });

  const firstDay = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const today = new Date();
  const todayKey = dateKey(today.getFullYear(), today.getMonth(), today.getDate());

  for (let i = 0; i < firstDay; i++) {
    const el = document.createElement('div');
    el.className = 'cal-day empty';
    grid.appendChild(el);
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const dk = dateKey(viewYear, viewMonth, d);
    const totalSec = totalSecondsForDate(dk);
    const el = document.createElement('div');
    el.className = 'cal-day';
    if (dk === todayKey) el.classList.add('today');
    if (dk === selectedDate) el.classList.add('selected');

    let inner = `<span>${d}</span>`;
    if (totalSec > 0) {
      inner += `<div class="dot"></div>`;
      const m = Math.round(totalSec / 60);
      if (m > 0) inner += `<div class="day-time">${m}m</div>`;
    }
    el.innerHTML = inner;

    el.addEventListener('click', () => {
      selectedDate = dk;
      renderCalendar();
      renderDayDetail(dk);
    });
    grid.appendChild(el);
  }
}

// --- Day detail ---

function renderDayDetail(dk) {
  const title = document.getElementById('dayDetailTitle');
  const content = document.getElementById('dayDetailContent');

  const d = new Date(dk + 'T00:00:00');
  title.textContent = d.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  const dayTime = timeData[dk] || {};
  const dayJournals = journals.filter(j => j.date === dk);
  const hasData = Object.keys(dayTime).length > 0 || dayJournals.length > 0;

  if (!hasData) {
    content.innerHTML = '<div class="no-data">No activity this day.</div>';
    return;
  }

  let html = '';

  const entries = Object.entries(dayTime).sort((a, b) => b[1] - a[1]);
  if (entries.length) {
    const maxSec = Math.max(...entries.map(e => e[1]));
    html += '<div class="time-breakdown">';
    for (const [site, sec] of entries) {
      const pct = Math.round((sec / maxSec) * 100);
      html += `
        <div class="time-bar-row">
          <div class="time-bar-label">${site}</div>
          <div class="time-bar-track"><div class="time-bar-fill" style="width:${pct}%"></div></div>
          <div class="time-bar-value">${formatSeconds(sec)}</div>
        </div>`;
    }
    html += '</div>';
  }

  if (dayJournals.length) {
    html += '<h3 style="font-size:14px;font-weight:600;margin-bottom:10px;">Journal Entries</h3>';
    html += '<div class="journal-entries">';
    for (const j of dayJournals.sort((a, b) => a.timestamp - b.timestamp)) {
      const time = new Date(j.timestamp).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      html += `
        <div class="journal-entry">
          <div class="je-header">
            <span class="je-site">${j.hostname}</span>
            <span>${time}</span>
          </div>
          <div class="je-text">${escapeHtml(j.text)}</div>
        </div>`;
    }
    html += '</div>';
  }

  content.innerHTML = html;
}

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

// --- Leaderboard ---

function renderLeaderboard() {
  const totals = {};
  for (const day of Object.values(timeData)) {
    for (const [site, sec] of Object.entries(day)) {
      totals[site] = (totals[site] || 0) + sec;
    }
  }

  const sorted = Object.entries(totals).sort((a, b) => b[1] - a[1]);
  const container = document.getElementById('leaderboard');

  if (!sorted.length) {
    container.innerHTML = '<div class="lb-empty">No data yet.</div>';
    return;
  }

  const maxSec = sorted[0][1];
  container.innerHTML = sorted.map(([site, sec], i) => {
    const rankClass = i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : '';
    const pct = Math.round((sec / maxSec) * 100);
    return `
      <div class="lb-item">
        <div class="lb-rank ${rankClass}">${i + 1}</div>
        <div class="lb-info">
          <div class="lb-name">${site}</div>
          <div class="lb-time">${formatSeconds(sec)}</div>
        </div>
        <div class="lb-bar"><div class="lb-bar-fill" style="width:${pct}%"></div></div>
      </div>`;
  }).join('');
}

// --- Init ---

document.getElementById('prevMonth').addEventListener('click', () => {
  viewMonth--;
  if (viewMonth < 0) { viewMonth = 11; viewYear--; }
  renderCalendar();
});
document.getElementById('nextMonth').addEventListener('click', () => {
  viewMonth++;
  if (viewMonth > 11) { viewMonth = 0; viewYear++; }
  renderCalendar();
});

(async () => {
  const now = new Date();
  viewYear = now.getFullYear();
  viewMonth = now.getMonth();
  await loadData();
  renderCalendar();
  renderLeaderboard();
  renderBlockedSites();
  showBingeFree();
})();

// --- Binge-free overlay ---

function showBingeFree() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let daysFree = 0;

  const dates = Object.keys(timeData).sort().reverse();
  if (dates.length === 0) {
    daysFree = -1; // no data at all
  } else {
    const lastDate = new Date(dates[0] + 'T00:00:00');
    daysFree = Math.floor((today - lastDate) / (1000 * 60 * 60 * 24));
  }

  const bingeCount = document.getElementById('bingeCount');
  const bingeLabel = document.querySelector('.binge-label');

  if (daysFree < 0) {
    bingeCount.textContent = '✓';
    bingeLabel.textContent = 'no activity recorded yet';
  } else {
    bingeCount.textContent = daysFree;
    bingeLabel.textContent = daysFree === 1 ? 'day binge-free' : 'days binge-free';
  }
}

document.getElementById('bingeDismiss').addEventListener('click', () => {
  document.getElementById('bingeOverlay').classList.add('hidden');
});

document.getElementById('bingeOverlay').addEventListener('click', (e) => {
  if (e.target === document.getElementById('bingeOverlay')) {
    document.getElementById('bingeOverlay').classList.add('hidden');
  }
});

// --- Tab gate timer ---

let GATE_SECONDS = 300;
let gateRemaining = GATE_SECONDS;
let gateUnlocked = false;
let interruptShowing = false;
let secondsSinceLastInterrupt = 0;
const INTERRUPT_INTERVAL = 60;

const interruptOverlay = document.getElementById('interruptOverlay');
const gateToggle = document.getElementById('gateToggle');
const gateMinutesInput = document.getElementById('gateMinutesInput');

// Load saved gate settings
(async () => {
  const data = await chrome.storage.local.get(['gateEnabled', 'gateMinutes']);
  const enabled = data.gateEnabled !== false;
  const minutes = data.gateMinutes ?? 5;
  gateToggle.classList.toggle('on', enabled);
  gateMinutesInput.value = minutes;
  if (!enabled) {
    gateUnlocked = true;
    unlockTabs();
    unlockGateSettings();
  } else {
    GATE_SECONDS = minutes * 60;
    gateRemaining = GATE_SECONDS;
    updateGateDisplay();
  }
})();

function updateGateDisplay() {
  const m = Math.floor(gateRemaining / 60);
  const s = gateRemaining % 60;
  const txt = `${m}:${String(s).padStart(2, '0')}`;
  document.querySelectorAll('.tab-lock-timer').forEach(el => {
    el.textContent = txt;
  });
}

function unlockTabs() {
  gateUnlocked = true;
  document.querySelectorAll('.tab-btn.tab-locked').forEach(btn => {
    btn.classList.remove('tab-locked');
    btn.classList.add('tab-unlocked');
  });
}

function unlockGateSettings() {
  gateToggle.classList.remove('gate-toggle-locked');
  gateToggle.style.pointerEvents = 'auto';
  gateToggle.style.opacity = '1';
  gateMinutesInput.disabled = false;
}

function showInterrupt() {
  interruptShowing = true;
  interruptOverlay.classList.add('visible');
}

document.getElementById('interruptYes').addEventListener('click', () => {
  interruptOverlay.classList.remove('visible');
  interruptShowing = false;
  secondsSinceLastInterrupt = 0;
});

updateGateDisplay();

setInterval(() => {
  if (gateUnlocked) return;
  if (document.hidden) return;
  if (interruptShowing) return;

  gateRemaining--;
  secondsSinceLastInterrupt++;

  if (gateRemaining <= 0) {
    gateRemaining = 0;
    unlockTabs();
    unlockGateSettings();
    updateGateDisplay();
    return;
  }

  if (secondsSinceLastInterrupt >= INTERRUPT_INTERVAL && gateRemaining > 0) {
    showInterrupt();
  }

  updateGateDisplay();
}, 1000);

// Gate toggle and minutes (only usable after unlock)
gateToggle.addEventListener('click', async () => {
  if (!gateUnlocked) return;
  const nowOn = gateToggle.classList.contains('on');
  gateToggle.classList.toggle('on', !nowOn);
  gateMinutesInput.disabled = nowOn;
  await chrome.storage.local.set({ gateEnabled: !nowOn });
});

gateMinutesInput.addEventListener('change', async () => {
  const val = Math.max(1, parseInt(gateMinutesInput.value) || 5);
  gateMinutesInput.value = val;
  await chrome.storage.local.set({ gateMinutes: val });
});

// --- Tabs ---

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.classList.contains('tab-locked')) return;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
  });
});

// --- Blocked sites management ---

async function saveSites(sites) {
  await chrome.storage.local.set({ blockedSites: sites });
}

async function updateSiteField(index, field, value) {
  const data = await chrome.storage.local.get(['blockedSites']);
  const sites = data.blockedSites || [];
  if (!sites[index]) return;
  sites[index][field] = value;
  await saveSites(sites);
}

function renderSiteCard(site, index) {
  const isHardBlocked = !!site.indefinite;
  const journalMin = Math.floor((site.minSeconds || 300) / 60);
  const journalSec = (site.minSeconds || 300) % 60;
  const rejMin = Math.floor((site.rejournalSeconds || 900) / 60);
  const rejSec = (site.rejournalSeconds || 900) % 60;
  const rejOn = site.rejournalEnabled !== false;

  const card = document.createElement('div');
  card.className = 'bs-card' + (isHardBlocked ? ' hard-blocked' : '') + ' collapsed';
  card.innerHTML = `
    <div class="bs-card-header">
      <span class="bs-card-host">${site.hostname}</span>
      <div class="bs-card-actions">
        <button class="bs-card-remove">Remove</button>
        <span class="bs-card-chevron">▸</span>
      </div>
    </div>
    <div class="bs-card-body">
      <div class="bs-card-rows">
      <div class="bs-card-row">
        <label>Mode</label>
        <select class="bs-card-input" style="width:auto" data-field="mode">
          <option value="journal" ${!isHardBlocked ? 'selected' : ''}>Journal</option>
          <option value="hardblock" ${isHardBlocked ? 'selected' : ''}>Hard block</option>
        </select>
      </div>
      <div class="bs-card-row bs-journal-row" ${isHardBlocked ? 'style="display:none"' : ''}>
        <label>Journal time</label>
        <input type="number" class="bs-card-input" data-field="journalMin" min="0" value="${journalMin}">
        <span class="unit">min</span>
        <input type="number" class="bs-card-input" data-field="journalSec" min="0" max="59" value="${journalSec}">
        <span class="unit">sec</span>
      </div>
      <div class="bs-card-row bs-rej-row" ${isHardBlocked ? 'style="display:none"' : ''}>
        <label>Rejournal</label>
        <div class="bs-mini-toggle ${rejOn ? 'on' : ''}" data-field="rejournalToggle"><div class="bs-mini-toggle-knob"></div></div>
        <input type="number" class="bs-card-input" data-field="rejMin" min="0" value="${rejMin}" ${!rejOn ? 'disabled' : ''}>
        <span class="unit">min</span>
        <input type="number" class="bs-card-input" data-field="rejSec" min="0" max="59" value="${rejSec}" ${!rejOn ? 'disabled' : ''}>
        <span class="unit">sec</span>
      </div>
      </div>
    </div>
  `;

  // --- Collapse toggle ---
  card.querySelector('.bs-card-header').addEventListener('click', (e) => {
    if (e.target.closest('.bs-card-remove')) return;
    card.classList.toggle('collapsed');
  });

  // --- Mode select ---
  const modeSelect = card.querySelector('[data-field="mode"]');
  modeSelect.addEventListener('change', async () => {
    const isHard = modeSelect.value === 'hardblock';
    await updateSiteField(index, 'indefinite', isHard);
    renderBlockedSites();
  });

  // --- Journal time ---
  const jMinInput = card.querySelector('[data-field="journalMin"]');
  const jSecInput = card.querySelector('[data-field="journalSec"]');
  const saveJournalTime = async () => {
    const total = (parseInt(jMinInput.value) || 0) * 60 + (parseInt(jSecInput.value) || 0);
    await updateSiteField(index, 'minSeconds', Math.max(total, 1));
  };
  jMinInput.addEventListener('change', saveJournalTime);
  jSecInput.addEventListener('change', saveJournalTime);

  // --- Rejournal toggle ---
  const rejToggle = card.querySelector('[data-field="rejournalToggle"]');
  const rejMinInput = card.querySelector('[data-field="rejMin"]');
  const rejSecInput = card.querySelector('[data-field="rejSec"]');

  rejToggle.addEventListener('click', async () => {
    const nowOn = rejToggle.classList.contains('on');
    rejToggle.classList.toggle('on', !nowOn);
    rejMinInput.disabled = nowOn;
    rejSecInput.disabled = nowOn;
    await updateSiteField(index, 'rejournalEnabled', !nowOn);
  });

  const saveRejTime = async () => {
    const total = (parseInt(rejMinInput.value) || 0) * 60 + (parseInt(rejSecInput.value) || 0);
    await updateSiteField(index, 'rejournalSeconds', Math.max(total, 10));
  };
  rejMinInput.addEventListener('change', saveRejTime);
  rejSecInput.addEventListener('change', saveRejTime);

  // --- Remove ---
  card.querySelector('.bs-card-remove').addEventListener('click', () => {
    requestRemove(index, site.hostname);
  });

  return card;
}

async function renderBlockedSites() {
  const data = await chrome.storage.local.get(['blockedSites']);
  const sites = data.blockedSites || [];
  const container = document.getElementById('bsSiteList');
  container.innerHTML = '';

  if (!sites.length) {
    container.innerHTML = '<div class="bs-empty">No blocked sites yet.</div>';
    return;
  }

  const sortMode = document.getElementById('bsSort').value;
  const indexed = sites.map((site, i) => ({ site, origIndex: i }));

  if (sortMode === 'hardblock') {
    indexed.sort((a, b) => (b.site.indefinite ? 1 : 0) - (a.site.indefinite ? 1 : 0));
  } else if (sortMode === 'journal') {
    indexed.sort((a, b) => (a.site.indefinite ? 1 : 0) - (b.site.indefinite ? 1 : 0));
  } else if (sortMode === 'time') {
    indexed.sort((a, b) => (b.site.minSeconds || 0) - (a.site.minSeconds || 0));
  }

  indexed.forEach(({ site, origIndex }) => {
    container.appendChild(renderSiteCard(site, origIndex));
  });
}

document.getElementById('bsAddBtn').addEventListener('click', addBlockedSite);
document.getElementById('bsHostname').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') addBlockedSite();
});

async function addBlockedSite() {
  const hostnameInput = document.getElementById('bsHostname');
  const hostname = hostnameInput.value.trim().replace(/^(https?:\/\/)?(www\.)?/, '').replace(/\/.*$/, '');
  if (!hostname) return;

  const data = await chrome.storage.local.get(['blockedSites']);
  const sites = data.blockedSites || [];
  if (sites.some(s => s.hostname === hostname)) {
    hostnameInput.value = '';
    return;
  }

  sites.push({
    hostname,
    indefinite: false,
    minSeconds: 300,
    rejournalEnabled: true,
    rejournalSeconds: 900,
  });
  await saveSites(sites);
  hostnameInput.value = '';
  renderBlockedSites();
}

// --- Sort ---

document.getElementById('bsSort').addEventListener('change', renderBlockedSites);

// --- Confirm remove ---

let confirmRemoveEnabled = true;
let pendingRemoveIndex = null;

const confirmOverlay = document.getElementById('bsConfirmOverlay');
const confirmHost = document.getElementById('bsConfirmHost');
const confirmToggle = document.getElementById('bsConfirmToggle');

(async () => {
  const data = await chrome.storage.local.get(['confirmRemove']);
  confirmRemoveEnabled = data.confirmRemove !== false;
  confirmToggle.classList.toggle('on', confirmRemoveEnabled);
})();

confirmToggle.addEventListener('click', async () => {
  confirmRemoveEnabled = !confirmRemoveEnabled;
  confirmToggle.classList.toggle('on', confirmRemoveEnabled);
  await chrome.storage.local.set({ confirmRemove: confirmRemoveEnabled });
});

async function requestRemove(index, hostname) {
  if (!confirmRemoveEnabled) {
    await doRemove(index);
    return;
  }
  pendingRemoveIndex = index;
  confirmHost.textContent = hostname;
  confirmOverlay.classList.add('visible');
}

async function doRemove(index) {
  const data = await chrome.storage.local.get(['blockedSites']);
  const sites = data.blockedSites || [];
  sites.splice(index, 1);
  await saveSites(sites);
  renderBlockedSites();
}

document.getElementById('bsConfirmCancel').addEventListener('click', () => {
  confirmOverlay.classList.remove('visible');
  pendingRemoveIndex = null;
});

document.getElementById('bsConfirmYes').addEventListener('click', async () => {
  confirmOverlay.classList.remove('visible');
  if (pendingRemoveIndex !== null) {
    await doRemove(pendingRemoveIndex);
    pendingRemoveIndex = null;
  }
});

confirmOverlay.addEventListener('click', (e) => {
  if (e.target === confirmOverlay) {
    confirmOverlay.classList.remove('visible');
    pendingRemoveIndex = null;
  }
});

// --- Exceptions ---

async function renderExceptions() {
  const data = await chrome.storage.local.get(['exceptions']);
  const exceptions = data.exceptions || [];
  const container = document.getElementById('exList');

  if (!exceptions.length) {
    container.innerHTML = '<div class="ex-empty">No exceptions yet.</div>';
    return;
  }

  container.innerHTML = exceptions.map((ex, i) => `
    <div class="ex-item">
      <span class="ex-item-path">${ex}</span>
      <button class="ex-remove" data-index="${i}">Remove</button>
    </div>
  `).join('');

  container.querySelectorAll('.ex-remove').forEach(btn => {
    btn.addEventListener('click', async () => {
      const idx = parseInt(btn.dataset.index);
      const data = await chrome.storage.local.get(['exceptions']);
      const exceptions = data.exceptions || [];
      exceptions.splice(idx, 1);
      await chrome.storage.local.set({ exceptions });
      renderExceptions();
    });
  });
}

document.getElementById('exAddBtn').addEventListener('click', addException);
document.getElementById('exInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') addException();
});

async function addException() {
  const input = document.getElementById('exInput');
  let value = input.value.trim()
    .replace(/^(https?:\/\/)?(www\.)?/, '')
    .replace(/\/+$/, '');
  if (!value) return;

  const data = await chrome.storage.local.get(['exceptions']);
  const exceptions = data.exceptions || [];
  if (exceptions.includes(value)) {
    input.value = '';
    return;
  }

  exceptions.push(value);
  await chrome.storage.local.set({ exceptions });
  input.value = '';
  renderExceptions();
}

renderExceptions();
