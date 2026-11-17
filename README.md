# BatchData for Make

![BatchData](assets/logo-512.png)

BatchData gives you property, owner and address data through an API. This app brings it into your Make scenarios, so you can find properties, enrich them with owner contact details, and verify addresses and phone numbers without writing code.

Typical uses:

- Build a list of properties that match your filters and send it to a spreadsheet, CRM or marketing tool.
- Look up one address and add the full property record, ownership and sale history to a lead.
- Find the owner's phone numbers and emails (skip trace) for a property, and check the numbers against Do Not Call and TCPA litigator lists.
- Clean up addresses before mailing, or turn an address into coordinates.

Support: support@batchservice.com

## Connect

1. Sign in to your BatchData account and create an API token. Tokens are available on plans with API access.
2. In Make, add any BatchData module to a scenario.
3. Next to **Connection**, click **Add**, paste the token into **API token** and save.

If the token is rejected, create a new one and try again. Use a sandbox token to try the app with sample data. Sandbox tokens return mock data and are not billed. Use a production token for real data. If you need help, contact support@batchservice.com.

## Modules

### Properties

| Module | What it does |
| --- | --- |
| Search Properties | Finds properties by location and filters such as property type, bedrooms, owner details and prebuilt quick lists. |
| Get Property Details | Returns the full record for one address, property ID, hash or APN. |
| Batch Look Up Properties | Returns full records for up to 100 addresses in one call. |
| Get Property Permits | Returns the building permits for one property, one result per permit. |

### Owner contact

| Module | What it does |
| --- | --- |
| Skip Trace Owner (V1) | Owner contact details for a property, one result per person. |
| Skip Trace Owner (V3) | Owner contact details, one result per property with a list of persons. |
| Batch Skip Trace Properties (V3) | Skip trace for up to 100 properties in one call. |
| Reverse Skip Trace (Phone or Email) | Finds the person behind a phone number or email address. |
| Verify Phone Numbers | Checks whether phone numbers are valid and reachable. |
| Check Do Not Call | Checks phone numbers against the Do Not Call list. |
| Check TCPA Litigator | Checks phone numbers against known TCPA litigators. |

### Addresses

| Module | What it does |
| --- | --- |
| Verify Address, Batch Verify Addresses | Standardizes and validates one address, or up to 100 US addresses. |
| Autocomplete Address | Suggests addresses as you type. |
| Geocode Address | Turns an address into coordinates. |
| Reverse Geocode (Find Nearby Addresses) | Finds the addresses closest to a set of coordinates. |

### Investors

| Module | What it does |
| --- | --- |
| Find Investors (Buy Box) | Finds likely investors for a subject property, based on nearby comparable sales. |
| Get Investor Properties | Lists the properties an investor holds. |

### Search sessions

A search session remembers what it has already returned, so each run gives you only properties you have not received before.

| Module | What it does |
| --- | --- |
| Create or Advance Search Session | Starts a session, or returns the next properties from an existing one. |
| List Search Sessions | Lists the sessions on your team. |
| Delete Search Session | Deletes a session. |

### Triggers

| Module | Type | What it does |
| --- | --- | --- |
| Watch New Search Sessions | Polling | Runs when a new search session appears on your team. |
| Watch New Properties in a Search Session (Billed) | Polling | Runs for each new property a session delivers. |

### Other

| Module | What it does |
| --- | --- |
| Make an API Call | Calls any other BatchData API path with your connection. |

## Limit and paging

Search Properties, Get Investor Properties, Find Investors (Buy Box), Get Property Permits, List Search Sessions and Watch New Search Sessions have a **Limit** field. It is the total number of records you want. Make fetches them in pages of up to 100 and never asks for more than your Limit, so the Limit is also the most you can be billed for in one run. Search Properties and List Search Sessions also have **Skip** to start part-way through the results.

Each record comes out as its own bundle. On billed searches (Search Properties, Get Investor Properties, Find Investors (Buy Box) and Get Property Permits) the default Limit is 1, so a test run does not bill a full page. Raise it when you need more records. Watch New Properties in a Search Session (Billed) defaults to 5 properties per check.

## Billing

Your BatchData plan decides what each call costs. Each module's description in Make says how it is billed. In general:

- Search and lookup modules bill per record returned. Set a Limit to cap it.
- Skip trace modules bill per matched property.
- Address, phone and compliance checks bill per item checked.
- Autocomplete, geocoding and the modules that list, get or delete search sessions do not bill property records.
- Get Property Permits bills per property requested, not per permit. A Limit above 100 sends more than one request.
- Watch New Properties in a Search Session (Billed) bills every property it delivers, on every scheduled run.

For pricing questions, contact support@batchservice.com.

## Phone compliance

Skip trace and phone modules return data only. You are responsible for following the TCPA and Do Not Call rules before you contact anyone. Skip trace leaves out phone numbers flagged as TCPA litigators unless you switch on **Include phone numbers flagged as TCPA litigators**.

## Support

Email support@batchservice.com.

## License

The code in this repository is released under the MIT License (see `LICENSE`). The BatchData API and the data it returns are proprietary to BatchData (batchdata.io) and are subject to BatchData's terms of service. Development notes are in `DEVELOPMENT.md`.
