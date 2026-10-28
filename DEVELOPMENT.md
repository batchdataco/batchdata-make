# Development notes

This is a Make custom app in the local project format used by the Make Apps Editor extension for VS Code (`makecomapp.json`, `general/`, `connections/`, `modules/`).

## Layout

- `scripts/generate.mjs` writes every JSON file under `general/`, `connections/`, `modules/` and `makecomapp.json` from `scripts/params.mjs` and the fixtures in `test/fixtures/`. The generated files are committed. Edit the scripts, then run `node scripts/generate.mjs`.
- `test/structure.test.mjs` checks the manifest, file links, billing and compliance copy, and that no callback or wallet fields exist.
- `test/replay.test.mjs` renders the request templates with a small IML evaluator (`test/iml.mjs`) and compares the request bodies and output mapping to the n8n and Zapier integrations.

```
node --test "test/*.test.mjs"
```

Node 20 or later. There are no dependencies.

## Import into Make

1. Create a Make account (the organisation that will own the app) and a Make API key with the `apps:read` and `apps:write` scopes.
2. Install the Make Apps Editor extension in VS Code and open this folder.
3. Put the API key in `.secrets/apikey` (the folder is git-ignored).
4. In `makecomapp.json`, set `origins[0].baseUrl` to your zone, for example `https://us1.make.com/api` or `https://eu1.make.com/api`.
5. Run **Deploy to Make** from the extension. The app is created as a private app with id `batchdata`.
6. Open the app in Make and run the checks below.

## What was and was not verified

Verified here (offline): JSON validity, manifest links, request bodies and output mapping against mocked BatchData responses, billing and compliance copy, no callback or wallet fields.

Not verified, needs a Make account and a BatchData test token:

- Import with the VS Code extension (the file layout follows public examples, not a Make validator).
- Connection check. It POSTs `{"requests":[]}` to `/v1/address/verify` and marks the connection valid on HTTP 400 or 2xx through `response.valid`. If Make marks the 400 as an error before it reads `valid`, switch the check to `GET https://api.batchdata.com/api/v2/property/search-sessions?take=1` (valid on 2xx). Also confirm with BatchData that the rejected empty request is not billed.
- Optional fields. The templates use `ifempty(x, undefined)` and `omit()` so empty fields are not sent. Check that an unfilled nested collection (for example Building) is not sent as `{}`.
- The `{{...}}` spread in the Search Properties output (adds `searchMeta` next to each property).
- Make an API Call: the wallet guard redirects any path containing `wallet` to a non-existent path. IML cannot raise a validation error, so this is best effort. Decide whether to keep the module.

## Decisions

- No triggers: search sessions bill per record and have no teardown hook, and the property subscription payload is not documented.
- No callback URL fields (`webhookUrl`, `errorWebhookUrl`): they are for asynchronous requests only.
- Skip trace is two modules because V1 and V3 return different shapes. The TCPA option is always sent explicitly (V1 excludes flagged numbers by default, V3 includes them).
- Search sends one request of at most 100 records and does not page, so one run cannot bill more than 100 records.
