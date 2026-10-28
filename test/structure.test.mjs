import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (rel) => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
const app = read('makecomapp.json');
const walk = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (['node_modules', '.git', '.secrets'].includes(e.name)) return [];
    return e.isDirectory() ? walk(p) : [p];
  });
const allFiles = walk(root);
const jsonFiles = allFiles.filter((f) => f.endsWith('.json'));

test('every JSON file parses', () => {
  for (const f of jsonFiles) JSON.parse(fs.readFileSync(f, 'utf8'));
  assert.ok(jsonFiles.length > 30);
});

test('manifest points at files that exist', () => {
  for (const rel of Object.values(app.generalCodeFiles)) assert.ok(fs.existsSync(path.join(root, rel)), rel);
  for (const c of Object.values(app.components.connection)) {
    for (const rel of Object.values(c.codeFiles)) assert.ok(fs.existsSync(path.join(root, rel)), rel);
  }
  for (const [key, m] of Object.entries(app.components.module)) {
    assert.ok(['search', 'action', 'universal'].includes(m.moduleType), key);
    assert.equal(m.connection, 'batchdata');
    assert.ok(m.label && m.description, key);
    for (const rel of Object.values(m.codeFiles)) assert.ok(fs.existsSync(path.join(root, rel)), rel);
  }
});

test('id mapping covers every module and groups cover every module', () => {
  const keys = Object.keys(app.components.module).sort();
  const mapped = app.origins[0].idMapping.module.map((m) => m.local).sort();
  assert.deepEqual(mapped, keys);
  const grouped = read('modules/groups.json').flatMap((g) => g.modules).sort();
  assert.deepEqual(grouped, keys);
});

test('no triggers or webhooks are declared', () => {
  for (const m of Object.values(app.components.module)) {
    assert.ok(!m.moduleType.includes('trigger'));
  }
  assert.equal(app.components.webhook, undefined);
});

test('module URLs use a versioned API path and never the wallet', () => {
  for (const [key, m] of Object.entries(app.components.module)) {
    const comm = read(m.codeFiles.communication);
    if (m.moduleType !== 'universal') assert.match(comm.url, /^\/v[123]\//, key);
  }
});

test('no callback fields and no wallet endpoints anywhere in the app', () => {
  const skip = ['test', 'scripts', 'DEVELOPMENT.md'];
  for (const f of allFiles) {
    const rel = path.relative(root, f);
    if (skip.some((s) => rel.startsWith(s))) continue;
    if (rel.endsWith('.png') || rel === 'package-lock.json') continue;
    const text = fs.readFileSync(f, 'utf8');
    assert.ok(!/webhookUrl|errorWebhookUrl/i.test(text), `${rel} mentions a callback field`);
    if (rel.startsWith('modules/') || rel.startsWith('connections/') || rel.startsWith('general/')) {
      const wallet = text.match(/wallet/gi) || [];
      const allowed = rel.includes('makeAnApiCall');
      assert.ok(wallet.length === 0 || allowed, `${rel} mentions wallet`);
    }
  }
});

test('retired product names never appear', () => {
  for (const f of allFiles) {
    if (f.includes(`${path.sep}test${path.sep}`)) continue;
    const text = fs.readFileSync(f, 'utf8');
    assert.ok(!/batchleads|batch dialer|batchdialer/i.test(text), f);
  }
});

test('billing is disclosed on every data module', () => {
  for (const [key, m] of Object.entries(app.components.module)) {
    if (m.moduleType === 'universal') continue;
    assert.match(m.description, /billed/i, key);
  }
});

test('phone and skip trace modules carry the compliance note', () => {
  for (const key of ['skipTraceV1', 'skipTraceV3', 'verifyPhones', 'checkDnc', 'checkTcpa']) {
    assert.match(app.components.module[key].description, /TCPA/, key);
  }
});

test('the connection hides the token in logs and has no secret literal', () => {
  const comm = read('connections/batchdata/batchdata.communication.iml.json');
  assert.deepEqual(comm.log.sanitize, ['request.headers.authorization']);
  assert.deepEqual(read('general/base.iml.json').log.sanitize, ['request.headers.authorization']);
  const params = read('connections/batchdata/batchdata.params.iml.json');
  assert.equal(params[0].type, 'password');
});

test('secrets are git-ignored', () => {
  assert.match(fs.readFileSync(path.join(root, '.gitignore'), 'utf8'), /\.secrets/);
});

test('every module has samples that match its interface top-level names', () => {
  for (const [key, m] of Object.entries(app.components.module)) {
    const iface = read(m.codeFiles.interface).map((f) => f.name).sort();
    const sample = Object.keys(read(m.codeFiles.samples)).sort();
    assert.deepEqual(iface, sample, key);
  }
});
