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
  npmCliCandidates,
  fetchLatestNpmVersion,
} = require("../src/lib/cli-update");

const NODE = "/usr/bin/node";
const NPM_CLI = "/usr/lib/node_modules/npm/bin/npm-cli.js";
const WIN_NODE = "C:\\Program Files\\nodejs\\node.exe";
const WIN_NPM_CLI = "C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js";
const WIN_PREFIX = "C:\\Users\\me\\AppData\\Roaming\\npm";
const WIN_ROOT = `${WIN_PREFIX}\\node_modules\\tokentracker-cli`;

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

// `npm prefix --global` probes answer with npmPrefix (or fail without one) and
// are recorded apart from the install/upgrade calls.
function fakeSpawn({ code = 0, npmPrefix = null, onSpawn } = {}) {
  const calls = [];
  const probes = [];
  const spawn = (command, args, options) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};
    if (args.at(-2) === "prefix" && args.at(-1) === "--global") {
      probes.push({ command, args, options });
      process.nextTick(() => {
        if (npmPrefix) child.stdout.emit("data", `${npmPrefix}\n`);
        child.emit("close", npmPrefix ? 0 : 1);
      });
      return child;
    }
    calls.push({ command, args, options });
    if (onSpawn) onSpawn({ command, args, options });
    process.nextTick(() => child.emit("close", code));
    return child;
  };
  return { spawn, calls, probes };
}

function plan(packageRoot, extra = {}) {
  return planUpdate({
    packageRoot,
    platform: "linux",
    current: "1.4.7",
    latest: "1.4.12",
    writable: true,
    npm: [NODE, NPM_CLI],
    ...extra,
  });
}

async function writeManifest(packageRoot, version) {
  await fs.mkdir(packageRoot, { recursive: true });
  await fs.writeFile(
    path.join(packageRoot, "package.json"),
    JSON.stringify({ name: "tokentracker-cli", version }),
  );
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
  const npmPlan = plan("/usr/lib/node_modules/tokentracker-cli", { npmPrefix: "/usr" });
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
  assert.deepEqual(npmPlan.exec, [NODE, NPM_CLI, ...npmPlan.command.slice(1)]);

  const nvmPrefix = "/home/me/.nvm/versions/node/v20.19.0";
  const nvmPlan = plan(`${nvmPrefix}/lib/node_modules/tokentracker-cli`, { npmPrefix: nvmPrefix });
  assert.equal(nvmPlan.prefix, nvmPrefix);
  assert.equal(nvmPlan.apply, true);

  const brewPlan = plan("/opt/homebrew/Cellar/tokentracker/1.4.7/libexec/lib/node_modules/tokentracker-cli");
  assert.equal(brewPlan.channel, "brew");
  assert.deepEqual(brewPlan.command, ["brew", "upgrade", "xiufengsun/tokentracker/tokentracker"]);
  assert.deepEqual(brewPlan.exec, brewPlan.command);

  const linuxbrew = plan("/home/linuxbrew/.linuxbrew/Cellar/tokentracker/1.4.7/libexec/lib/node_modules/tokentracker-cli");
  assert.equal(linuxbrew.channel, "brew");

  const npxPlan = plan("/root/.npm/_npx/abc/node_modules/tokentracker-cli");
  assert.equal(npxPlan.channel, "npx");
  assert.equal(npxPlan.apply, false);
  assert.match(npxPlan.lines.join("\n"), /npx tokentracker-cli@1\.4\.12/);
});

test("windows runs npm-cli.js with node instead of npm.cmd", () => {
  const win = plan(WIN_ROOT, {
    platform: "win32",
    npm: [WIN_NODE, WIN_NPM_CLI],
    npmPrefix: WIN_PREFIX.toLowerCase(),
  });
  assert.equal(win.channel, "npm");
  assert.equal(win.prefix, WIN_PREFIX);
  assert.equal(win.apply, true);
  assert.equal(win.command[0], "npm");
  assert.equal(win.command[4], WIN_PREFIX);
  assert.deepEqual(win.exec.slice(0, 3), [WIN_NODE, WIN_NPM_CLI, "install"]);
  assert.equal(win.exec.some((arg) => /npm\.cmd$/i.test(arg)), false);
});

test("npm-cli.js is looked up next to the running node, then under the prefix", () => {
  const nvm = "/home/me/.nvm/versions/node/v20.19.0";
  assert.deepEqual(
    npmCliCandidates({ prefix: nvm, platform: "linux", execPath: `${nvm}/bin/node` }),
    [`${nvm}/bin/npm`, `${nvm}/lib/node_modules/npm/bin/npm-cli.js`],
  );
  assert.deepEqual(
    npmCliCandidates({ prefix: WIN_PREFIX, platform: "win32", execPath: WIN_NODE }),
    [WIN_NPM_CLI, `${WIN_PREFIX}\\node_modules\\npm\\bin\\npm-cli.js`],
  );
});

test("a lib/node_modules copy outside npm's global prefix is not updated", () => {
  const roots = [
    "/home/me/.volta/tools/image/packages/tokentracker-cli/lib/node_modules/tokentracker-cli",
    "/home/me/.local/share/mise/installs/npm-tokentracker-cli/1.4.7/lib/node_modules/tokentracker-cli",
    "/home/me/work/lib/node_modules/tokentracker-cli",
  ];
  for (const root of roots) {
    const result = plan(root, { npmPrefix: "/usr/local" });
    assert.equal(result.channel, "npm", root);
    assert.equal(result.apply, false, root);
    assert.equal(result.command, null, root);
    assert.equal(result.exec, null, root);
    assert.match(result.lines.join("\n"), /npm's global prefix is \/usr\/local/, root);
  }

  const unknown = plan("/home/me/work/lib/node_modules/tokentracker-cli", { npmPrefix: null });
  assert.equal(unknown.apply, false);
  assert.match(unknown.lines.join("\n"), /Could not confirm/);
});

test("other package managers and source checkouts are not updated in place", () => {
  const roots = [
    "/home/me/proj/node_modules/tokentracker-cli",
    "/home/me/.local/share/pnpm/global/5/node_modules/tokentracker-cli",
    "/home/me/.config/yarn/global/node_modules/tokentracker-cli",
    "/home/me/.bun/install/global/node_modules/tokentracker-cli",
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
    assert.match(text, /npm install -g tokentracker-cli@1\.4\.12/);
    assert.match(text, /brew upgrade xiufengsun\/tokentracker\/tokentracker/);
    assert.match(text, /npx tokentracker-cli@1\.4\.12/);
  }
});

test("a bundled app, including the Homebrew cask's, is not updated with npm", () => {
  for (const root of [
    "/Applications/TokenTracker.app/Contents/Resources/EmbeddedServer/tokentracker",
    "/opt/homebrew/Caskroom/tokentracker/1.4.7/TokenTracker.app/Contents/Resources/EmbeddedServer/tokentracker",
  ]) {
    const result = plan(root);
    const text = result.lines.join("\n");
    assert.equal(result.channel, "app", root);
    assert.equal(result.apply, false, root);
    assert.match(text, /brew upgrade --cask xiufengsun\/tokentracker\/tokentracker/);
    assert.match(text, /Check for Updates/);
    assert.match(text, /AppImage/);
    assert.equal(text.includes("npm install"), false);
  }
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
  const spawn = fakeSpawn({ npmPrefix: "/usr" });
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
  // packageRoot is a realpath in production (defaultPackageRoot).
  const tmp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-update-")));
  const packageRoot = path.join(tmp, "lib", "node_modules", "tokentracker-cli");
  const execPath = path.join(tmp, "bin", "node");
  const npmCli = path.join(tmp, "lib", "node_modules", "npm", "bin", "npm-cli.js");
  await writeManifest(packageRoot, "1.4.7");
  await fs.mkdir(path.dirname(npmCli), { recursive: true });
  await fs.writeFile(npmCli, "");
  const realNpmCli = await fs.realpath(npmCli);
  const spawn = fakeSpawn({
    npmPrefix: tmp,
    onSpawn() {
      process.stdout.write("installer output\n");
      require("node:fs").writeFileSync(
        path.join(packageRoot, "package.json"),
        JSON.stringify({ name: "tokentracker-cli", version: "1.4.12" }),
      );
    },
  });

  try {
    const captured = await capture(() => cmdUpdate([], {
      packageRoot,
      execPath,
      currentVersion: "1.4.7",
      platform: "linux",
      fetch: registry("1.4.12"),
      spawn: spawn.spawn,
    }));
    assert.equal(captured.exitCode, 0);
    assert.deepEqual(spawn.probes[0].args, [realNpmCli, "prefix", "--global"]);
    assert.equal(spawn.calls.length, 1);
    assert.equal(spawn.calls[0].command, execPath);
    assert.deepEqual(spawn.calls[0].args, [
      realNpmCli,
      "install",
      "--global",
      "--prefix",
      tmp,
      "tokentracker-cli@1.4.12",
    ]);
    assert.equal(spawn.calls[0].options.shell, false);
    // The planned command prints before the installer runs, the result after.
    const commandAt = captured.out.indexOf(`npm install --global --prefix ${tmp}`);
    const installerAt = captured.out.indexOf("installer output");
    const resultAt = captured.out.indexOf("Updated to 1.4.12");
    assert.ok(commandAt >= 0 && commandAt < installerAt && installerAt < resultAt, captured.out);
    assert.equal(captured.out.split(`npm install --global --prefix ${tmp}`).length, 2);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("update on Windows spawns node and npm-cli.js without a shell", async () => {
  let version = "1.4.7";
  const fakeFs = {
    existsSync: (file) => file === WIN_NPM_CLI,
    readFileSync: () => JSON.stringify({ version }),
  };
  const spawn = fakeSpawn({
    npmPrefix: WIN_PREFIX,
    onSpawn() {
      version = "1.4.12";
    },
  });
  const captured = await capture(() => cmdUpdate([], {
    packageRoot: WIN_ROOT,
    execPath: WIN_NODE,
    currentVersion: "1.4.7",
    platform: "win32",
    writable: true,
    fs: fakeFs,
    fetch: registry("1.4.12"),
    spawn: spawn.spawn,
  }));
  assert.equal(captured.exitCode, 0);
  assert.equal(spawn.probes[0].command, WIN_NODE);
  assert.deepEqual(spawn.probes[0].args, [WIN_NPM_CLI, "prefix", "--global"]);
  assert.equal(spawn.calls[0].command, WIN_NODE);
  assert.deepEqual(spawn.calls[0].args.slice(0, 5), [WIN_NPM_CLI, "install", "--global", "--prefix", WIN_PREFIX]);
  for (const call of [...spawn.probes, ...spawn.calls]) {
    assert.equal(call.options.shell, false);
    assert.equal(/npm\.cmd$/i.test(call.command), false);
  }
});

test("update on Windows without a bundled npm prints the command instead of running npm.cmd", async () => {
  const spawn = fakeSpawn({ npmPrefix: WIN_PREFIX });
  const captured = await capture(() => cmdUpdate([], {
    packageRoot: WIN_ROOT,
    execPath: WIN_NODE,
    currentVersion: "1.4.7",
    platform: "win32",
    writable: true,
    fs: { existsSync: () => false },
    fetch: registry("1.4.12"),
    spawn: spawn.spawn,
  }));
  assert.equal(spawn.probes.length + spawn.calls.length, 0);
  assert.equal(captured.exitCode, 1);
  assert.match(captured.out, /Could not find npm/);
  assert.match(captured.out, /npm install --global --prefix C:\\Users\\me\\AppData\\Roaming\\npm tokentracker-cli@1\.4\.12/);
});

test("update refuses a lib/node_modules copy outside npm's global prefix", async () => {
  const spawn = fakeSpawn({ npmPrefix: "/usr/local" });
  const captured = await capture(() => cmdUpdate([], {
    packageRoot: "/home/me/.volta/tools/image/packages/tokentracker-cli/lib/node_modules/tokentracker-cli",
    currentVersion: "1.4.7",
    platform: "linux",
    writable: true,
    fetch: registry("1.4.12"),
    spawn: spawn.spawn,
  }));
  assert.equal(spawn.probes.length, 1);
  assert.equal(spawn.calls.length, 0);
  assert.equal(captured.exitCode, 1);
  assert.match(captured.out, /npm's global prefix is \/usr\/local/);
});

test("update does not claim success when the npm install leaves the old version", async () => {
  // packageRoot is a realpath in production (defaultPackageRoot).
  const tmp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-update-")));
  const packageRoot = path.join(tmp, "lib", "node_modules", "tokentracker-cli");
  await writeManifest(packageRoot, "1.4.7");
  const spawn = fakeSpawn({ npmPrefix: tmp });
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
  const spawn = fakeSpawn({ npmPrefix: "/usr" });
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

async function brewFixture() {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-brew-"));
  const inner = path.join("libexec", "lib", "node_modules", "tokentracker-cli");
  const packageRoot = path.join(tmp, "Cellar", "tokentracker", "1.4.7", inner);
  const linkedRoot = path.join(tmp, "opt", "tokentracker", inner);
  await writeManifest(packageRoot, "1.4.7");
  await writeManifest(linkedRoot, "1.4.7");
  return { tmp, packageRoot, linkedRoot };
}

test("update runs brew upgrade and confirms the version Homebrew linked", async () => {
  const { tmp, packageRoot, linkedRoot } = await brewFixture();
  const spawn = fakeSpawn({
    onSpawn() {
      require("node:fs").writeFileSync(
        path.join(linkedRoot, "package.json"),
        JSON.stringify({ name: "tokentracker-cli", version: "1.4.12" }),
      );
    },
  });
  try {
    const captured = await capture(() => cmdUpdate([], {
      packageRoot,
      currentVersion: "1.4.7",
      platform: "darwin",
      fetch: registry("1.4.12"),
      spawn: spawn.spawn,
    }));
    assert.equal(captured.exitCode, 0);
    assert.equal(spawn.calls[0].command, "brew");
    assert.deepEqual(spawn.calls[0].args, ["upgrade", "xiufengsun/tokentracker/tokentracker"]);
    assert.equal(spawn.calls[0].options.shell, false);
    assert.match(captured.out, /Updated to 1\.4\.12/);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("update does not report applied when the Homebrew tap has not bumped yet", async () => {
  const { tmp, packageRoot } = await brewFixture();
  const spawn = fakeSpawn();
  try {
    const captured = await capture(() => cmdUpdate(["--json"], {
      packageRoot,
      currentVersion: "1.4.7",
      platform: "darwin",
      fetch: registry("1.4.12"),
      spawn: spawn.spawn,
    }));
    const payload = JSON.parse(captured.out);
    assert.equal(spawn.calls.length, 1);
    assert.equal(captured.exitCode, 1);
    assert.equal(payload.ok, false);
    assert.equal(payload.applied, false);
    assert.match(payload.message, /Homebrew still has 1\.4\.7/);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
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
  assert.equal(spawn.probes.length + spawn.calls.length, 0);
  assert.equal(captured.exitCode, 1);
  assert.match(captured.out, /npm install -g tokentracker-cli@latest/);
  assert.match(captured.out, /brew upgrade xiufengsun\/tokentracker\/tokentracker/);
  assert.match(captured.out, /npx tokentracker-cli@latest/);
  assert.equal(captured.out.includes("rm -rf"), false);
});

test("unknown commands print help to stderr instead of throwing", async () => {
  const captured = await capture(() => run(["updat"]));
  assert.equal(captured.out, "");
  assert.match(captured.err, /Unknown command: updat/);
  assert.match(captured.err, /Usage:/);
  assert.match(captured.err, /update \[--check\] \[--json\]/);
  assert.match(captured.err, /doctor/);
  assert.equal(captured.err.includes("at run ("), false);
  assert.equal(captured.exitCode, 1);
});

test("update reports an unknown option with usage instead of a stack", async () => {
  const captured = await capture(() => cmdUpdate(["--force"]));
  assert.equal(captured.out, "");
  assert.match(captured.err, /Unknown option: --force/);
  assert.match(captured.err, /Usage: tokentracker update \[--check\] \[--json\]/);
  assert.equal(captured.err.includes("    at "), false);
  assert.equal(captured.exitCode, 1);
});
