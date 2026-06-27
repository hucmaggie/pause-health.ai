# pause-whoop-system-api-spec

OAS 3.0 contract for the Pause Whoop System API.

**Spec only.** Follows the
[`pause-oura-system-api-spec`](../pause-oura-system-api-spec/) template
exactly — same `GET /{vendor}/{patient}/{dataType}` URL shape, same OMH
envelope, same OAuth 2.0 client_credentials downstream auth. What
changes:

- **Data-type catalog.** Whoop has `recovery-score`,
  `cardiovascular-strain`, `sleep-episode`, `physical-activity`,
  `heart-rate`, `heart-rate-variability`. The recovery + strain
  schemas are synthetic OMH names (`recovery-score:1.0`,
  `cardiovascular-strain:1.0`) because the OMH catalog doesn't define
  Whoop's composite scoring metrics.
- **Upstream auth.** Whoop is OAuth 2.0 + a refresh-token-rotating flow
  (every refresh returns a new refresh token; old ones invalidate).
  Hidden inside the Mule app via Anypoint Secret Manager; not surfaced
  in the contract.

Same build/publish/consume recipe as the Oura asset. Spec file:
[`src/main/resources/whoop-system-api.oas3.yaml`](./src/main/resources/whoop-system-api.oas3.yaml).
