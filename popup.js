const hostnameInput = document.getElementById('hostname');
const journalMinInput = document.getElementById('journalMin');
const journalSecInput = document.getElementById('journalSec');
const rejMinInput = document.getElementById('rejMin');
const rejSecInput = document.getElementById('rejSec');
const hardblockBox = document.getElementById('hardblock');
const addBtn = document.getElementById('addBtn');
const feedback = document.getElementById('feedback');
const dashLink = document.getElementById('dashLink');
const popConfirm = document.getElementById('popConfirm');
const popSummary = document.getElementById('popSummary');

// Toggle journal/rejournal rows when hardblock is checked
hardblockBox.addEventListener('change', () => {
  const disabled = hardblockBox.checked;
  document.getElementById('journalRow').style.opacity = disabled ? '0.4' : '1';
  document.getElementById('rejRow').style.opacity = disabled ? '0.4' : '1';
  [journalMinInput, journalSecInput, rejMinInput, rejSecInput].forEach(
    el => el.disabled = disabled
  );
});

let feedbackTimer = null;
function showFeedback(msg, isError) {
  feedback.textContent = msg;
  feedback.classList.toggle('error', !!isError);
  feedback.classList.add('visible');
  clearTimeout(feedbackTimer);
  feedbackTimer = setTimeout(() => feedback.classList.remove('visible'), 2000);
}

let pendingSite = null;

function buildSiteObj() {
  const hostname = hostnameInput.value.trim()
    .replace(/^(https?:\/\/)?(www\.)?/, '').replace(/\/.*$/, '');
  if (!hostname) return null;

  const isHard = hardblockBox.checked;
  const jMin = parseInt(journalMinInput.value) || 0;
  const jSec = parseInt(journalSecInput.value) || 0;
  const rMin = parseInt(rejMinInput.value) || 0;
  const rSec = parseInt(rejSecInput.value) || 0;
  const minSeconds = jMin * 60 + jSec;
  const rejournalSeconds = rMin * 60 + rSec;

  if (!isHard && minSeconds < 1) return null;

  return {
    hostname,
    indefinite: isHard,
    minSeconds: isHard ? 0 : minSeconds,
    rejournalEnabled: !isHard,
    rejournalSeconds: isHard ? 0 : (rejournalSeconds || 900),
  };
}

function fmtTime(s) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  if (m > 0 && sec > 0) return `${m}m ${sec}s`;
  if (m > 0) return `${m}m`;
  return `${sec}s`;
}

function summarize(site) {
  if (site.indefinite) {
    return `<strong>${site.hostname}</strong><br>Mode: Hard block`;
  }
  let txt = `<strong>${site.hostname}</strong><br>`;
  txt += `Journal: ${fmtTime(site.minSeconds)}<br>`;
  txt += `Rejournal: ${fmtTime(site.rejournalSeconds)}`;
  return txt;
}

addBtn.addEventListener('click', async () => {
  const site = buildSiteObj();
  if (!site) return;

  const data = await chrome.storage.local.get(['blockedSites']);
  const sites = data.blockedSites || [];
  if (sites.some(s => s.hostname === site.hostname)) {
    showFeedback('Already blocked', true);
    return;
  }

  pendingSite = site;
  popSummary.innerHTML = summarize(site);
  popConfirm.classList.add('visible');
});

document.getElementById('popCancel').addEventListener('click', () => {
  popConfirm.classList.remove('visible');
  pendingSite = null;
});

document.getElementById('popYes').addEventListener('click', async () => {
  popConfirm.classList.remove('visible');
  if (!pendingSite) return;

  const data = await chrome.storage.local.get(['blockedSites']);
  const sites = data.blockedSites || [];
  sites.push(pendingSite);
  await chrome.storage.local.set({ blockedSites: sites });
  showFeedback('Added ' + pendingSite.hostname);
  pendingSite = null;

  hostnameInput.value = '';
  journalMinInput.value = '5';
  journalSecInput.value = '0';
  rejMinInput.value = '15';
  rejSecInput.value = '0';
  hardblockBox.checked = false;
  hardblockBox.dispatchEvent(new Event('change'));
});

hostnameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') addBtn.click();
});

dashLink.addEventListener('click', (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') });
});
