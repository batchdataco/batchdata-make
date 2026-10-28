import fs from 'node:fs';
import { root } from './lib.mjs';

const C = JSON.parse(fs.readFileSync(`${root}/scripts/constants.json`, 'utf8'));

const opt = (v) => ({ label: v, value: v });
const num = (name, label) => ({ name, type: 'number', label });
const txt = (name, label, extra = {}) => ({ name, type: 'text', label, ...extra });
const range = (name, label) => ({
  name,
  type: 'collection',
  label,
  spec: [num('min', 'Minimum'), num('max', 'Maximum')],
});
const addressSpec = () => [
  txt('street', 'Street'),
  txt('city', 'City'),
  txt('state', 'State', { help: 'Two-letter state code, for example AZ.' }),
  txt('zip', 'ZIP code'),
];

export const searchParams = [
  txt('query', 'Location or text query', {
    help: 'City, county, ZIP code or address text to search in. Leave empty to rely on the filters below.',
  }),
  {
    name: 'quickLists',
    type: 'array',
    label: 'Quick lists (all must match)',
    help: 'Prebuilt lead lists. Choose a "not-" entry to exclude a list.',
    spec: { type: 'select', options: [...C.QUICKLISTS.map(opt), ...C.QUICKLISTS.map((q) => opt(`not-${q}`))] },
  },
  {
    name: 'orQuickLists',
    type: 'array',
    label: 'Quick lists (any may match)',
    spec: { type: 'select', options: C.QUICKLISTS.map(opt) },
  },
  {
    name: 'building',
    type: 'collection',
    label: 'Building',
    spec: [
      range('bedroomCount', 'Bedrooms'),
      range('bathroomCount', 'Bathrooms'),
      range('yearBuilt', 'Year built'),
      range('livingAreaSquareFeet', 'Living area (sq ft)'),
    ],
  },
  {
    name: 'general',
    type: 'collection',
    label: 'Property type',
    spec: [
      { name: 'propertyTypeCategory', type: 'collection', label: 'Property type category', spec: [txt('equals', 'Equals', { help: 'For example Single Family, Multi Family, Condo.' })] },
      { name: 'propertyTypeDetail', type: 'collection', label: 'Property type detail', spec: [txt('equals', 'Equals')] },
    ],
  },
  { name: 'lot', type: 'collection', label: 'Lot', spec: [range('lotSizeAcres', 'Lot size (acres)')] },
  {
    name: 'valuation',
    type: 'collection',
    label: 'Valuation',
    spec: [range('estimatedValue', 'Estimated value'), range('equityPercent', 'Equity percent')],
  },
  {
    name: 'sale',
    type: 'collection',
    label: 'Sale',
    spec: [
      {
        name: 'lastSaleDate',
        type: 'collection',
        label: 'Last sale date',
        spec: [txt('minDate', 'From (YYYY-MM-DD)'), txt('maxDate', 'To (YYYY-MM-DD)')],
      },
    ],
  },
  {
    name: 'owner',
    type: 'collection',
    label: 'Owner',
    spec: [
      {
        name: 'ownerOccupied',
        type: 'collection',
        label: 'Owner occupied',
        spec: [{ name: 'equals', type: 'boolean', label: 'Equals' }],
      },
    ],
  },
  {
    name: 'take',
    type: 'uinteger',
    label: 'Max results',
    default: 25,
    validate: { max: 100 },
    help: 'Up to 100 per run. You are billed per record returned, and a value of 0 is billed as 1 record.',
  },
  { name: 'skip', type: 'uinteger', label: 'Skip', help: 'Number of records to skip, for paging.' },
];

export const lookupParams = [
  {
    name: 'identifyBy',
    type: 'select',
    label: 'Identify property by',
    required: true,
    default: 'address',
    options: [
      { label: 'Address', value: 'address' },
      { label: 'Property ID', value: 'propertyId' },
      { label: 'Address hash', value: 'hash' },
      { label: 'APN and county FIPS code', value: 'apn' },
    ],
    help: 'Only the identifier chosen here is sent. The other identifier fields are ignored.',
  },
  { name: 'address', type: 'collection', label: 'Address', spec: addressSpec() },
  txt('propertyId', 'Property ID'),
  txt('hash', 'Address hash'),
  txt('apn', 'APN'),
  txt('countyFipsCode', 'County FIPS code'),
  {
    name: 'datasets',
    type: 'array',
    label: 'Datasets',
    help: 'Extra data to include. "basic" and "core" cannot be combined. Leave empty for the default set.',
    spec: { type: 'select', options: C.LOOKUP_DATASETS.map(opt) },
  },
  {
    name: 'includeSkipTrace',
    type: 'boolean',
    label: 'Include skip trace',
    help: 'Skip trace is billed separately for each matched record.',
  },
  txt('requestId', 'Request ID', { help: 'Optional value returned with the result so you can match it later.' }),
];

const skipTraceParams = [
  {
    name: 'findBy',
    type: 'select',
    label: 'Find owner by',
    required: true,
    default: 'address',
    options: [
      { label: 'Property address', value: 'address' },
      { label: 'APN', value: 'apn' },
    ],
  },
  { name: 'propertyAddress', type: 'collection', label: 'Property address', spec: addressSpec() },
  txt('apn', 'APN'),
  txt('countyFipsCode', 'County FIPS code'),
  txt('county', 'County'),
  txt('state', 'State (for APN)'),
  { name: 'name', type: 'collection', label: 'Owner name (optional)', spec: [txt('first', 'First name'), txt('last', 'Last name')] },
  { name: 'mailingAddress', type: 'collection', label: 'Owner mailing address (optional)', spec: addressSpec() },
  txt('requestId', 'Request ID'),
  {
    name: 'includeTcpaFlaggedPhones',
    type: 'boolean',
    label: 'Include phone numbers flagged as TCPA litigators',
    default: false,
    help: 'Off by default: flagged numbers are removed. Turn on only if your compliance process allows it.',
  },
  { name: 'prioritizeMobilePhones', type: 'boolean', label: 'Prioritize mobile phones' },
];
export const skipTraceV1Params = skipTraceParams;
export const skipTraceV3Params = skipTraceParams;

export const verifyAddressParams = [
  txt('street', 'Street', { required: true }),
  txt('city', 'City'),
  txt('state', 'State'),
  txt('zip', 'ZIP code'),
];

export const phoneParams = [
  {
    name: 'phoneNumbers',
    type: 'array',
    label: 'Phone numbers',
    required: true,
    help: 'One number per item, for example 4805550123. You are billed per phone number.',
    spec: { type: 'text', label: 'Phone number' },
  },
];

export const apiCallParams = [
  txt('url', 'URL', {
    required: true,
    help: 'Path after /api, without a leading slash, for example v1/property/search. Account balance (wallet) endpoints are not available here.',
  }),
  {
    name: 'method',
    type: 'select',
    label: 'Method',
    required: true,
    default: 'GET',
    options: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map(opt),
  },
  {
    name: 'headers',
    type: 'array',
    label: 'Headers',
    help: 'The authorization header is added for you.',
    spec: [txt('key', 'Key'), txt('value', 'Value')],
  },
  {
    name: 'qs',
    type: 'array',
    label: 'Query string',
    spec: [txt('key', 'Key'), txt('value', 'Value')],
  },
  { name: 'body', type: 'any', label: 'Body', help: 'JSON request body.' },
];
