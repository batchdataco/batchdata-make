// Turns the shared catalog (scripts/catalog.json) into Make modules, webhooks and RPCs.
// The catalog is the single source of truth shared with the Zapier and n8n integrations.
import fs from 'node:fs';
import { root } from './lib.mjs';

export const catalog = JSON.parse(fs.readFileSync(`${root}/scripts/catalog.json`, 'utf8'));
const fx = (n) => JSON.parse(fs.readFileSync(`${root}/test/fixtures/${n}.json`, 'utf8'));

const camel = (s) => s.replace(/[-_]+([a-z0-9])/g, (_, c) => c.toUpperCase());
const moduleKey = (key) => camel(key);
const opt = (c) => ({ label: c.label ?? c.value ?? c, value: c.value ?? c });

// ---------- parameters (what the user fills in) ----------
const nestSpec = (rowFields) => {
  const tree = {};
  for (const f of rowFields) {
    const segs = f.path.split('.');
    let node = tree;
    segs.forEach((s, i) => {
      if (i === segs.length - 1) node[s] = f;
      else node = node[s] ??= {};
    });
  }
  const build = (n) =>
    Object.entries(n).map(([name, v]) =>
      v.key !== undefined && v.path !== undefined
        ? { name, type: 'text', label: v.label, ...(v.help ? { help: v.help } : {}) }
        : { name, type: 'collection', label: name === 'propertyAddress' ? 'Property address' : name[0].toUpperCase() + name.slice(1), spec: build(v) },
    );
  return build(tree);
};

const lastSeg = (p) => p.split('.').pop();

const paramFor = (f, name = camel(f.key), dynamicRpc) => {
  const base = { name, label: f.label };
  if (f.required) base.required = true;
  if (f.help) base.help = f.help;
  switch (f.type) {
    case 'rows':
      return { ...base, type: 'array', spec: nestSpec(f.rowFields) };
    case 'list':
      return { ...base, type: 'array', spec: f.choices ? { type: 'select', options: f.choices.map(opt) } : { type: 'text' } };
    case 'choice':
      return { ...base, type: 'select', options: f.choices.map(opt), ...(f.default !== undefined ? { default: f.default } : {}) };
    case 'boolean':
      return { ...base, type: 'boolean', ...(f.default !== undefined ? { default: f.default } : {}) };
    case 'integer':
      return { ...base, type: 'integer', ...(f.default !== undefined ? { default: f.default } : {}), ...(f.min !== undefined || f.max !== undefined ? { validate: { ...(f.min !== undefined ? { min: f.min } : {}), ...(f.max !== undefined ? { max: f.max } : {}) } } : {}) };
    case 'number':
      return { ...base, type: 'number' };
    case 'date':
      return { ...base, type: 'date' };
    case 'password':
      return { ...base, type: 'password' };
    case 'json':
      return { ...base, type: 'text', help: `${f.help ? `${f.help} ` : ''}Optional JSON object with extra filters, for example {"general":{"propertyTypeCategory":{"equals":"Single Family"}}}. Fields you fill in above take priority.` };
    default: {
      if (dynamicRpc && f.in === 'path') return { ...base, type: 'select', options: `rpc://${dynamicRpc}` };
      return { ...base, type: 'text', ...(f.pattern ? { validate: { pattern: f.pattern } } : f.in === 'path' ? { validate: { pattern: '^[A-Za-z0-9_-]+$' } } : {}) };
    }
  }
};

const RPC_FOR = { new_search_session: 'listSearchSessions', new_monitor: 'listMonitors' };

// Optional nested filters (for example request.status.equals) are grouped into one collection
// parameter that mirrors the wire shape, so an untouched group is dropped instead of sent as {}.
const rootLen = (segs) => (/^\d+$/.test(segs[1] ?? '') ? 2 : 1);
const plain = (f) => !f.local && !f.when && !f.merge && f.in === undefined && f.path && f.type !== 'rows';
export const groupsOf = (op) => {
  const found = {};
  for (const f of op.fields.filter(plain)) {
    const segs = f.path.split('.');
    const rest = segs.slice(rootLen(segs));
    if (rest.length < 2) continue;
    (found[`${segs.slice(0, rootLen(segs)).join('.')}|${rest[0]}`] ??= []).push(f);
  }
  const out = {};
  for (const [k, fs_] of Object.entries(found)) {
    if (fs_.some((f) => f.required)) continue;
    const [root, name] = k.split('|');
    out[k] = { root, name, fields: fs_ };
  }
  return out;
};
const groupedKeys = (op) => new Set(Object.values(groupsOf(op)).flatMap((g) => g.fields.map((f) => f.key)));
const title = (n) => n.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());
const nestFields = (fields, rootN) => {
  const tree = {};
  for (const f of fields) {
    const rest = f.path.split('.').slice(rootN);
    let node = tree;
    rest.forEach((s, i) => {
      if (i === rest.length - 1) node[s] = f;
      else node = node[s] ??= {};
    });
  }
  const build = (n) =>
    Object.entries(n).map(([name, v]) =>
      v.key !== undefined && v.path !== undefined
        ? (() => {
            const p = paramFor(v.type === 'date' ? { ...v, type: 'string', help: `${v.help ? `${v.help} ` : ''}Format YYYY-MM-DD.` } : v, name);
            delete p.required;
            return p;
          })()
        : { name, type: 'collection', label: title(name), spec: build(v) },
    );
  return build(tree);
};

const paramsFor = (op) => {
  const out = [];
  const groups = {};
  const grouped = groupedKeys(op);
  const doneGroups = new Set();
  for (const f of op.fields) {
    if (f.local) continue;
    if (grouped.has(f.key)) {
      const segs = f.path.split('.');
      const gk = `${segs.slice(0, rootLen(segs)).join('.')}|${segs[rootLen(segs)]}`;
      if (!doneGroups.has(gk)) {
        doneGroups.add(gk);
        const g = groupsOf(op)[gk];
        out.push({ name: g.name, type: 'collection', label: title(g.name), spec: nestFields(g.fields, rootLen(segs) + 1) });
      }
      continue;
    }
    if (f.when) {
      const g = camel(f.when.equals);
      (groups[g] ??= { equals: f.when.equals, fields: [] }).fields.push(f);
      continue;
    }
    out.push(paramFor(f, camel(f.key), RPC_FOR[op.dynamic]));
  }
  for (const [name, g] of Object.entries(groups)) {
    out.push({
      name,
      type: 'collection',
      label: g.equals === 'kinesis' ? 'AWS Kinesis settings' : 'Azure Event Hub settings',
      help: `Used when Delivery type is "${g.equals}".`,
      spec: g.fields.map((f) => paramFor(f, lastSeg(f.path))),
    });
  }
  return out;
};

// ---------- request bodies (what is sent) ----------
const P = (k) => `parameters.${k}`;
const valueExpr = (f, name = camel(f.key)) => {
  const p = P(name);
  switch (f.type) {
    case 'rows':
      return `{{${p}}}`;
    case 'list':
      return `{{if(length(${p}) > 0, ${p}, undefined)}}`;
    case 'boolean':
      return f.emit === 'always' ? `{{if(${p} == true, true, false)}}` : `{{if(${p} == true, true, undefined)}}`;
    case 'date':
      return `{{if(${p}, formatDate(${p}, 'YYYY-MM-DD'), undefined)}}`;
    case 'json':
      return `{{if(${p}, parseJSON(${p}), undefined)}}`;
    case 'integer':
    case 'number':
      return `{{ifempty(${p}, ${f.default !== undefined ? JSON.stringify(f.default) : 'undefined'})}}`;
    default:
      if (f.required) return `{{${p}}}`;
      return f.default !== undefined ? `{{ifempty(${p}, ${JSON.stringify(f.default)})}}` : `{{ifempty(${p}, undefined)}}`;
  }
};

const arrayify = (n) => {
  if (Array.isArray(n) || n === null || typeof n !== 'object') return n;
  const keys = Object.keys(n);
  const mapped = Object.fromEntries(keys.map((k) => [k, arrayify(n[k])]));
  return keys.length && keys.every((k) => /^\d+$/.test(k)) ? keys.map((k) => mapped[k]) : mapped;
};

export const buildBody = (op, { only } = {}) => {
  const tree = {};
  const at = (segs, create = true) => {
    let n = tree;
    for (const s of segs) n = n[s] ??= {};
    return n;
  };
  const grouped = groupedKeys(op);
  const fields = op.fields.filter((f) => !f.local && f.in !== 'path' && f.in !== 'query' && (!only || only(f)) && !grouped.has(f.key));
  for (const g of Object.values(groupsOf(op))) {
    if (only && !g.fields.every(only)) continue;
    at(g.root.split('.'))[g.name] = `{{ifempty(parameters.${g.name}, undefined)}}`;
  }
  for (const f of fields.filter((x) => x.merge)) at(f.path.split('.'))['{{...}}'] = valueExpr(f);
  for (const f of fields.filter((x) => !x.merge && !x.when)) {
    const segs = f.path.split('.');
    at(segs.slice(0, -1))[segs.at(-1)] = valueExpr(f);
  }
  const groups = {};
  for (const f of fields.filter((x) => x.when)) (groups[f.when.equals] ??= []).push(f);
  for (const [eq, fs_] of Object.entries(groups)) {
    const target = fs_[0].path.split('.').slice(0, -1);
    const expr = `{{if(parameters.${camel(fs_[0].when.field)} == '${eq}', parameters.${camel(eq)}, undefined)}}`;
    if (target.length === 1) at(target)['{{...}}'] = expr;
    else at(target.slice(0, -1))[target.at(-1)] = expr;
  }
  for (const fx_ of op.fixed ?? []) {
    const segs = fx_.path.split('.');
    at(segs.slice(0, -1))[segs.at(-1)] = fx_.value;
  }
  return arrayify(tree);
};

const api = (p) => p.replace(/^\/api/, '');
const urlFor = (op) => api(op.http.path).replace('{id}', "{{replace(replace(parameters.id, '/', '_'), '.', '_')}}");

const responseFor = (op) => {
  const r = op.result;
  const get = (p) => `{{body.${p}}}`;
  if (r.list) {
    const iterate = r.filter
      ? { container: get(r.list), condition: `{{item.${r.filter.path} == ${JSON.stringify(r.filter.equals)}}}` }
      : get(r.list);
    const attach = Object.entries(r.attach ?? {}).map(([k, p]) => [k, get(p)]);
    return { iterate, output: attach.length ? { '{{...}}': '{{item}}', ...Object.fromEntries(attach) } : '{{item}}' };
  }
  if (r.item) return { output: get(r.item) };
  if (r.compose) return { output: Object.fromEntries(Object.entries(r.compose).map(([k, p]) => [k, get(p)])) };
  if (r.static) {
    return { output: { ...r.static, ...Object.fromEntries(Object.entries(r.echo ?? {}).map(([k, f]) => [k, `{{parameters.${camel(f)}}}`])) } };
  }
  throw new Error(`no result mapping for ${op.key}`);
};

const requestFor = (op) => {
  const queryFields = op.fields.filter((f) => f.in === 'query');
  const body = op.http.method === 'GET' || op.http.method === 'DELETE' ? undefined : buildBody(op);
  return {
    url: urlFor(op),
    method: op.http.method,
    ...(queryFields.length ? { qs: Object.fromEntries(queryFields.map((f) => [f.qs, valueExpr(f)])) } : {}),
    ...(body ? { body } : {}),
    response: responseFor(op),
  };
};

const CRUD = (op) => (op.key.startsWith('create_') ? 'create' : op.key.startsWith('delete_') ? 'delete' : 'read');

const describe = (op) =>
  op.requireOneOf ? `${op.description} Fill in at least one of: ${op.requireOneOf.map((k) => op.fields.find((f) => f.key === k).label).join(', ')}.` : op.description;

// Result fields the API sometimes omits from the catalog sample; shown in the output list anyway.
const SAMPLE_FILL = { warnings: [], nextPageCursor: 'eyJwYWdlIjoyfQ' };

// ---------- modules ----------
export const catalogModules = {};
for (const op of catalog.ops) {
  const key = moduleKey(op.key);
  catalogModules[key] = {
    moduleType: op.kind === 'search' ? 'search' : 'action',
    actionCrud: CRUD(op),
    catalogKey: op.key,
    label: op.label,
    description: describe(op),
    communication: requestFor(op),
    params: paramsFor(op),
    sampleFrom: () => ({ ...op.sample, ...Object.fromEntries(Object.keys(op.result.attach ?? {}).filter((k) => !(k in op.sample)).map((k) => [k, SAMPLE_FILL[k] ?? {}])) }),
  };
}

const staticFromFields = (op) => paramsFor(op);

const trig = (key) => catalog.triggers.find((t) => t.key === key);

{
  const t = trig('new_search_session');
  catalogModules.watchSearchSessions = {
    moduleType: 'trigger',
    catalogKey: t.key,
    label: 'Watch New Search Sessions',
    description: t.description,
    communication: {
      url: api(t.http.path),
      method: 'GET',
      qs: { take: t.fixedQuery.take },
      response: {
        iterate: `{{body.${t.result.list}}}`,
        output: '{{item}}',
        trigger: { type: 'date', date: '{{item.createdAt}}', id: '{{item.id}}', order: 'unordered' },
      },
    },
    staticParams: [],
    sampleFrom: () => t.sample,
  };
}
{
  // Search-session properties carry neither a date nor an ordered ID. The session itself never
  // delivers the same property twice, so the poll time is used as the trigger date.
  const t = trig('new_session_property');
  catalogModules.watchSessionProperties = {
    moduleType: 'trigger',
    catalogKey: t.key,
    label: t.label.replace('New Property in Search Session', 'Watch New Properties in a Search Session'),
    description: `${t.description} Every scheduled run of the scenario, and every "Run once", is a billed search.`,
    communication: {
      url: api(t.http.path),
      method: 'POST',
      body: buildBody(t),
      response: {
        iterate: `{{body.${t.result.list}}}`,
        output: { '{{...}}': '{{item}}', id: '{{item._id}}', searchMeta: `{{body.${t.result.attach.searchMeta}}}` },
        trigger: { type: 'date', date: '{{now}}', id: '{{item._id}}', order: 'unordered' },
      },
    },
    staticParams: staticFromFields(t),
    sampleFrom: () => ({ ...t.sample, searchMeta: { totalCount: 1 } }),
  };
}

// ---------- instant trigger: webhook component + two modules ----------
const ev = trig('monitor_event');
const criteriaOnly = (f) => !f.local;
const webhookParams = ev.fields.filter(criteriaOnly).map((f) => paramFor(f));
export const webhooks = {
  monitorEvents: {
    label: 'Property monitor events',
    webhookType: 'web',
    communication: {
      condition: "{{length(ifempty(body.eventId, '')) > 0}}",
      uid: '{{body.eventId}}',
      output: { '{{...}}': '{{body}}', id: '{{body.eventId}}' },
    },
    params: webhookParams,
    attach: {
      url: api(ev.http.path),
      method: 'POST',
      body: {
        ...buildBody(ev, { only: criteriaOnly }),
        deliveryConfig: { type: 'webhook', url: '{{webhook.url}}' },
      },
      response: { data: { externalHookId: '{{body.result.subscriptionId}}' } },
    },
    detach: {
      url: api(ev.http.deletePath).replace('{id}', '{{webhook.externalHookId}}'),
      method: 'DELETE',
    },
  },
};
export const EVENT_LIMITS_NOTE =
  'Limits: up to 5 monitors per team, a monitor cannot be edited after it is created (delete and recreate it), a new monitor can take up to 7 days to start delivering, and delivery is best effort (4 attempts per event), so the same event can arrive more than once. Use the Event ID to skip repeats.';

const evBase = ev.description
  .replace('Turning the Zap or scenario on', 'Turning the scenario on')
  .replace('turning it off', 'turning it off')
  .replace(' turn on "Include Property Record" to also look up the full property record.', ' use "Watch Property Monitor Events with Property Record" to also look up the full property record.')
  .replace(/ The optional property lookup is billed per event, per matched property\./, '');
catalogModules.watchMonitorEvents = {
  moduleType: 'instant_trigger',
  catalogKey: ev.key,
  webhook: 'monitorEvents',
  label: 'Watch Property Monitor Events (Instant)',
  description: evBase,
  communication: {},
  staticParams: [],
  sampleFrom: () => ev.sample,
};
catalogModules.watchMonitorEventsWithProperty = {
  moduleType: 'instant_trigger',
  catalogKey: ev.key,
  webhook: 'monitorEvents',
  label: 'Watch Property Monitor Events with Property Record (Instant, Billed)',
  description: `${evBase} This version also looks up the full property record for every event. The lookup is billed per event, per matched property, on top of the monitor charges.`,
  communication: {
    url: api(ev.hydrate.path),
    method: 'POST',
    body: { requests: [{ propertyId: '{{payload.propertyId}}' }] },
    response: {
      output: { '{{...}}': '{{payload}}', [ev.hydrate.into]: `{{first(body.${ev.hydrate.listPath})}}` },
    },
  },
  staticParams: [],
  sampleFrom: () => ({ ...ev.sample, property: fx('property-lookup-all-attributes').results.properties[0] }),
};

// ---------- RPCs for dropdowns ----------
export const rpcs = {
  listSearchSessions: {
    label: 'List search sessions',
    communication: {
      url: '/v2/property/search-sessions',
      method: 'GET',
      qs: { take: 100 },
      response: { iterate: '{{body.results.sessions}}', output: { label: '{{item.id}}', value: '{{item.id}}' } },
    },
    params: [],
  },
  listMonitors: {
    label: 'List property monitors',
    communication: {
      url: '/v2/property-subscription',
      method: 'GET',
      response: { iterate: '{{body.results.subscriptions}}', output: { label: '{{item.id}}', value: '{{item.id}}' } },
    },
    params: [],
  },
};

export const catalogGroups = [
  { label: 'Properties', modules: ['batchLookupProperty', 'getPermits'] },
  { label: 'Owner contact', modules: ['reverseSkipTrace', 'batchSkipTrace'] },
  { label: 'Addresses', modules: ['autocompleteAddress', 'geocodeAddress', 'reverseGeocode', 'batchVerifyAddress'] },
  { label: 'Investors', modules: ['investorBuybox', 'investorProperties'] },
  { label: 'Search sessions', modules: ['createSearchSession', 'listSearchSessions', 'deleteSearchSession'] },
  { label: 'Property monitors', modules: ['createMonitor', 'listMonitors', 'getMonitor', 'deleteMonitor'] },
  { label: 'Triggers', modules: ['watchSearchSessions', 'watchSessionProperties', 'watchMonitorEvents', 'watchMonitorEventsWithProperty'] },
];
