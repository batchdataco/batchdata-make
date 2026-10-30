import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { render } from './iml.mjs';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (rel) => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
const comm = (name) => read(`modules/${name}/${name}.communication.iml.json`);
const fixture = (name) => read(`test/fixtures/${name}.json`);

const PAGED = ['searchProperties', 'investorProperties', 'investorBuybox', 'getPermits', 'listSearchSessions', 'watchSearchSessions'];

// Response paths, checked against the BatchData OpenAPI examples and test/fixtures.
const has = (obj, p) => p.split('.').reduce((n, k) => (n === undefined || n === null ? undefined : n[k]), obj) !== undefined;
test('the response paths the pagination reads exist in real BatchData responses', () => {
  assert.ok(has(fixture('property-search'), 'results.meta.results.resultsFound'));
  assert.ok(has(fixture('property-search'), 'results.properties'));
  for (const [file, p] of Object.entries({
    'search-sessions': 'results.total',
    'investor-properties': 'result.nextPageCursor',
    'investor-buybox': 'result.meta.results.resultsFound',
    'property-permits': 'result.meta.results.resultsFound',
  })) assert.ok(has(fixture(file), p), `${file} ${p}`);
});

// A fake BatchData endpoint that enforces the real rules and counts billed records.
const API = {
  searchProperties: (n) => {
    const rows = Array.from({ length: n }, (_, i) => ({ _id: `p${i}` }));
    return (req, bill) => {
      const { take = 25, skip = 0 } = req.body.options;
      assert.ok(take >= 1 && take <= 100, `take ${take} outside 1..100`);
      assert.ok(req.body.searchCriteria?.query, 'searchCriteria must be repeated on every request');
      const page = rows.slice(skip, skip + take);
      bill(page.length);
      return { results: { properties: page, meta: { results: { resultCount: page.length, resultsFound: n } } } };
    };
  },
  getPermits: (n) => {
    const rows = Array.from({ length: n }, (_, i) => ({ permitNumber: `x${i}` }));
    return (req, bill) => {
      const { take = 25, skip = 0 } = req.body.options;
      assert.ok(take >= 1 && take <= 100, `take ${take}`);
      assert.ok(req.body.request?.propertyId === 'P-1', 'the property must be repeated on every request');
      bill(1); // billed per property requested, not per permit
      const page = rows.slice(skip, skip + take);
      return { result: { permits: page, property: {}, meta: { results: { resultCount: page.length, resultsFound: n } } } };
    };
  },
  investorBuybox: (n) => {
    const rows = Array.from({ length: n }, (_, i) => ({ id: `i${i}` }));
    return (req, bill) => {
      const { take = 25, skip = 0 } = req.body.options;
      assert.ok(take >= 1 && take <= 100, `take ${take}`);
      assert.ok(req.body.searchCriteria, 'searchCriteria must be repeated on every request');
      const page = rows.slice(skip, skip + take);
      bill(page.length);
      return { result: { investors: page, meta: { results: { resultCount: page.length, resultsFound: n } } } };
    };
  },
  investorProperties: (n) => {
    const rows = Array.from({ length: n }, (_, i) => ({ propertyId: `p${i}` }));
    return (req, bill) => {
      const { take = 25, pageCursor, skip } = req.body.options;
      assert.equal(skip, undefined, 'skip is rejected by this endpoint');
      assert.ok(take >= 1 && take <= 100, `take ${take}`);
      assert.equal(req.body.searchCriteria.investorId, 'inv-1', 'searchCriteria must be repeated on every request');
      const from = pageCursor ? Number(pageCursor.replace('c', '')) : 0;
      const page = rows.slice(from, from + take);
      bill(page.length);
      // A full last page still returns a cursor.
      return { result: { properties: page, resultsFound: n, nextPageCursor: page.length === take ? `c${from + take}` : undefined } };
    };
  },
  listSearchSessions: (n) => {
    const rows = Array.from({ length: n }, (_, i) => ({ id: `s${i}` }));
    return (req) => {
      const { take = 50, skip = 0 } = req.qs;
      assert.ok(take >= 1 && take <= 100, `take ${take}`);
      return { results: { sessions: rows.slice(skip, skip + take), total: n } };
    };
  },
};
API.watchSearchSessions = API.listSearchSessions;

// Plays a module the way Make does: first request, then pagination requests (page 2, 3, ...)
// until response.limit is reached, the condition is false, or the API returns nothing.
const run = (name, parameters, n, { requestBase } = {}) => {
  const c = comm(name);
  const endpoint = API[name](n);
  let billed = 0;
  const requests = [];
  const send = (req) => {
    requests.push(req);
    return endpoint(req, (k) => (billed += k));
  };
  const scope = (extra = {}) => ({ parameters, ...extra });
  const items = [];
  const list = (body) => render(c.response.iterate, { body });
  const limit = render(c.response.limit, scope());
  let body = send({ body: render(c.body, scope()), qs: render(c.qs, scope()) });
  items.push(...list(body));
  for (let page = 2; page < 60 && items.length < limit; page++) {
    const ctx = scope({ body, pagination: { page } });
    if (!render(c.pagination.condition, ctx)) break;
    const base = { body: render(c.body, scope()), qs: render(c.qs, scope()) };
    const req = {
      body: c.pagination.body ? render(c.pagination.body, ctx) : base.body,
      qs: c.pagination.qs ? { ...base.qs, ...render(c.pagination.qs, ctx) } : base.qs,
    };
    body = send(req);
    const got = list(body);
    if (!got.length) break;
    items.push(...got);
  }
  void requestBase;
  return { items: items.slice(0, limit), requests, billed };
};

const SCENARIOS = {
  searchProperties: { params: { query: 'Phoenix, AZ' }, billedPerRecord: true },
  investorProperties: { params: { investorId: 'inv-1' }, billedPerRecord: true },
  investorBuybox: { params: { propertyId: 'P-1' }, billedPerRecord: true },
  getPermits: { params: { propertyId: 'P-1' }, billedPerRecord: false },
  listSearchSessions: { params: {}, billedPerRecord: false },
  watchSearchSessions: { params: {}, billedPerRecord: false },
};

test('every paged module has a Limit parameter and sends limit and pagination directives', () => {
  for (const name of PAGED) {
    const c = comm(name);
    const m = read('makecomapp.json').components.module[name];
    const params = read(m.codeFiles[m.moduleType === 'trigger' ? 'staticParams' : 'mappableParams']);
    const limit = params.find((p) => p.name === 'limit');
    assert.ok(limit, `${name} has no Limit parameter`);
    assert.equal(limit.label, 'Limit');
    assert.ok(limit.validate.min >= 1 && limit.validate.max >= limit.default, name);
    assert.ok(!params.some((p) => p.name === 'take'), `${name} still has the old take parameter`);
    assert.match(c.response.limit, /parameters\.limit/, name);
    assert.ok(c.pagination?.condition, `${name} has no pagination condition`);
    assert.ok(c.pagination.body || c.pagination.qs, name);
  }
});

for (const name of PAGED) {
  const { params, billedPerRecord } = SCENARIOS[name];
  const cap = name.includes('Sessions') ? 100 : 100000;

  test(`${name}: returns exactly the Limit and never asks for more records than the Limit`, () => {
    for (const [limit, available] of [[1, 500], [25, 500], [100, 500], [101, 500], [250, 1000], [100, 100], [200, 200]]) {
      if (name.includes('Sessions') && (limit > 100 || available > 100)) continue;
      const r = run(name, { ...params, limit }, Math.min(available, cap));
      assert.equal(r.items.length, Math.min(limit, available), `${name} limit ${limit}`);
      const taken = r.requests.map((q) => (q.body?.options ?? q.qs).take);
      assert.ok(taken.every((t) => t >= 1 && t <= 100), `${name} take values ${taken}`);
      assert.ok(taken.reduce((a, b) => a + b, 0) <= limit, `${name} requested ${taken} for limit ${limit}`);
      if (billedPerRecord) assert.ok(r.billed <= limit, `${name} billed ${r.billed} for limit ${limit}`);
    }
  });

  test(`${name}: stops when the data runs out and pages without duplicates`, () => {
    if (name.includes('Sessions')) {
      const r = run(name, { ...params, limit: 100 }, 37);
      assert.equal(r.items.length, 37);
      assert.equal(r.requests.length, 1);
      return;
    }
    const r = run(name, { ...params, limit: 1000 }, 230);
    assert.equal(r.items.length, 230);
    assert.equal(new Set(r.items.map((i) => JSON.stringify(i))).size, 230, `${name} returned duplicates`);
    assert.ok(r.requests.length <= 4, `${name} sent ${r.requests.length} requests`);
  });

  test(`${name}: the default Limit is a single request`, () => {
    const r = run(name, { ...params }, 1000);
    const def = name.includes('Sessions') ? (name === 'watchSearchSessions' ? 100 : 50) : 25;
    assert.equal(r.items.length, Math.min(def, 1000));
    assert.equal(r.requests.length, 1);
  });
}

test('searchProperties: the Skip offset is kept on every page', () => {
  const r = run('searchProperties', { query: 'Tempe', limit: 150, skip: 40 }, 500);
  assert.equal(r.items.length, 150);
  assert.equal(r.items[0]._id, 'p40');
  assert.equal(r.items.at(-1)._id, 'p189');
  assert.deepEqual(r.requests.map((q) => [q.body.options.skip, q.body.options.take]), [[40, 100], [140, 50]]);
});

test('searchProperties: limit and skip are never sent as search filters', () => {
  const r = run('searchProperties', { query: 'Tempe', limit: 150, skip: 40 }, 500);
  for (const q of r.requests) assert.deepEqual(Object.keys(q.body.searchCriteria), ['query']);
});

test('investorProperties: a full last page ends the run without an extra request when the Limit is met', () => {
  const r = run('investorProperties', { investorId: 'inv-1', limit: 200 }, 500);
  assert.equal(r.items.length, 200);
  assert.equal(r.requests.length, 2);
  assert.equal(r.requests[1].body.options.pageCursor, 'c100');
});

test('getPermits: one request covers up to 100 permits, so a small Limit is billed once', () => {
  const r = run('getPermits', { propertyId: 'P-1', limit: 60 }, 500);
  assert.equal(r.requests.length, 1);
  assert.equal(r.billed, 1);
});
