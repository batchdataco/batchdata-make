# BatchData for Make

Use BatchData property data inside Make scenarios: search properties, get property details, find owner contact details, verify addresses and check phone numbers.

## Connect

1. Create an API token in your BatchData account.
2. In a BatchData module, click **Add** next to Connection and paste the token.

If the token is rejected, create a new one. For help, contact support@batchservice.com.

## Modules

| Module | What it does | Billing |
| --- | --- | --- |
| Search Properties | Finds properties by location and filters. Up to 100 records per run. | Per record returned (0 is billed as 1) |
| Get Property Details | Full property data for one address or ID. | Per matched property |
| Skip Trace Owner (V1) | Owner contact details, one result per person. | Per matched property |
| Skip Trace Owner (V3) | Owner contact details, one result per property with a persons list. | Per matched property |
| Verify Address | Standardizes one US address. | Per address |
| Verify Phone Numbers | Reachability, carrier, DNC and TCPA flags. | Per phone number |
| Check Do Not Call | Do Not Call registry check. | Per phone number |
| Check TCPA Litigator | TCPA litigator list check. | Per phone number |
| Make an API Call | Any other BatchData API path. | Follows the endpoint |

## Phone compliance

Skip trace and phone modules return data only. You are responsible for following the TCPA and Do Not Call rules before you contact anyone. Skip trace removes phone numbers flagged as TCPA litigators unless you switch on **Include phone numbers flagged as TCPA litigators**.

## Not included

There is no instant trigger (watch) module in this version. Use a scheduled scenario with Search Properties instead.
