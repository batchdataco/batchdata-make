import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { render } from './iml.mjs';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (rel) => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
const catalog = read('scripts/catalog.json');
const app = read('makecomapp.json');
const camel = (s) => s.replace(/[-_]+([a-z0-9])/g, (_, c) => c.toUpperCase());
const files = (key) => app.components.module[key].codeFiles;
const comm = (key) => read(files(key).communication);
const params = (key) => read(files(key).mappableParams);
const request = (key, parameters, extra = {}) => {
  const c = comm(key);
  const scope = { parameters, connection: { apiKey: 't' }, ...extra };
  return { url: render(c.url, scope), method: render(c.method, scope), qs: render(c.qs, scope), body: render(c.body, scope) };
};
const setPath = (obj, p, v) => {
  const segs = p.split('.');
  let n = obj;
  segs.forEach((s, i) => {
    if (i === segs.length - 1) n[s] = v;
    else n = n[s] ??= {};
  });
  return obj;
};
// A fake API response built from the catalog's own result mapping and sample.
const fakeBody = (op) => {
  const r = op.result;
  const b = {};
  if (r.list) {
    setPath(b, r.list, [op.sample]);
    for (const [k, p] of Object.entries(r.attach ?? {})) setPath(b, p, { [k]: 1 });
  } else if (r.item) setPath(b, r.item, op.sample);
  else if (r.compose) for (const [k, p] of Object.entries(r.compose)) setPath(b, p, op.sample[k]);
  return b;
};

test('vendored catalog matches its recorded hash and the shared source when present', () => {
  const raw = fs.readFileSync(path.join(root, 'scripts/catalog.json'), 'utf8');
  assert.equal(createHash('sha256').update(raw).digest('hex'), fs.readFileSync(path.join(root, 'scripts/catalog.sha256'), 'utf8').trim());
  const shared = path.join(root, '..', 'shared', 'catalog.json');
  if (fs.existsSync(shared)) assert.equal(fs.readFileSync(shared, 'utf8'), raw);
});

test('every catalog operation and the polling and instant triggers are present as modules', () => {
  for (const op of catalog.ops) assert.ok(app.components.module[camel(op.key)], op.key);
  for (const key of ['watchSearchSessions', 'watchSessionProperties', 'watchMonitorEvents', 'watchMonitorEventsWithProperty']) {
    assert.ok(app.components.module[key], key);
  }
  assert.equal(Object.keys(app.components.module).length, 30);
});

test('copy lint: one contact, no retired names, no callback fields, no Zapier wording', () => {
  const banned = new RegExp(['batch' + 'leads', 'batch\\s*' + 'dialer'].join('|'), 'i');
  const dirs = ['modules', 'webhooks', 'rpcs', 'connections', 'general'];
  const all = dirs.flatMap((d) => fs.readdirSync(path.join(root, d), { recursive: true }).map((f) => path.join(root, d, f))).filter((f) => f.endsWith('.json'));
  for (const f of [...all, path.join(root, 'makecomapp.json')]) {
    const text = fs.readFileSync(f, 'utf8');
    assert.ok(!banned.test(text), f);
    assert.ok(!/webhookUrl|errorWebhookUrl/i.test(text), f);
    assert.ok(!/\bzap(s|ier)?\b/i.test(text), `${f} mentions Zapier`);
    if (f.includes('.samples.')) continue; // sample records contain made-up example data
    for (const email of text.match(/[\w.+-]+@[\w-]+\.[\w.]+/g) ?? []) assert.equal(email.replace(/\.$/, ''), 'support@batchservice.com', f);
  }
});

test('request sweep: every operation builds a versioned URL and a body that renders cleanly', () => {
  for (const op of catalog.ops) {
    const key = camel(op.key);
    const p = {};
    for (const f of op.fields) {
      const n = camel(f.key);
      if (f.type === 'rows') p[n] = [{ propertyAddress: { street: '1 Main St' }, address: { street: '1 Main St' }, street: '1 Main St' }];
      else if (f.type === 'integer' || f.type === 'number') p[n] = 3;
      else if (f.type === 'boolean') p[n] = true;
      else if (f.type === 'list') p[n] = ['a'];
      else if (f.type === 'choice') p[n] = f.choices[0].value;
      else if (f.type === 'json') p[n] = '{"general":{"x":1}}';
      else if (f.type === 'date') p[n] = '2026-01-02T00:00:00.000Z';
      else p[n] = 'abc';
    }
    const r = request(key, p);
    assert.match(r.url, /^\/v[123]\//, key);
    assert.ok(!r.url.includes('{{'), key);
    assert.equal(r.method, op.http.method, key);
    assert.ok(!JSON.stringify(r.body ?? {}).includes('{{'), `${key} left an expression unresolved`);
  }
});

test('output sweep: every operation yields the sample fields from a realistic response', () => {
  for (const op of catalog.ops) {
    const key = camel(op.key);
    const c = comm(key);
    const body = fakeBody(op);
    const iterate = c.response.iterate;
    const out = (item) => render(c.response.output, { body, item, parameters: { id: 'x' } });
    const results = iterate
      ? render(typeof iterate === 'string' ? iterate : iterate.container, { body }).filter((item) =>
          typeof iterate === 'string' ? true : render(iterate.condition, { item }),
        ).map(out)
      : [out()];
    if (op.key === 'reverse_skip_trace') continue; // the sample is the matched row, tested separately
    assert.ok(results.length >= 1, key);
    for (const k of Object.keys(results[0])) assert.ok(k in read(files(key).samples), `${key}: output field ${k} is not in the sample`);
  }
});

test('TCPA-flagged phones are explicit on every skip trace style operation', () => {
  for (const op of catalog.ops.filter((o) => o.skipTraceLike)) {
    const key = camel(op.key);
    const base = { phone: '4805550123', properties: [{ propertyAddress: { street: '1 Main St' } }] };
    assert.strictEqual(request(key, base).body.options.includeTCPABlacklistedPhones, false, key);
    assert.strictEqual(request(key, { ...base, includeTcpaFlagged: true }).body.options.includeTCPABlacklistedPhones, true, key);
    assert.match(app.components.module[key].description, /TCPA/, key);
  }
  for (const k of ['investorBuybox']) assert.match(app.components.module[k].description, /TCPA/);
});

test('batch operations pass the rows straight through and cap them at 100 in the help text', () => {
  const rows = [{ propertyAddress: { street: '1 Main St', city: 'Phoenix' }, name: { first: 'Ann' }, requestId: 'r1' }];
  assert.deepEqual(request('batchSkipTrace', { properties: rows }).body.requests, rows);
  const spec = params('batchSkipTrace')[0].spec;
  assert.deepEqual(spec.map((s) => s.name).sort(), ['name', 'propertyAddress', 'requestId']);
  assert.match(params('batchSkipTrace')[0].help, /100/);
  assert.deepEqual(request('batchVerifyAddress', { addresses: [{ street: 'a' }] }).body, { requests: [{ street: 'a' }] });
  const lookup = request('batchLookupProperty', { addresses: [{ address: { street: 'a' } }], datasets: ['owner'] });
  assert.deepEqual(lookup.body.options, { datasets: ['owner'] });
});

test('reverse skip trace sends one request and keeps only matched rows', () => {
  const r = request('reverseSkipTrace', { email: 'a@example.com' });
  assert.deepEqual(r.body.requests, [{ email: 'a@example.com' }]);
  const c = comm('reverseSkipTrace');
  const body = { result: { data: [{ meta: { matched: false } }, { meta: { matched: true }, persons: [{}] }] } };
  const kept = render(c.response.iterate.container, { body }).filter((item) => render(c.response.iterate.condition, { item }));
  assert.equal(kept.length, 1);
  assert.match(app.components.module.reverseSkipTrace.description, /Fill in at least one of: Phone Number, Email Address/);
});

test('permits, geocoding and investors build the documented requests', () => {
  const p = request('getPermits', { address: { street: '1 Main St' }, status: { equals: 'active' }, allTags: { inList: ['solar'] }, issueDate: { minDate: '2026-01-02' }, take: 10 });
  assert.equal(p.url, '/v2/property/get-property-permits');
  assert.deepEqual(p.body, {
    request: { address: { street: '1 Main St' }, status: { equals: 'active' }, allTags: { inList: ['solar'] }, issueDate: { minDate: '2026-01-02' } },
    options: { take: 10 },
  });
  assert.deepEqual(request('reverseGeocode', { latitude: 33.4, longitude: -112.1 }).body, { request: { latitude: 33.4, longitude: -112.1 }, options: {} });
  assert.deepEqual(request('geocodeAddress', { address: '1 Main St, Phoenix, AZ' }).body, { requests: [{ address: '1 Main St, Phoenix, AZ' }] });
  assert.deepEqual(request('autocompleteAddress', { query: '2800 N 24' }).body, { searchCriteria: { query: '2800 N 24' }, options: { take: 5 } });
  const b = request('investorBuybox', { street: '1 Main St', investor: { classification: { inList: ['flipper'] } }, additionalCriteria: '{"x":{"y":1}}' });
  assert.deepEqual(b.body.searchCriteria, { x: { y: 1 }, compAddress: { street: '1 Main St' }, investor: { classification: { inList: ['flipper'] } } });
  const ip = request('investorProperties', { investorId: 'inv1', includeChildEntities: true });
  assert.deepEqual(ip.body, { searchCriteria: { investorId: 'inv1', includeChildEntities: true }, options: { take: 25 } });
});

test('search sessions: the session ID and cursor pagination are sent, deletes sanitize the ID', () => {
  const c = request('createSearchSession', { sessionId: 'my-session', query: 'Tempe, AZ', quickLists: ['vacant'] });
  assert.equal(c.url, '/v1/property/search');
  assert.deepEqual(c.body, {
    searchCriteria: { query: 'Tempe, AZ', quickLists: ['vacant'] },
    options: { searchSession: { id: 'my-session' }, take: 1, useCursorPagination: true },
  });
  assert.match(app.components.module.createSearchSession.description, /bill/i);
  const l = request('listSearchSessions', {});
  assert.equal(l.url, '/v2/property/search-sessions');
  assert.deepEqual(l.qs, { take: 50 });
  assert.equal(request('deleteSearchSession', { id: 'a/../b.c' }).url, '/v2/property/search-sessions/a____b_c');
  const idParam = params('deleteSearchSession')[0];
  assert.equal(idParam.options, 'rpc://listSearchSessions');
});

test('monitor creation is stream delivery only and never offers a webhook delivery type', () => {
  const m = params('createMonitor');
  const type = m.find((p) => p.name === 'deliveryType');
  assert.deepEqual(type.options.map((o) => o.value), ['kinesis', 'event-hub']);
  const k = request('createMonitor', { deliveryType: 'kinesis', query: 'Phoenix, AZ', kinesis: { streamName: 's', region: 'us-west-2' }, eventHub: { eventHubName: 'ignored' } });
  assert.deepEqual(k.body, { searchCriteria: { query: 'Phoenix, AZ' }, deliveryConfig: { type: 'kinesis', streamName: 's', region: 'us-west-2' } });
  const e = request('createMonitor', { deliveryType: 'event-hub', eventHub: { eventHubName: 'h' }, kinesis: { streamName: 'ignored' } });
  assert.deepEqual(e.body.deliveryConfig, { type: 'event-hub', eventHub: { eventHubName: 'h' } });
  assert.equal(request('deleteMonitor', { id: 'abc' }).url, '/v2/property-subscription/abc');
  assert.equal(request('getMonitor', { id: 'abc' }).method, 'GET');
  for (const key of ['createMonitor', 'listMonitors', 'getMonitor', 'deleteMonitor']) {
    assert.match(app.components.module[key].description, /5 monitors per team/, key);
  }
});

test('polling triggers: sessions by creation date, session properties by poll time, billing disclosed', () => {
  const s = comm('watchSearchSessions');
  assert.deepEqual(render(s.qs, {}), { take: 100 });
  assert.equal(s.response.trigger.date, '{{item.createdAt}}');
  const sample = read(files('watchSearchSessions').samples);
  assert.equal(render(s.response.trigger.id, { item: sample }), sample.id);
  const sp = comm('watchSessionProperties');
  const req = render(sp.body, { parameters: { sessionId: 'abc', query: 'Mesa, AZ', take: 5 } });
  assert.deepEqual(req, { searchCriteria: { query: 'Mesa, AZ' }, options: { searchSession: { id: 'abc' }, take: 5, useCursorPagination: true } });
  assert.match(app.components.module.watchSessionProperties.description, /Billed per property record delivered/);
  assert.match(app.components.module.watchSessionProperties.description, /Max Results|Max results/i);
  const names = read(files('watchSessionProperties').staticParams).map((p) => p.name);
  assert.ok(names.includes('sessionId') && names.includes('take'));
  assert.equal(read(files('watchSessionProperties').staticParams).find((p) => p.name === 'sessionId').required, true);
});

test('instant trigger: the hook is the trigger\'s own, criteria come from the webhook parameters', () => {
  const w = app.components.webhook.monitorEvents;
  const attach = read(w.codeFiles.attach);
  const scope = { parameters: { query: 'Phoenix, AZ', quickLists: ['vacant'] }, webhook: { url: 'https://hook.make.com/abc' } };
  assert.deepEqual(render(attach.body, scope), {
    searchCriteria: { query: 'Phoenix, AZ', quickLists: ['vacant'] },
    deliveryConfig: { type: 'webhook', url: 'https://hook.make.com/abc' },
  });
  const detach = read(w.codeFiles.detach);
  assert.equal(render(detach.url, { webhook: { externalHookId: 'sub1' } }), '/v2/property-subscription/sub1');
  assert.equal(render(attach.response.data.externalHookId, { body: { result: { subscriptionId: 'sub1' } } }), 'sub1');
  const hook = read(w.codeFiles.communication);
  const payload = { eventId: 'e1', propertyId: 'p1', addedToSubscriptionIds: ['sub1'] };
  assert.equal(render(hook.condition, { body: payload }), true);
  assert.equal(render(hook.condition, { body: { hello: 1 } }), false);
  assert.equal(render(hook.output, { body: payload }).id, 'e1');
  assert.equal(render(hook.output, { body: payload }).propertyId, 'p1');
  const params_ = read(w.codeFiles.params).map((p) => p.name);
  assert.ok(!params_.some((n) => /include|webhook|url/i.test(n)), params_.join());
});

test('instant trigger: property lookup only happens in the billed variant', () => {
  assert.deepEqual(comm('watchMonitorEvents'), {});
  const c = comm('watchMonitorEventsWithProperty');
  const payload = { id: 'e1', eventId: 'e1', propertyId: 'p1' };
  assert.equal(c.url, '/v1/property/lookup/all-attributes');
  assert.deepEqual(render(c.body, { payload }), { requests: [{ propertyId: 'p1' }] });
  const out = render(c.response.output, { payload, body: { results: { properties: [{ _id: 'p1' }] } } });
  assert.deepEqual(out, { ...payload, property: { _id: 'p1' } });
  assert.match(app.components.module.watchMonitorEventsWithProperty.description, /billed per event, per matched property/i);
  assert.match(app.components.module.watchMonitorEvents.description, /4 attempts per event/);
  assert.match(app.components.module.watchMonitorEvents.description, /Property Record/);
});

test('generic API call: wallet, async, path tricks and monitor creation are blocked', () => {
  const c = comm('makeAnApiCall');
  const url = (u, method = 'GET') => render(c.url, { parameters: { url: u, method } });
  for (const ok of ['v1/property/search', 'v2/property/search-sessions', 'v3/property/skip-trace']) assert.equal(url(ok, 'POST'), `/${ok}`);
  assert.equal(url('v2/property-subscription', 'GET'), '/v2/property-subscription');
  assert.equal(url('v2/property-subscription/abc', 'DELETE'), '/v2/property-subscription/abc');
  for (const bad of ['v1/wallet', 'v2/WALLET/x', 'v3/property/skip-trace/async', 'v1/Async/x', 'v1/../v2/wallet', 'v1/property%2Fwallet', 'v1/x?y=1', 'https://example.com/x', 'x://y']) {
    assert.equal(url(bad, 'POST'), '/blocked/not-available', bad);
  }
  for (const m of ['POST', 'PUT', 'PATCH']) assert.equal(url('v2/property-subscription', m), '/blocked/not-available', m);
  for (const body of ['{"web\\u0068ookUrl":"x"}', '{"webhook":"x"}', '{"a":{"errorWebhookUrl":"x"}}', '{"WebhookUrl":"x"}']) {
    assert.equal(render(c.url, { parameters: { url: 'v1/property/search', method: 'POST', body } }), '/blocked/not-available', body);
  }
});

test('blocked API calls send no body or query; the webhook dedupes on eventId', () => {
  const c = comm('makeAnApiCall');
  const scope = { parameters: { url: 'v1/wallet', method: 'POST', body: '{"a":1}', qs: [{ key: 'x', value: '1' }] } };
  assert.equal(render(c.body, scope), undefined);
  assert.deepEqual(render(c.qs, scope), {});
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'webhooks/monitorEvents/monitorEvents.communication.iml.json'), 'utf8')).uid, '{{body.eventId}}');
});
