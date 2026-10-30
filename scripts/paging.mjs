// Make "Limit" and pagination for the modules that return lists of billed records.
//
// BatchData bills per record returned, so every page asks for at most the records still missing
// from the user's Limit: min(100, Limit - records already requested). Make stops paging as soon as
// the Limit is met (response.limit) or the API reports that no more records exist
// (pagination.condition). A pagination request REPLACES the original body (it only merges query
// string and headers), so a POST body is repeated whole, including searchCriteria.

export const PAGE_SIZE = 100;
export const LIMIT_MAX = 5000; // Make allows 1 first request + 50 pagination requests per module run

const clone = (v) => JSON.parse(JSON.stringify(v));
// Records already requested before the page that Make is about to ask for (pagination.page is 2 then).
const done = `(pagination.page - 1) * ${PAGE_SIZE}`;
const limitOf = (def) => `ifempty(parameters.limit, ${def})`;
const skipOf = (skipParam) => (skipParam ? `ifempty(parameters.${skipParam}, 0)` : '0');

export const limitParam = (def, { max = LIMIT_MAX, what, extra = '' }) => ({
  name: 'limit',
  type: 'uinteger',
  label: 'Limit',
  default: def,
  required: true,
  validate: { min: 1, max },
  help: `The maximum number of ${what} to return in total (1 to ${max}, default ${def}). They are requested in pages of up to ${PAGE_SIZE}, and never more than this number are requested.${extra}`,
});

const takeFirst = (def) => `{{min(${PAGE_SIZE}, ${limitOf(def)})}}`;
const takeNext = (def) => `{{min(${PAGE_SIZE}, ${limitOf(def)} - ${done})}}`;
const moreAfter = (def) => `${limitOf(def)} > ${done}`;

// Skip/take paging. `where` is 'body' (POST, options.take/skip) or 'qs' (GET, take/skip).
// `found` is the response path with the total number of matches.
export const offsetPaging = (comm, { def, found, where, skip }) => {
  const nextOffset = `{{${skipOf(skip)} + ${done}}}`;
  comm.response.limit = `{{${limitOf(def)}}}`;
  const condition = `{{${found} > ${skipOf(skip)} + ${done} && ${moreAfter(def)}}}`;
  if (where === 'qs') {
    comm.qs = { ...comm.qs, take: takeFirst(def) };
    comm.pagination = { qs: { take: takeNext(def), skip: nextOffset }, condition };
    return;
  }
  const next = clone(comm.body);
  comm.body.options = { ...comm.body.options, take: takeFirst(def) };
  next.options = { ...next.options, take: takeNext(def), skip: nextOffset };
  comm.pagination = { body: next, condition };
};

// Cursor paging (the API returns nextPageCursor; skip is not accepted).
export const cursorPaging = (comm, { def, cursor }) => {
  comm.response.limit = `{{${limitOf(def)}}}`;
  const next = clone(comm.body);
  comm.body.options = { ...comm.body.options, take: takeFirst(def) };
  next.options = { ...next.options, take: takeNext(def), pageCursor: `{{${cursor}}}` };
  comm.pagination = { body: next, condition: `{{length(ifempty(${cursor}, '')) > 0 && ${moreAfter(def)}}}` };
};
