const root = document.getElementById("overlay-root");
const party = document.getElementById("party");
const settingsPanel = document.getElementById("settings");
const source = document.getElementById("source");
const pickFolder = document.getElementById("pickFolder");
const refresh = document.getElementById("refresh");
const toggleClick = document.getElementById("toggleClick");
const closeSettings = document.getElementById("closeSettings");
const scaleInput = document.getElementById("scale");
const layoutSelect = document.getElementById("layout");

let latest = null;
let clickThrough = true;
let draggingParty = false;
let draggingSettings = false;
let dragStart = null;
let cooldownTimer = null;

function asset(path) {
  if (!path) return "";
  const value = String(path).replaceAll("\\", "/");
  if (/^(https?:|data:)/i.test(value)) return value;
  return `../../${value}`;
}

function fmt(ms) {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  if (seconds >= 60) return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  return `0:${String(seconds).padStart(2, "0")}`;
}

function setSettingsPanelPosition(settings = {}) {
  if (!settings.settingsPosition) return;
  settingsPanel.style.left = `${settings.settingsPosition.x}px`;
  settingsPanel.style.top = `${settings.settingsPosition.y}px`;
  settingsPanel.style.transform = "none";
}

function setSettings(settings = {}) {
  const pos = settings.position || { x: 42, y: 110 };
  party.style.left = `${pos.x}px`;
  party.style.top = `${pos.y}px`;
  setSettingsPanelPosition(settings);
  root.style.setProperty("--scale", Number(settings.scale || 0.82));
  scaleInput.value = Math.round(Number(settings.scale || 0.82) * 100);
  party.classList.toggle("horizontal", settings.layout === "horizontal");
  party.classList.toggle("vertical", settings.layout !== "horizontal");
  layoutSelect.value = settings.layout || "vertical";
}

function renderChip(item) {
  const now = Date.now();
  const readyAt = Number(item.readyAt || 0);
  const remaining = Math.max(0, readyAt - now);
  const cdMs = Math.max(1, Number(item.cooldown || 1) * 1000);
  const progress = remaining > 0 ? `${Math.round(360 - (remaining / cdMs) * 360)}deg` : "360deg";
  const icon = item.icon ? `<img src="${asset(item.icon)}" onerror="this.remove()" />` : "";
  const kind = item.kind === "ultimate" ? "ultimate" : "relic";
  const unknown = item.unknown ? "unknown" : "";
  return `
    <div class="chip ${kind} ${unknown} ${remaining > 0 ? "cooldown" : "ready"}" title="${item.name || ""} - ${item.cooldown || 0}s" data-ready-at="${readyAt}" data-cooldown="${Number(item.cooldown || 1)}" style="--progress:${progress}">
      ${icon}
      <span class="mask"></span>
      <span class="timer">${remaining > 0 ? fmt(remaining) : ""}</span>
    </div>
  `;
}

function updateCooldowns() {
  clearTimeout(cooldownTimer);
  let hasActiveCooldown = false;

  for (const chip of party.querySelectorAll(".chip")) {
    const readyAt = Number(chip.dataset.readyAt || 0);
    const cooldown = Math.max(1, Number(chip.dataset.cooldown || 1));
    const remaining = Math.max(0, readyAt - Date.now());
    const timer = chip.querySelector(".timer");
    const cdMs = cooldown * 1000;
    chip.style.setProperty("--progress", remaining > 0 ? `${Math.round(360 - (remaining / cdMs) * 360)}deg` : "360deg");
    chip.classList.toggle("cooldown", remaining > 0);
    chip.classList.toggle("ready", remaining <= 0);
    if (timer) timer.textContent = remaining > 0 ? fmt(remaining) : "";
    if (remaining > 0) hasActiveCooldown = true;
  }

  if (hasActiveCooldown) {
    cooldownTimer = setTimeout(updateCooldowns, 500);
  }
}

function render() {
  if (!latest) return;
  setSettings(latest.settings);
  if (latest.inactive || !latest.players || latest.players.length === 0) {
    clearTimeout(cooldownTimer);
    party.innerHTML = "";
    source.textContent = latest.inactiveReason || "Aucun groupe actif.";
    return;
  }
  party.innerHTML = (latest.players || []).map((player) => {
    const icons = player.relics || [];
    const hasSpirit = player.spirit
      && Number.isFinite(Number(player.spirit.current))
      && Number.isFinite(Number(player.spirit.max))
      && Number(player.spirit.max) > 0;
    const spirit = hasSpirit
      ? `SPIRIT ${Math.floor(player.spirit.current)} / ${Math.floor(player.spirit.max)}`
      : "";
    return `
      <article class="player-card">
        <div>
          <div class="name">${player.name || "Unknown"}</div>
          ${spirit ? `<div class="spirit">${spirit}</div>` : ""}
        </div>
        <div class="icons">${icons.map(renderChip).join("")}</div>
      </article>
    `;
  }).join("");
  updateCooldowns();
}

async function openSettings(payload = {}) {
  if (!settingsPanel.classList.contains("hidden")) {
    settingsPanel.classList.add("hidden");
    await window.fellowshipOverlay.setClickThrough(true);
    return;
  }

  setSettings(payload.settings || latest?.settings || {});
  settingsPanel.classList.remove("hidden");
  source.textContent = payload.activeLogPath || latest?.filePath || "";
}

window.fellowshipOverlay.onLogData((payload) => {
  if (!payload.ok) {
    source.textContent = payload.error || "Erreur log";
    return;
  }
  latest = payload.data;
  render();
});

window.fellowshipOverlay.onWatchStatus((payload) => {
  source.textContent = payload.activeLogPath || payload.logDirectory || payload.message || "";
});

window.fellowshipOverlay.onOverlayMode((payload) => {
  clickThrough = !!payload.clickThrough;
  toggleClick.textContent = clickThrough ? "Activer interaction" : "Click-through";
});

window.fellowshipOverlay.onOpenSettings(openSettings);
window.fellowshipOverlay.onRefreshState((payload) => {
  source.textContent = payload.message || "";
  refresh.disabled = !!payload.refreshing;
  refresh.textContent = payload.refreshing ? "..." : "Rafraichir";
});

pickFolder.addEventListener("click", async () => {
  const next = await window.fellowshipOverlay.chooseLogDirectory();
  setSettings(next);
});

refresh.addEventListener("click", async () => {
  source.textContent = "Refresh en cours...";
  refresh.disabled = true;
  refresh.textContent = "...";
  try {
    await window.fellowshipOverlay.refresh();
  } finally {
    refresh.disabled = false;
    refresh.textContent = "Rafraichir";
  }
});

toggleClick.addEventListener("click", async () => {
  await window.fellowshipOverlay.setClickThrough(!clickThrough);
});

closeSettings.addEventListener("click", async () => {
  settingsPanel.classList.add("hidden");
  await window.fellowshipOverlay.setClickThrough(true);
});

scaleInput.addEventListener("input", async () => {
  const scale = Number(scaleInput.value) / 100;
  root.style.setProperty("--scale", scale);
  await window.fellowshipOverlay.saveSettings({ scale });
});

layoutSelect.addEventListener("change", async () => {
  party.classList.toggle("horizontal", layoutSelect.value === "horizontal");
  party.classList.toggle("vertical", layoutSelect.value !== "horizontal");
  await window.fellowshipOverlay.saveSettings({ layout: layoutSelect.value });
});

party.addEventListener("mousedown", (event) => {
  if (clickThrough) return;
  draggingParty = true;
  dragStart = {
    mouseX: event.clientX,
    mouseY: event.clientY,
    left: parseFloat(party.style.left || "42"),
    top: parseFloat(party.style.top || "110"),
  };
});

settingsPanel.querySelector("header").addEventListener("mousedown", (event) => {
  if (event.target.closest("button")) return;
  draggingSettings = true;
  const rect = settingsPanel.getBoundingClientRect();
  settingsPanel.style.left = `${rect.left}px`;
  settingsPanel.style.top = `${rect.top}px`;
  settingsPanel.style.transform = "none";
  dragStart = {
    mouseX: event.clientX,
    mouseY: event.clientY,
    left: rect.left,
    top: rect.top,
  };
});

window.addEventListener("mousemove", (event) => {
  if (!draggingParty && !draggingSettings) return;
  const target = draggingSettings ? settingsPanel : party;
  const maxX = Math.max(0, window.innerWidth - target.offsetWidth);
  const maxY = Math.max(0, window.innerHeight - target.offsetHeight);
  const x = Math.min(maxX, Math.max(0, dragStart.left + event.clientX - dragStart.mouseX));
  const y = Math.min(maxY, Math.max(0, dragStart.top + event.clientY - dragStart.mouseY));
  target.style.left = `${x}px`;
  target.style.top = `${y}px`;
});

window.addEventListener("mouseup", async () => {
  if (draggingParty) {
    draggingParty = false;
    await window.fellowshipOverlay.saveSettings({
      position: {
        x: parseFloat(party.style.left || "42"),
        y: parseFloat(party.style.top || "110"),
      },
    });
  }

  if (draggingSettings) {
    draggingSettings = false;
    await window.fellowshipOverlay.saveSettings({
      settingsPosition: {
        x: parseFloat(settingsPanel.style.left || "0"),
        y: parseFloat(settingsPanel.style.top || "0"),
      },
    });
  }
});
