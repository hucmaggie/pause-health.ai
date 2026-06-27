# pause-garmin-system-api-spec

OAS 3.0 contract for the Pause Garmin System API.

**Spec only.** Follows the
[`pause-oura-system-api-spec`](../pause-oura-system-api-spec/) template
— same `GET /{vendor}/{patient}/{dataType}` URL shape, same OMH
envelope. What changes:

- **Data-type catalog.** Garmin exposes a wider set than Oura, including
  `body-temperature` (Body Battery feed) and `oxygen-saturation` (Pulse
  Ox feed) which several Oura models also expose but aren't yet in the
  Oura spec's data-type enum.
- **Upstream auth.** Garmin Health API still uses **OAuth 1.0a**
  (consumer key + token secret + HMAC-SHA1 signing). Not migrated to
  OAuth 2.0. Hidden inside the Mule app; downstream callers still use
  OAuth 2.0 client_credentials.
- **Upstream cadence.** Garmin pushes a "data available" webhook ping;
  the Mule app pulls on receipt. To downstream callers this looks like
  any other pull source — `AccountStatus.lastSyncIso` reports when the
  Mule app last pulled.

Same build/publish/consume recipe as the Oura asset. Spec file:
[`src/main/resources/garmin-system-api.oas3.yaml`](./src/main/resources/garmin-system-api.oas3.yaml).
