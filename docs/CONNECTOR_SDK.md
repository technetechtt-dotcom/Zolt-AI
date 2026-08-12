# Connector SDK

Implement `ZoltConnector` from `@zolt/connector-sdk`:

- `validatePayload` must reject malformed vendor payloads before transform
- `transform` must emit canonical `ZoltTelemetryEnvelope` values, including `simulated` when the source is not live plant data
- Never map vendor commands into Zolt. Connectors are ingest-only in this build

See `connectors/gridflex` for the reference GridFlex 1.0 connector.
