# Generate a RAP service with the existing SAP RAP Generator

`createFullRapService` uses the installed `abap-adt-api` RAP Generator endpoints. The SAP system must support the selected generator (`uiservice` or `webapiservice`), and the ADT user must have permissions for the reference object, destination package, and transport. This tool does **not** construct a fixed set of eight artifacts: the generator decides which objects to produce.

Provide a local ADT `refObjectUri` (for example `/sap/bc/adt/ddic/tables/zorders`) and `packageName`. Optional `generatorId` defaults to `uiservice`. Optionally pass an SDK `RapGeneratorContent` object with the `general`, `businessObject`, `serviceProjection`, and `businessService` fields; otherwise server-generated defaults are fetched. If supplied, `content.metadata.package` must match `packageName`. The tool sets that metadata package when absent, after validating the content structure.

For a non-`$TMP` package, supply a nonblank `transport` to generate; for `$TMP`, an empty transport is allowed and the SDK sends an empty `corrNr`. `dryRun: true` only validates and previews; it does not generate, and requires no transport. Use dry run to inspect proposed object names before generation.

Example:

```json
{
  "generatorId": "uiservice",
  "refObjectUri": "/sap/bc/adt/ddic/tables/zorders",
  "packageName": "ZPKG",
  "transport": "REQ123",
  "dryRun": true
}
```

The pipeline validates the reference/package, fetches defaults only if content was omitted, validates final content, previews, then calls generate once unless dry-run. Validation errors or malformed responses return `isError` with `status: "failure"`. The `preview` field lists proposed objects, **not** proof they were created. A failed, empty, or malformed generation result is uncertain: inspect the SAP system before manually retrying. No automatic retry, rollback, activation or service-binding publication is performed. Actual generation mutates SAP objects; no live SAP operation is part of the automated tests.
