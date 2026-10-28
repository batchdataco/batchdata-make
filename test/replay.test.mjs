import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { render } from './iml.mjs';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (rel) => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
const comm = (name) => read(`modules/${name}/${name}.communication.iml.json`);
const fixture = (name) => read(`test/fixtures/${name}.json`);
const request = (name, parameters) => {
  const c = comm(name);
  const scope = { parameters, connection: { apiKey: 'test-token' } };
  return { url: render(c.url, scope), method: render(c.method, scope), body: render(c.body, scope) };
};
const respond = (name, body, extra = {}) => {
  const out = render(comm(name).response.output ?? '{{item}}', { body, ...extra });
  return out;
};
const iterate = (name, body) => render(comm(name).response.iterate, { body });

test('search: only filled filters are sent, take defaults to 25', () => {
  const r = request('searchProperties', {
    query: 'Phoenix, AZ',
    quickLists: ['absentee-owner', 'not-vacant'],
    building: { bedroomCount: { min: 3 } },
    owner: { ownerOccupied: { equals: false } },
  });
  assert.equal(r.url, '/v1/property/search');
  assert.deepEqual(r.body, {
    searchCriteria: {
      query: 'Phoenix, AZ',
      quickLists: ['absentee-owner', 'not-vacant'],
      building: { bedroomCount: { min: 3 } },
      owner: { ownerOccupied: { equals: false } },
    },
    options: { take: 25 },
  });
});

test('search: take and skip are passed and kept out of the criteria', () => {
  const r = request('searchProperties', { query: 'Tempe', take: 0, skip: 50 });
  assert.deepEqual(r.body, { searchCriteria: { query: 'Tempe' }, options: { take: 0, skip: 50 } });
});

test('search: output is each property plus the result counts', () => {
  const f = fixture('property-search');
  const items = iterate('searchProperties', f);
  assert.equal(items.length, f.results.properties.length);
  const out = render(comm('searchProperties').response.output, { item: items[0], body: f });
  assert.equal(out._id, items[0]._id);
  assert.deepEqual(out.searchMeta, f.results.meta.results);
});

test('lookup: sends exactly one identifier', () => {
  const byAddress = request('lookupProperty', {
    identifyBy: 'address',
    address: { street: '1 Main St', city: 'Phoenix', state: 'AZ', zip: '85001' },
    propertyId: 'IGNORED',
    hash: 'IGNORED',
  });
  assert.deepEqual(byAddress.body.requests, [{ address: { street: '1 Main St', city: 'Phoenix', state: 'AZ', zip: '85001' } }]);

  const byApn = request('lookupProperty', { identifyBy: 'apn', apn: '123-45', countyFipsCode: '04013', propertyId: 'IGNORED' });
  assert.deepEqual(byApn.body.requests, [{ apn: '123-45', countyFipsCode: '04013' }]);

  const byId = request('lookupProperty', { identifyBy: 'propertyId', propertyId: 'abc' });
  assert.deepEqual(byId.body.requests, [{ propertyId: 'abc' }]);
});

test('lookup: datasets and skip trace only when chosen', () => {
  const r = request('lookupProperty', {
    identifyBy: 'hash',
    hash: 'h1',
    datasets: ['owner', 'mortgage-liens'],
    includeSkipTrace: true,
  });
  assert.deepEqual(r.body.options, { skipTrace: true, datasets: ['owner', 'mortgage-liens'] });
  const none = request('lookupProperty', { identifyBy: 'hash', hash: 'h1' });
  assert.deepEqual(none.body.options, {});
});

test('lookup: output is the first property', () => {
  const f = fixture('property-lookup-all-attributes');
  assert.equal(respond('lookupProperty', f)._id, f.results.properties[0]._id);
});

for (const [name, version] of [['skipTraceV1', 'v1'], ['skipTraceV3', 'v3']]) {
  test(`skip trace ${version}: path is versioned and TCPA-flagged phones are excluded by default`, () => {
    const r = request(name, {
      findBy: 'address',
      propertyAddress: { street: '1 Main St', city: 'Phoenix', state: 'AZ', zip: '85001' },
      apn: 'IGNORED',
    });
    assert.equal(r.url, `/${version}/property/skip-trace`);
    assert.deepEqual(r.body.requests, [
      { propertyAddress: { street: '1 Main St', city: 'Phoenix', state: 'AZ', zip: '85001' } },
    ]);
    assert.deepEqual(r.body.options, { includeTCPABlacklistedPhones: false });
  });

  test(`skip trace ${version}: the TCPA option is explicit when turned on`, () => {
    const r = request(name, {
      findBy: 'apn',
      apn: '1-2',
      countyFipsCode: '04013',
      includeTcpaFlaggedPhones: true,
      prioritizeMobilePhones: true,
      name: { first: 'Ann', last: 'Lee' },
    });
    assert.deepEqual(r.body.requests, [{ apn: '1-2', countyFipsCode: '04013', name: { first: 'Ann', last: 'Lee' } }]);
    assert.deepEqual(r.body.options, { includeTCPABlacklistedPhones: true, prioritizeMobilePhones: true });
  });
}

test('skip trace: V1 yields a bundle per person, V3 a bundle per property', () => {
  assert.equal(iterate('skipTraceV1', fixture('property-skip-trace')).length, fixture('property-skip-trace').results.persons.length);
  const v3 = fixture('v3-property-skip-trace');
  const items = iterate('skipTraceV3', v3);
  assert.equal(items.length, v3.result.data.length);
  assert.ok(Array.isArray(items[0].persons));
});

test('address verify: street required, empty parts dropped, output is first address', () => {
  const r = request('verifyAddress', { street: '1 Main St', zip: '85001' });
  assert.deepEqual(r.body, { requests: [{ street: '1 Main St', zip: '85001' }] });
  const f = fixture('address-verify');
  assert.equal(respond('verifyAddress', f).hash, f.results.addresses[0].hash);
});

for (const [name, path_, file] of [
  ['verifyPhones', '/v1/phone/verification', 'phone-verification'],
  ['checkDnc', '/v1/phone/dnc', 'phone-dnc'],
  ['checkTcpa', '/v1/phone/tcpa', 'phone-tcpa'],
]) {
  test(`${name}: sends the numbers as a flat array and yields one bundle per number`, () => {
    const r = request(name, { phoneNumbers: ['4805550123', '6025550199'] });
    assert.equal(r.url, path_);
    assert.deepEqual(r.body, { requests: ['4805550123', '6025550199'] });
    const f = fixture(file);
    assert.equal(iterate(name, f).length, f.results.phoneNumbers.length);
  });
}

test('api call: builds url, method, headers and query; wallet paths are redirected', () => {
  const r = request('makeAnApiCall', { url: 'v1/property/search', method: 'POST', body: { a: 1 } });
  assert.equal(r.url, '/v1/property/search');
  assert.equal(r.method, 'POST');
  const c = comm('makeAnApiCall');
  const scope = {
    parameters: { url: 'v1/x', method: 'GET', headers: [{ key: 'X-A', value: '1' }], qs: [{ key: 'take', value: '1' }] },
  };
  assert.deepEqual(render(c.headers, scope), { 'X-A': '1' });
  assert.deepEqual(render(c.qs, scope), { take: '1' });
  for (const bad of ['v1/Wallet/balance', 'v2/wallet', ' v1/WALLET ']) {
    assert.equal(request('makeAnApiCall', { url: bad, method: 'GET' }).url, '/blocked/not-available');
  }
});

test('connection check treats 400 and 2xx as valid and 401/403 as invalid', () => {
  const c = read('connections/batchdata/batchdata.communication.iml.json');
  assert.deepEqual(c.body, { requests: [] });
  const valid = (statusCode) => render(c.response.valid, { statusCode });
  assert.equal(valid(200), true);
  assert.equal(valid(400), true);
  assert.equal(valid(401), false);
  assert.equal(valid(403), false);
  assert.equal(valid(500), false);
  assert.equal(render(c.headers.Authorization, { parameters: { apiKey: 't' } }), 'Bearer t');
  assert.equal(render(c.response.data, { parameters: { apiKey: 't' } }).apiKey, 't');
});

test('base: bearer header comes from the connection and errors read the BatchData body', () => {
  const b = read('general/base.iml.json');
  assert.equal(render(b.headers.Authorization, { connection: { apiKey: 'k' } }), 'Bearer k');
  const msg = render(b.response.error.message, { statusCode: 422, body: { status: { message: 'Bad input' } } });
  assert.equal(msg, '[422] Bad input');
  const fallback = render(b.response.error.message, { statusCode: 500, body: {} });
  assert.match(fallback, /^\[500\]/);
  assert.equal(b.response.error['401'].type, 'InvalidAccessTokenError');
});
