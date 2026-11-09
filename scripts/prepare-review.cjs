#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const args = process.argv.slice(2);
const help = `Usage: node scripts/prepare-review.cjs [--help]

Prepare a physical copy excluding known private configuration names (.env*,
clientes*.json, .npmrc and credentials.json), then run installed Jest and TypeScript
without installing dependencies or changing the original project.
This is not an OS sandbox or an arbitrary-secret detector. Copied code executes
with your operating-system permissions. Only run trusted code. Output is retained.
The report.json and separate stdout/stderr logs record checks, not code review.
`;
if (args.length === 1 && args[0] === '--help') {
  process.stdout.write(help);
} else if (args.length) {
  process.stderr.write(`Unknown argument: ${args[0]}\n`);
  process.exitCode = 2;
} else {
  main();
}

function main() {
  const root = fs.realpathSync(path.resolve(__dirname, '..'));
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'prepare-review-'));
  fs.chmodSync(output, 0o700);
  const snapshot = path.join(output, 'snapshot');
  const report = {
    codeReviewPerformed: false,
    agentInvoked: false,
    installationPerformed: false,
    commands: {}
  };
  const excluded = name => name.startsWith('.env') || /^clientes.*\.json$/i.test(name) ||
    name === '.npmrc' || /^credentials\.json$/i.test(name) ||
    /(?:backup|backups|\.bak(?:-|$)|\.cache|coverage)/i.test(name) || name === '.git';
  const inside = (parent, file) => {
    const relative = path.relative(parent, file);
    return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
  };

  // Resolve every link before reading contents. Physical copies never retain links
  // to the live workspace; cycles and links escaping the project are rejected.
  function copy(source, destination, ancestors = new Set()) {
    const resolved = fs.realpathSync(source);
    if (!inside(root, resolved)) throw new Error(`Escaping symlink: ${path.relative(root, source)}`);
    if (path.relative(root, resolved).split(path.sep).some(excluded)) {
      throw new Error(`Link targets excluded content: ${path.relative(root, source)}`);
    }
    const stat = fs.statSync(resolved);
    if (stat.isDirectory()) {
      if (ancestors.has(resolved)) throw new Error(`Cyclic link: ${path.relative(root, source)}`);
      const next = new Set(ancestors).add(resolved);
      fs.mkdirSync(destination, { recursive: true });
      for (const name of fs.readdirSync(resolved)) {
        if (!excluded(name)) copy(path.join(resolved, name), path.join(destination, name), next);
      }
    } else if (stat.isFile()) {
      fs.copyFileSync(resolved, destination, fs.constants.COPYFILE_EXCL);
      fs.chmodSync(destination, stat.mode & 0o777);
    } else {
      throw new Error(`Unsupported file: ${path.relative(root, source)}`);
    }
  }

  try {
    // Explicit top-level allowlist: root dist, private configs and host artifacts
    // are never copied. Dependency dist directories are required and preserved.
    fs.mkdirSync(snapshot);
    for (const name of ['src', 'node_modules', 'package.json', 'package-lock.json',
      'tsconfig.json', 'jest.config.js', 'jest.config.cjs', 'jest.config.json']) {
      const source = path.join(root, name);
      if (fs.existsSync(source)) copy(source, path.join(snapshot, name));
    }
    const home = path.join(output, 'home');
    const tmp = path.join(output, 'tmp');
    fs.mkdirSync(home);
    fs.mkdirSync(tmp);
    const env = { HOME: home, TMPDIR: tmp, TMP: tmp, TEMP: tmp, CI: 'true' };
    // Do not inherit NODE_OPTIONS, NODE_PATH, SAP credentials or proxy settings.
    if (process.env.SystemRoot) env.SystemRoot = process.env.SystemRoot;
    const commands = [
      ['jest', 'jest/bin/jest.js', ['--runInBand', '--no-cache', '--coverage=false']],
      ['tsc', 'typescript/bin/tsc', ['-p', 'tsconfig.json']]
    ];
    for (const [name, cli, options] of commands) {
      const stdout = fs.openSync(path.join(output, `${name}.stdout`), 'wx', 0o600);
      const stderr = fs.openSync(path.join(output, `${name}.stderr`), 'wx', 0o600);
      let run;
      try {
        run = spawnSync(process.execPath, [path.join(snapshot, 'node_modules', cli), ...options], {
          cwd: snapshot, env, stdio: ['ignore', stdout, stderr]
        });
      } finally {
        fs.closeSync(stdout);
        fs.closeSync(stderr);
      }
      report.commands[name] = { status: run.status, signal: run.signal };
      if (run.error) report.commands[name].error = run.error.message;
      if (run.status !== 0) {
        process.exitCode = run.status || 1;
        break;
      }
    }
  } catch (error) {
    report.error = error.message;
    process.exitCode = 1;
  } finally {
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
    process.stdout.write(`Report: ${path.join(output, 'report.json')}\n`);
  }
}
