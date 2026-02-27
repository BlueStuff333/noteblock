// === Data ===
let viewYear, viewMonth, selectedDate = null;
let timeData = {}, journals = [], streaks = [];
let settings = {};

const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

const DEFAULT_SETTINGS = {
  darkMode: true, optLockMin: 0, listsLockMin: 3, interruptCount: 5,
  defaultJournal: 300, defaultRejournal: 900, streakSubtitle: '🏆',
  msgInterrupt: 'Are you sure you want to do this?',
  msgStreakEnd: 'End your streak here?',
  msgRemoveSite: 'Remove {site} from the blocklist?',
  confirmRemove: true,
};

async function loadData() {
  const data = await chrome.storage.local.get(['timeData','journals','streaks','settings']);
  timeData = data.timeData || {};
  journals = data.journals || [];
  streaks = data.streaks || [];
  settings = { ...DEFAULT_SETTINGS, ...(data.settings || {}) };
}
async function saveStreaks() { await chrome.storage.local.set({ streaks }); }
async function saveSettings() { await chrome.storage.local.set({ settings }); }
function S(key) { return settings[key] ?? DEFAULT_SETTINGS[key]; }

function todayKey() { const t = new Date(); return dateKey(t.getFullYear(), t.getMonth(), t.getDate()); }
function getActiveStreak() { return streaks.find(s => s.end === null) || null; }
function isInAnyStreak(dk) { return streaks.some(s => { const end = s.end || todayKey(); return dk >= s.start && dk <= end; }); }
function isInActiveStreak(dk) { const a = getActiveStreak(); return a ? dk >= a.start && dk <= todayKey() : false; }
function activeStreakLength() {
  const a = getActiveStreak(); if (!a) return 0;
  const s = new Date(a.start + 'T00:00:00'), n = new Date(); n.setHours(0,0,0,0);
  return Math.floor((n - s) / 86400000) + 1;
}
function formatSeconds(s) {
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60), sec = s % 60;
  if (m < 60) return `${m}m ${sec}s`;
  return `${Math.floor(m/60)}h ${m%60}m`;
}
function dateKey(y, m, d) { return `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`; }
function totalSecondsForDate(dk) { const d = timeData[dk]; return d ? Object.values(d).reduce((a,b) => a+b, 0) : 0; }
function escapeHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

// === Calendar ===
function renderCalendar() {
  document.getElementById('monthLabel').textContent = `${MONTHS[viewMonth]} ${viewYear}`;
  const grid = document.getElementById('calGrid');
  grid.innerHTML = '';
  DAYS.forEach(d => { const el = document.createElement('div'); el.className = 'cal-header'; el.textContent = d; grid.appendChild(el); });
  const firstDay = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  for (let i = 0; i < firstDay; i++) { const el = document.createElement('div'); el.className = 'cal-day empty'; grid.appendChild(el); }
  for (let d = 1; d <= daysInMonth; d++) {
    const dk = dateKey(viewYear, viewMonth, d);
    const totalSec = totalSecondsForDate(dk);
    const el = document.createElement('div');
    el.className = 'cal-day';
    if (dk === todayKey()) el.classList.add('today');
    if (dk === selectedDate) el.classList.add('selected');
    if (isInAnyStreak(dk)) el.classList.add('streak');
    if (dk > todayKey()) el.classList.add('future');
    let inner = `<span>${d}</span>`;
    if (totalSec > 0) { inner += `<div class="dot"></div>`; const m = Math.round(totalSec/60); if (m > 0) inner += `<div class="day-time">${m}m</div>`; }
    el.innerHTML = inner;
    el.addEventListener('click', () => {
      if (dk > todayKey()) return;
      if (selectedDate === dk) { selectedDate = null; renderCalendar(); renderStreakButton(); resetDayDetail(); renderLeaderboard(); }
      else { selectedDate = dk; renderCalendar(); renderDayDetail(dk); renderLeaderboard(dk); renderStreakButton(); }
    });
    grid.appendChild(el);
  }
}
function resetDayDetail() {
  document.getElementById('dayDetailTitle').textContent = 'Select a day';
  document.getElementById('dayDetailContent').innerHTML = '<div class="no-data">Click a day on the calendar to view details.</div>';
}

// === Day Detail ===
function renderDayDetail(dk) {
  const title = document.getElementById('dayDetailTitle');
  const content = document.getElementById('dayDetailContent');
  const d = new Date(dk + 'T00:00:00');
  title.textContent = d.toLocaleDateString('en-US', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
  const dayTime = timeData[dk] || {}, dayJournals = journals.filter(j => j.date === dk);
  if (!Object.keys(dayTime).length && !dayJournals.length) { content.innerHTML = '<div class="no-data">No activity this day.</div>'; return; }
  let html = '';
  const entries = Object.entries(dayTime).sort((a,b) => b[1]-a[1]);
  if (entries.length) {
    const maxSec = Math.max(...entries.map(e => e[1]));
    html += '<div class="time-breakdown">';
    for (const [site, sec] of entries) { const pct = Math.round(sec/maxSec*100); html += `<div class="time-bar-row"><div class="time-bar-label">${site}</div><div class="time-bar-track"><div class="time-bar-fill" style="width:${pct}%"></div></div><div class="time-bar-value">${formatSeconds(sec)}</div></div>`; }
    html += '</div>';
  }
  if (dayJournals.length) {
    html += '<h3 style="margin-top:12px;">Journal Entries</h3><div>';
    for (const j of dayJournals.sort((a,b) => a.timestamp-b.timestamp)) {
      const time = new Date(j.timestamp).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'});
      html += `<div class="journal-entry"><div class="je-header"><span class="je-site">${j.hostname}</span><span>${time}</span></div><div class="je-text">${escapeHtml(j.text)}</div></div>`;
    }
    html += '</div>';
  }
  content.innerHTML = html;
}

// === Leaderboard ===
function renderLeaderboard(dk) {
  const totals = {}, heading = document.getElementById('lbHeading');
  if (dk) {
    const day = timeData[dk] || {};
    for (const [site, sec] of Object.entries(day)) totals[site] = (totals[site]||0) + sec;
    heading.textContent = '💀 ' + new Date(dk+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'});
  } else {
    for (const day of Object.values(timeData)) for (const [site, sec] of Object.entries(day)) totals[site] = (totals[site]||0) + sec;
    heading.textContent = '💀 Leaderboard — Total Time';
  }
  const sorted = Object.entries(totals).sort((a,b) => b[1]-a[1]);
  const container = document.getElementById('leaderboard');
  if (!sorted.length) { container.innerHTML = '<div class="lb-empty">No data yet.</div>'; return; }
  const maxSec = sorted[0][1];
  container.innerHTML = sorted.map(([site,sec],i) => {
    const rc = i===0?'gold':i===1?'silver':i===2?'bronze':'';
    const pct = Math.round(sec/maxSec*100);
    return `<div class="lb-item"><div class="lb-rank ${rc}">${i+1}</div><div class="lb-info"><div class="lb-name">${site}</div><div class="lb-time">${formatSeconds(sec)}</div></div><div class="lb-bar"><div class="lb-bar-fill" style="width:${pct}%"></div></div></div>`;
  }).join('');
}

// === Streak ===
let pendingStreakEndDate = null;

function renderStreakButton() {
  const bar = document.getElementById('streakBar');
  const active = getActiveStreak();
  if (active) {
    const len = activeStreakLength();
    let html = `<div class="streak-active">🔥 ${len} day${len===1?'':'s'} streak</div>`;
    if (selectedDate && isInActiveStreak(selectedDate)) {
      html += `<button class="streak-end" id="endStreakBtn">End streak on ${selectedDate}</button>`;
    } else {
      html += `<div class="streak-hint">Select a green day to end the streak there</div>`;
    }
    bar.innerHTML = html;
    const endBtn = document.getElementById('endStreakBtn');
    if (endBtn) endBtn.addEventListener('click', () => {
      pendingStreakEndDate = selectedDate;
      document.getElementById('streakEndText').textContent = S('msgStreakEnd');
      document.getElementById('streakEndDate').textContent = selectedDate;
      document.getElementById('streakEndOverlay').classList.add('visible');
    });
  } else {
    bar.innerHTML = `<button class="streak-begin" id="beginStreakBtn">Begin streak</button>`;
    document.getElementById('beginStreakBtn').addEventListener('click', async () => {
      streaks.push({ start: todayKey(), end: null });
      await saveStreaks(); renderCalendar(); renderStreakButton();
    });
  }
}

document.getElementById('streakEndCancel').addEventListener('click', () => {
  document.getElementById('streakEndOverlay').classList.remove('visible');
  pendingStreakEndDate = null;
});
document.getElementById('streakEndConfirm').addEventListener('click', async () => {
  document.getElementById('streakEndOverlay').classList.remove('visible');
  if (!pendingStreakEndDate) return;
  const active = getActiveStreak();
  if (!active) return;
  if (pendingStreakEndDate === active.start) streaks = streaks.filter(s => s !== active);
  else {
    const prev = new Date(pendingStreakEndDate + 'T00:00:00');
    prev.setDate(prev.getDate() - 1);
    active.end = dateKey(prev.getFullYear(), prev.getMonth(), prev.getDate());
  }
  await saveStreaks();
  pendingStreakEndDate = null;
  selectedDate = null;
  resetDayDetail(); renderCalendar(); renderLeaderboard(); renderStreakButton();
});

// === Binge overlay + Confetti ===
let confettiDone = false;

function showBingeFree() {
  const bingeCount = document.getElementById('bingeCount');
  const bingeLabel = document.querySelector('.binge-label');
  const sub = document.getElementById('streakSubDisplay');
  sub.textContent = S('streakSubtitle');
  const active = getActiveStreak();
  if (active) { const len = activeStreakLength(); bingeCount.textContent = len; bingeLabel.textContent = len===1?'day streak':'days streak'; }
  else { bingeCount.textContent = '🏆'; bingeLabel.textContent = 'no active streak'; }
}

document.getElementById('bingeDismiss').addEventListener('click', () => { if (confettiDone) document.getElementById('bingeOverlay').classList.add('hidden'); });
document.getElementById('bingeOverlay').addEventListener('click', (e) => { if (confettiDone && e.target === document.getElementById('bingeOverlay')) document.getElementById('bingeOverlay').classList.add('hidden'); });
document.getElementById('streakBtn').addEventListener('click', () => {
  confettiDone = false; showBingeFree(); document.getElementById('bingeOverlay').classList.remove('hidden'); launchConfetti();
});

function launchConfetti() {
  const canvas = document.getElementById('confettiCanvas');
  const btn = document.getElementById('bingeDismiss');
  if (!canvas) return;
  btn.style.opacity = '0.3'; btn.style.pointerEvents = 'none';
  const ctx = canvas.getContext('2d');
  canvas.width = window.innerWidth; canvas.height = window.innerHeight;
  const colors = ['#f0c040','#e74c3c','#27ae60','#3498db','#9b59b6','#e67e22','#ff6b9d'];
  const pieces = [];
  for (let i = 0; i < 120; i++) pieces.push({ x: Math.random()*canvas.width, y: Math.random()*-canvas.height, w: 4+Math.random()*6, h: 8+Math.random()*8, color: colors[Math.floor(Math.random()*colors.length)], vy: 2+Math.random()*3, vx: (Math.random()-0.5)*2, rot: Math.random()*Math.PI*2, vr: (Math.random()-0.5)*0.15, opacity: 1 });
  let frame = 0;
  function draw() {
    ctx.clearRect(0,0,canvas.width,canvas.height); frame++;
    let alive = false;
    for (const p of pieces) {
      p.x += p.vx; p.y += p.vy; p.rot += p.vr;
      if (frame > 90) p.opacity = Math.max(0, p.opacity - 0.015);
      if (p.opacity <= 0) continue; alive = true;
      ctx.save(); ctx.translate(p.x,p.y); ctx.rotate(p.rot); ctx.globalAlpha = p.opacity; ctx.fillStyle = p.color; ctx.fillRect(-p.w/2,-p.h/2,p.w,p.h); ctx.restore();
    }
    if (alive) requestAnimationFrame(draw);
    else { confettiDone = true; btn.style.opacity = '1'; btn.style.pointerEvents = 'auto'; }
  }
  requestAnimationFrame(draw);
}

// === Lock System ===
const locks = {
  lists: { remaining: 180, unlocked: false, started: false, interruptsFired: 0, interruptShowing: false },
  options: { remaining: 0, unlocked: false, started: false, interruptsFired: 0, interruptShowing: false },
};
let activeLock = null;

function fmtTimer(s) { return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`; }

function updateLockDisplay(name) {
  const L = locks[name];
  document.querySelectorAll(`.tab-lock-timer[data-lock="${name}"]`).forEach(el => el.textContent = fmtTimer(L.remaining));
  const btn = document.querySelector(`.tab-btn[data-tab="${name}"]`);
  if (!btn) return;
  const lockSpan = btn.querySelector('.tab-lock');
  if (L.remaining <= 0 || L.unlocked) {
    btn.classList.remove('tab-locked'); btn.classList.add('tab-unlocked');
    if (lockSpan) lockSpan.style.display = 'none';
  } else {
    if (!btn.classList.contains('tab-unlocked')) { btn.classList.add('tab-locked'); if (lockSpan) lockSpan.style.display = ''; }
  }
}

function unlockLock(name) {
  locks[name].unlocked = true;
  locks[name].remaining = 0;
  updateLockDisplay(name);
  if (name === 'lists') document.getElementById('listsLockMin').disabled = false;
}

function getInterruptInterval(name) {
  const count = S('interruptCount');
  if (count <= 0) return Infinity;
  const total = name === 'lists' ? S('listsLockMin') * 60 : S('optLockMin') * 60;
  return Math.floor(total / (count + 1));
}

document.getElementById('interruptYes').addEventListener('click', () => {
  document.getElementById('interruptOverlay').classList.remove('visible');
  if (activeLock) locks[activeLock].interruptShowing = false;
});

setInterval(() => {
  for (const name of ['lists', 'options']) {
    const L = locks[name];
    if (L.unlocked || !L.started || document.hidden || L.interruptShowing) continue;
    L.remaining--;
    if (L.remaining <= 0) { unlockLock(name); continue; }
    const interval = getInterruptInterval(name);
    const totalElapsed = (name === 'lists' ? S('listsLockMin') * 60 : S('optLockMin') * 60) - L.remaining;
    const expectedInterrupts = interval > 0 ? Math.floor(totalElapsed / interval) : 0;
    if (expectedInterrupts > L.interruptsFired && L.remaining > 0) {
      L.interruptsFired++;
      L.interruptShowing = true;
      activeLock = name;
      document.getElementById('interruptText').textContent = S('msgInterrupt');
      document.getElementById('interruptOverlay').classList.add('visible');
    }
    updateLockDisplay(name);
  }
}, 1000);

// === Tabs ===
document.querySelectorAll('#mainTabs .tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.tab;
    const lockName = tab === 'activity' ? null : tab;
    if (lockName && locks[lockName] && !locks[lockName].unlocked) {
      if (locks[lockName].remaining > 0) { if (!locks[lockName].started) locks[lockName].started = true; return; }
    }
    document.querySelectorAll('#mainTabs .tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + tab).classList.add('active');
  });
});
document.querySelectorAll('#subTabs .tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#subTabs .tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.sub-tab-content').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('subtab-' + btn.dataset.subtab).classList.add('active');
  });
});

// === Init ===
document.getElementById('prevMonth').addEventListener('click', () => { viewMonth--; if (viewMonth<0){viewMonth=11;viewYear--;} renderCalendar(); });
document.getElementById('nextMonth').addEventListener('click', () => { viewMonth++; if (viewMonth>11){viewMonth=0;viewYear++;} renderCalendar(); });

(async () => {
  const now = new Date(); viewYear = now.getFullYear(); viewMonth = now.getMonth();
  await loadData();

  // Apply dark mode
  document.body.classList.toggle('dark', S('darkMode'));
  document.getElementById('darkToggle').classList.toggle('on', S('darkMode'));

  // Set lock timers
  const listsMin = S('listsLockMin');
  locks.lists.remaining = listsMin * 60;
  const optMin = S('optLockMin');
  locks.options.remaining = optMin * 60;
  if (optMin <= 0) unlockLock('options');
  if (listsMin <= 0) unlockLock('lists');
  updateLockDisplay('lists');
  updateLockDisplay('options');

  // Populate options inputs
  document.getElementById('optLockMin').value = S('optLockMin');
  document.getElementById('listsLockMin').value = S('listsLockMin');
  document.getElementById('interruptCount').value = S('interruptCount');
  document.getElementById('defaultJournalMin').value = Math.floor(S('defaultJournal')/60);
  document.getElementById('defaultJournalSec').value = S('defaultJournal')%60;
  document.getElementById('defaultRejMin').value = Math.floor(S('defaultRejournal')/60);
  document.getElementById('defaultRejSec').value = S('defaultRejournal')%60;
  document.getElementById('streakSubtitle').value = S('streakSubtitle');
  document.getElementById('msgInterrupt').value = S('msgInterrupt');
  document.getElementById('msgStreakEnd').value = S('msgStreakEnd');
  document.getElementById('msgRemoveSite').value = S('msgRemoveSite');

  // Lists lock locked
  if (!locks.lists.unlocked) document.getElementById('listsLockMin').disabled = true;

  renderCalendar(); renderLeaderboard(); renderBlockedSites(); renderStreakButton();
  showBingeFree(); document.getElementById('bingeOverlay').classList.remove('hidden'); launchConfetti();
})();

// === Options handlers ===
function optChange(id, key, transform) {
  document.getElementById(id).addEventListener('change', async () => {
    settings[key] = transform(document.getElementById(id).value);
    await saveSettings();
  });
}
optChange('optLockMin', 'optLockMin', v => Math.max(0, parseInt(v)||0));
optChange('listsLockMin', 'listsLockMin', v => Math.max(0, parseInt(v)||0));
optChange('interruptCount', 'interruptCount', v => Math.max(0, parseInt(v)||0));
optChange('streakSubtitle', 'streakSubtitle', v => v);
optChange('msgInterrupt', 'msgInterrupt', v => v);
optChange('msgStreakEnd', 'msgStreakEnd', v => v);
optChange('msgRemoveSite', 'msgRemoveSite', v => v);

// Default journal/rejournal time
['defaultJournalMin','defaultJournalSec','defaultRejMin','defaultRejSec'].forEach(id => {
  document.getElementById(id).addEventListener('change', async () => {
    settings.defaultJournal = (parseInt(document.getElementById('defaultJournalMin').value)||0)*60 + (parseInt(document.getElementById('defaultJournalSec').value)||0);
    settings.defaultRejournal = (parseInt(document.getElementById('defaultRejMin').value)||0)*60 + (parseInt(document.getElementById('defaultRejSec').value)||0);
    await saveSettings();
  });
});

// Dark mode
document.getElementById('darkToggle').addEventListener('click', async () => {
  const tog = document.getElementById('darkToggle');
  const nowOn = tog.classList.contains('on');
  tog.classList.toggle('on', !nowOn);
  document.body.classList.toggle('dark', !nowOn);
  settings.darkMode = !nowOn;
  await saveSettings();
});

// Confirm remove toggle
const confirmToggle = document.getElementById('bsConfirmToggle');
confirmToggle.addEventListener('click', async () => {
  const nowOn = confirmToggle.classList.contains('on');
  confirmToggle.classList.toggle('on', !nowOn);
  settings.confirmRemove = !nowOn;
  await saveSettings();
});

// Import/Export
document.getElementById('exportBtn').addEventListener('click', async () => {
  const keys = ['blockedSites','exceptions','timeData','journals','streaks','settings','activePasses'];
  const data = await chrome.storage.local.get(keys);
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = `noteblock-backup-${new Date().toISOString().split('T')[0]}.json`; a.click();
  URL.revokeObjectURL(url);
});
document.getElementById('importBtn').addEventListener('click', () => document.getElementById('importFile').click());
document.getElementById('importFile').addEventListener('change', async (e) => {
  const file = e.target.files[0]; if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const allowed = ['blockedSites','exceptions','timeData','journals','streaks','settings'];
    const filtered = {};
    for (const k of allowed) if (data[k] !== undefined) filtered[k] = data[k];
    if (!Object.keys(filtered).length) { alert('No valid Noteblock data found.'); return; }
    if (!confirm(`Import ${Object.keys(filtered).length} settings? This will overwrite current data.`)) return;
    await chrome.storage.local.set(filtered);
    location.reload();
  } catch (err) { alert('Invalid file: ' + err.message); }
  e.target.value = '';
});

// === Blocklist ===
async function saveSites(sites) { await chrome.storage.local.set({ blockedSites: sites }); }
async function updateSiteField(index, field, value) {
  const data = await chrome.storage.local.get(['blockedSites']);
  const sites = data.blockedSites || [];
  if (sites[index]) { sites[index][field] = value; await saveSites(sites); }
}

function renderSiteCard(site, index) {
  const card = document.createElement('div');
  card.className = 'bs-card collapsed' + (site.indefinite ? ' hard-blocked' : '');
  const isHard = site.indefinite;
  const jMin = Math.floor((site.minSeconds||0)/60), jSec = (site.minSeconds||0)%60;
  const rMin = Math.floor((site.rejournalSeconds||0)/60), rSec = (site.rejournalSeconds||0)%60;
  const rejOn = site.rejournalEnabled !== false;
  card.innerHTML = `
    <div class="bs-card-header">
      <span class="bs-card-host">${escapeHtml(site.hostname)}</span>
      <div class="bs-card-actions"><button class="bs-card-remove">Remove</button><span class="bs-card-chevron">▶</span></div>
    </div>
    <div class="bs-card-body"><div class="bs-card-rows">
      <div class="bs-card-row"><label>Mode</label><select class="bs-card-input" data-field="mode" style="width:auto"><option value="journal" ${isHard?'':'selected'}>Journal</option><option value="hardblock" ${isHard?'selected':''}>Hard block</option></select></div>
      <div class="bs-card-row" ${isHard?'style="display:none"':''}><label>Journal time</label><input type="number" class="bs-card-input" data-field="journalMin" min="0" value="${jMin}"><span class="unit">min</span><input type="number" class="bs-card-input" data-field="journalSec" min="0" max="59" value="${jSec}"><span class="unit">sec</span></div>
      <div class="bs-card-row bs-rej-row" ${isHard?'style="display:none"':''}><label>Rejournal</label><div class="bs-mini-toggle ${rejOn?'on':''}" data-field="rejournalToggle"><div class="bs-mini-toggle-knob"></div></div><input type="number" class="bs-card-input" data-field="rejMin" min="0" value="${rMin}" ${!rejOn?'disabled':''}><span class="unit">min</span><input type="number" class="bs-card-input" data-field="rejSec" min="0" max="59" value="${rSec}" ${!rejOn?'disabled':''}><span class="unit">sec</span></div>
    </div></div>`;

  card.querySelector('.bs-card-header').addEventListener('click', (e) => { if (!e.target.closest('.bs-card-remove')) card.classList.toggle('collapsed'); });
  card.querySelector('[data-field="mode"]').addEventListener('change', async function() { await updateSiteField(index, 'indefinite', this.value==='hardblock'); renderBlockedSites(); });
  const jMinI = card.querySelector('[data-field="journalMin"]'), jSecI = card.querySelector('[data-field="journalSec"]');
  const saveJ = async () => { await updateSiteField(index, 'minSeconds', Math.max((parseInt(jMinI.value)||0)*60+(parseInt(jSecI.value)||0), 1)); };
  jMinI.addEventListener('change', saveJ); jSecI.addEventListener('change', saveJ);
  const rejTog = card.querySelector('[data-field="rejournalToggle"]'), rMinI = card.querySelector('[data-field="rejMin"]'), rSecI = card.querySelector('[data-field="rejSec"]');
  rejTog.addEventListener('click', async () => { const on = rejTog.classList.contains('on'); rejTog.classList.toggle('on',!on); rMinI.disabled=on; rSecI.disabled=on; await updateSiteField(index,'rejournalEnabled',!on); });
  const saveR = async () => { await updateSiteField(index, 'rejournalSeconds', Math.max((parseInt(rMinI.value)||0)*60+(parseInt(rSecI.value)||0), 10)); };
  rMinI.addEventListener('change', saveR); rSecI.addEventListener('change', saveR);
  card.querySelector('.bs-card-remove').addEventListener('click', () => requestRemove(index, site.hostname));
  return card;
}

async function renderBlockedSites() {
  const data = await chrome.storage.local.get(['blockedSites']);
  const sites = data.blockedSites || [];
  const container = document.getElementById('bsSiteList');
  container.innerHTML = '';
  if (!sites.length) { container.innerHTML = '<div class="bs-empty">No sites on blocklist yet.</div>'; return; }
  const sortMode = document.getElementById('bsSort').value;
  const indexed = sites.map((site, i) => ({ site, origIndex: i }));
  if (sortMode==='hardblock') indexed.sort((a,b) => (b.site.indefinite?1:0)-(a.site.indefinite?1:0));
  else if (sortMode==='journal') indexed.sort((a,b) => (a.site.indefinite?1:0)-(b.site.indefinite?1:0));
  else if (sortMode==='time') indexed.sort((a,b) => (b.site.minSeconds||0)-(a.site.minSeconds||0));
  indexed.forEach(({site, origIndex}) => container.appendChild(renderSiteCard(site, origIndex)));
}

document.getElementById('bsAddBtn').addEventListener('click', addBlockedSite);
document.getElementById('bsHostname').addEventListener('keydown', (e) => { if (e.key==='Enter') addBlockedSite(); });

async function addBlockedSite() {
  const input = document.getElementById('bsHostname');
  const raw = input.value.trim().replace(/^(https?:\/\/)?(www\.)?/, '').replace(/\/+$/, '');
  if (!raw) return;
  const data = await chrome.storage.local.get(['blockedSites']);
  const sites = data.blockedSites || [];
  if (sites.some(s => s.hostname === raw)) { input.value = ''; return; }
  // Check for redundant parent
  const parentExists = sites.some(s => {
    if (!raw.includes('/') && !s.hostname.includes('/')) return raw.endsWith('.'+s.hostname);
    if (raw.includes('/') && !s.hostname.includes('/')) { const rawHost = raw.split('/')[0]; return rawHost === s.hostname || rawHost.endsWith('.'+s.hostname); }
    return false;
  });
  if (parentExists && !confirm(`A parent domain already covers this. Add "${raw}" anyway?`)) return;

  sites.push({ hostname: raw, indefinite: false, minSeconds: S('defaultJournal'), rejournalEnabled: true, rejournalSeconds: S('defaultRejournal') });
  await saveSites(sites); input.value = ''; renderBlockedSites();
}

document.getElementById('bsSort').addEventListener('change', renderBlockedSites);

// === Remove confirmation ===
let pendingRemoveIndex = null;
async function requestRemove(index, hostname) {
  if (!S('confirmRemove')) { await doRemove(index); return; }
  pendingRemoveIndex = index;
  document.getElementById('removeText').textContent = S('msgRemoveSite').replace('{site}', hostname);
  document.getElementById('removeOverlay').classList.add('visible');
}
async function doRemove(index) {
  const data = await chrome.storage.local.get(['blockedSites']);
  const sites = data.blockedSites || []; sites.splice(index, 1);
  await saveSites(sites); renderBlockedSites();
}
document.getElementById('removeCancel').addEventListener('click', () => { document.getElementById('removeOverlay').classList.remove('visible'); pendingRemoveIndex = null; });
document.getElementById('removeConfirm').addEventListener('click', async () => { document.getElementById('removeOverlay').classList.remove('visible'); if (pendingRemoveIndex!==null) { await doRemove(pendingRemoveIndex); pendingRemoveIndex=null; } });
document.getElementById('removeOverlay').addEventListener('click', (e) => { if (e.target===document.getElementById('removeOverlay')) { document.getElementById('removeOverlay').classList.remove('visible'); pendingRemoveIndex=null; } });

// === Exceptions ===
async function renderExceptions() {
  const data = await chrome.storage.local.get(['exceptions']);
  const exceptions = data.exceptions || [];
  const container = document.getElementById('exList');
  if (!exceptions.length) { container.innerHTML = '<div class="ex-empty">No exceptions yet.</div>'; return; }
  container.innerHTML = exceptions.map((ex,i) => `<div class="ex-item"><span class="ex-item-path">${escapeHtml(ex)}</span><button class="ex-remove" data-index="${i}">Remove</button></div>`).join('');
  container.querySelectorAll('.ex-remove').forEach(btn => {
    btn.addEventListener('click', async () => {
      const data = await chrome.storage.local.get(['exceptions']);
      const ex = data.exceptions || []; ex.splice(parseInt(btn.dataset.index), 1);
      await chrome.storage.local.set({ exceptions: ex }); renderExceptions();
    });
  });
}
document.getElementById('exAddBtn').addEventListener('click', addException);
document.getElementById('exInput').addEventListener('keydown', (e) => { if (e.key==='Enter') addException(); });
async function addException() {
  const input = document.getElementById('exInput');
  const val = input.value.trim().replace(/^(https?:\/\/)?(www\.)?/, '').replace(/\/+$/, '');
  if (!val) return;
  const data = await chrome.storage.local.get(['exceptions']);
  const ex = data.exceptions || [];
  if (ex.includes(val)) { input.value = ''; return; }
  ex.push(val); await chrome.storage.local.set({ exceptions: ex }); input.value = ''; renderExceptions();
}
renderExceptions();
