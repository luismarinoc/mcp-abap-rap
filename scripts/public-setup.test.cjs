const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');

for (const name of ['activar.command', 'generar-mcps.command']) {
  test(`${name} derives its project directory from the launcher`, () => {
    const source = fs.readFileSync(path.join(root, name), 'utf8');
    const assignment = source.match(/^PROY=(.+)$/m);
    assert.ok(assignment, 'project assignment exists');
    assert.doesNotMatch(assignment[0], /\/Users\//);
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'public-setup-path-'));
    try {
      const launcher = path.join(scratch, name);
      fs.writeFileSync(launcher, `#!/bin/bash\n${assignment[0]}\nprintf '%s' "$PROY"\n`);
      const result = spawnSync('/bin/bash', [launcher], { encoding: 'utf8' });
      assert.equal(result.status, 0);
      assert.equal(result.stderr, '');
      assert.equal(result.stdout, fs.realpathSync(scratch));
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  });
}

test('client example uses reserved endpoints and generic placeholder accounts', () => {
  const example = JSON.parse(fs.readFileSync(path.join(root, 'clientes.example.json'), 'utf8'));
  assert.ok(example.clientes[example.porDefecto]);
  for (const client of Object.values(example.clientes)) {
    assert.match(new URL(client.url).hostname, /(?:^|\.)example\.invalid$/);
    assert.equal(client.usuario, 'YOUR_USER');
    assert.equal(client.password, 'YOUR_PASSWORD');
    assert.deepEqual(Object.keys(client).sort(), ['descripcion', 'idioma', 'mandante', 'password', 'url', 'usuario'].sort());
  }
});

test('revert fails without npx before touching fixture configuration', () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'public-setup-revert-'));
  try {
    const home = path.join(scratch, 'home');
    const bin = path.join(scratch, 'bin');
    const config = path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
    fs.mkdirSync(path.dirname(config), { recursive: true });
    fs.mkdirSync(bin);
    fs.writeFileSync(config, '{"mcpServers":{"existing":{"command":"keep"}}}\n');
    // Only the preflight path may run; do not expose python, npm, or pkill.
    fs.symlinkSync('/bin/bash', path.join(bin, 'bash'));
    const original = fs.readFileSync(config);
    const result = spawnSync('/bin/bash', [path.join(root, 'revertir.command')], {
      env: { HOME: home, PATH: bin }, input: '', encoding: 'utf8', timeout: 5000
    });
    assert.equal(result.status, 1);
    assert.match(result.stdout + result.stderr, /npx/i);
    assert.deepEqual(fs.readFileSync(config), original);
    assert.deepEqual(fs.readdirSync(path.dirname(config)), ['claude_desktop_config.json']);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});
