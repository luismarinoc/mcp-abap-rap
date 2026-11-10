import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, writeFile, readFile, readdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const script = fileURLToPath(new URL('./verify-package.mjs', import.meta.url));

test('clean checkout creates owned scratch parent before invoking npm', async t => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'package-clean-checkout-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const scripts = path.join(root, 'scripts');
  await mkdir(scripts);
  await copyFile(script, path.join(scripts, 'verify-package.mjs'));
  await writeFile(path.join(scripts, 'verify-stdio.mjs'), 'export async function verify() {}\n');
  const manifest = '{"name":"mcp-abap-rap","version":"0.2.0"}\n';
  const lock = '{}\n';
  await writeFile(path.join(root, 'package.json'), manifest);
  await writeFile(path.join(root, 'package-lock.json'), lock);
  const npm = path.join(root, 'fake-npm.cjs');
  await writeFile(npm, `const fs = require('node:fs');
const path = require('node:path');
fs.writeFileSync(path.join(process.cwd(), 'observed.json'), JSON.stringify(process.argv.slice(2)));
process.stderr.write('fixture pack stopped before installation\\n');
process.exit(73);
`);
  assert.equal((await readdir(root)).includes('.local-builds'), false);
  const run = spawnSync(process.execPath, [path.join(scripts, 'verify-package.mjs')], {
    cwd: root, env: { ...process.env, npm_execpath: npm }, encoding: 'utf8', timeout: 5000,
  });
  assert.equal(run.status, 1);
  assert.equal(run.stdout, '');
  assert.match(run.stderr, /npm pack exited 73/);
  assert.match(run.stderr, /fixture pack stopped before installation/);
  assert.doesNotMatch(run.stderr, /ENOENT/);
  const args = JSON.parse(await readFile(path.join(root, 'observed.json'), 'utf8'));
  assert.deepEqual(args.slice(0, 4), ['pack', '--ignore-scripts', '--json', '--pack-destination']);
  assert.ok(args[4].startsWith(path.join(root, '.local-builds') + path.sep));
  assert.deepEqual(await readdir(path.join(root, '.local-builds')), []);
  assert.equal(await readFile(path.join(root, 'package.json'), 'utf8'), manifest);
  assert.equal(await readFile(path.join(root, 'package-lock.json'), 'utf8'), lock);
});
