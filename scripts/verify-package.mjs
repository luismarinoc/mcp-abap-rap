import { lstat, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { verify } from "./verify-stdio.mjs";

const npm = process.env.npm_execpath;
if (!npm) throw new Error("Run through npm run verify:package");
const root = process.cwd();
// This test owns and removes every install/cache artifact inside the registered worktree.
const dir = await mkdtemp(path.join(root, ".local-builds", "package-verification-"));
const installDir = path.join(dir, "install");
const env = {
  ...Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    !/^npm_config_/i.test(key) && !/^(?:NODE_AUTH_TOKEN|NPM_TOKEN|NPMRC)$/i.test(key))),
  npm_config_cache: path.join(dir, "npm-cache"),
  npm_config_userconfig: path.join(dir, "user.npmrc"),
  npm_config_globalconfig: path.join(dir, "global.npmrc"),
};
const exec = (args, cwd) => {
  const r = spawnSync(process.execPath, [npm, ...args], {
    cwd,
    env,
    encoding: "utf8",
    timeout: 120000,
  });
  if (r.status !== 0) throw new Error(`npm ${args[0]} exited ${r.status} (signal ${r.signal ?? "none"})\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
  return { stdout: r.stdout, stderr: r.stderr, status: r.status };
};
try {
  await mkdir(installDir);
  // A manifest is mandatory: npm otherwise walks upward and can prune the
  // integration project's development dependencies instead of this fixture.
  await writeFile(path.join(installDir, "package.json"), JSON.stringify({
    name: "package-verification-fixture", version: "0.0.0", private: true,
  }) + "\n", { flag: "wx", mode: 0o600 });
  const originalManifest = await readFile(path.join(root, "package.json"));
  const originalLock = await readFile(path.join(root, "package-lock.json"));
  await writeFile(env.npm_config_userconfig, "", { mode: 0o600 });
  await writeFile(env.npm_config_globalconfig, "", { mode: 0o600 });
  const packageName = JSON.parse(await readFile(path.join(root, "package.json"), "utf8")).name;
  if (packageName !== "mcp-abap-rap") throw new Error("Unexpected source package name");
  const packed = exec(["pack", "--ignore-scripts", "--json", "--pack-destination", dir], root);
  let records;
  try {
    const parsed = JSON.parse(packed.stdout);
    // npm returns an array; the configured package runner returns a name-keyed
    // object. Accept only this package's sole record, never another artifact.
    records = Array.isArray(parsed) ? parsed :
      parsed && typeof parsed === "object" && Object.keys(parsed).length === 1 &&
      Object.hasOwn(parsed, packageName) ? [parsed[packageName]] : [];
  } catch {
    throw new Error(`npm pack returned invalid JSON (exit ${packed.status})\nstdout:\n${packed.stdout}\nstderr:\n${packed.stderr}`);
  }
  // S8 observed an exit-0 JSON result without records. A new owned directory
  // cannot contain a previous package; require exactly one real, nonempty archive.
  const archives = (await readdir(dir)).filter(name => name.endsWith(".tgz"));
  const filenames = records.map(record => record?.filename);
  if (records.length !== 1 || archives.length !== 1 ||
      records.some(record => record?.name !== undefined && record.name !== packageName) ||
      filenames.some(name => typeof name !== "string" || path.basename(name) !== name || name !== archives[0]))
    throw new Error(`npm pack did not produce exactly one matching archive (exit ${packed.status}, archives ${archives.length})\nstdout:\n${packed.stdout}\nstderr:\n${packed.stderr}`);
  const archive = path.join(dir, archives[0]);
  const archiveInfo = await lstat(archive);
  if (!archiveInfo.isFile() || archiveInfo.size === 0)
    throw new Error(`npm pack archive is not a nonempty regular file\nstdout:\n${packed.stdout}\nstderr:\n${packed.stderr}`);
  console.log(`npm pack exit=${packed.status} archive verified; stdout=${JSON.stringify(packed.stdout)} stderr=${JSON.stringify(packed.stderr)}`);
  const prefix = exec(["prefix"], installDir).stdout.trim();
  if (path.resolve(prefix) !== installDir) throw new Error(`Unsafe npm install prefix: ${prefix}`);
  const installed = exec(["install", "--prefix", installDir, "--omit=dev", "--ignore-scripts", "--no-fund", archive], installDir);
  if (!originalManifest.equals(await readFile(path.join(root, "package.json"))) ||
      !originalLock.equals(await readFile(path.join(root, "package-lock.json"))))
    throw new Error("Package fixture modified the integration manifest or lockfile");
  console.log(`npm install exit=${installed.status}; source manifest/lock unchanged; stdout=${JSON.stringify(installed.stdout)} stderr=${JSON.stringify(installed.stderr)}`);
  const base = path.join(installDir, "node_modules", "mcp-abap-rap");
  const pkg = JSON.parse(await readFile(path.join(base, "package.json"), "utf8"));
  if (pkg.name !== "mcp-abap-rap" || pkg.bin["mcp-abap-rap"] !== "dist/index.js" ||
      pkg.bin["mcp-abap-abap-adt-api"] !== "dist/index.js")
    throw new Error("Package or binary aliases changed unexpectedly");
  for (const name of ["mcp-abap-rap", "mcp-abap-abap-adt-api"]) {
    await verify([process.execPath, path.join(base, pkg.bin[name])]);
    console.log(`${name} installed bin passed both protocol exchanges`);
  }
  const audited = exec(["audit", "--omit=dev"], installDir);
  console.log(`npm audit exit=${audited.status}; stdout=${JSON.stringify(audited.stdout)} stderr=${JSON.stringify(audited.stderr)}`);
  console.log("Installed production mcp-abap-rap tarball and both bin aliases passed; audit0");
} finally {
  await rm(dir, { recursive: true, force: true });
}
