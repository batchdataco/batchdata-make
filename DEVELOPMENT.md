# Development notes

This is a Make custom app in the local project format used by the Make Apps Editor extension for VS Code (`makecomapp.json`, `general/`, `connections/`, `modules/`).

## Layout

- `scripts/generate.mjs` writes every JSON file under `general/`, `connections/`, `modules/`, `webhooks/`, `rpcs/` and `makecomapp.json` from `scripts/params.mjs`, the fixtures in `test/fixtures/` and the shared operation catalog. `scripts/catalog.json` is a vendored copy of the catalog used by the Zapier and n8n apps (`scripts/catalog.sha256` pins it; a test fails on drift) and `scripts/catalog-modules.mjs` translates it into modules, the webhook and the dynamic dropdowns. The generated files are committed. Edit the scripts, then run `node scripts/generate.mjs`.
- `test/catalog.test.mjs` checks every catalog module (request, output, TCPA flag, billing text, guards, webhook attach and detach).
- `test/structure.test.mjs` checks the manifest, file links, billing and compliance copy, and that no callback or wallet fields exist.
- `test/pagination.test.mjs` plays the six paged modules (Search Properties, Get Investor Properties, Find Investors, Get Property Permits, List Search Sessions, Watch New Search Sessions) against a fake BatchData endpoint the way Make pages: it checks the Limit is met, that no request asks for more records than the Limit has left (billing safety), that the whole body is repeated on every page, and the response paths used. `scripts/paging.mjs` builds the directives.
- `test/replay.test.mjs` renders the request templates with a small IML evaluator (`test/iml.mjs`) and compares the request bodies and output mapping to the n8n and Zapier integrations.

```
node --test "test/*.test.mjs"
```

Node 20 or later. There are no dependencies.

## Import into Make

1. Create a Make account (the organisation that will own the app) and a Make API key with the `apps:read` and `apps:write` scopes.
2. Install the Make Apps Editor extension in VS Code and open this folder.
3. Put the API key in `.secrets/apikey` (the folder is git-ignored).
4. `makecomapp.json` has one documented origin: the private app `batchdata-r6b83g` in organization 3655001 on `https://us2.make.com/api` (Make added the suffix to the name `batchdata`, so the connection and webhook remote names are `batchdata-r6b83g`). To deploy to another zone or organization, copy that entry, change `baseUrl` and `appId`, and clear the `idMapping`.
5. Run **Deploy to Make** from the extension.
6. Open the app in Make and run the checks below.

## What was and was not verified

Verified here (offline): JSON validity, manifest links, request bodies and output mapping against mocked BatchData responses, billing and compliance copy, no callback or wallet fields.

Not verified, needs a Make account and a BatchData test token (a sandbox token returns mock data at no cost):

- Import with the VS Code extension (the file layout follows public examples, not a Make validator).
- Connection check. It POSTs `{"requests":[]}` to `/v1/address/verify` and marks the connection valid on HTTP 400 or 2xx through `response.valid`. If Make marks the 400 as an error before it reads `valid`, switch the check to `GET https://api.batchdata.com/api/v2/property/search-sessions?take=1` (valid on 2xx). Also confirm with BatchData that the rejected empty request is not billed.
- Optional fields. The templates use `ifempty(x, undefined)` and `omit()` so empty fields are not sent. Nested optional filters (for example Permit Status) are collection parameters that are dropped when empty. Check that an unfilled nested collection (for example Building) is not sent as `{}`.
- Instant triggers. Check that turning a scenario on creates the property subscription (attach), that a test event arrives with `eventId` set, and that turning it off deletes the subscription (detach, `externalHookId`). Create hooks only with a sandbox token: a subscription counts towards the team's limit of 5 and cannot be edited.
- Polling triggers (`Watch New Search Sessions`, `Watch New Properties in a Search Session`): confirm the date ordering and that a first run does not replay old items as expected.
- Dynamic dropdowns (`rpc://listSearchSessions`, `rpc://listMonitors`): confirm the label and value mapping.
- The `{{...}}` spread in the Search Properties output (adds `searchMeta` next to each property).
- Make an API Call: the wallet guard redirects any path containing `wallet` to a non-existent path. IML cannot raise a validation error, so this is best effort. Decide whether to keep the module.

- Webhook dedupe. The webhook sets `uid` to `body.eventId`; confirm in Make that a repeated event does not start a second run.
- Callback keys. IML cannot strip keys recursively. Make an API Call blocks (sends nothing) any body that contains `webhook` or a JSON unicode escape (`u00`). The Additional Criteria JSON fields on search, session and monitor modules are not stripped; BatchData's synchronous endpoints ignore callback keys, and the monitor and trigger modules fix `deliveryConfig` themselves. A Make custom function that strips the keys would close this gap.

## Decisions

- Triggers: the instant triggers use a BatchData webhook subscription (`deliveryConfig {type: "webhook"}`) created on attach and deleted on detach; the hook URL is the scenario's own and is never entered by the user. Polling triggers cover new search sessions and new properties in a session (billed, opt-in by choosing that module). Billed property hydration is a separate module so the default instant trigger never bills a lookup. There is no new-monitor polling trigger (no date or ordered ID).
- Monitor creation (`Create Property Monitor`) is stream delivery only; Make an API Call blocks monitor create or edit calls so webhook URLs only come from the trigger.
- No callback URL fields (`webhookUrl`, `errorWebhookUrl`): they are for asynchronous requests only.
- Skip trace is two modules because V1 and V3 return different shapes. The TCPA option is always sent explicitly (V1 excludes flagged numbers by default, V3 includes them).
- Search sends one request of at most 100 records and does not page, so one run cannot bill more than 100 records.

## Push steps (Make Apps Editor)

1. In the Make account that will own the app, create an API key with scopes `apps:read` and `apps:write` (Profile, API access).
2. Install the Make Apps Editor extension in VS Code, open this folder and save the key to `.secrets/apikey`.
3. Set `origins[0].baseUrl` in `makecomapp.json` to the account zone (for example `https://us1.make.com/api`).
4. Run **Deploy to Make**, then the checks above. The app starts private; to publish it publicly submit it for Make review from the app page in Make.
