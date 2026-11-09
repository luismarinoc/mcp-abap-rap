const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const utility = path.join(__dirname, 'prepare-review.cjs');
const put = (root, name, value) => {
  const file = path.join(root, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value);
};

function fixture(t) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'prepare-review-test-'));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const project = path.join(scratch, 'project');
  const temp = path.join(scratch, 'owned-temp');
  fs.mkdirSync(temp);
  put(project, 'scripts/prepare-review.cjs', fs.readFileSync(utility));
  put(project, 'src/sample.ts', 'original source bytes\n');
  put(project, 'package.json', '{}');
  put(project, 'package-lock.json', '{}');
  put(project, 'tsconfig.json', '{}');
  put(project, 'jest.config.js', 'module.exports = {};');
  put(project, 'node_modules/dependency/dist/index.js', 'nested dependency dist\n');
  put(project, 'node_modules/jest/bin/jest.js', fakeCli('jest'));
  put(project, 'node_modules/typescript/bin/tsc', fakeCli('tsc'));
  put(project, '.env', 'private');
  put(project, '.env.example', 'private');
  put(project, 'clientes.json', 'private');
  put(project, 'clientes-local.json', 'private');
  put(project, 'dist/index.js', 'old installed build');
  put(project, 'src/.env.local', 'nested private');
  put(project, 'src/clientes-dev.json', 'nested private');
  put(project, 'src/backup.bak', 'backup');
  put(project, 'node_modules/dependency/.cache/data', 'cached');
  const run = (args = [], vars = {}) => spawnSync(process.execPath, [path.join(project, 'scripts/prepare-review.cjs'), ...args], {
    encoding: 'utf8', env: { ...process.env, TMPDIR: temp, HOME: '/not-the-owned-home',
      NODE_OPTIONS: '', NODE_PATH: '/private/modules', SAP_TEST_TOKEN: 'do-not-inherit',
      ...vars }
  });
  return { scratch, project, temp, run };
}

function fakeCli(which) {
  return `const fs = require('node:fs');
const path = require('node:path');
const here = process.cwd();
fs.writeFileSync(path.join(here, '${which}.observed.json'), JSON.stringify({ cwd: here, argv: process.argv, env: process.env }));
process.stdout.write('${which} output\\n');
process.stderr.write('${which} warning\\n');
if (fs.existsSync(path.join(here, 'src/fail-${which}'))) process.exit('${which}' === 'jest' ? 7 : 9);
`;
}

function result(run) {
  assert.match(run.stdout, /Report: (.+\/report\.json)\n/);
  const reportPath = run.stdout.match(/Report: (.+\/report\.json)\n/)[1];
  return { report: JSON.parse(fs.readFileSync(reportPath, 'utf8')), copy: path.dirname(reportPath) };
}

test('physical allowlist copy preserves source, nested dist, clean child environment and exact logs', t => {
  const f = fixture(t);
  const before = fs.readFileSync(path.join(f.project, 'src/sample.ts'));
  fs.symlinkSync('dist/index.js', path.join(f.project, 'node_modules/dependency/alias.js'));
  const run = f.run();
  assert.equal(run.status, 0, run.stderr);
  const { copy, report } = result(run);
  assert.ok(copy.startsWith(f.temp + path.sep));
  assert.deepEqual(fs.readFileSync(path.join(f.project, 'src/sample.ts')), before);
  assert.deepEqual(fs.readFileSync(path.join(copy, 'snapshot/src/sample.ts')), before);
  assert.equal(fs.readFileSync(path.join(copy, 'snapshot/node_modules/dependency/dist/index.js'), 'utf8'), 'nested dependency dist\n');
  assert.equal(fs.readFileSync(path.join(copy, 'snapshot/node_modules/dependency/alias.js'), 'utf8'), 'nested dependency dist\n');
  assert.equal(fs.lstatSync(path.join(copy, 'snapshot/node_modules/dependency/alias.js')).isSymbolicLink(), false);
  for (const name of ['.env', '.env.example', 'clientes.json', 'clientes-local.json', 'dist',
    'src/.env.local', 'src/clientes-dev.json', 'src/backup.bak', 'node_modules/dependency/.cache']) {
    assert.equal(fs.existsSync(path.join(copy, 'snapshot', name)), false, name);
  }
  for (const [which, args] of [['jest', ['--runInBand', '--no-cache', '--coverage=false']], ['tsc', ['-p', 'tsconfig.json']]]) {
    const observed = JSON.parse(fs.readFileSync(path.join(copy, 'snapshot', `${which}.observed.json`)));
    assert.equal(observed.cwd, fs.realpathSync(path.join(copy, 'snapshot')));
    assert.equal(observed.argv[0], process.execPath);
    assert.equal(observed.argv[1], path.join(copy, 'snapshot/node_modules', which === 'jest' ? 'jest/bin/jest.js' : 'typescript/bin/tsc'));
    assert.deepEqual(observed.argv.slice(2), args);
    assert.equal(observed.env.HOME, path.join(copy, 'home'));
    assert.equal(observed.env.TMPDIR, path.join(copy, 'tmp'));
    assert.equal(observed.env.NODE_PATH, undefined);
    assert.equal(observed.env.NODE_OPTIONS, undefined);
    assert.equal(observed.env.SAP_TEST_TOKEN, undefined);
    assert.equal(report.commands[which].status, 0);
    assert.equal(fs.readFileSync(path.join(copy, `${which}.stdout`), 'utf8'), `${which} output\n`);
    assert.equal(fs.readFileSync(path.join(copy, `${which}.stderr`), 'utf8'), `${which} warning\n`);
  }
  assert.equal(report.codeReviewPerformed, false);
  assert.equal(report.agentInvoked, false);
  assert.equal(report.installationPerformed, false);
});

test('failed Jest retains exact status/logs, skips TypeScript and does not retry', t => {
  const f = fixture(t);
  put(f.project, 'src/fail-jest', '7');
  const run = f.run();
  assert.equal(run.status, 7);
  const { copy, report } = result(run);
  assert.equal(report.commands.jest.status, 7);
  assert.equal(report.commands.tsc, undefined);
  assert.equal(fs.existsSync(path.join(copy, 'snapshot/tsc.observed.json')), false);
  assert.equal(fs.readFileSync(path.join(copy, 'jest.stdout'), 'utf8'), 'jest output\n');
  assert.equal(fs.readFileSync(path.join(copy, 'jest.stderr'), 'utf8'), 'jest warning\n');
  assert.equal(report.codeReviewPerformed, false);
});

test('failed TypeScript retains status, without retry or false review claims', t => {
  const f = fixture(t);
  put(f.project, 'src/fail-tsc', '9');
  const run = f.run();
  assert.equal(run.status, 9);
  const { copy, report } = result(run);
  assert.equal(report.commands.jest.status, 0);
  assert.equal(report.commands.tsc.status, 9);
  assert.equal(fs.readFileSync(path.join(copy, 'tsc.stderr'), 'utf8'), 'tsc warning\n');
  assert.equal(report.codeReviewPerformed, false);
});

test('escaping symlink is rejected before following private contents, with retained failure report', t => {
  const f = fixture(t);
  put(f.scratch, 'secret.txt', 'private');
  fs.symlinkSync(path.join(f.scratch, 'secret.txt'), path.join(f.project, 'src/escape.ts'));
  const run = f.run();
  assert.notEqual(run.status, 0);
  const { copy, report } = result(run);
  assert.match(report.error, /symlink|link/i);
  assert.equal(fs.existsSync(path.join(copy, 'snapshot/src/escape.ts')), false);
  assert.equal(fs.existsSync(path.join(copy, 'jest.observed.json')), false);
  assert.equal(report.codeReviewPerformed, false);
});

test('private configuration is not retained in a successful snapshot', t => {
  const f = fixture(t);
  put(f.project, 'src/.npmrc', '//registry.npmjs.org/:_authToken=private-token\n');
  put(f.project, 'src/credentials.json', '{"token":"private-token"}\n');
  const run = f.run();
  assert.equal(run.status, 0, run.stderr);
  const { copy, report } = result(run);
  assert.equal(fs.existsSync(path.join(copy, 'snapshot/src/.npmrc')), false);
  assert.equal(fs.existsSync(path.join(copy, 'snapshot/src/credentials.json')), false);
  assert.equal(fs.readFileSync(path.join(f.project, 'src/.npmrc'), 'utf8'), '//registry.npmjs.org/:_authToken=private-token\n');
  assert.equal(fs.readFileSync(path.join(f.project, 'src/credentials.json'), 'utf8'), '{"token":"private-token"}\n');
  assert.equal(report.codeReviewPerformed, false);
});

test('alias to private configuration is rejected before running tools', t => {
  for (const [target, alias] of [['.npmrc', 'registry-alias'], ['credentials.json', 'credentials-alias.json']]) {
    const f = fixture(t);
    put(f.project, `src/${target}`, 'private fixture contents');
    fs.symlinkSync(target, path.join(f.project, 'src', alias));
    const run = f.run();
    assert.equal(run.status, 1);
    assert.equal(run.stderr, '');
    const { copy, report } = result(run);
    assert.equal(run.stdout, `Report: ${path.join(copy, 'report.json')}\n`);
    assert.equal(report.error, `Link targets excluded content: src/${alias}`);
    assert.deepEqual(report.commands, {});
    assert.equal(fs.existsSync(path.join(copy, 'snapshot/src', alias)), false);
    assert.equal(fs.existsSync(path.join(copy, 'jest.observed.json')), false);
    assert.equal(fs.readFileSync(path.join(f.project, 'src', target), 'utf8'), 'private fixture contents');
  }
});

test('help and unknown arguments have exact streams and no workspace side effects', t => {
  const f = fixture(t);
  const help = f.run(['--help']);
  assert.equal(help.status, 0);
  assert.equal(help.stderr, '');
  assert.match(help.stdout, /Usage: node scripts\/prepare-review\.cjs/);
  assert.match(help.stdout, /not an OS sandbox/i);
  assert.match(help.stdout, /report\.json/);
  const bad = f.run(['--unknown']);
  assert.equal(bad.status, 2);
  assert.equal(bad.stdout, '');
  assert.equal(bad.stderr, 'Unknown argument: --unknown\n');
  assert.deepEqual(fs.readdirSync(f.temp), []);
});
