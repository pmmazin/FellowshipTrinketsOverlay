const root = document.getElementById("overlay-root");
const party = document.getElementById("party");
const interrupts = document.getElementById("interrupts");
const settingsPanel = document.getElementById("settings");
const source = document.getElementById("source");
const pickFolder = document.getElementById("pickFolder");
const pickInstall = document.getElementById("pickInstall");
const refresh = document.getElementById("refresh");
const updateApp = document.getElementById("updateApp");
const toggleClick = document.getElementById("toggleClick");
const closeSettings = document.getElementById("closeSettings");
const scaleInput = document.getElementById("scale");
const layoutSelect = document.getElementById("layout");
const cursorHalo = document.getElementById("cursorHalo");
const cursorHaloToggle = document.getElementById("cursorHaloToggle");
const closeWithFellowship = document.getElementById("closeWithFellowship");
const cursorHaloSize = document.getElementById("cursorHaloSize");

let latest = null;
let clickThrough = true;
let draggingParty = false;
let draggingSettings = false;
let draggingInterrupts = false;
let dragStart = null;
let cooldownTimer = null;

function asset(path) {
  if (!path) return "";
  const value = String(path).replaceAll("\\", "/");
  if (/^(https?:|data:)/i.test(value)) return value;
  return `../../${value}`;
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
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

function positionInterrupts(settings = {}, playerCount = latest?.players?.length || 0) {
  if (settings.interruptPosition) {
    interrupts.style.left = `${settings.interruptPosition.x}px`;
    interrupts.style.top = `${settings.interruptPosition.y}px`;
    return;
  }
  const pos = settings.position || { x: 42, y: 110 };
  const scale = Number(settings.scale || 0.82);
  const isHorizontal = settings.layout === "horizontal";
  const offset = isHorizontal
    ? 64 * scale
    : Math.max(1, Number(playerCount || 1)) * 64 * scale + 8 * scale;
  interrupts.style.left = `${pos.x}px`;
  interrupts.style.top = `${pos.y + offset}px`;
}

function setSettings(settings = {}) {
  const pos = settings.position || { x: 42, y: 110 };
  party.style.left = `${pos.x}px`;
  party.style.top = `${pos.y}px`;
  positionInterrupts(settings);
  setSettingsPanelPosition(settings);
  root.style.setProperty("--scale", Number(settings.scale || 0.82));
  scaleInput.value = Math.round(Number(settings.scale || 0.82) * 100);
  party.classList.toggle("horizontal", settings.layout === "horizontal");
  party.classList.toggle("vertical", settings.layout !== "horizontal");
  layoutSelect.value = settings.layout || "vertical";
  cursorHaloToggle.checked = settings.cursorHalo === true;
  closeWithFellowship.checked = settings.closeWithFellowship !== false;
  cursorHaloSize.value = Math.round(Number(settings.cursorHaloSize || 48));
  cursorHalo.style.setProperty("--cursor-size", `${Number(settings.cursorHaloSize || 48)}px`);
  cursorHalo.classList.toggle("disabled", settings.cursorHalo !== true);
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
    <div class="chip ${kind} ${unknown} ${remaining > 0 ? "cooldown" : "ready"}" title="${escapeHtml(item.name || "")} - ${item.cooldown || 0}s" data-ready-at="${readyAt}" data-cooldown="${Number(item.cooldown || 1)}" style="--progress:${progress}">
      ${icon}
      <span class="mask"></span>
      <span class="timer">${remaining > 0 ? fmt(remaining) : ""}</span>
    </div>
  `;
}

function renderInterrupt(item) {
  const now = Date.now();
  const readyAt = Number(item.readyAt || 0);
  const cooldown = Number(item.cooldown || 0);
  const remaining = Math.max(0, readyAt - now);
  const icon = item.icon ? `<img src="${asset(item.icon)}" onerror="this.remove()" />` : "";
  const timerText = remaining > 0 ? fmt(remaining) : (cooldown > 0 ? "OK" : "?");
  return `
    <article class="interrupt-item ${item.missed ? "missed" : ""}" data-ready-at="${readyAt}" data-cooldown="${cooldown}">
      <div class="interrupt-icon">${icon || "!"}</div>
      <div class="interrupt-body">
        <div class="interrupt-line">
          <strong>${escapeHtml(item.playerName)}</strong>
          <span>${escapeHtml(item.abilityName)}</span>
        </div>
        <div class="interrupt-target">
          ${escapeHtml(item.interruptedName)}
          ${item.targetName ? `<span>sur ${escapeHtml(item.targetName)}</span>` : ""}
        </div>
      </div>
      <div class="interrupt-cd">CD ${timerText}</div>
    </article>
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

  for (const item of interrupts.querySelectorAll(".interrupt-item")) {
    const readyAt = Number(item.dataset.readyAt || 0);
    const cooldown = Number(item.dataset.cooldown || 0);
    const remaining = Math.max(0, readyAt - Date.now());
    const timer = item.querySelector(".interrupt-cd");
    item.classList.toggle("cooldown", remaining > 0);
    if (timer) timer.textContent = `CD ${remaining > 0 ? fmt(remaining) : (cooldown > 0 ? "OK" : "?")}`;
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
    interrupts.innerHTML = "";
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
          <div class="name">${escapeHtml(player.name || "Unknown")}</div>
          ${spirit ? `<div class="spirit">${spirit}</div>` : ""}
        </div>
        <div class="icons">${icons.map(renderChip).join("")}</div>
      </article>
    `;
  }).join("");
  interrupts.innerHTML = (latest.interrupts || []).map(renderInterrupt).join("");
  positionInterrupts(latest.settings, latest.players?.length || 0);
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

window.fellowshipOverlay.onUpdateState((payload) => {
  source.textContent = payload.message || "";
  updateApp.disabled = !!payload.updating;
  updateApp.textContent = payload.updating ? "Telechargement..." : "Mise a jour";
});

window.fellowshipOverlay.onCursorPosition((payload) => {
  if (!payload.visible || cursorHalo.classList.contains("disabled")) {
    cursorHalo.classList.add("hidden");
    return;
  }
  cursorHalo.classList.remove("hidden");
  cursorHalo.style.transform = `translate(${Math.round(payload.x)}px, ${Math.round(payload.y)}px)`;
});

pickFolder.addEventListener("click", async () => {
  const next = await window.fellowshipOverlay.chooseLogDirectory();
  setSettings(next);
});

pickInstall.addEventListener("click", async () => {
  const next = await window.fellowshipOverlay.chooseInstallDirectory();
  setSettings(next);
  source.textContent = next.updateInstallDir ? `Installation : ${next.updateInstallDir}` : "Dossier installation non change.";
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

updateApp.addEventListener("click", async () => {
  updateApp.disabled = true;
  updateApp.textContent = "Verification...";
  source.textContent = "Recherche d'une mise a jour...";
  try {
    const result = await window.fellowshipOverlay.updateApp();
    source.textContent = result.message || "Mise a jour terminee.";
  } catch (error) {
    source.textContent = error?.message || "Erreur pendant la mise a jour.";
  } finally {
    updateApp.disabled = false;
    updateApp.textContent = "Mise a jour";
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

cursorHaloToggle.addEventListener("change", async () => {
  cursorHalo.classList.toggle("disabled", !cursorHaloToggle.checked);
  if (!cursorHaloToggle.checked) cursorHalo.classList.add("hidden");
  await window.fellowshipOverlay.saveSettings({ cursorHalo: cursorHaloToggle.checked });
});

closeWithFellowship.addEventListener("change", async () => {
  await window.fellowshipOverlay.saveSettings({ closeWithFellowship: closeWithFellowship.checked });
});

cursorHaloSize.addEventListener("input", async () => {
  const size = Number(cursorHaloSize.value);
  cursorHalo.style.setProperty("--cursor-size", `${size}px`);
  await window.fellowshipOverlay.saveSettings({ cursorHaloSize: size });
});

party.addEventListener("mousedown", (event) => {
  if (clickThrough) return;
  if (event.target.closest("#interrupts")) return;
  draggingParty = true;
  dragStart = {
    mouseX: event.clientX,
    mouseY: event.clientY,
    left: parseFloat(party.style.left || "42"),
    top: parseFloat(party.style.top || "110"),
  };
});

interrupts.addEventListener("mousedown", (event) => {
  if (clickThrough) return;
  draggingInterrupts = true;
  const rect = interrupts.getBoundingClientRect();
  interrupts.style.left = `${rect.left}px`;
  interrupts.style.top = `${rect.top}px`;
  dragStart = {
    mouseX: event.clientX,
    mouseY: event.clientY,
    left: rect.left,
    top: rect.top,
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
  if (!draggingParty && !draggingSettings && !draggingInterrupts) return;
  const target = draggingSettings ? settingsPanel : draggingInterrupts ? interrupts : party;
  const maxX = Math.max(0, window.innerWidth - target.offsetWidth);
  const maxY = Math.max(0, window.innerHeight - target.offsetHeight);
  const x = Math.min(maxX, Math.max(0, dragStart.left + event.clientX - dragStart.mouseX));
  const y = Math.min(maxY, Math.max(0, dragStart.top + event.clientY - dragStart.mouseY));
  target.style.left = `${x}px`;
  target.style.top = `${y}px`;
  if (draggingParty && !latest?.settings?.interruptPosition) {
    positionInterrupts({
      ...(latest?.settings || {}),
      position: { x, y },
    }, latest?.players?.length || 0);
  }
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

  if (draggingInterrupts) {
    draggingInterrupts = false;
    await window.fellowshipOverlay.saveSettings({
      interruptPosition: {
        x: parseFloat(interrupts.style.left || "42"),
        y: parseFloat(interrupts.style.top || "110"),
      },
    });
  }
});
