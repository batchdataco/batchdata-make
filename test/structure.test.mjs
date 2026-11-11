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
    assert.ok(['search', 'action', 'universal', 'trigger', 'instant_trigger'].includes(m.moduleType), key);
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

test('triggers: polling ones declare a trigger rule, instant ones point at a declared webhook', () => {
  const polling = Object.entries(app.components.module).filter(([, m]) => m.moduleType === 'trigger');
  const instant = Object.entries(app.components.module).filter(([, m]) => m.moduleType === 'instant_trigger');
  assert.equal(polling.length, 2);
  assert.equal(instant.length, 2);
  for (const [key, m] of polling) {
    const rule = read(m.codeFiles.communication).response.trigger;
    assert.ok(['id', 'date'].includes(rule.type), key);
    assert.ok(['asc', 'desc', 'unordered'].includes(rule.order), key);
    assert.ok(m.codeFiles.staticParams, key);
    assert.equal(m.codeFiles.mappableParams, undefined, key);
  }
  for (const [key, m] of instant) {
    assert.ok(app.components.webhook[m.webhook], key);
    assert.equal(m.actionCrud, undefined, key);
  }
});

test('the webhook component creates and removes its own monitor and nothing else', () => {
  const w = app.components.webhook.monitorEvents;
  assert.equal(w.webhookType, 'web');
  assert.equal(w.connection, 'batchdata');
  for (const rel of Object.values(w.codeFiles)) assert.ok(fs.existsSync(path.join(root, rel)), rel);
  const attach = read(w.codeFiles.attach);
  assert.equal(attach.method, 'POST');
  assert.equal(attach.url, '/v2/property-subscription');
  assert.deepEqual(attach.body.deliveryConfig, { type: 'webhook', url: '{{webhook.url}}' });
  assert.equal(attach.response.data.externalHookId, '{{body.result.subscriptionId}}');
  const detach = read(w.codeFiles.detach);
  assert.equal(detach.method, 'DELETE');
  assert.equal(detach.url, '/v2/property-subscription/{{webhook.externalHookId}}');
  assert.deepEqual(app.origins[0].idMapping.webhook.map((x) => x.local), ['monitorEvents']);
});

test('RPC dropdowns are declared, mapped and used', () => {
  assert.deepEqual(Object.keys(app.components.rpc).sort(), ['listMonitors', 'listSearchSessions']);
  assert.deepEqual(app.origins[0].idMapping.rpc.map((x) => x.local).sort(), ['listMonitors', 'listSearchSessions']);
  for (const r of Object.values(app.components.rpc)) for (const rel of Object.values(r.codeFiles)) assert.ok(fs.existsSync(path.join(root, rel)), rel);
  const used = JSON.stringify(read(app.components.module.deleteSearchSession.codeFiles.mappableParams));
  assert.match(used, /rpc:\/\/listSearchSessions/);
});

test('module URLs use a versioned API path and never the wallet', () => {
  for (const [key, m] of Object.entries(app.components.module)) {
    const comm = read(m.codeFiles.communication);
    if (m.moduleType !== 'universal' && comm.url) assert.match(comm.url, /^\/v[123]\//, key);
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
    assert.match(m.description, /bill/i, key);
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

test('makecomapp.json documents the us2 private app as an origin', () => {
  const o = app.origins[0];
  assert.equal(o.baseUrl, 'https://us2.make.com/api');
  assert.equal(o.appId, 'batchdata-r6b83g');
  assert.equal(o.idMapping.connection[0].remote, 'batchdata-r6b83g');
  assert.equal(o.apikeyFile, '.secrets/apikey');
});

test('the README is written for users', () => {
  const text = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  assert.ok(!/not yet imported|BatchLeads|BatchDialer|zapier|n8n/i.test(text));
  assert.ok(!/\$\s?\d/.test(text), 'the README must not state prices');
  assert.match(text, /support@batchservice\.com/);
  assert.match(text, /API token/);
  assert.ok(fs.existsSync(path.join(root, 'assets/logo-512.png')));
});

test('no module description refers to itself', () => {
  for (const [key, m] of Object.entries(app.components.module)) assert.ok(!m.description.includes(`"${m.label}"`), `${key} mentions itself`);
});

test('the connection label fallback never includes the app name', () => {
  const comm = read('connections/batchdata/batchdata.communication.iml.json');
  const meta = comm.response.metadata;
  assert.equal(meta.type, 'text');
  assert.match(meta.value, /Token ending/);
  assert.match(meta.value, /API token/);
  assert.match(meta.value, /API token missing/);
  assert.ok(!/BatchData/i.test(meta.value), 'connection label must not include the app name');
});

test('HTTP 402 and 404 have clear error messages', () => {
  const errors = read('general/base.iml.json').response.error;
  assert.equal(errors[402].type, 'DataError');
  assert.match(errors[402].message, /balance is too low/);
  assert.match(errors[402].message, /support@batchservice\.com/);
  assert.equal(errors[404].type, 'RuntimeError');
  assert.match(errors[404].message, /Not found/);
});

test('billed search modules default to Limit 1, and the billed session trigger defaults to 5', () => {
  const app = read('makecomapp.json');
  for (const key of ['searchProperties', 'getPermits', 'investorBuybox', 'investorProperties']) {
    const params = read(app.components.module[key].codeFiles.mappableParams);
    const limit = params.find((p) => p.name === 'limit');
    assert.equal(limit.default, 1, key);
  }
  const take = read(app.components.module.watchSessionProperties.codeFiles.staticParams).find((p) => p.name === 'take');
  assert.equal(take.default, 5);
  assert.match(take.help, /Default 5/);
});


test('every first() mapping is guarded and marks a missing API object as InvalidAccessTokenError', () => {
  const files = jsonFiles.filter((f) => f.endsWith('.communication.iml.json') || f.endsWith('batchdata.communication.iml.json'));
  let found = 0;
  for (const f of files) {
    const text = fs.readFileSync(f, 'utf8');
    const rel = path.relative(root, f);
    const matches = [...text.matchAll(/\{\{first\(([^}]+)\)\}\}/g)];
    for (const m of matches) {
      found += 1;
      assert.match(m[1], /ifempty\(.+, emptyarray\)/, `${rel} unguarded first(${m[1]})`);
    }
  }
  assert.ok(found >= 3, `expected at least 3 first() mappings, found ${found}`);

  for (const [rel, parent] of [
    ['modules/lookupProperty/lookupProperty.communication.iml.json', 'body.results'],
    ['modules/verifyAddress/verifyAddress.communication.iml.json', 'body.results'],
    ['modules/watchMonitorEventsWithProperty/watchMonitorEventsWithProperty.communication.iml.json', 'body.results'],
  ]) {
    const comm = read(rel);
    assert.equal(comm.response.valid.type, 'InvalidAccessTokenError', rel);
    assert.match(comm.response.valid.condition, new RegExp(parent.replace('.', '\\.')), rel);
    assert.match(comm.response.valid.message, /API token is valid/);
  }
});
