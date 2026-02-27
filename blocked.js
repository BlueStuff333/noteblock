const params = new URLSearchParams(location.search);
const targetUrl = params.get('url');
const hostname = params.get('hostname');

document.getElementById('siteLabel').textContent = hostname;

const journal = document.getElementById('journal');
const timerEl = document.getElementById('timer');
const proceedBtn = document.getElementById('proceedBtn');

let minSeconds = 300;
let secondsLeft = minSeconds;
let timerDone = false;

// Apply dark mode + custom messages from settings
(async () => {
  const data = await chrome.storage.local.get(['settings']);
  const s = data.settings || {};
  if (s.darkMode !== false) document.body.classList.add('dark');
  if (s.msgJournalHeading) document.getElementById('heading').textContent = s.msgJournalHeading;
  if (s.msgJournalPrompt) document.getElementById('promptLabel').textContent = s.msgJournalPrompt;
})();

chrome.runtime.sendMessage({ type: 'getSiteSeconds', hostname }, (secs) => {
  minSeconds = secs || 300;
  secondsLeft = minSeconds;
  updateTimerDisplay();
});

let timerStarted = false;

function updateTimerDisplay() {
  const m = Math.floor(secondsLeft / 60);
  const s = secondsLeft % 60;
  timerEl.textContent = `${m}:${String(s).padStart(2, '0')}`;
}

function checkReady() {
  if (timerDone && journal.value.trim().length > 0) proceedBtn.classList.add('active');
  else proceedBtn.classList.remove('active');
}

function startTimer() {
  updateTimerDisplay();
  const interval = setInterval(() => {
    secondsLeft--;
    if (secondsLeft <= 0) { secondsLeft = 0; timerDone = true; timerEl.classList.add('done'); clearInterval(interval); }
    updateTimerDisplay(); checkReady();
  }, 1000);
}

journal.addEventListener('input', () => {
  if (!timerStarted) { timerStarted = true; startTimer(); }
  checkReady();
});

proceedBtn.addEventListener('click', async () => {
  if (!timerDone || !journal.value.trim()) return;
  const now = new Date();
  const date = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  const entry = { hostname, date, timestamp: Date.now(), text: journal.value.trim(), durationSeconds: minSeconds };
  const data = await chrome.storage.local.get(['journals']);
  const journals = data.journals || [];
  journals.push(entry);
  await chrome.storage.local.set({ journals });
  chrome.runtime.sendMessage({ type: 'grantPass', hostname, url: targetUrl });
});

// Streak badge
(async () => {
  const data = await chrome.storage.local.get(['streaks']);
  const streaks = data.streaks || [];
  const badge = document.getElementById('bingeBadge');
  const active = streaks.find(s => s.end === null);
  if (!active) { badge.textContent = ''; return; }
  const start = new Date(active.start + 'T00:00:00');
  const now = new Date(); now.setHours(0,0,0,0);
  const days = Math.floor((now - start) / 86400000) + 1;
  badge.textContent = `🔥 ${days} day${days === 1 ? '' : 's'} streak`;
})();
