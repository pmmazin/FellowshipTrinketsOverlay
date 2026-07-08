const { app, BrowserWindow, globalShortcut, ipcMain, dialog, screen } = require("electron");
const { execFile, spawn } = require("child_process");
const fs = require("fs");
const https = require("https");
const path = require("path");

const DEFAULT_LOG_DIR = "F:\\SteamLibrary\\steamapps\\common\\Fellowship\\fellowship\\Saved\\CombatLogs";
const SETTINGS_FILE = () => path.join(app.getPath("userData"), "settings.json");
const DEBUG_LOG = path.join(__dirname, "..", "..", "debug-startup.log");
const MAX_PARSE_BYTES = 4 * 1024 * 1024;
const INITIAL_SCAN_BYTES = 64 * 1024 * 1024;
const ACTIVE_LOG_MAX_AGE_MS = 30 * 60 * 1000;
const MAX_INTERRUPTS = 4;
const UPDATE_REPO = "pmmazin/FellowshipTrinketsOverlay";
const INTERRUPT_COOLDOWN_FALLBACKS = {
  512: 23,
  976: 12,
  1019: 20,
  1116: 12,
  1200: 12,
  1226: 16,
  1244: 20,
  1263: 20,
  1308: 20,
  1844: 12,
};

let win;
let watcher;
let activeLogPath = null;
let parseTimer = null;
let cursorTimer = null;
let processMonitorTimer = null;
let fellowshipSeenThisSession = false;
let missingFellowshipChecks = 0;
let clickThrough = true;
let settings = {};
let lastData = null;
let lastSentSignature = "";
let catalogCache = null;
let iconCache = new Map();
let parseState = null;

app.commandLine.appendSwitch("disable-gpu");
app.commandLine.appendSwitch("disable-gpu-compositing");

function debug(message) {
  try {
    fs.appendFileSync(DEBUG_LOG, `${new Date().toISOString()} ${message}\n`, "utf8");
  } catch {
  }
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function compareVersions(left, right) {
  const a = String(left || "0").replace(/^v/i, "").split(".").map((part) => Number(part) || 0);
  const b = String(right || "0").replace(/^v/i, "").split(".").map((part) => Number(part) || 0);
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const diff = (a[index] || 0) - (b[index] || 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

function requestJson(url) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      headers: {
        "User-Agent": "FellowshipTrinketsOverlay",
        Accept: "application/vnd.github+json",
      },
    }, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
        response.resume();
        requestJson(response.headers.location).then(resolve, reject);
        return;
      }
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`GitHub a repondu ${response.statusCode}.`));
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(error);
        }
      });
    });
    request.on("error", reject);
  });
}

function downloadFile(url, destination, onProgress) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destination);
    let settled = false;

    const fail = (error) => {
      if (settled) return;
      settled = true;
      file.close(() => {
        fs.rm(destination, { force: true }, () => reject(error));
      });
    };

    const request = https.get(url, {
      headers: {
        "User-Agent": "FellowshipTrinketsOverlay",
        Accept: "application/octet-stream",
      },
    }, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
        response.resume();
        file.close(() => {
          fs.rm(destination, { force: true }, () => {
            downloadFile(response.headers.location, destination, onProgress).then(resolve, reject);
          });
        });
        return;
      }
      if (response.statusCode < 200 || response.statusCode >= 300) {
        response.resume();
        fail(new Error(`Telechargement impossible (${response.statusCode}).`));
        return;
      }

      const total = Number(response.headers["content-length"] || 0);
      let received = 0;
      response.on("data", (chunk) => {
        received += chunk.length;
        if (total > 0) onProgress?.(received, total);
      });
      response.pipe(file);
      file.on("finish", () => {
        if (settled) return;
        settled = true;
        file.close(() => resolve(destination));
      });
    });

    request.on("error", fail);
    file.on("error", fail);
  });
}

function selectUpdateAsset(release) {
  const assets = Array.isArray(release?.assets) ? release.assets : [];
  return assets.find((asset) => /FellowshipTrinketsOverlay.*win.*\.(zip|exe)$/i.test(asset.name))
    || assets.find((asset) => /FellowshipTrinketsOverlay.*\.(zip|exe)$/i.test(asset.name))
    || assets.find((asset) => /\.(zip|exe)$/i.test(asset.name));
}

function isProcessRunning(imageName) {
  return new Promise((resolve) => {
    execFile("tasklist.exe", ["/FI", `IMAGENAME eq ${imageName}`, "/NH"], { windowsHide: true }, (error, stdout) => {
      if (error) {
        resolve(false);
        return;
      }
      resolve(String(stdout || "").toLowerCase().includes(imageName.toLowerCase()));
    });
  });
}

function getDefaultInstallDir() {
  return app.isPackaged ? path.dirname(process.execPath) : path.join(app.getPath("documents"), "FellowshipTrinketsOverlay");
}

function getInstalledExePath(installDir = getDefaultInstallDir()) {
  return path.join(installDir, "FellowshipTrinketsOverlay.exe");
}

function quotePowerShellString(value) {
  return String(value || "").replaceAll("'", "''");
}

function writePortableUpdaterScript(archivePath, installDir) {
  const scriptPath = path.join(app.getPath("userData"), "portable-update.ps1");
  const exePath = getInstalledExePath(installDir);
  const script = `
$ErrorActionPreference = "Stop"
$archivePath = '${quotePowerShellString(archivePath)}'
$installDir = '${quotePowerShellString(installDir)}'
$exePath = '${quotePowerShellString(exePath)}'
$pidToWait = ${process.pid}
$extractDir = Join-Path ([System.IO.Path]::GetTempPath()) ("FellowshipTrinketsOverlay-update-" + [System.Guid]::NewGuid().ToString("N"))

try {
  Wait-Process -Id $pidToWait -Timeout 60 -ErrorAction SilentlyContinue
  if (!(Test-Path -LiteralPath $installDir)) {
    New-Item -ItemType Directory -Force -Path $installDir | Out-Null
  }

  if ($archivePath.ToLowerInvariant().EndsWith(".zip")) {
    New-Item -ItemType Directory -Force -Path $extractDir | Out-Null
    Expand-Archive -LiteralPath $archivePath -DestinationPath $extractDir -Force
    $sourceDir = $extractDir
    $children = @(Get-ChildItem -LiteralPath $extractDir)
    if ($children.Count -eq 1 -and $children[0].PSIsContainer) {
      $sourceDir = $children[0].FullName
    }
    Copy-Item -Path (Join-Path $sourceDir "*") -Destination $installDir -Recurse -Force
  } elseif ($archivePath.ToLowerInvariant().EndsWith(".exe")) {
    Copy-Item -LiteralPath $archivePath -Destination $exePath -Force
  } else {
    throw "Format de mise a jour non supporte : $archivePath"
  }

  if (Test-Path -LiteralPath $exePath) {
    Start-Process -FilePath $exePath -WorkingDirectory $installDir
  } else {
    Start-Process explorer.exe -ArgumentList $installDir
  }
} catch {
  $message = $_.Exception.Message
  Add-Type -AssemblyName PresentationFramework
  [System.Windows.MessageBox]::Show("La mise a jour a echoue : $message", "Fellowship Trinkets Overlay") | Out-Null
  Start-Process explorer.exe -ArgumentList $installDir
} finally {
  if (Test-Path -LiteralPath $extractDir) {
    Remove-Item -LiteralPath $extractDir -Recurse -Force -ErrorAction SilentlyContinue
  }
}
`;
  fs.writeFileSync(scriptPath, script.trimStart(), "utf8");
  return scriptPath;
}

function launchPortableUpdater(archivePath, installDir) {
  const scriptPath = writePortableUpdaterScript(archivePath, installDir);
  spawn("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    scriptPath,
  ], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  }).unref();
}

function loadSettings() {
  settings = readJson(SETTINGS_FILE(), {});
  settings.logDirectory = settings.logDirectory || DEFAULT_LOG_DIR;
  settings.position = settings.position || { x: 42, y: 110 };
  settings.scale = Number(settings.scale || 0.82);
  settings.layout = settings.layout || "vertical";
  settings.activeLogMaxAgeMs = Math.max(Number(settings.activeLogMaxAgeMs || ACTIVE_LOG_MAX_AGE_MS), ACTIVE_LOG_MAX_AGE_MS);
  settings.clickThrough = settings.clickThrough !== false;
  settings.learnedTrinketActivationMap = settings.learnedTrinketActivationMap || {};
  settings.interruptPosition = settings.interruptPosition || null;
  settings.cursorHalo = settings.cursorHalo === true;
  settings.cursorHaloSize = Number(settings.cursorHaloSize || 48);
  settings.updateInstallDir = settings.updateInstallDir || getDefaultInstallDir();
  settings.closeWithFellowship = settings.closeWithFellowship !== false;
  clickThrough = settings.clickThrough;
}

function saveSettings() {
  fs.mkdirSync(path.dirname(SETTINGS_FILE()), { recursive: true });
  fs.writeFileSync(SETTINGS_FILE(), JSON.stringify(settings, null, 2), "utf8");
}

function isLogFile(fileName) {
  return /^CombatLog.*\.(txt|log)$/i.test(path.basename(String(fileName || "")));
}

function getLatestLog(logDir) {
  try {
    return fs.readdirSync(logDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && isLogFile(entry.name))
      .map((entry) => {
        const fullPath = path.join(logDir, entry.name);
        return { fullPath, mtimeMs: fs.statSync(fullPath).mtimeMs };
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs)[0]?.fullPath || null;
  } catch {
    return null;
  }
}

function splitTopLevelTuples(value) {
  const text = String(value || "").trim();
  const tuples = [];
  let depth = 0;
  let start = -1;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === "(") {
      if (depth === 0) start = index;
      depth += 1;
    } else if (char === ")") {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        tuples.push(text.slice(start + 1, index));
        start = -1;
      }
    }
  }
  return tuples;
}

function parseNumberList(value) {
  const match = String(value || "").match(/^\[(.*)\]$/);
  if (!match || !match[1].trim()) return [];
  return match[1]
    .split(",")
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isFinite(item) && item > 0);
}

function parseStatList(value) {
  const match = String(value || "").match(/^\[(.*)\]$/);
  if (!match || !match[1].trim()) return [];
  return match[1]
    .split(",")
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isFinite(item));
}

function parseStats(value) {
  const stats = parseStatList(value);
  const spiritCurrent = Number(stats[2]);
  const spiritMax = Number(stats[3]);
  return {
    health: stats[0] || 0,
    spirit: spiritMax >= 80 && spiritMax <= 200 && spiritCurrent >= 0 && spiritCurrent <= spiritMax
      ? { current: spiritCurrent, max: spiritMax, type: "stats" }
      : null,
  };
}

function loadCatalog() {
  if (catalogCache) return catalogCache;
  const root = path.join(__dirname, "..", "..");
  const skills = readJson(path.join(root, "data", "skills.json"), {});
  const tooltips = readJson(
    path.join(__dirname, "..", "..", "..", "FS_ovelay_reference", "fix", "fixes", "05-tooltips-and-skill-catalog", "src", "main", "services", "ability-tooltips.json"),
    {},
  );
  const relicData = readJson(path.join(root, "data", "relics.json"), { relics: {}, item_mapping: {} });
  const trinketData = readJson(path.join(root, "data", "trinkets.json"), { trinket_ids: [], trinkets: {} });
  const interruptData = readJson(path.join(root, "data", "interrupts.json"), { interrupts: {} });
  const abilities = new Map();

  for (const [classId, classSkills] of Object.entries(skills)) {
    for (const [abilityId, cooldown] of Object.entries(classSkills || {})) {
      abilities.set(String(Number(abilityId)), {
        id: Number(abilityId),
        classId: Number(classId),
        cooldown: Number(cooldown) || 0,
      });
    }
  }

  const configuredActivationMap = Object.fromEntries(
    Object.entries(trinketData.trinkets || {}).flatMap(([itemId, item]) => (
      (item.activation_ids || []).map((activationId) => [String(Number(activationId)), Number(itemId)])
    )),
  );
  const learnedActivationMap = Object.fromEntries(
    Object.entries(settings.learnedTrinketActivationMap || {})
      .map(([activationId, itemId]) => [String(Number(activationId)), Number(itemId)])
      .filter(([activationId, itemId]) => activationId !== "NaN" && itemId > 0),
  );

  catalogCache = {
    root,
    skills,
    tooltips,
    abilities,
    relics: relicData.relics || {},
    itemMapping: relicData.item_mapping || {},
    trinketIds: new Set((trinketData.trinket_ids || []).map((id) => Number(id)).filter(Boolean)),
    trinkets: trinketData.trinkets || {},
    interrupts: interruptData.interrupts || {},
    learnedTrinketActivationMap: learnedActivationMap,
    trinketActivationMap: { ...learnedActivationMap, ...configuredActivationMap },
  };
  return catalogCache;
}

function findHeroAbilityIcon(root, classId, abilityId) {
  const cacheKey = `${Number(classId)}:${Number(abilityId)}`;
  if (iconCache.has(cacheKey)) return iconCache.get(cacheKey);
  const heroesDir = path.join(root, "Heroes");
  try {
    const heroDir = fs.readdirSync(heroesDir, { withFileTypes: true })
      .find((entry) => entry.isDirectory() && entry.name.startsWith(`${Number(classId)}_`));
    if (!heroDir) return null;
    const heroPath = path.join(heroesDir, heroDir.name);
    const file = fs.readdirSync(heroPath).find((name) => name.startsWith(`${Number(abilityId)}_`));
    const icon = file ? path.join("Heroes", heroDir.name, file).replace(/\\/g, "/") : null;
    iconCache.set(cacheKey, icon);
    return icon;
  } catch {
    iconCache.set(cacheKey, null);
    return null;
  }
}

function nameFromIcon(iconPath, fallback) {
  if (!iconPath) return fallback;
  return path.basename(iconPath).replace(/^\d+[_-]?/, "").replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ");
}

function splitTupleFields(value) {
  const fields = [];
  let current = "";
  let inQuote = false;
  for (const char of String(value || "")) {
    if (char === '"') {
      inQuote = !inQuote;
      current += char;
    } else if (char === "," && !inQuote) {
      fields.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields.map((field) => field.trim());
}

function unquote(value) {
  return String(value || "").replace(/^"|"$/g, "");
}

function parseCombatantAbilities(value) {
  return splitTopLevelTuples(value)
    .map((tuple) => {
      const [abilityId, cooldown] = tuple.split(",", 2);
      return {
        id: Number(abilityId),
        cooldown: Number(cooldown) || 0,
      };
    })
    .filter((ability) => ability.id > 0);
}

function parseCombatantEquipment(value) {
  return splitTopLevelTuples(value)
    .map((tuple) => {
      const fields = splitTupleFields(tuple);
      return {
        id: Number(fields[0]),
        cooldown: Number(fields[1]) || 0,
      };
    })
    .filter((item) => item.id > 0);
}

function getTrinketActivationIds(catalog, itemId) {
  const id = Number(itemId);
  const trinket = catalog.trinkets[String(id)] || {};
  const configured = (trinket.activation_ids || []).map((activationId) => Number(activationId)).filter(Boolean);
  const learned = Object.entries(catalog.learnedTrinketActivationMap || {})
    .filter(([, mappedItemId]) => Number(mappedItemId) === id)
    .map(([activationId]) => Number(activationId))
    .filter(Boolean);
  return Array.from(new Set([...configured, ...learned]));
}

function getTrinketMeta(catalog, itemId) {
  const id = Number(itemId);
  if (!catalog.trinketIds?.has(id)) return null;
  const trinket = catalog.trinkets[String(id)] || {};
  const activationCooldown = getTrinketActivationIds(catalog, id)
    .map((activationId) => Number(catalog.relics[String(Number(activationId))]?.base_cooldown) || 0)
    .find((cooldown) => cooldown > 0) || 0;
  return {
    id,
    itemId: id,
    name: trinket.name || `Trinket ${id}`,
    cooldown: Number(trinket.cooldown) || activationCooldown,
    icon: trinket.icon || null,
  };
}

function getCanonicalRelicId(catalog, rawId) {
  if (rawId == null) return null;
  const key = String(Number(rawId));
  return catalog.itemMapping[key] || (catalog.relics[key] ? Number(key) : null);
}

function getRelicMetaByAnyId(catalog, rawId) {
  const canonicalId = getCanonicalRelicId(catalog, rawId);
  if (canonicalId == null) return null;
  const relic = catalog.relics[String(canonicalId)];
  if (!relic) return null;
  return {
    id: Number(canonicalId),
    name: relic.name || `Relic ${canonicalId}`,
    cooldown: Number(relic.base_cooldown) || 0,
    icon: relic.icon || null,
  };
}

function extractRelicsFromCombatantInfo(catalog, parts) {
  const found = new Map();
  for (const part of parts) {
    if (typeof part !== "string" || !part.includes("(")) continue;
    for (const match of part.matchAll(/\((\d+),/g)) {
      const relic = getRelicMetaByAnyId(catalog, Number(match[1]));
      if (relic) found.set(relic.id, relic);
    }
  }
  return Array.from(found.values());
}

function makeUnknownRelic(rawId) {
  const id = Number(rawId);
  if (!id) return null;
  return {
    id,
    itemId: id,
    name: `Trinket ${id}`,
    cooldown: 0,
    icon: null,
    readyAt: 0,
    shortLabel: String(id),
    unknown: true,
    kind: "relic",
  };
}

function makeEffectRelic(effectId, effectName) {
  const id = Number(effectId);
  if (!id) return null;
  return {
    id,
    itemId: id,
    name: effectName || `Trinket ${id}`,
    cooldown: 0,
    icon: null,
    readyAt: 0,
    shortLabel: String(id),
    unknown: true,
    kind: "relic",
  };
}

function extractEquippedEffectRelics(playerId, parts) {
  return splitTopLevelTuples(parts[14])
    .map((tuple) => {
      const fields = splitTupleFields(tuple);
      const sourceId = fields[0];
      const effectId = Number(fields[2]);
      const effectName = unquote(fields[3]);
      const duration = Number(fields[4]);
      const effectType = unquote(fields[6]);
      if (sourceId !== playerId || duration !== -1 || effectType !== "BUFF") return null;
      return makeEffectRelic(effectId, effectName);
    })
    .filter(Boolean);
}

function extractEquippedRelics(catalog, parts) {
  const found = new Map();

  for (const item of parseCombatantEquipment(parts[11])) {
    const meta = getTrinketMeta(catalog, item.id);
    if (!meta) continue;
    found.set(String(meta.id), {
      id: meta.id,
      itemId: meta.itemId,
      name: meta.name,
      cooldown: meta.cooldown,
      icon: meta.icon,
      readyAt: 0,
      shortLabel: "",
      unknown: !meta.icon,
      kind: "relic",
    });
  }

  return Array.from(found.values());
}

function parseStoneValues(raw) {
  return parseStatList(raw).map((value) => Number(value) || 0);
}

function parseStones(raw) {
  const values = parseStoneValues(raw);
  return {
    raw: values,
    blue: values[4] || 0,
    green: values[2] || 0,
    white: values[1] || 0,
  };
}

function getRelicCooldownModifier(player) {
  const whiteStone = Number(player?.stones?.white || 0);
  if (whiteStone >= 2640) return 0.76;
  if (whiteStone >= 960) return 0.92;
  return 1;
}

function makeAbilityItem(catalog, classId, abilityId, abilityName, cooldown = 0) {
  const id = Number(abilityId);
  if (!id) return null;
  const icon = findHeroAbilityIcon(catalog.root, classId, id);
  return {
    id,
    name: abilityName || catalog.tooltips[String(id)]?.name || nameFromIcon(icon, `Ability ${id}`),
    cooldown: Number(cooldown) || 0,
    icon,
    readyAt: 0,
    kind: "ultimate",
  };
}

function makeInterruptItem(catalog, player, parts) {
  const stamp = Date.parse(parts[0]) || Date.now();
  const abilityId = Number(parts[6]);
  const abilityName = unquote(parts[7]);
  const interruptedId = Number(parts[8]);
  const interruptedName = unquote(parts[9]);
  const sourceName = unquote(parts[3]) || player?.name || "Unknown";
  const targetName = unquote(parts[5]) || "Unknown";
  const meta = getInterruptMeta(catalog, player, abilityId);

  return {
    id: `${stamp}:${parts[2]}:${abilityId}:${interruptedId}`,
    playerId: parts[2],
    playerName: sourceName,
    targetName,
    abilityId,
    abilityName: abilityName || meta.name || `Interrupt ${abilityId}`,
    interruptedId,
    interruptedName: interruptedName || `Sort ${interruptedId}`,
    cooldown: meta.cooldown,
    readyAt: meta.cooldown > 0 ? stamp + meta.cooldown * 1000 : 0,
    icon: meta.icon,
    at: stamp,
  };
}

function makeInterruptUseItem(catalog, player, parts) {
  const stamp = Date.parse(parts[0]) || Date.now();
  const abilityId = Number(parts[4]);
  const abilityName = unquote(parts[5]);
  const sourceName = unquote(parts[3]) || player?.name || "Unknown";
  const targetName = unquote(parts[8]) || "";
  const meta = getInterruptMeta(catalog, player, abilityId);

  return {
    id: `${stamp}:${parts[2]}:${abilityId}:use`,
    playerId: parts[2],
    playerName: sourceName,
    targetName,
    abilityId,
    abilityName: abilityName || meta.name || `Interrupt ${abilityId}`,
    interruptedId: 0,
    interruptedName: "Aucun sort interrompu",
    cooldown: meta.cooldown,
    readyAt: meta.cooldown > 0 ? stamp + meta.cooldown * 1000 : 0,
    icon: meta.icon,
    at: stamp,
    missed: true,
  };
}

function getInterruptMeta(catalog, player, abilityId) {
  const id = Number(abilityId);
  const configured = catalog.interrupts?.[String(id)] || {};
  const knownAbility = catalog.abilities.get(String(id));
  const classId = Number(player?.classId || knownAbility?.classId || 0);
  const fallbackIcon = classId ? findHeroAbilityIcon(catalog.root, classId, id) : null;
  const configuredCooldown = Number(configured.cooldown);
  const cooldown = Number.isFinite(configuredCooldown) && configuredCooldown > 0
    ? configuredCooldown
    : getAbilityCooldown(player, catalog, id) || INTERRUPT_COOLDOWN_FALLBACKS[id] || 0;

  return {
    name: configured.name || catalog.tooltips[String(id)]?.name || null,
    cooldown,
    icon: configured.icon || fallbackIcon,
  };
}

function addInterrupt(state, interrupt) {
  if (!interrupt || !interrupt.abilityId) return;
  const duplicateIndex = state.interrupts.findIndex((item) => (
    item.playerId === interrupt.playerId
    && Number(item.abilityId) === Number(interrupt.abilityId)
    && Math.abs(Number(item.at || 0) - Number(interrupt.at || 0)) < 1500
  ));
  if (duplicateIndex >= 0) {
    state.interrupts[duplicateIndex] = {
      ...state.interrupts[duplicateIndex],
      ...interrupt,
      readyAt: state.interrupts[duplicateIndex].readyAt || interrupt.readyAt,
      cooldown: state.interrupts[duplicateIndex].cooldown || interrupt.cooldown,
    };
    return;
  }
  state.interrupts.unshift(interrupt);
  if (state.interrupts.length > MAX_INTERRUPTS) {
    state.interrupts.length = MAX_INTERRUPTS;
  }
}

function isKnownInterruptAbility(catalog, abilityId) {
  const id = Number(abilityId);
  return !!catalog.interrupts?.[String(id)] || !!INTERRUPT_COOLDOWN_FALLBACKS[id];
}

function makeRelicItem(catalog, abilityId, abilityName, readyAt = 0) {
  const meta = getRelicMetaByAnyId(catalog, abilityId);
  if (!meta) return null;
  return {
    id: meta.id,
    itemId: Number(abilityId),
    name: abilityName || meta.name,
    cooldown: meta.cooldown,
    icon: meta.icon,
    readyAt,
    shortLabel: "",
    unknown: false,
    kind: "relic",
  };
}

function hasKnownTrinketActivation(catalog, itemId) {
  return getTrinketActivationIds(catalog, itemId).length > 0;
}

function getLearnableEquippedTrinket(player, catalog, abilityId) {
  const activationId = String(Number(abilityId));
  if (!catalog.relics[activationId]) return null;
  const candidates = (player?.relics || []).filter((relic) => (
    catalog.trinketIds?.has(Number(relic.itemId || relic.id))
    && !hasKnownTrinketActivation(catalog, relic.itemId || relic.id)
  ));
  return candidates.length === 1 ? candidates[0] : null;
}

function learnTrinketActivation(player, catalog, abilityId) {
  const activationId = String(Number(abilityId));
  const relic = getLearnableEquippedTrinket(player, catalog, abilityId);
  if (!relic) return null;
  const itemId = Number(relic.itemId || relic.id);
  const activationMeta = catalog.relics[activationId];
  const cooldown = Number(activationMeta?.base_cooldown) || 0;

  catalog.trinketActivationMap[activationId] = itemId;
  catalog.learnedTrinketActivationMap[activationId] = itemId;
  settings.learnedTrinketActivationMap = settings.learnedTrinketActivationMap || {};
  if (Number(settings.learnedTrinketActivationMap[activationId]) !== itemId) {
    settings.learnedTrinketActivationMap[activationId] = itemId;
    saveSettings();
    debug(`learned trinket activation ${activationId} -> ${itemId}`);
  }

  relic.cooldown = cooldown;
  relic.name = relic.name || activationMeta?.name || `Trinket ${itemId}`;
  return relic;
}

function shouldTrackAsRelic(player, catalog, abilityId, abilityName) {
  const name = String(abilityName || "");
  if (!player || !Number(abilityId) || /^Mount\b/i.test(name)) return false;
  return !!getEquippedRelicByAnyId(player, catalog, abilityId) || !!getLearnableEquippedTrinket(player, catalog, abilityId);
}

function putRelicOnCooldown(player, catalog, abilityId, abilityName, stamp) {
  const existing = getEquippedRelicByAnyId(player, catalog, abilityId) || learnTrinketActivation(player, catalog, abilityId);
  const item = existing ? null : makeRelicItem(catalog, abilityId, abilityName, 0);
  const relic = existing || item;
  if (!relic) return;
  const cooldown = Number(relic.cooldown || item?.cooldown || 0);
  if (item) {
    relic.name = item.name;
    relic.icon = item.icon;
    relic.shortLabel = item.shortLabel;
    relic.unknown = item.unknown;
  }
  relic.cooldown = cooldown;
  relic.readyAt = cooldown > 0 ? stamp + cooldown * 1000 : 0;
  if (!existing) player.relics.push(relic);
}

function getEquippedRelicByAnyId(player, catalog, rawId) {
  if (!player?.relics?.length) return null;
  const direct = player.relics.find((relic) => (
    Number(relic.id) === Number(rawId)
    || Number(relic.itemId) === Number(rawId)
  ));
  if (direct) return direct;
  const mappedTrinketId = Number(catalog.trinketActivationMap?.[String(Number(rawId))] || 0);
  if (mappedTrinketId) {
    const mapped = player.relics.find((relic) => (
      Number(relic.id) === mappedTrinketId
      || Number(relic.itemId) === mappedTrinketId
    ));
    if (mapped) return mapped;
  }
  const canonicalId = getCanonicalRelicId(catalog, rawId);
  if (canonicalId == null) return null;
  return player.relics.find((relic) => Number(relic.id) === Number(canonicalId)) || null;
}

function getSpiritAbility(catalog, classId, combatantAbilities = []) {
  const classSkills = catalog.skills[String(Number(classId))] || {};
  const catalogAbilities = Object.entries(classSkills)
    .map(([abilityId, cooldown]) => ({
      id: Number(abilityId),
      cooldown: Number(cooldown) || 0,
    }))
    .filter((ability) => ability.id > 0);
  const knownIds = new Set(catalogAbilities.map((ability) => ability.id));
  const abilities = [
    ...catalogAbilities,
    ...combatantAbilities.filter((ability) => !knownIds.has(ability.id)),
  ];
  const spiritAbility = abilities.find((ability) => {
    const tooltip = catalog.tooltips[String(ability.id)]?.tooltip || "";
    return /SPIRIT ABILITY|^\s*\d+\s+Spirit\s*$/im.test(tooltip);
  });
  return spiritAbility ? makeAbilityItem(catalog, classId, spiritAbility.id, null, spiritAbility.cooldown) : null;
}

function getAbilityCooldown(player, catalog, abilityId) {
  const id = String(Number(abilityId));
  return Number(player?.knownAbilities?.[id] ?? catalog.abilities.get(id)?.cooldown ?? 0) || 0;
}

function parseSourceAbility(parts) {
  const type = parts[1] || "";
  if (type === "ABILITY_ACTIVATED" || type === "ABILITY_CAST_SUCCESS" || type === "ABILITY_CAST_START" || type === "ABILITY_CHANNEL_SUCCESS") {
    return {
      id: Number(parts[4]),
      name: (parts[5] || "").replaceAll('"', ""),
    };
  }

  if (type.startsWith("ABILITY_")) {
    return {
      id: Number(parts[6]),
      name: (parts[7] || "").replaceAll('"', ""),
    };
  }

  if (type.startsWith("EFFECT_")) {
    return {
      id: Number(parts[parts.length - 3]),
      name: (parts[parts.length - 2] || "").replaceAll('"', ""),
    };
  }

  return { id: 0, name: "" };
}

function didSpendSpirit(previous, next) {
  if (!previous || !next) return false;
  if (previous.type !== next.type || previous.max !== next.max) return false;
  return previous.max === 100 && previous.current >= 80 && previous.current - next.current >= 50;
}

function parseResourceChange(parts) {
  return {
    sourceId: parts[2],
    targetId: parts[4],
    type: Number(parts[6]),
    current: Number(parts[8]),
    max: Number(parts[9]),
  };
}

function parseSpiritSnapshot(value) {
  const tuples = splitTopLevelTuples(value)
    .map((item) => item.split(",").map((part) => Number(part.trim())))
    .filter(([type, current, max]) => Number.isFinite(type) && Number.isFinite(current) && Number.isFinite(max) && max === 100);
  const tuple = tuples.find(([type]) => type === 4) || tuples.find(([type]) => type === 2);
  if (!tuple) return null;
  return {
    current: tuple[1],
    max: tuple[2],
    type: tuple[0],
  };
}

function parseSourceSpiritSnapshot(parts) {
  const snapshotField = parts.slice(15).find((part) => String(part || "").startsWith("[("));
  return snapshotField ? parseSpiritSnapshot(snapshotField) : null;
}

function isTrackableSpiritPoints(resource) {
  if (!resource || resource.sourceId !== resource.targetId) return false;
  if (!Number.isFinite(resource.current) || !Number.isFinite(resource.max)) return false;
  if (![2, 4].includes(resource.type) || resource.max !== 100) return false;
  if (resource.current < 0 || resource.current > resource.max) return false;
  return true;
}

function readFileSlice(filePath, start, length) {
  const buffer = Buffer.alloc(length);
  const fd = fs.openSync(filePath, "r");
  try {
    fs.readSync(fd, buffer, 0, length, start);
  } finally {
    fs.closeSync(fd);
  }
  return buffer.toString("utf8");
}

function findInitialReadPosition(filePath, stat) {
  const start = Math.max(0, stat.size - INITIAL_SCAN_BYTES);
  const text = readFileSlice(filePath, start, stat.size - start);
  const dungeonStart = text.lastIndexOf("|DUNGEON_START|");
  const dungeonEnd = text.lastIndexOf("|DUNGEON_END|");
  const combatantInfo = text.lastIndexOf("|COMBATANT_INFO|");

  if (dungeonStart > dungeonEnd) {
    const lineStart = text.lastIndexOf("\n", dungeonStart);
    return {
      offset: start + (lineStart >= 0 ? lineStart + 1 : 0),
      skipPartialFirstLine: false,
    };
  }

  if (combatantInfo > dungeonEnd) {
    return {
      offset: Math.max(0, stat.size - MAX_PARSE_BYTES),
      skipPartialFirstLine: stat.size > MAX_PARSE_BYTES,
    };
  }

  if (dungeonEnd >= 0) {
    const lineStart = text.lastIndexOf("\n", dungeonEnd);
    return {
      offset: start + (lineStart >= 0 ? lineStart + 1 : 0),
      skipPartialFirstLine: false,
    };
  }

  return {
    offset: Math.max(0, stat.size - MAX_PARSE_BYTES),
    skipPartialFirstLine: stat.size > MAX_PARSE_BYTES,
  };
}

function readLogTail(filePath) {
  const stat = fs.statSync(filePath);
  const start = Math.max(0, stat.size - MAX_PARSE_BYTES);
  const length = stat.size - start;
  let text = readFileSlice(filePath, start, length);
  if (start > 0) {
    const firstBreak = text.indexOf("\n");
    text = firstBreak >= 0 ? text.slice(firstBreak + 1) : "";
  }
  return text;
}

function getParseState(filePath, stat) {
  if (!parseState || parseState.filePath !== filePath || stat.size < parseState.offset) {
    const initial = findInitialReadPosition(filePath, stat);
    parseState = {
      filePath,
      offset: initial.offset,
      carry: "",
      players: new Map(),
      interrupts: [],
      activeSession: false,
      skipPartialFirstLine: initial.skipPartialFirstLine,
    };
  }
  parseState.interrupts = parseState.interrupts || [];
  return parseState;
}

function readNewLogLines(filePath, state, stat) {
  if (stat.size <= state.offset) return [];
  const length = stat.size - state.offset;

  let text = state.carry + readFileSlice(filePath, state.offset, length);
  state.offset = stat.size;
  if (state.skipPartialFirstLine) {
    const firstBreak = text.indexOf("\n");
    text = firstBreak >= 0 ? text.slice(firstBreak + 1) : "";
    state.skipPartialFirstLine = false;
  }

  const complete = text.endsWith("\n") || text.endsWith("\r");
  const lines = text.split(/\r?\n/);
  state.carry = complete ? "" : lines.pop() || "";
  return lines;
}

function getEmptyPayload(filePath, reason) {
  return {
    filePath,
    parsedAt: Date.now(),
    partial: true,
    inactive: true,
    inactiveReason: reason,
    settings: {
      position: settings.position,
      scale: settings.scale,
      layout: settings.layout,
      clickThrough,
      interruptPosition: settings.interruptPosition,
      cursorHalo: settings.cursorHalo,
      cursorHaloSize: settings.cursorHaloSize,
      updateInstallDir: settings.updateInstallDir,
      closeWithFellowship: settings.closeWithFellowship,
    },
    players: [],
    interrupts: [],
  };
}

function parseCombatLog(filePath) {
  const catalog = loadCatalog();
  const stat = fs.statSync(filePath);
  const logAgeMs = Date.now() - stat.mtimeMs;
  const activeLogMaxAgeMs = Number(settings.activeLogMaxAgeMs || ACTIVE_LOG_MAX_AGE_MS);
  if (logAgeMs > activeLogMaxAgeMs) {
    return getEmptyPayload(filePath, "Aucune run active detectee.");
  }

  const state = getParseState(filePath, stat);
  const players = state.players;
  const lines = readNewLogLines(filePath, state, stat);

  for (const line of lines) {
    if (!line) continue;
    const parts = line.split("|");
    const type = parts[1];

    if (type === "DUNGEON_START") {
      state.activeSession = true;
      players.clear();
      state.interrupts = [];
      continue;
    }

    if (type === "DUNGEON_END") {
      state.activeSession = false;
      players.clear();
      continue;
    }

    if (type === "ABILITY_INTERRUPT" && parts[2]?.startsWith("Player-")) {
      const player = players.get(parts[2]);
      addInterrupt(state, makeInterruptItem(catalog, player, parts));
      continue;
    }

    if (type === "COMBATANT_INFO" && parts[3]?.startsWith("Player-")) {
      state.activeSession = true;
      const playerId = parts[3];
      const classId = Number(parts[6]) || 0;
      const stats = parseStats(parts[8]);
      const combatantAbilities = parseCombatantAbilities(parts[11]);
      const knownAbilities = Object.fromEntries(combatantAbilities.map((ability) => [String(ability.id), ability.cooldown]));
      const stones = parseStones(parts[10]);
      const existingPlayer = players.get(playerId);
      const visibleRelics = extractEquippedRelics(catalog, parts);
      for (const relic of visibleRelics) {
        const existing = existingPlayer?.relics?.find((item) => (
          Number(item.id) === Number(relic.id)
          || Number(item.itemId) === Number(relic.itemId)
        ));
        if (!existing) continue;
        relic.readyAt = Number(existing.readyAt || 0);
        relic.cooldown = Number(existing.cooldown || relic.cooldown);
      }

      players.set(playerId, {
        id: playerId,
        name: (parts[4] || "").replaceAll('"', "") || "Unknown",
        classId,
        health: stats.health,
        spirit: stats.spirit || {
          current: null,
          max: null,
          type: null,
        },
        relics: visibleRelics,
        stones,
        knownAbilities,
        ultimate: getSpiritAbility(catalog, classId, combatantAbilities),
      });
      continue;
    }

    if (type === "RESOURCE_CHANGED") {
      const resource = parseResourceChange(parts);
      const player = players.get(resource.targetId);
      if (player && isTrackableSpiritPoints(resource)) {
        const resourceSnapshot = { current: resource.current, max: resource.max, type: resource.type };
        const abilityId = Number(parts[11]);
        if (didSpendSpirit(player.spirit, resourceSnapshot) && abilityId > 0) {
          const abilityName = (parts[12] || "").replaceAll('"', "");
          const cooldown = getAbilityCooldown(player, catalog, abilityId);
          const stamp = Date.parse(parts[0]) || Date.now();
          player.ultimate = makeAbilityItem(catalog, player.classId, abilityId, abilityName, cooldown);
          player.ultimate.readyAt = cooldown > 0 ? stamp + cooldown * 1000 : 0;
        }

        if (player.spirit?.type === 4 && resource.type !== 4) continue;
        player.spirit = resourceSnapshot;
      }
      continue;
    }

    if (parts[2]?.startsWith("Player-")) {
      const player = players.get(parts[2]);
      const spiritSnapshot = player ? parseSourceSpiritSnapshot(parts) : null;
      if (spiritSnapshot) {
        const eventAbility = parseSourceAbility(parts);
        if (didSpendSpirit(player.spirit, spiritSnapshot) && eventAbility.id > 0) {
          const cooldown = getAbilityCooldown(player, catalog, eventAbility.id);
          const stamp = Date.parse(parts[0]) || Date.now();
          player.ultimate = makeAbilityItem(catalog, player.classId, eventAbility.id, eventAbility.name, cooldown);
          player.ultimate.readyAt = cooldown > 0 ? stamp + cooldown * 1000 : 0;
        }

        if (!player.spirit?.type || spiritSnapshot.type === 4 || player.spirit.type !== 4) {
          player.spirit = spiritSnapshot;
        }
      }
    }

    if ((type === "ABILITY_ACTIVATED" || type === "ABILITY_CAST_SUCCESS") && parts[2]?.startsWith("Player-")) {
      const player = players.get(parts[2]);
      const abilityId = String(Number(parts[4]));

      if (player) {
        const castName = (parts[5] || "").replaceAll('"', "");
        const stamp = Date.parse(parts[0]) || Date.now();
        if (type === "ABILITY_ACTIVATED" && isKnownInterruptAbility(catalog, abilityId)) {
          addInterrupt(state, makeInterruptUseItem(catalog, player, parts));
        }
        if (player.ultimate && String(player.ultimate.id) === abilityId) {
          player.ultimate.readyAt = stamp + player.ultimate.cooldown * 1000;
        }
        if (shouldTrackAsRelic(player, catalog, abilityId, castName)) {
          putRelicOnCooldown(player, catalog, abilityId, castName, stamp);
        }
      }
    }
  }

  if (!state.activeSession || players.size === 0) {
    return getEmptyPayload(filePath, "Aucun joueur detecte dans le log actif.");
  }

  return {
    filePath,
    parsedAt: Date.now(),
    partial: true,
    settings: {
      position: settings.position,
      scale: settings.scale,
      layout: settings.layout,
      clickThrough,
      interruptPosition: settings.interruptPosition,
      cursorHalo: settings.cursorHalo,
      cursorHaloSize: settings.cursorHaloSize,
      updateInstallDir: settings.updateInstallDir,
      closeWithFellowship: settings.closeWithFellowship,
    },
    players: Array.from(players.values()).slice(-4),
    interrupts: state.interrupts,
  };
}

function setClickThrough(enabled) {
  clickThrough = !!enabled;
  settings.clickThrough = clickThrough;
  saveSettings();
  if (!win) return;
  win.setIgnoreMouseEvents(clickThrough, { forward: true });
  win.webContents.send("overlay-mode", { clickThrough });
}

function updateCursorTracking() {
  clearInterval(cursorTimer);
  cursorTimer = null;
  if (!settings.cursorHalo || !win) {
    win?.webContents.send("cursor-position", { visible: false });
    return;
  }

  cursorTimer = setInterval(() => {
    if (!win || win.isDestroyed()) return;
    const point = screen.getCursorScreenPoint();
    const bounds = win.getBounds();
    const x = point.x - bounds.x;
    const y = point.y - bounds.y;
    const visible = x >= 0 && y >= 0 && x <= bounds.width && y <= bounds.height;
    win.webContents.send("cursor-position", { x, y, visible });
  }, 33);
}

async function checkFellowshipProcess() {
  if (!settings.closeWithFellowship) return;
  const running = await isProcessRunning("fellowship.exe");
  if (running) {
    fellowshipSeenThisSession = true;
    missingFellowshipChecks = 0;
    return;
  }

  if (!fellowshipSeenThisSession) return;
  missingFellowshipChecks += 1;
  if (missingFellowshipChecks >= 2) {
    debug("Fellowship closed, quitting overlay");
    app.quit();
  }
}

function startProcessMonitor() {
  clearInterval(processMonitorTimer);
  processMonitorTimer = setInterval(checkFellowshipProcess, 5000);
  checkFellowshipProcess();
}

function sendData() {
  if (!win) return;
  if (!activeLogPath) {
    win.webContents.send("log-data", { ok: false, error: "Aucun combat log trouve." });
    return;
  }

  try {
    const data = parseCombatLog(activeLogPath);
    if (!data.inactive && (!data.players || data.players.length === 0) && lastData?.players?.length) {
      data.players = lastData.players;
    }
    lastData = data;
    const signature = JSON.stringify({
      inactive: data.inactive,
      reason: data.inactiveReason,
      players: (data.players || []).map((player) => ({
        id: player.id,
        spirit: player.spirit,
        relics: (player.relics || []).map((item) => [item.id, item.itemId, item.readyAt, item.shortLabel]),
        ultimate: player.ultimate ? [player.ultimate.id, player.ultimate.readyAt] : null,
      })),
      interrupts: (data.interrupts || []).map((item) => [item.id, item.readyAt]),
      settings: data.settings,
    });
    if (signature === lastSentSignature) return;
    lastSentSignature = signature;
    win.webContents.send("log-data", { ok: true, data });
  } catch (error) {
    win.webContents.send("log-data", { ok: false, error: error.message || String(error) });
  }
}

function scheduleSend() {
  clearTimeout(parseTimer);
  parseTimer = setTimeout(sendData, 350);
}

function watchLogs() {
  if (watcher) watcher.close();
  activeLogPath = getLatestLog(settings.logDirectory);
  if (activeLogPath) scheduleSend();
  try {
    watcher = fs.watch(settings.logDirectory, (_event, fileName) => {
      if (!isLogFile(fileName)) return;
      const latest = getLatestLog(settings.logDirectory);
      if (latest) activeLogPath = latest;
      scheduleSend();
    });
    win?.webContents.send("watch-status", { ok: true, logDirectory: settings.logDirectory, activeLogPath });
  } catch (error) {
    win?.webContents.send("watch-status", { ok: false, message: error.message || String(error) });
  }
}

function createWindow() {
  const display = require("electron").screen.getPrimaryDisplay().workAreaSize;
  win = new BrowserWindow({
    width: display.width,
    height: display.height,
    x: 0,
    y: 0,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: false,
    resizable: false,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
    },
  });
  win.setAlwaysOnTop(true, "screen-saver");
  win.loadFile(path.join(__dirname, "..", "renderer", "index.html"));
  setClickThrough(clickThrough);
  updateCursorTracking();
}

app.whenReady().then(() => {
  debug("ready");
  loadSettings();
  debug("settings loaded");
  createWindow();
  debug("window created");
  watchLogs();
  debug("watching logs");
  startProcessMonitor();
  debug("watching Fellowship process");

  globalShortcut.register("F8", () => setClickThrough(!clickThrough));
  globalShortcut.register("F10", () => (win.isVisible() ? win.hide() : win.show()));
  globalShortcut.register("F11", () => {
    setClickThrough(false);
    win.webContents.send("open-settings", { settings, activeLogPath });
  });

  ipcMain.handle("choose-log-directory", async () => {
    const result = await dialog.showOpenDialog(win, { properties: ["openDirectory"] });
    if (result.canceled || !result.filePaths[0]) return settings;
    settings.logDirectory = result.filePaths[0];
    saveSettings();
    watchLogs();
    return settings;
  });

  ipcMain.handle("choose-install-directory", async () => {
    const result = await dialog.showOpenDialog(win, {
      title: "Choisir le dossier d'installation",
      defaultPath: settings.updateInstallDir || getDefaultInstallDir(),
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled || !result.filePaths[0]) return settings;
    settings.updateInstallDir = result.filePaths[0];
    saveSettings();
    return settings;
  });

  ipcMain.handle("save-settings", (_event, next) => {
    const previousLogDirectory = settings.logDirectory;
    settings = { ...settings, ...next };
    saveSettings();
    if (Object.prototype.hasOwnProperty.call(next || {}, "cursorHalo")) {
      updateCursorTracking();
    }
    if (Object.prototype.hasOwnProperty.call(next || {}, "closeWithFellowship")) {
      fellowshipSeenThisSession = false;
      missingFellowshipChecks = 0;
      startProcessMonitor();
    }
    if (settings.logDirectory !== previousLogDirectory) {
      watchLogs();
    }
    return settings;
  });

  ipcMain.handle("set-click-through", (_event, enabled) => {
    setClickThrough(enabled);
    return { clickThrough };
  });

  ipcMain.handle("refresh", async () => {
    win?.webContents.send("refresh-state", { refreshing: true, message: "Refresh en cours..." });
    activeLogPath = getLatestLog(settings.logDirectory);
    parseState = null;
    lastSentSignature = "";
    sendData();
    win?.webContents.send("watch-status", { ok: !!activeLogPath, logDirectory: settings.logDirectory, activeLogPath });
    win?.webContents.send("refresh-state", { refreshing: false, message: activeLogPath ? "Refresh termine." : "Aucun log trouve." });
    return { activeLogPath };
  });

  ipcMain.handle("update-app", async () => {
    const sendUpdate = (payload) => win?.webContents.send("update-state", payload);
    try {
      sendUpdate({ updating: true, message: "Recherche de la derniere version..." });
      const release = await requestJson(`https://api.github.com/repos/${UPDATE_REPO}/releases/latest`);
      const latestVersion = String(release.tag_name || release.name || "").replace(/^v/i, "");
      const currentVersion = app.getVersion();

      if (latestVersion && compareVersions(latestVersion, currentVersion) <= 0) {
        const message = `Version deja a jour (${currentVersion}).`;
        sendUpdate({ updating: false, message });
        return { ok: true, upToDate: true, message };
      }

      const asset = selectUpdateAsset(release);
      if (!asset?.browser_download_url) {
        throw new Error("Aucun fichier Windows trouve dans la derniere release GitHub.");
      }

      const installDir = settings.updateInstallDir || getDefaultInstallDir();
      const downloadDir = path.join(app.getPath("temp"), "FellowshipTrinketsOverlay-updates");
      fs.mkdirSync(downloadDir, { recursive: true });
      const safeName = String(asset.name || "FellowshipTrinketsOverlay.zip").replace(/[<>:"/\\|?*]/g, "_");
      const versionPart = latestVersion ? `-${latestVersion}` : "";
      const destination = path.join(downloadDir, safeName.replace(/(\.[^.]+)$/i, `${versionPart}$1`));

      sendUpdate({ updating: true, message: `Telechargement de ${asset.name}...` });
      await downloadFile(asset.browser_download_url, destination, (received, total) => {
        const percent = Math.max(1, Math.min(100, Math.round((received / total) * 100)));
        sendUpdate({ updating: true, message: `Telechargement ${percent}%...` });
      });

      sendUpdate({ updating: true, message: "Installation de la mise a jour..." });
      launchPortableUpdater(destination, installDir);
      const message = `Mise a jour prete. L'application va se fermer et se relancer depuis : ${installDir}`;
      sendUpdate({ updating: false, message });
      setTimeout(() => app.quit(), 700);
      return { ok: true, filePath: destination, installDir, message };
    } catch (error) {
      const message = error.message || String(error);
      sendUpdate({ updating: false, message: `Erreur mise a jour : ${message}` });
      return { ok: false, message: `Erreur mise a jour : ${message}` };
    }
  });
});

app.on("window-all-closed", () => app.quit());
app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  if (watcher) watcher.close();
  clearInterval(processMonitorTimer);
  clearInterval(cursorTimer);
});
