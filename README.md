# BatchData for Make

Use BatchData property data inside Make scenarios: search and look up properties, skip trace owners (V1 and V3, single and batch), reverse skip trace, verify and geocode addresses, check phone numbers, get permits, find investors by buy box, run search sessions and watch property monitors, with polling and instant (webhook) triggers and a generic API call module.

Support: support@batchservice.com

> **Status: v0.2.0, not yet imported into Make.** It passes its offline tests. Most operations were smoke-tested live through the BatchData API; monitors and the instant trigger were not (see [What was and was not verified](#what-was-and-was-not-verified)).

![BatchData](assets/logo.png)

## Connect

1. Create an API token in your BatchData account.
2. In a BatchData module, click **Add** next to Connection and paste the token.

If the token is rejected, create a new one. For help, contact support@batchservice.com.

## Modules

Billing text is also in each module's description in Make.

| Module | Type | What it does | Billing |
| --- | --- | --- | --- |
| Search Properties | Search | Finds properties by location and filters. Up to 100 records per run. | Per record returned (0 is billed as 1) |
| Get Property Details | Search | Full property data for one address or ID. | Per matched property |
| Batch Look Up Properties | Search | Full records for up to 100 addresses in one call. | Per matched property |
| Skip Trace Owner (V1) | Search | Owner contact details, one result per person. | Per matched property |
| Skip Trace Owner (V3) | Search | Owner contact details, one result per property with a persons list. | Per matched property |
| Batch Skip Trace Properties (V3) | Search | Up to 100 properties in one call. | Per matched property |
| Reverse Skip Trace (Phone or Email) | Search | Finds the person behind a phone number or email. | Per matched result |
| Verify Address / Batch Verify Addresses | Search | Standardizes one or up to 100 US addresses. | Per address |
| Autocomplete, Geocode, Reverse Geocode | Search | Address suggestions, coordinates, nearest addresses. | This call does not bill property records |
| Verify Phone Numbers, Check Do Not Call, Check TCPA Litigator | Search | Phone checks. | Per phone number |
| Get Property Permits | Search | Building permits for one property, one result per permit. | See the module description |
| Find Investors (Buy Box), Get Investor Properties | Search | Investors who bought near a subject property, and their holdings. | See the module description |
| List, Create or Advance, Delete Search Session | Search, Action | Persistent search sessions that return only properties not yet delivered. | Create or Advance bills each record delivered |
| List, Get, Create, Delete Property Monitor | Search, Action | Property monitors with stream delivery (Kinesis or Azure Event Hubs). | According to your BatchData plan |
| Watch New Search Sessions | Polling trigger | New search sessions on your team. | Does not bill property records |
| Watch New Properties in a Search Session (Billed) | Polling trigger | New properties delivered by a session. | Every check bills each property delivered |
| Watch Property Monitor Events (Instant) | Instant trigger | Fires when a property is added to, removed from or changed in a monitor. | According to your BatchData plan |
| Watch Property Monitor Events with Property Record (Instant, Billed) | Instant trigger | Same, plus the full property record. | Plan billing, plus one property lookup per event |
| Make an API Call | Universal | Any other BatchData API path. Wallet, asynchronous and monitor create or edit paths are blocked, and so are bodies with callback URL fields. | Follows the endpoint |

### Instant triggers (property monitor events)

Turning a scenario on creates a V2 property subscription whose delivery is the scenario's own Make webhook URL. Turning it off (or deleting the scenario) deletes that subscription. You never enter a callback URL. Each event is `{eventId, propertyId, parcelHash, addressHash, addedToSubscriptionIds, removedFromSubscriptionIds, propertyChangedAt, sentAt}`. The event carries IDs only; use the module with **Property Record** to add the full record (one billed property lookup per event). Use `eventId` to skip repeats.

Limits (also in each trigger's description): up to 5 monitors per team, a monitor cannot be edited after it is created (delete and recreate it), a new monitor can take up to 7 days to start delivering, and delivery is best effort (4 attempts per event). Because of the 5 monitor limit, avoid many scenarios that each create a monitor.

There is no polling "new monitor" trigger in Make: a polling trigger needs a date or an ordered ID on each item, and monitors have neither. Use List Property Monitors on a schedule instead. The Zapier and n8n apps do include one.

## Phone compliance

Skip trace and phone modules return data only. You are responsible for following the TCPA and Do Not Call rules before you contact anyone. Skip trace removes phone numbers flagged as TCPA litigators unless you switch on **Include phone numbers flagged as TCPA litigators**.

## What was and was not verified

Verified live (production API, 1 record per call, through the same request shapes the other BatchData integrations use): property search, lookup, skip trace V1 and V3, reverse skip trace (no match), address verify, DNC, permits, investor buy box and properties, geocode, reverse geocode, autocomplete, and the search-session create, list and delete lifecycle.

Mocked only: property monitors and the instant triggers. The token used gets 403 on the subscription endpoints, so create, list, delete and event delivery need a sandbox token (mock data, no cost, from app.batchdata.com) or a token with that ability.

Offline tests (47) check the manifest, file links, copy rules (one support contact, billing text in every module, no callback fields) and the request body, query and output of every module against mocked responses. The offline IML evaluator is a subset of Make's engine, so Make itself has not run these modules; see `DEVELOPMENT.md` for the checks to run after import.

## License

The code in this repository is released under the MIT License (see `LICENSE`). The BatchData API and the data it returns are proprietary to BatchData (batchdata.io) and are subject to BatchData's terms of service; the MIT License does not cover them. Support: support@batchservice.com
