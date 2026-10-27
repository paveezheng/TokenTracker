const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { test } = require("node:test");

const { run } = require("../src/cli");
const { cmdUpdate } = require("../src/commands/update");
const {
  compareVersions,
  planUpdate,
  fetchLatestNpmVersion,
} = require("../src/lib/cli-update");

function capture(fn) {
  const prevOut = process.stdout.write;
  const prevErr = process.stderr.write;
  const prevExit = process.exitCode;
  let out = "";
  let err = "";
  process.stdout.write = (chunk) => {
    out += String(chunk ?? "");
    return true;
  };
  process.stderr.write = (chunk) => {
    err += String(chunk ?? "");
    return true;
  };
  process.exitCode = undefined;
  return Promise.resolve()
    .then(fn)
    .then((result) => ({ out, err, exitCode: process.exitCode, result }))
    .finally(() => {
      process.stdout.write = prevOut;
      process.stderr.write = prevErr;
      process.exitCode = prevExit;
    });
}

function registry(version, status = 200) {
  return async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => ({ version }),
  });
}

function fakeSpawn({ code = 0, onSpawn } = {}) {
  const calls = [];
  const spawn = (command, args, options) => {
    calls.push({ command, args, options });
    if (onSpawn) onSpawn({ command, args, options });
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    process.nextTick(() => child.emit("close", code));
    return child;
  };
  return { spawn, calls };
}

function plan(packageRoot, extra = {}) {
  return planUpdate({
    packageRoot,
    platform: "linux",
    current: "1.4.7",
    latest: "1.4.12",
    writable: true,
    ...extra,
  });
}

test("compareVersions orders releases and prereleases", () => {
  assert.equal(compareVersions("1.4.7", "1.4.12"), -1);
  assert.equal(compareVersions("v1.4.12", "1.4.12"), 0);
  assert.equal(compareVersions("1.4.13", "1.4.12"), 1);
  assert.equal(compareVersions("1.4.12-beta.1", "1.4.12"), -1);
  assert.equal(compareVersions("1.4.12; touch /tmp/pwned", "1.4.12"), null);
  assert.equal(compareVersions("1.4.12\nrm -rf /", "1.4.12"), null);
});

test("npm global, Homebrew, and npx are the CLI update channels", () => {
  const npmPlan = plan("/usr/lib/node_modules/tokentracker-cli");
  assert.equal(npmPlan.channel, "npm");
  assert.equal(npmPlan.prefix, "/usr");
  assert.equal(npmPlan.apply, true);
  assert.deepEqual(npmPlan.command, [
    "npm",
    "install",
    "--global",
    "--prefix",
    "/usr",
    "tokentracker-cli@1.4.12",
  ]);

  const nvmPlan = plan("/home/me/.nvm/versions/node/v20.19.0/lib/node_modules/tokentracker-cli");
  assert.equal(nvmPlan.prefix, "/home/me/.nvm/versions/node/v20.19.0");

  const brewPlan = plan("/opt/homebrew/Cellar/tokentracker/1.4.7/libexec/lib/node_modules/tokentracker-cli");
  assert.equal(brewPlan.channel, "brew");
  assert.deepEqual(brewPlan.command, ["brew", "upgrade", "xiufengsun/tokentracker/tokentracker"]);

  const linuxbrew = plan("/home/linuxbrew/.linuxbrew/Cellar/tokentracker/1.4.7/libexec/lib/node_modules/tokentracker-cli");
  assert.equal(linuxbrew.channel, "brew");

  const cask = plan("/opt/homebrew/Caskroom/tokentracker/1.4.7/TokenTracker.app/Contents/Resources/EmbeddedServer/tokentracker");
  assert.equal(cask.channel, "brew-cask");
  assert.deepEqual(cask.command, ["brew", "upgrade", "--cask", "xiufengsun/tokentracker/tokentracker"]);

  const npxPlan = plan("/root/.npm/_npx/abc/node_modules/tokentracker-cli");
  assert.equal(npxPlan.channel, "npx");
  assert.equal(npxPlan.apply, false);
  assert.match(npxPlan.lines.join("\n"), /npx tokentracker-cli@1\.4\.12/);
});

test("windows npm global prefix is the npm directory", () => {
  const win = plan("C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\tokentracker-cli", { platform: "win32" });
  assert.equal(win.channel, "npm");
  assert.equal(win.prefix, "C:\\Users\\me\\AppData\\Roaming\\npm");
  assert.equal(win.command[0], "npm.cmd");
  assert.equal(win.command[4], "C:\\Users\\me\\AppData\\Roaming\\npm");
});

test("other package managers and source checkouts are not updated in place", () => {
  const roots = [
    "/home/me/proj/node_modules/tokentracker-cli",
    "/home/me/.local/share/pnpm/global/5/node_modules/tokentracker-cli",
    "/home/me/.config/yarn/global/node_modules/tokentracker-cli",
    "/home/me/.bun/install/global/node_modules/tokentracker-cli",
    "/home/me/.volta/tools/image/packages/tokentracker-cli",
    "/root/CodeProjects/TokenTracker",
  ];
  for (const root of roots) {
    const result = plan(root);
    const text = result.lines.join("\n");
    assert.equal(result.apply, false, root);
    assert.equal(result.command, null, root);
    assert.equal(text.includes("pnpm"), false, root);
    assert.equal(text.includes("yarn"), false, root);
    assert.equal(text.includes(" bun"), false, root);
    assert.equal(text.includes("volta"), false, root);
    assert.match(text, /npm install -g tokentracker-cli@1\.4\.12/);
    assert.match(text, /brew upgrade xiufengsun\/tokentracker\/tokentracker/);
    assert.match(text, /npx tokentracker-cli@1\.4\.12/);
  }
});

test("a bundled app is not updated with npm", () => {
  const result = plan("/Applications/TokenTracker.app/Contents/Resources/EmbeddedServer/tokentracker");
  const text = result.lines.join("\n");
  assert.equal(result.channel, "app");
  assert.equal(result.apply, false);
  assert.match(text, /brew upgrade --cask xiufengsun\/tokentracker\/tokentracker/);
  assert.match(text, /Check for Updates/);
  assert.match(text, /AppImage/);
  assert.equal(text.includes("npm install"), false);
});

test("an npm install that is already current does not run", () => {
  const result = plan("/usr/lib/node_modules/tokentracker-cli", { current: "1.4.12", latest: "1.4.12" });
  assert.equal(result.updateAvailable, false);
  assert.equal(result.apply, false);
  assert.match(result.lines.join("\n"), /already the latest release/);
});

test("fetchLatestNpmVersion rejects a version that is not a release number", async () => {
  await assert.rejects(
    fetchLatestNpmVersion(registry("1.4.12; touch /tmp/pwned")),
    /unusable version/,
  );
  assert.equal(await fetchLatestNpmVersion(registry("v1.4.12")), "1.4.12");
});

test("update --check reports a newer npm release without installing", async () => {
  const spawn = fakeSpawn();
  const captured = await capture(() => cmdUpdate(["--check", "--json"], {
    packageRoot: "/usr/lib/node_modules/tokentracker-cli",
    currentVersion: "1.4.7",
    platform: "linux",
    writable: true,
    fetch: registry("1.4.12"),
    spawn: spawn.spawn,
  }));
  const payload = JSON.parse(captured.out);
  assert.equal(payload.ok, true);
  assert.equal(payload.updateAvailable, true);
  assert.equal(payload.applied, false);
  assert.equal(payload.channel, "npm");
  assert.equal(payload.command[5], "tokentracker-cli@1.4.12");
  assert.equal(captured.exitCode, 1);
  assert.equal(spawn.calls.length, 0);
});

test("update installs the npm global prefix in place", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-update-"));
  const packageRoot = path.join(tmp, "lib", "node_modules", "tokentracker-cli");
  await fs.mkdir(packageRoot, { recursive: true });
  const manifestPath = path.join(packageRoot, "package.json");
  await fs.writeFile(manifestPath, JSON.stringify({ name: "tokentracker-cli", version: "1.4.7" }));
  const spawn = fakeSpawn({
    onSpawn() {
      require("node:fs").writeFileSync(manifestPath, JSON.stringify({ name: "tokentracker-cli", version: "1.4.12" }));
    },
  });

  try {
    const captured = await capture(() => cmdUpdate([], {
      packageRoot,
      currentVersion: "1.4.7",
      platform: "linux",
      fetch: registry("1.4.12"),
      spawn: spawn.spawn,
    }));
    assert.equal(captured.exitCode, 0);
    assert.equal(spawn.calls.length, 1);
    assert.deepEqual(spawn.calls[0].args, [
      "install",
      "--global",
      "--prefix",
      tmp,
      "tokentracker-cli@1.4.12",
    ]);
    assert.equal(spawn.calls[0].options.shell, false);
    assert.match(captured.out, /Updated to 1\.4\.12/);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("update does not claim success when the npm install leaves the old version", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-update-"));
  const packageRoot = path.join(tmp, "lib", "node_modules", "tokentracker-cli");
  await fs.mkdir(packageRoot, { recursive: true });
  await fs.writeFile(
    path.join(packageRoot, "package.json"),
    JSON.stringify({ name: "tokentracker-cli", version: "1.4.7" }),
  );
  const spawn = fakeSpawn();
  try {
    const captured = await capture(() => cmdUpdate([], {
      packageRoot,
      currentVersion: "1.4.7",
      platform: "linux",
      fetch: registry("1.4.12"),
      spawn: spawn.spawn,
    }));
    assert.equal(captured.exitCode, 1);
    assert.match(captured.out, /still 1\.4\.7/);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("update refuses an unwritable npm prefix", async () => {
  const spawn = fakeSpawn();
  const captured = await capture(() => cmdUpdate([], {
    packageRoot: "/usr/lib/node_modules/tokentracker-cli",
    currentVersion: "1.4.7",
    platform: "linux",
    writable: false,
    fetch: registry("1.4.12"),
    spawn: spawn.spawn,
  }));
  assert.equal(spawn.calls.length, 0);
  assert.equal(captured.exitCode, 1);
  assert.match(captured.out, /not writable: \/usr/);
  assert.match(captured.out, /npm install --global --prefix \/usr tokentracker-cli@1\.4\.12/);
});

test("update runs brew upgrade for a Homebrew formula install", async () => {
  const spawn = fakeSpawn();
  const captured = await capture(() => cmdUpdate([], {
    packageRoot: "/opt/homebrew/Cellar/tokentracker/1.4.7/libexec/lib/node_modules/tokentracker-cli",
    currentVersion: "1.4.7",
    platform: "darwin",
    fetch: registry("1.4.12"),
    spawn: spawn.spawn,
  }));
  assert.equal(captured.exitCode, 0);
  assert.deepEqual(spawn.calls[0].args, ["upgrade", "xiufengsun/tokentracker/tokentracker"]);
  assert.equal(spawn.calls[0].command, "brew");
  assert.match(captured.out, /Homebrew finished/);
});

test("npx prints the next launch command and does not install", async () => {
  const spawn = fakeSpawn();
  const captured = await capture(() => cmdUpdate([], {
    packageRoot: "/root/.npm/_npx/abc/node_modules/tokentracker-cli",
    currentVersion: "1.4.7",
    platform: "linux",
    fetch: registry("1.4.12"),
    spawn: spawn.spawn,
  }));
  assert.equal(spawn.calls.length, 0);
  assert.equal(captured.exitCode, 0);
  assert.match(captured.out, /npx tokentracker-cli@1\.4\.12/);
});

test("a registry failure prints the three CLI install commands and does not install", async () => {
  const spawn = fakeSpawn();
  const captured = await capture(() => cmdUpdate([], {
    packageRoot: "/usr/lib/node_modules/tokentracker-cli",
    currentVersion: "1.4.7",
    platform: "linux",
    fetch: registry("1.4.12; rm -rf /", 200),
    spawn: spawn.spawn,
  }));
  assert.equal(spawn.calls.length, 0);
  assert.equal(captured.exitCode, 1);
  assert.match(captured.out, /npm install -g tokentracker-cli@latest/);
  assert.match(captured.out, /brew upgrade xiufengsun\/tokentracker\/tokentracker/);
  assert.match(captured.out, /npx tokentracker-cli@latest/);
  assert.equal(captured.out.includes("rm -rf"), false);
});

test("unknown commands print help instead of throwing", async () => {
  const captured = await capture(() => run(["updat"]));
  assert.match(captured.out, /Unknown command: updat/);
  assert.match(captured.out, /Usage:/);
  assert.match(captured.out, /update \[--check\] \[--json\]/);
  assert.match(captured.out, /doctor/);
  assert.equal(captured.out.includes("at run ("), false);
  assert.equal(captured.exitCode, 1);
});

test("update rejects an unknown option", async () => {
  await assert.rejects(() => cmdUpdate(["--force"]), /Unknown option: --force/);
});
