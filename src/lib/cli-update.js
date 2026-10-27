"use strict";

const path = require("node:path");

const NPM_PACKAGE = "tokentracker-cli";
const BREW_FORMULA = "xiufengsun/tokentracker/tokentracker";
const LATEST_URL = "https://registry.npmjs.org/tokentracker-cli/latest";

// Release versions this package publishes. A registry value that does not
// match is refused before it can reach a shell argument.
const VERSION_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

function parseVersion(version) {
  const match = VERSION_RE.exec(String(version ?? "").trim());
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    pre: match[4] || null,
    raw: `${match[1]}.${match[2]}.${match[3]}${match[4] ? `-${match[4]}` : ""}`,
  };
}

// Negative when left is older. A prerelease is older than the same numbers
// without a prerelease. Returns null when either side is not a release version.
function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) return null;
  if (a.major !== b.major) return a.major < b.major ? -1 : 1;
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1;
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1;
  if (a.pre === b.pre) return 0;
  if (a.pre && !b.pre) return -1;
  if (!a.pre && b.pre) return 1;
  return a.pre < b.pre ? -1 : 1;
}

function toPosix(value) {
  return String(value || "").replace(/\\/g, "/").replace(/\/+$/, "");
}

function parentPosix(value) {
  const cut = value.lastIndexOf("/");
  if (cut <= 0) return null;
  return value.slice(0, cut);
}

function nativePath(posixValue, platform) {
  if (!posixValue) return null;
  const pathApi = platform === "win32" ? path.win32 : path.posix;
  return pathApi.normalize(posixValue);
}

// Documented CLI installs are npm global, Homebrew, and a one-shot npx run.
// npm's global layout is prefix/lib/node_modules on Unix and
// prefix/node_modules under the npm or nodejs directory on Windows.
// A project-local node_modules, or a pnpm/yarn/bun/Volta tree, does not match.
function npmGlobalPrefix(posixRoot, platform) {
  const marker = `/node_modules/${NPM_PACKAGE}`;
  if (!posixRoot.endsWith(marker)) return null;
  const modulesDir = posixRoot.slice(0, -`/${NPM_PACKAGE}`.length);
  if (!modulesDir.endsWith("/node_modules")) return null;
  const above = modulesDir.slice(0, -"/node_modules".length);
  const base = above.split("/").pop();
  if (base === "lib") return nativePath(parentPosix(above), platform);
  if (platform === "win32" && (base === "npm" || base === "nodejs")) {
    return nativePath(above, platform);
  }
  return null;
}

function classifyInstall({ packageRoot, platform = "linux" } = {}) {
  const root = toPosix(packageRoot);
  if (root.includes("/Caskroom/tokentracker/")) return { channel: "brew-cask", prefix: null };
  if (root.includes("/Cellar/tokentracker/")) return { channel: "brew", prefix: null };
  if (root.includes("/_npx/")) return { channel: "npx", prefix: null };
  const prefix = npmGlobalPrefix(root, platform);
  if (prefix) return { channel: "npm", prefix };
  if (root.includes("/EmbeddedServer/") || root.endsWith("/EmbeddedServer")) {
    return { channel: "app", prefix: null };
  }
  return { channel: "source", prefix: null };
}

function officialCommands(version) {
  const pin = parseVersion(version) ? `@${parseVersion(version).raw}` : "@latest";
  return [
    `npm install -g ${NPM_PACKAGE}${pin}`,
    `brew upgrade ${BREW_FORMULA}`,
    `npx ${NPM_PACKAGE}${pin}`,
  ];
}

function formatCommand(argv) {
  return argv.map((arg) => (/[\s"]/.test(arg) ? `"${String(arg).replace(/"/g, '\\"')}"` : String(arg))).join(" ");
}

function appUpdateLines() {
  return [
    "Update the app:",
    `macOS: the menu bar app checks for updates, or run brew upgrade --cask ${BREW_FORMULA}`,
    "Windows: choose Check for Updates in the tray menu.",
    "Linux: download the latest AppImage, .deb, or .rpm from GitHub Releases.",
  ];
}

function brewCommand(channel) {
  if (channel === "brew-cask") return ["brew", "upgrade", "--cask", BREW_FORMULA];
  return ["brew", "upgrade", BREW_FORMULA];
}

function npmCommand(prefix, version, platform) {
  const parsed = parseVersion(version);
  if (!prefix || !parsed) return null;
  const npmBin = platform === "win32" ? "npm.cmd" : "npm";
  return [npmBin, "install", "--global", "--prefix", prefix, `${NPM_PACKAGE}@${parsed.raw}`];
}

function versionLine(current, latest, label) {
  if (!latest) return `TokenTracker ${current} (${label})`;
  if (compareVersions(current, latest) === 0) return `TokenTracker ${current} is already the latest release.`;
  if (compareVersions(current, latest) > 0) {
    return `TokenTracker ${current} is newer than the latest npm release ${latest}.`;
  }
  return `TokenTracker ${current} → ${latest} (${label})`;
}

function planUpdate({ packageRoot, platform = "linux", current, latest = null, writable = true } = {}) {
  const install = classifyInstall({ packageRoot, platform });
  const parsedLatest = parseVersion(latest);
  const latestRaw = parsedLatest ? parsedLatest.raw : null;
  const cmp = latestRaw ? compareVersions(current, latestRaw) : null;
  const updateAvailable = Boolean(latestRaw && (cmp === null || cmp < 0));
  const lines = [];
  let command = null;
  let apply = false;

  if (install.channel === "npm") {
    lines.push(versionLine(current, latestRaw, "npm"));
    if (updateAvailable) {
      command = npmCommand(install.prefix, latestRaw, platform);
      if (writable && command) {
        apply = true;
        lines.push(formatCommand(command));
      } else {
        lines.push(`The npm prefix is not writable: ${install.prefix}`);
        lines.push("Run this as a user who can write there:");
        if (command) lines.push(formatCommand(command));
      }
    }
  } else if (install.channel === "brew" || install.channel === "brew-cask") {
    const label = install.channel === "brew-cask" ? "Homebrew cask" : "Homebrew";
    lines.push(versionLine(current, latestRaw, label));
    if (updateAvailable) {
      command = brewCommand(install.channel);
      apply = true;
      lines.push(formatCommand(command));
      lines.push("Homebrew's tap follows a release within about an hour. Until it bumps, brew reports the formula is already up to date.");
    }
  } else if (install.channel === "npx") {
    if (updateAvailable) {
      lines.push(`This is an npx run of ${NPM_PACKAGE} ${current}. The latest release is ${latestRaw}.`);
      lines.push("npx does not stay installed. The next launch picks up the new package:");
      lines.push(`npx ${NPM_PACKAGE}@${latestRaw}`);
    } else if (latestRaw) {
      lines.push(`This npx run is already ${NPM_PACKAGE} ${current}.`);
    }
  } else if (install.channel === "app") {
    if (updateAvailable) {
      lines.push(`This copy is bundled inside the TokenTracker app (${current}). The latest release is ${latestRaw}.`);
      lines.push(...appUpdateLines());
    } else if (latestRaw && cmp > 0) {
      lines.push(`This copy is bundled inside the TokenTracker app. ${current} is newer than the latest npm release ${latestRaw}.`);
    } else if (latestRaw) {
      lines.push(`This copy is bundled inside the TokenTracker app. ${current} matches the latest release.`);
    } else {
      lines.push(`This copy is bundled inside the TokenTracker app (${current}).`);
      lines.push(...appUpdateLines());
    }
  } else if (!latestRaw) {
    lines.push(`This copy was not installed with npm or Homebrew (${current}).`);
    lines.push("Update a supported CLI install with:");
    lines.push(...officialCommands(null));
  } else if (updateAvailable) {
    lines.push(`This copy was not installed with npm or Homebrew (${current}). The latest release is ${latestRaw}.`);
    lines.push("Update a supported CLI install with:");
    lines.push(...officialCommands(latestRaw));
  } else if (cmp > 0) {
    lines.push(`This copy was not installed with npm or Homebrew. ${current} is newer than the latest npm release ${latestRaw}.`);
  } else {
    lines.push(`This copy was not installed with npm or Homebrew. ${current} matches the latest release.`);
  }

  return {
    channel: install.channel,
    prefix: install.prefix,
    current,
    latest: latestRaw,
    updateAvailable,
    apply,
    command,
    lines,
  };
}

async function fetchLatestNpmVersion(fetchImpl, { url = LATEST_URL, signal } = {}) {
  if (typeof fetchImpl !== "function") {
    throw new Error("npm registry is unavailable");
  }
  const response = await fetchImpl(url, {
    headers: { accept: "application/json" },
    signal: signal || AbortSignal.timeout(20000),
  });
  if (!response || !response.ok || typeof response.json !== "function") {
    const status = response && response.status ? response.status : "no response";
    throw new Error(`npm registry returned ${status}`);
  }
  const body = await response.json();
  const parsed = parseVersion(body && body.version);
  if (!parsed) throw new Error("npm registry returned an unusable version");
  return parsed.raw;
}

module.exports = {
  NPM_PACKAGE,
  BREW_FORMULA,
  LATEST_URL,
  parseVersion,
  compareVersions,
  classifyInstall,
  officialCommands,
  planUpdate,
  fetchLatestNpmVersion,
  formatCommand,
};
