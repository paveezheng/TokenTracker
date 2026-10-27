"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const {
  parseVersion,
  compareVersions,
  planUpdate,
  fetchLatestNpmVersion,
  officialCommands,
} = require("../lib/cli-update");

function parseArgs(argv) {
  const out = { check: false, json: false };
  for (const arg of argv) {
    if (arg === "--check") out.check = true;
    else if (arg === "--json") out.json = true;
    else throw new Error(`Unknown option: ${arg}`);
  }
  return out;
}

function defaultPackageRoot(fsImpl) {
  const root = path.resolve(__dirname, "..", "..");
  try {
    return fsImpl.realpathSync(root);
  } catch {
    return root;
  }
}

function canWrite(dir, fsImpl) {
  try {
    fsImpl.accessSync(dir, fsImpl.constants ? fsImpl.constants.W_OK : fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function quoteCmd(arg) {
  const value = String(arg);
  if (value === "") return '""';
  if (/^[\w@./:\\+-]+$/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

function runSpawn(spawnImpl, command, args, platform, pipe) {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let child;
    try {
      child = spawnImpl(command, platform === "win32" ? args.map(quoteCmd) : args.slice(), {
        shell: platform === "win32",
        windowsHide: true,
        stdio: pipe ? ["ignore", "pipe", "pipe"] : "inherit",
      });
    } catch (error) {
      resolve({ code: 1, stdout: "", stderr: error && error.message ? error.message : String(error) });
      return;
    }

    if (pipe && child.stdout) child.stdout.on("data", (chunk) => { stdout += chunk; });
    if (pipe && child.stderr) child.stderr.on("data", (chunk) => { stderr += chunk; });

    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    child.on("error", (error) => {
      finish({ code: 1, stdout, stderr: error && error.message ? error.message : String(error) });
    });
    child.on("close", (code) => {
      finish({ code: code == null ? 1 : code, stdout, stderr });
    });
  });
}

function readInstalledVersion(packageRoot, fsImpl) {
  try {
    const raw = fsImpl.readFileSync(path.join(packageRoot, "package.json"), "utf8");
    const manifest = JSON.parse(raw);
    return parseVersion(manifest && manifest.version) ? parseVersion(manifest.version).raw : null;
  } catch {
    return null;
  }
}

function emit(opts, payload, exitCode) {
  const message = payload.lines.filter(Boolean).join("\n");
  if (opts.json) {
    process.stdout.write(`${JSON.stringify({
      ok: payload.ok,
      current: payload.current,
      latest: payload.latest,
      channel: payload.channel,
      updateAvailable: payload.updateAvailable,
      command: payload.command,
      applied: payload.applied,
      message,
    })}\n`);
  } else if (message) {
    process.stdout.write(`${message}\n`);
  }
  process.exitCode = exitCode;
  return payload;
}

async function cmdUpdate(argv = [], deps = {}) {
  const opts = parseArgs(argv);
  const fsImpl = deps.fs || fs;
  const spawnImpl = deps.spawn || spawn;
  const platform = deps.platform || process.platform;
  const packageRoot = deps.packageRoot || defaultPackageRoot(fsImpl);
  const current = deps.currentVersion || require("../../package.json").version;
  const writable = typeof deps.writable === "boolean"
    ? deps.writable
    : canWrite(path.dirname(packageRoot), fsImpl);

  let latest = null;
  let fetchError = null;
  try {
    latest = await fetchLatestNpmVersion(deps.fetch || globalThis.fetch);
  } catch (error) {
    fetchError = error instanceof Error ? error.message : String(error);
  }

  if (fetchError) {
    return emit(opts, {
      ok: false,
      current,
      latest: null,
      channel: planUpdate({ packageRoot, platform, current, latest: null, writable }).channel,
      updateAvailable: false,
      command: null,
      applied: false,
      lines: [
        "Could not read the latest tokentracker-cli version from the npm registry.",
        ...officialCommands(null),
      ],
    }, 1);
  }

  const plan = planUpdate({ packageRoot, platform, current, latest, writable });
  if (opts.check || !plan.apply) {
    const exitCode = opts.check
      ? (plan.updateAvailable ? 1 : 0)
      : (plan.channel === "npm" && plan.updateAvailable ? 1 : 0);
    // --check exits 1 when a newer release exists. ok stays true because the
    // check itself succeeded; updateAvailable carries the result.
    return emit(opts, { ...plan, ok: opts.check || exitCode === 0, applied: false }, exitCode);
  }

  const [command, ...args] = plan.command;
  const result = await runSpawn(spawnImpl, command, args, platform, opts.json);
  const lines = plan.lines.slice();
  let ok = result.code === 0;
  if (!ok) {
    const detail = (result.stderr || result.stdout || "").trim();
    lines.push(detail || `${command} exited with status ${result.code}`);
  } else if (plan.channel === "npm") {
    const installed = readInstalledVersion(packageRoot, fsImpl);
    if (installed && compareVersions(installed, plan.latest) < 0) {
      ok = false;
      lines.push(`The installer finished, but this install is still ${installed}.`);
    } else {
      lines.push(`Updated to ${plan.latest}. Restart a running tokentracker serve to pick up this version.`);
    }
  } else {
    lines.push("Homebrew finished. Run tokentracker --version in a new command to confirm the version.");
  }

  return emit(opts, { ...plan, ok, applied: ok, lines }, ok ? 0 : 1);
}

module.exports = { cmdUpdate, parseArgs };
