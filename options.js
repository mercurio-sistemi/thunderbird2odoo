const urlInput = document.getElementById("url");
const dbInput = document.getElementById("db");
const apiKeyInput = document.getElementById("apikey");
const testBtn = document.getElementById("test");
const testStatus = document.getElementById("testStatus");
const saveBtn = document.getElementById("save");
const clearCacheBtn = document.getElementById("clearCache");
const status = document.getElementById("status");

const maxAgeInput = document.getElementById("maxAgeDays");
const syncLimitInput = document.getElementById("syncLimit");
const saveSyncBtn = document.getElementById("saveSync");
const syncNowBtn = document.getElementById("syncNow");
const countBtn = document.getElementById("countBtn");
const countResult = document.getElementById("countResult");
const cacheInfo = document.getElementById("cacheInfo");

const helpdeskTeamIdInput = document.getElementById("helpdeskTeamId");
const loadTeamsBtn = document.getElementById("loadTeams");
const loadTeamsStatus = document.getElementById("loadTeamsStatus");
const saveTicketBtn = document.getElementById("saveTicket");
const ticketStatus = document.getElementById("ticketStatus");

const syncSettingsForm = document.getElementById("syncSettings");
const syncFields = [
  maxAgeInput,
  syncLimitInput,
  saveSyncBtn,
  clearCacheBtn,
  syncNowBtn,
  countBtn,
  syncSettingsForm,
  helpdeskTeamIdInput,
  loadTeamsBtn,
  saveTicketBtn,
];
function setSyncEnabled(enabled) {
  syncFields.forEach((el) => {
    if (el) el.disabled = !enabled;
  });
}

let lastValidHash = null;

function getConfig() {
  return {
    url: urlInput.value.trim(),
    apikey: apiKeyInput.value.trim(),
    db: dbInput.value.trim() || null,
  };
}

function hash(cfg) {
  return JSON.stringify(cfg);
}

function invalidate() {
  lastValidHash = null;
  saveBtn.disabled = true;
  testStatus.textContent = "";
  setSyncEnabled(false);
}

(async () => {
  const stored = await browser.storage.local.get([
    "url",
    "db",
    "apikey",
    "maxAgeDays",
    "syncLimit",
    "helpdeskTeamId",
  ]);
  if (stored.url) urlInput.value = stored.url;
  if (stored.db) dbInput.value = stored.db;
  if (stored.apikey) apiKeyInput.value = stored.apikey;
  if (stored.maxAgeDays !== undefined) maxAgeInput.value = stored.maxAgeDays;
  if (stored.syncLimit !== undefined) syncLimitInput.value = stored.syncLimit;
  invalidate();
  if (stored.url && stored.apikey) {
    setSyncEnabled(true);
    loadTeams(stored.helpdeskTeamId);
  }
  refreshCacheInfo();
})();

browser.storage.onChanged.addListener((changes, area) => {
  if (
    area === "local" &&
    ("odooMailCache" in changes || "lastOdooSync" in changes)
  ) {
    refreshCacheInfo();
  }
});

[urlInput, dbInput, apiKeyInput].forEach((el) =>
  el.addEventListener("input", invalidate),
);

testBtn.addEventListener("click", async () => {
  const cfg = getConfig();

  if (!cfg.url || !cfg.apikey) {
    testStatus.textContent = "URL and API key are required";
    return;
  }

  const granted = await browser.permissions.request({
    origins: ["*://*/*"],
  });
  if (!granted) {
    testStatus.textContent = "Host permission is required";
    return;
  }
  console.debug("testConnection: host permission granted");

  testStatus.textContent = "Testing…";
  saveBtn.disabled = true;

  const result = await browser.runtime.sendMessage({
    action: "testConnection",
    config: cfg,
  });

  if (result?.ok) {
    lastValidHash = hash(cfg);
    saveBtn.disabled = false;
    const info = result.info;
    let text = "OK";
    if (info?.userInfo) {
      const u = info.userInfo;
      text += " as " + (u.login || "") + (u.name ? " (" + u.name + ")" : "");
    }
    testStatus.textContent = text;
    testStatus.style.color = "green";
  } else {
    testStatus.textContent = "Failed: " + (result?.error || "unknown error");
    testStatus.style.color = "#c0392b";
  }
});

clearCacheBtn.addEventListener("click", async () => {
  const result = await browser.runtime.sendMessage({ action: "clearCache" });
  status.textContent = result?.ok
    ? "Odoo cache cleared"
    : "Failed to clear cache";
  refreshCacheInfo();
});

async function loadTeams(selectAfter) {
  const wanted =
    selectAfter !== undefined && selectAfter !== null
      ? String(selectAfter)
      : helpdeskTeamIdInput.value;
  loadTeamsStatus.textContent = "Loading…";
  loadTeamsStatus.style.color = "";
  loadTeamsBtn.disabled = true;
  const result = await browser.runtime.sendMessage({
    action: "listHelpdeskTeams",
  });
  loadTeamsBtn.disabled = false;
  if (result?.ok) {
    helpdeskTeamIdInput.innerHTML = "";
    const noneOpt = document.createElement("option");
    noneOpt.value = "";
    noneOpt.textContent = "— not set —";
    helpdeskTeamIdInput.appendChild(noneOpt);
    for (const team of result.teams) {
      const opt = document.createElement("option");
      opt.value = String(team.id);
      opt.textContent = team.name;
      helpdeskTeamIdInput.appendChild(opt);
    }
    if (wanted) helpdeskTeamIdInput.value = wanted;
    loadTeamsStatus.textContent =
      result.teams.length + (result.teams.length === 1 ? " team" : " teams");
    loadTeamsStatus.style.color = "green";
  } else {
    loadTeamsStatus.textContent =
      "Failed: " + (result?.error || "unknown error");
    loadTeamsStatus.style.color = "#c0392b";
  }
}

loadTeamsBtn.addEventListener("click", () => loadTeams());

saveTicketBtn.addEventListener("click", async () => {
  const raw = helpdeskTeamIdInput.value;
  if (raw === "") {
    await browser.storage.local.remove("helpdeskTeamId");
  } else {
    await browser.storage.local.set({ helpdeskTeamId: parseInt(raw, 10) });
  }
  ticketStatus.textContent = "Saved";
  ticketStatus.style.color = "green";
});

document.getElementById("settings").addEventListener("submit", async (e) => {
  e.preventDefault();

  const cfg = getConfig();
  if (hash(cfg) !== lastValidHash) {
    status.textContent = "Please test before saving";
    return;
  }

  await browser.storage.local.set(cfg);

  const result = await browser.runtime.sendMessage({
    action: "setup",
  });

  if (result?.ok) {
    status.textContent = "Settings saved";
    setSyncEnabled(true);
    loadTeams();
  } else {
    status.textContent =
      "Saved, but setup failed: " + (result?.error || "unknown error");
  }
});

saveSyncBtn.addEventListener("click", async () => {
  const raw = parseInt(maxAgeInput.value, 10);
  const maxAgeDays = Number.isNaN(raw) ? 365 : Math.max(0, raw);
  const rawLimit = parseInt(syncLimitInput.value, 10);
  const syncLimit = Number.isNaN(rawLimit) ? 0 : Math.max(0, rawLimit);
  await browser.storage.local.set({ maxAgeDays, syncLimit });
  status.textContent = "Sync settings saved";
  refreshCacheInfo();
});

countBtn.addEventListener("click", async () => {
  countBtn.disabled = true;
  countResult.textContent = "Counting…";
  const raw = parseInt(maxAgeInput.value, 10);
  const maxAgeDays = Number.isNaN(raw) ? 365 : Math.max(0, raw);
  const result = await browser.runtime.sendMessage({
    action: "countOdooMessages",
    maxAgeDays,
  });
  countResult.textContent = result?.ok
    ? result.count + " messages"
    : "Error: " + (result?.error || "unknown");
  countBtn.disabled = false;
});

syncNowBtn.addEventListener("click", async () => {
  syncNowBtn.disabled = true;
  status.textContent = "Syncing…";
  const result = await browser.runtime.sendMessage({ action: "syncFromOdoo" });
  status.textContent = result?.ok ? "Sync complete" : "Sync failed";
  syncNowBtn.disabled = false;
  refreshCacheInfo();
});

async function refreshCacheInfo() {
  const info = await browser.runtime.sendMessage({ action: "getCacheInfo" });
  if (!info) return;
  let text = "Cached entries: " + info.size;
  if (info.lastSync) {
    const d = new Date(info.lastSync);
    text += " | Last sync: " + d.toLocaleString();
  }
  cacheInfo.textContent = text;
}
