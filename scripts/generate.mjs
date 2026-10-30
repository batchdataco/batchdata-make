import fs from 'node:fs';
import { root, write, toInterface } from './lib.mjs';
import * as P from './params.mjs';
import { offsetPaging } from './paging.mjs';
import { catalogModules, catalogGroups, webhooks, rpcs } from './catalog-modules.mjs';

const fx = (n) => JSON.parse(fs.readFileSync(`${root}/test/fixtures/${n}.json`, 'utf8'));
const ue = (e) => `ifempty(${e}, undefined)`;
const u = (e) => `{{${ue(e)}}}`;

const BILL = {
  search: 'Billed per record returned.',
  lookup: 'Billed per matched property.',
  skip: 'Billed per matched property.',
  address: 'Billed per address.',
  phone: 'Billed per phone number.',
};
const PHONE_NOTE = ' Results are data only. You are responsible for TCPA and Do Not Call compliance.';

const skipBody = (path, iterate) => ({
  url: path,
  method: 'POST',
  body: {
    requests: [
      {
        propertyAddress: `{{if(parameters.findBy == 'address', parameters.propertyAddress, undefined)}}`,
        apn: `{{if(parameters.findBy == 'apn', ${ue('parameters.apn')}, undefined)}}`,
        countyFipsCode: `{{if(parameters.findBy == 'apn', ${ue('parameters.countyFipsCode')}, undefined)}}`,
        county: `{{if(parameters.findBy == 'apn', ${ue('parameters.county')}, undefined)}}`,
        state: `{{if(parameters.findBy == 'apn', ${ue('parameters.state')}, undefined)}}`,
        name: '{{ifempty(parameters.name, undefined)}}',
        mailingAddress: '{{ifempty(parameters.mailingAddress, undefined)}}',
        requestId: u('parameters.requestId'),
      },
    ],
    options: {
      includeTCPABlacklistedPhones: '{{if(parameters.includeTcpaFlaggedPhones == true, true, false)}}',
      prioritizeMobilePhones: u('parameters.prioritizeMobilePhones'),
    },
  },
  response: { iterate, output: '{{item}}' },
});

// Blocks account-balance (wallet) paths, asynchronous callback endpoints, path tricks and monitor
// creation. The same rules exist in the Zapier and n8n integrations (catalog apiRequest.guard).
const lc = 'lower(parameters.url)';
const API_GUARD = [
  `contains(${lc}, 'wallet')`,
  `contains(${lc}, 'async')`,
  `contains(${lc}, '..')`,
  `contains(${lc}, '%')`,
  `contains(${lc}, '?')`,
  `contains(${lc}, '://')`,
  `contains(lower(ifempty(parameters.body, '')), 'webhook')`,
  `contains(lower(ifempty(parameters.body, '')), 'u00')`,
  `contains(${lc}, '//')`,
  `contains(${lc}, '#')`,
  `(contains(${lc}, 'property-subscription') && (parameters.method == 'POST' || parameters.method == 'PUT' || parameters.method == 'PATCH'))`,
].join(' || ');

const modules = {
  searchProperties: {
    moduleType: 'search',
    label: 'Search Properties',
    description: `Finds properties that match your filters. ${BILL.search} Set a Limit to cap the records returned in total. Records are requested in pages of up to 100, and never more than the Limit are requested.`,
    communication: {
      url: '/v1/property/search',
      method: 'POST',
      body: {
        searchCriteria: "{{omit(parameters, 'limit', 'skip')}}",
        options: { skip: u('parameters.skip') },
      },
      response: {
        iterate: '{{body.results.properties}}',
        output: { '{{...}}': '{{item}}', searchMeta: '{{body.results.meta.results}}' },
      },
    },
    params: P.searchParams,
    sampleFrom: () => {
      const f = fx('property-search');
      return { ...f.results.properties[0], searchMeta: f.results.meta.results };
    },
  },
  lookupProperty: {
    moduleType: 'action',
    label: 'Get Property Details',
    description: `Returns property data for one address or identifier. ${BILL.lookup} Skip trace, if included, is billed separately.`,
    communication: {
      url: '/v1/property/lookup/all-attributes',
      method: 'POST',
      body: {
        requests: [
          {
            address: "{{if(parameters.identifyBy == 'address', parameters.address, undefined)}}",
            propertyId: `{{if(parameters.identifyBy == 'propertyId', ${ue('parameters.propertyId')}, undefined)}}`,
            hash: `{{if(parameters.identifyBy == 'hash', ${ue('parameters.hash')}, undefined)}}`,
            apn: `{{if(parameters.identifyBy == 'apn', ${ue('parameters.apn')}, undefined)}}`,
            countyFipsCode: `{{if(parameters.identifyBy == 'apn', ${ue('parameters.countyFipsCode')}, undefined)}}`,
            requestId: u('parameters.requestId'),
          },
        ],
        options: {
          skipTrace: '{{if(parameters.includeSkipTrace == true, true, undefined)}}',
          datasets: '{{if(length(parameters.datasets) > 0, parameters.datasets, undefined)}}',
        },
      },
      response: { output: '{{first(body.results.properties)}}' },
    },
    params: P.lookupParams,
    sampleFrom: () => fx('property-lookup-all-attributes').results.properties[0],
  },
  skipTraceV1: {
    moduleType: 'search',
    label: 'Skip Trace Owner (V1)',
    description: `Finds owner contact details for a property, one result per person. ${BILL.skip} Phone numbers flagged as TCPA litigators are removed unless you turn that option on.${PHONE_NOTE}`,
    communication: skipBody('/v1/property/skip-trace', '{{body.results.persons}}'),
    params: P.skipTraceV1Params,
    sampleFrom: () => fx('property-skip-trace').results.persons[0],
  },
  skipTraceV3: {
    moduleType: 'search',
    label: 'Skip Trace Owner (V3)',
    description: `Finds owner contact details using the V3 skip trace, one result per property with a list of persons. ${BILL.skip} Phone numbers flagged as TCPA litigators are removed unless you turn that option on.${PHONE_NOTE}`,
    communication: skipBody('/v3/property/skip-trace', '{{body.result.data}}'),
    params: P.skipTraceV3Params,
    sampleFrom: () => fx('v3-property-skip-trace').result.data[0],
  },
  verifyAddress: {
    moduleType: 'action',
    label: 'Verify Address',
    description: `Standardizes and validates one US address. ${BILL.address}`,
    communication: {
      url: '/v1/address/verify',
      method: 'POST',
      body: { requests: [{ street: '{{parameters.street}}', city: u('parameters.city'), state: u('parameters.state'), zip: u('parameters.zip') }] },
      response: { output: '{{first(body.results.addresses)}}' },
    },
    params: P.verifyAddressParams,
    sampleFrom: () => fx('address-verify').results.addresses[0],
  },
  verifyPhones: {
    moduleType: 'search',
    label: 'Verify Phone Numbers',
    description: `Checks whether phone numbers are reachable and returns carrier, DNC and TCPA flags, one result per number. ${BILL.phone}${PHONE_NOTE}`,
    communication: {
      url: '/v1/phone/verification',
      method: 'POST',
      body: { requests: '{{parameters.phoneNumbers}}' },
      response: { iterate: '{{body.results.phoneNumbers}}', output: '{{item}}' },
    },
    params: P.phoneParams,
    sampleFrom: () => fx('phone-verification').results.phoneNumbers[0],
  },
  checkDnc: {
    moduleType: 'search',
    label: 'Check Do Not Call',
    description: `Checks phone numbers against the Do Not Call registry, one result per number. ${BILL.phone}${PHONE_NOTE}`,
    communication: {
      url: '/v1/phone/dnc',
      method: 'POST',
      body: { requests: '{{parameters.phoneNumbers}}' },
      response: { iterate: '{{body.results.phoneNumbers}}', output: '{{item}}' },
    },
    params: P.phoneParams,
    sampleFrom: () => fx('phone-dnc').results.phoneNumbers[0],
  },
  checkTcpa: {
    moduleType: 'search',
    label: 'Check TCPA Litigator',
    description: `Checks phone numbers against the TCPA litigator list, one result per number. ${BILL.phone}${PHONE_NOTE}`,
    communication: {
      url: '/v1/phone/tcpa',
      method: 'POST',
      body: { requests: '{{parameters.phoneNumbers}}' },
      response: { iterate: '{{body.results.phoneNumbers}}', output: '{{item}}' },
    },
    params: P.phoneParams,
    sampleFrom: () => fx('phone-tcpa').results.phoneNumbers[0],
  },
  makeAnApiCall: {
    moduleType: 'universal',
    label: 'Make an API Call',
    description: 'Performs an authorized call to any BatchData API path. Billing follows the endpoint you call. Account balance (wallet) endpoints, asynchronous (callback) endpoints and monitor creation are not available here; use the dedicated modules for those.',
    communication: {
      url: `/{{if(${API_GUARD}, 'blocked/not-available', trim(parameters.url))}}`,
      method: '{{parameters.method}}',
      headers: { '{{...}}': "{{toCollection(parameters.headers, 'key', 'value')}}" },
      qs: { '{{...}}': `{{if(${API_GUARD}, undefined, toCollection(parameters.qs, 'key', 'value'))}}` },
      body: `{{if(${API_GUARD} || length(ifempty(parameters.body, '')) == 0, undefined, parseJSON(parameters.body))}}`,
      type: 'json',
      response: { output: { statusCode: '{{statusCode}}', headers: '{{headers}}', body: '{{body}}' } },
    },
    params: P.apiCallParams,
    sampleFrom: () => ({ statusCode: 200, headers: {}, body: {} }),
  },
};

offsetPaging(modules.searchProperties.communication, { def: 25, found: 'body.results.meta.results.resultsFound', where: 'body', skip: 'skip' });
Object.assign(modules, catalogModules);

const baseGroups = [
  { label: 'Properties', modules: ['searchProperties', 'lookupProperty'] },
  { label: 'Owner contact', modules: ['skipTraceV1', 'skipTraceV3'] },
  { label: 'Addresses', modules: ['verifyAddress'] },
  { label: 'Phone numbers', modules: ['verifyPhones', 'checkDnc', 'checkTcpa'] },
  { label: 'Other', modules: ['makeAnApiCall'] },
];
// Same-named groups are merged; the generic API call stays last.
const groups = [];
for (const g of [...baseGroups.filter((x) => x.label !== 'Other'), ...catalogGroups, ...baseGroups.filter((x) => x.label === 'Other')]) {
  const hit = groups.find((x) => x.label === g.label);
  if (hit) hit.modules.push(...g.modules);
  else groups.push({ label: g.label, modules: [...g.modules] });
}

const moduleComponents = {};
const idMap = [];
for (const [key, m] of Object.entries(modules)) {
  const dir = `modules/${key}/${key}`;
  const isTrigger = m.moduleType.includes('trigger');
  const files = { communication: `${dir}.communication.iml.json` };
  if (isTrigger) {
    if (m.moduleType === 'trigger') files.staticParams = `${dir}.static-params.iml.json`;
  } else {
    files.mappableParams = `${dir}.mappable-params.iml.json`;
  }
  files.interface = `${dir}.interface.iml.json`;
  files.samples = `${dir}.samples.iml.json`;
  const sample = m.sampleFrom();
  write(files.communication, m.communication);
  if (files.mappableParams) write(files.mappableParams, m.params);
  if (files.staticParams) write(files.staticParams, m.staticParams ?? []);
  write(files.samples, sample);
  write(
    files.interface,
    m.moduleType === 'universal'
      ? [
          { name: 'statusCode', type: 'number', label: 'Status code' },
          { name: 'headers', type: 'collection', label: 'Headers', spec: [] },
          { name: 'body', type: 'any', label: 'Body' },
        ]
      : toInterface(sample),
  );
  moduleComponents[key] = {
    moduleType: m.moduleType,
    label: m.label,
    description: m.description,
    ...(m.moduleType === 'universal' || isTrigger ? {} : { actionCrud: m.actionCrud ?? 'read' }),
    connection: 'batchdata',
    ...(m.webhook ? { webhook: m.webhook } : {}),
    codeFiles: files,
  };
  idMap.push({ local: key, remote: key });
}

const webhookComponents = {};
const webhookIdMap = [];
for (const [key, w] of Object.entries(webhooks)) {
  const dir = `webhooks/${key}/${key}`;
  const files = {
    communication: `${dir}.communication.iml.json`,
    params: `${dir}.params.iml.json`,
    attach: `${dir}.attach.iml.json`,
    detach: `${dir}.detach.iml.json`,
  };
  write(files.communication, w.communication);
  write(files.params, w.params);
  write(files.attach, w.attach);
  write(files.detach, w.detach);
  webhookComponents[key] = { label: w.label, webhookType: w.webhookType, connection: 'batchdata', codeFiles: files };
  webhookIdMap.push({ local: key, remote: key });
}

const rpcComponents = {};
const rpcIdMap = [];
for (const [key, r] of Object.entries(rpcs)) {
  const dir = `rpcs/${key}/${key}`;
  const files = { communication: `${dir}.communication.iml.json`, params: `${dir}.params.iml.json` };
  write(files.communication, r.communication);
  write(files.params, r.params);
  rpcComponents[key] = { label: r.label, connection: 'batchdata', codeFiles: files };
  rpcIdMap.push({ local: key, remote: key });
}

write('modules/groups.json', groups);
write('general/common.json', {});
write('general/base.iml.json', {
  baseUrl: 'https://api.batchdata.com/api',
  headers: { Authorization: 'Bearer {{connection.apiKey}}', 'Content-Type': 'application/json' },
  response: {
    error: {
      message: "[{{statusCode}}] {{ifempty(body.status.message, ifempty(body.status.text, 'The BatchData API returned an unexpected error.'))}}",
      type: 'RuntimeError',
      400: { type: 'DataError', message: "[400] {{ifempty(body.status.message, 'The request was rejected. Check the values you entered.')}}" },
      401: { type: 'InvalidAccessTokenError', message: 'Your BatchData API token is invalid or expired. Create a new connection with a valid token.' },
      403: { type: 'RuntimeError', message: 'Your BatchData API token does not have access to this data. Contact support@batchservice.com to enable it.' },
      429: { type: 'RateLimitError', message: 'The BatchData rate limit was reached. Wait a moment and try again.' },
    },
  },
  log: { sanitize: ['request.headers.authorization'] },
});

write('connections/batchdata/batchdata.params.iml.json', [
  {
    name: 'apiKey',
    type: 'password',
    label: 'API token',
    required: true,
    help: 'Create an API token in your BatchData account and paste it here. Tokens are only available on plans with API access.',
  },
]);
write('connections/batchdata/batchdata.communication.iml.json', {
  url: 'https://api.batchdata.com/api/v1/address/verify',
  method: 'POST',
  headers: { Authorization: 'Bearer {{parameters.apiKey}}', 'Content-Type': 'application/json' },
  body: { requests: [] },
  response: {
    valid: '{{statusCode == 400 || (statusCode >= 200 && statusCode < 300)}}',
    data: { apiKey: '{{parameters.apiKey}}' },
    error: {
      message: "[{{statusCode}}] {{ifempty(body.status.message, 'Could not verify the API token.')}}",
      401: { type: 'InvalidAccessTokenError', message: 'Invalid API token. Copy a fresh token from your BatchData account.' },
      403: { type: 'RuntimeError', message: 'This token cannot use the BatchData API. Contact support@batchservice.com.' },
    },
  },
  log: { sanitize: ['request.headers.authorization'] },
});

write('makecomapp.json', {
  fileVersion: 1,
  generalCodeFiles: {
    base: 'general/base.iml.json',
    common: 'general/common.json',
    readme: 'README.md',
    groups: 'modules/groups.json',
  },
  components: {
    connection: {
      batchdata: {
        label: 'BatchData',
        codeFiles: {
          communication: 'connections/batchdata/batchdata.communication.iml.json',
          params: 'connections/batchdata/batchdata.params.iml.json',
        },
      },
    },
    module: moduleComponents,
    webhook: webhookComponents,
    rpc: rpcComponents,
  },
  origins: [
    {
      // The private app that this source was uploaded to (organization 3655001, zone us2).
      // Make suffixed the app name, so the remote connection and webhook names differ from the local ones.
      // Put your own Make API token in .secrets/apikey. To deploy to another zone or organization,
      // copy this entry, change baseUrl and appId, and clear the idMapping.
      label: 'Make us2: batchdata-r6b83g (private app)',
      baseUrl: 'https://us2.make.com/api',
      appId: 'batchdata-r6b83g',
      appVersion: 1,
      apikeyFile: '.secrets/apikey',
      idMapping: {
        connection: [{ local: 'batchdata', remote: 'batchdata-r6b83g' }],
        module: idMap,
        function: [],
        rpc: rpcIdMap,
        webhook: webhookIdMap.map((w) => ({ ...w, remote: 'batchdata-r6b83g' })),
      },
    },
  ],
});
console.log('generated', Object.keys(modules).length, 'modules');
