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

chrome.runtime.sendMessage({ type: 'getSiteSeconds', hostname }, (secs) => {
  minSeconds = secs || 300;
  secondsLeft = minSeconds;
  updateTimerDisplay();
  startTimer();
});

function updateTimerDisplay() {
  const m = Math.floor(secondsLeft / 60);
  const s = secondsLeft % 60;
  timerEl.textContent = `${m}:${String(s).padStart(2, '0')}`;
}

function checkReady() {
  if (timerDone && journal.value.trim().length > 0) {
    proceedBtn.classList.add('active');
  } else {
    proceedBtn.classList.remove('active');
  }
}

function startTimer() {
  updateTimerDisplay();
  const interval = setInterval(() => {
    secondsLeft--;
    if (secondsLeft <= 0) {
      secondsLeft = 0;
      timerDone = true;
      timerEl.classList.add('done');
      clearInterval(interval);
    }
    updateTimerDisplay();
    checkReady();
  }, 1000);
}

journal.addEventListener('input', checkReady);

proceedBtn.addEventListener('click', async () => {
  if (!timerDone || !journal.value.trim()) return;

  const entry = {
    hostname,
    date: new Date().toISOString().split('T')[0],
    timestamp: Date.now(),
    text: journal.value.trim(),
    durationSeconds: minSeconds,
  };

  const data = await chrome.storage.local.get(['journals']);
  const journals = data.journals || [];
  journals.push(entry);
  await chrome.storage.local.set({ journals });

  chrome.runtime.sendMessage({ type: 'grantPass', hostname, url: targetUrl });
});

// --- Binge-free badge ---

(async () => {
  const data = await chrome.storage.local.get(['timeData']);
  const timeData = data.timeData || {};
  const dates = Object.keys(timeData).sort().reverse();
  const badge = document.getElementById('bingeBadge');

  if (!dates.length) {
    badge.textContent = '🏆 No binge activity recorded';
    return;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const lastDate = new Date(dates[0] + 'T00:00:00');
  const days = Math.floor((today - lastDate) / (1000 * 60 * 60 * 24));
  badge.textContent = `🏆 ${days} ${days === 1 ? 'day' : 'days'} without binging screentime`;
})();
