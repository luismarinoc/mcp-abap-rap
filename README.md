# ABAP ADT API MCP server

This server preserves the upstream ABAP ADT tools and adds RAP and multiclient tools alongside `readResultPage` for large results. Object CRUD, locking, activation, transports, queries, debugging, refactoring, Git and analysis use the selected SAP session owned by a trusted local stdio client. SAP authorizations determine what that session can read or change.

Local development: see [backup and recovery](docs/backup-and-recovery.md), [connection diagnostics](docs/connection-robustness.md), and [RAP operation results](docs/rap-results.md). After intentionally rebuilding or replacing `dist/`, restart the MCP connection so its process loads the new code. Offline protocol tests do not confirm the reported disconnect fixed against a live SAP system.


## Installation and protocol

Use Node22.22.2+ or24.15.0+. Run `npm ci` and `npm run build`, then configure your MCP client to launch `node` with the absolute path to `dist/index.js`. Existing npm/registry releases do not contain this PR until the owner releases it. No release is published here.

```json
{
  "mcpServers": {
    "abap-adt": {
      "command": "node",
      "args": ["/absolute/path/mcp-abap-abap-adt-api/dist/index.js"],
      "env": {
        "SAP_URL": "https://sap.example.invalid:44300",
        "SAP_USER": "YOUR_USER",
        "SAP_PASSWORD": "YOUR_PASSWORD",
        "SAP_CLIENT": "100",
        "SAP_LANGUAGE": "EN"
      }
    }
  }
}
```

Public TypeScript MCP2.0.0 supports modern2026-07-28 discovery and legacy2025-11-25 initialization, validated tools, cancellation and proper errors. This package exposes stdio; it is not an HTTP listener or MCP OAuth provider. Missing credentials still allow discovery. `healthcheck` reports local configuration and session recovery state, not verified SAP connectivity.

Environment comes from the MCP client. Dotenv loads only when `SAP_ENV_FILE` explicitly names a file. `SAP_URL` is an origin without a path, query or embedded credentials. For a private CA set `NODE_EXTRA_CA_CERTS` before launching Node. TLS verification cannot be disabled. Loopback HTTP is allowed for fixtures; a trusted private HTTP deployment requires `SAP_ALLOW_HTTP=1` and exposes credentials to that network.

An authorized broker's static `SAP_BEARER_TOKEN` can replace the password. Rotate it by restarting the process; this does not implement XSUAA grants or prove tenant acceptance. No password-grant flow is introduced.

## Session and limits

Only one SAP operation runs at a time; overlaps receive a busy error. Client selection and listing remain available while a request is pending; that request keeps its pinned connection. Debugger listeners also occupy this session until completed or cancelled. `SAP_REQUEST_TIMEOUT_MS` defaults to60000 and accepts100..120000, including login and every underlying HTTP request. Cancellation closes real sockets. The client does not follow redirects, inherit environment proxies, retry mutations or automatically reauthenticate a stateful call. An interrupted write may already have changed SAP: inspect writes and locks, then explicitly `login`, `dropSession` or `logout` to recover. Shutdown attempts a bounded logout; unreachable SAP can retain state until its own expiry.

HTTP stays on the configured origin under `/sap/`, with 2MiB requests,4MiB responses and verified TLS. XML entity declarations are rejected. Input JSON is bounded by bytes, nesting, arrays and field contracts. This is a trusted operator tool, not an OS sandbox or multi-user service. Git tools can ask SAP to contact a remote Git service with supplied credentials; those operations depend on SAP and remote permissions.

Schemas are derived from pinned abap-adt-api8.4.3 declarations, including objects, arrays and overloads. Previously documented JSON strings for object arguments remain accepted, parsed and validated. Unknown top-level arguments are rejected. `scripts/generate-input-contracts.mjs` and its report record the mapping; rerun and review on dependency updates. Its TypeScript6 compiler API is development-only; TypeScript6 builds the application.

Source snapshots from `getObjectSource`/successful `setObjectSource` can feed `syntaxCheckCode` when `code` is omitted (issue#2). The per-connection cache is limited to8MiB,64entries and five minutes. Mutating/session operations clear old snapshots. Snapshots are the last observed text, not a guarantee against external edits. Explicit empty text is checked as an equivalent blank line because upstream rejects an empty string; results report `emptySourceNormalized`. Source options accept structured or JSON objects, including active/inactive versions. Existing line paging remains available. Class includes fetch class metadata first; a public-request adapter handles valid single-link class XML rejected by the upstream parser. Maps preserve their entries in JSON.

Above64KiB, results return an opaque `resultId`, a JSON page, `nextOffset` and expiry. Use `readResultPage`, concatenate pages and JSON-parse to recover the original tool result. Paging never repeats SAP requests or writes. At most four 4MiB results live for five minutes; mutations/session resets clear them. Expired results need an intentional repeat of the original read. Larger results fail clearly. Query/search/ATC defaults are100 with caps of1000 where available; an API may return an extra sentinel row. Other large structures use generic paging.

## Validation and deployment acceptance

```sh
npm run build
npm test
npm run verify:stdio
npm run verify:package
npm audit
docker build -t mcp-abap-api .
node scripts/verify-stdio.mjs --offline docker run --rm -i --network none mcp-abap-api
```

Tests use real local HTTP/XML fixtures and installed modern/legacy protocol exchanges. Linux/Windows Node22/24 and non-root Docker run in CI. No SAP production credentials or writes are used. For an authorized read-only deployment canary set `SAP_LIVE_TEST=1` and optional `SAP_LIVE_SOURCE_URL`, then run `npm run verify:live`. This checks login/discovery/optional source reading, not every SAP write/debug/Git/transport feature. Validate those on a development system. Permissions, credentials, API availability and support through the end of2026 remain deployment checks.

Existing PRs19/20/21/22 overlap errors, result sizing, class includes and login; all remain open for owner review. PR15's state restoration and refactoring JSON work already exists on the starting branch. PR10's proposed XSUAA implementation is not merged here.

References: [abap-adt-api](https://github.com/marcellourbani/abap-adt-api), [MCP2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28), [Node private CA configuration](https://nodejs.org/api/cli.html#node_extra_ca_certsfile).

## Existing tool workflow reference

Original workflow examples follow. Runtime, schema and installation behavior above supersedes older client-specific examples.

## RAP fork tools

`listarClientes`, `clienteActual`, `usarCliente` and `recargarClientes` expose selection without passwords. Configure `clientes.json` locally or use `SAP_URL`, `SAP_USER` and `SAP_PASSWORD` (or `SAP_BEARER_TOKEN`) for one default client. URLs must be HTTPS origins unless explicitly trusted via `SAP_ALLOW_HTTP=1`. A request pins its selected connection; reload clears its old cache, and a fresh connection is used for later requests. After an uncertain write, inspect SAP before explicitly logging in and reacquiring locks. `adtRequest` stays on the configured `/sap/` origin and is subject to the same HTTP bounds.

The fork adds [class includes and package value helps](docs/class-package-tools.md),
[optional object-type filtering and bounded search pagination](docs/object-discovery-tools.md),
and [`createFullRapService` using SAP's RAP Generator](docs/rap-generator-tool.md).
`classIncludes` takes `clas`; `packageSearchHelp` takes one of four supported `type` values and optional `name` (a valid type can still return a system-specific 404).
`objectTypes` takes optional `filter` (case-insensitive substring of type, name, or description).
`searchObject` keeps `query`, `objType` and `max` unchanged when paging is omitted; paging uses `offset: 0` and `pageSize: 100` by default, fetches a prefix limited to 10000, and cannot be combined with `max`. It does not provide an exact total, stable snapshot or configurable timeout.
`createFullRapService` requires `refObjectUri` and `packageName`, defaults `generatorId` to `uiservice` and `dryRun` to false, accepts optional generator `content`, and requires nonblank `transport` to generate outside `$TMP`. The generator requires SAP endpoint support; dry run validates and previews without generating. It does not guarantee eight objects, publish services, or roll back partial creation.
These source changes require an intentional build and MCP restart to become active; no live SAP generation has been verified.

## Custom Instruction

Use this Custom Instruction to explain the tool to your model:

````
## mcp-abap-abap-adt-api Server

This server provides tools for interacting with an SAP system via ADT (ABAP Development Tools) APIs. It allows you to retrieve information about ABAP objects, modify source code, and manage transports.

**Key Tools and Usage:**

*   **`searchObject`:** Finds ABAP objects based on a query string (e.g., class name).
    *   `query`: (string, required) The search term.
    *   `objType` and `max`: optional legacy type filter and result cap.
    *   `offset` and `pageSize`: optional bounded local pagination; see [limits](docs/object-discovery-tools.md). Omit both for the legacy response.
    *   Returns the object's URI.  Example: `/sap/bc/adt/oo/classes/zcl_invoice_xml_gen_model`

*   **`transportInfo`:** Retrieves transport information for a given object.
    *   `objSourceUrl`: (string, required) The object's URI (obtained from `searchObject`).
    *   Returns transport details, including the transport request number (`TRKORR` or `transportInfo.LOCKS.HEADER.TRKORR` in the JSON response).

*   **`lock`:** Locks an ABAP object for editing.
    *   `objectUrl`: (string, required) The object's URI.
    *   Returns a `lockHandle`, which is required for subsequent modifications.

*   **`unLock`:** Unlocks a previously locked ABAP object.
    *   `objectUrl`: (string, required) The object's URI.
    *   `lockHandle`: (string, required) The lock handle obtained from the `lock` operation.

*   **`setObjectSource`:** Modifies the source code of an ABAP object.
    *   `objectSourceUrl`: (string, required) The object's URI *with the suffix `/source/main`*.  Example: `/sap/bc/adt/oo/classes/zcl_invoice_xml_gen_model/source/main`
    *   `lockHandle`: (string, required) The lock handle obtained from the `lock` operation.
    *   `source`: (string, required) The complete, modified ABAP source code.
    *   `transport`: (string, optional) The transport request number.

*   **`syntaxCheckCode`:** Performs a syntax check on a given ABAP source code.
    *   `code`: (string, required) The ABAP source code to check.
    *   `url`: (string, optional) The URL of the object.
    *   `mainUrl`: (string, optional) The main URL.
    *   `mainProgram`: (string, optional) The main program.
    *   `version`: (string, optional) The version.
    *   Returns syntax check results, including any errors.

*   **`activate`:** Activates an ABAP object. (See notes below on activation/unlocking.)
    *    `object`: The object to be activated.

*   **`getObjectSource`:** Retrieves the source code of an ABAP object.
    *   `objectSourceUrl`: (string, required) The object's URI *with the suffix `/source/main`*.

**Workflow for Modifying ABAP Code:**

1.  **Find the object URI:** Use `searchObject`.
2.  **Read the original source code:** Use `getObjectSource` (with the `/source/main` suffix).
3.  **Clone and Modify the source code locally:** (e.g., `write_to_file` for creating a local copy, and using `read_file`, `replace_in_file` for modifying this local copy).
4.  **Get transport information:** Use `transportInfo`.
5.  **Lock the object:** Use `lock`.
6.  **Set the modified source code:** Use `setObjectSource` (with the `/source/main` suffix).
7.  **Perform a syntax check:** Use `syntaxCheckCode`.
8.  **Activate** the object, Use `activate`..
9.  **unLock the object:** Use `unLock`.

**Important Notes:**
*   **File Handling:** SAP is completly de-coupled from the local file system. Reading source code will only return the code as tool result - it has no effect on file. Files are not synchronized with SAP but merely a local copy for our reference. FYI: It's not strictly necessary for you to create local copies of source codes, as they have no effect on SAP, but it helps us track changes.
*   **File Handling:** The local filenames you will use will not contain any paths, but only a filename! It's preferable to use a pattern like "[ObjectName].[ObjectType].abap". (e.g., SAPMV45A.prog.abap for a ABAP Program SAPMV45A, CL_IXML.clas.abap for a Class CL_IXML)
*   **URL Suffix:**  Remember to add `/source/main` to the object URI when using `setObjectSource` and `getObjectSource`.
*   **Transport Request:** Obtain the transport request number (e.g., from `transportInfo` or from the user) and include it in relevant operations.
*   **Lock Handle:**  The `lockHandle` obtained from the `lock` operation is crucial for `setObjectSource` and `unLock`. Ensure you are using a valid `lockHandle`. If a lock fails, you may need to re-acquire the lock. Locks can expire or be released by other users.
*   **Activation/Unlocking Order:** The exact order of `activate` and `unLock` operations might need clarification. Refer to the tool descriptions or ask the user. It appears `activate` can be used without unlocking first.
* **Error Handling:** The tools return JSON responses. Check for error messages within these responses.

## Efficient Database Access

SAP systems contain vast amounts of data.  It's crucial to write ABAP code that accesses the database efficiently to minimize performance impact and network traffic.  Avoid selecting entire tables or using broad `WHERE` clauses when you only need specific data.

*   **Use `WHERE` clauses:** Always use `WHERE` clauses in your `SELECT` statements to filter the data retrieved from the database.  Select only the specific rows you need.
*   **`UP TO 1 ROWS`:** If you only need a single record, use the `SELECT SINGLE` statement, if you can guarantee that you can provide ALL the key fields for the `SELECT SINGLE` statement. Otherwise, use the `SELECT` statement with the `UP TO 1 ROWS` addition. This tells the database to stop searching after finding the first matching record, improving performance. Example:

    ```abap
    SELECT vgbel FROM vbrp WHERE vbeln = @me->lv_vbeln INTO @DATA(lv_vgbel) UP TO 1 ROWS.
      EXIT. " Exit any loop after this.
    ENDSELECT.
    ```
## Checking Table and Structure Definitions

When working with ABAP objects, you may encounter errors related to unknown field names or incorrect table usage. Use the following tools to inspect DDIC (Data Dictionary) objects:

*   **`objectStructure`:** Retrieves the structure/metadata of an ABAP object (including DDIC tables and structures) from its object URI. Use `searchObject` first to resolve the object name to a URI.
*   **`ddicElement`:** Retrieves details of a DDIC element (e.g. a data element or domain).
*   **`ddicRepositoryAccess`:** Reads DDIC repository information for a given path.
*   **`tableContents`:** Retrieves the *contents* (rows) of a table, not its definition. Use `runQuery` for ad-hoc `SELECT`s.

````

## Troubleshooting

- **`npx` can't find the package / client won't start it:** ensure Node.js is installed and on your PATH (`node -v`, `npm -v`). On Windows try `"command": "npx.cmd"`, or use a source build with an absolute path to `node dist/index.js`.
- **SAP connection errors:** verify your credentials (`SAP_URL`, `SAP_USER`, `SAP_PASSWORD`, `SAP_CLIENT`), confirm the system is reachable, that your user has ADT authorizations, and that `/sap/bc/adt` is active in `SICF`.
- **TLS / self-signed certificate errors:** configure `NODE_EXTRA_CA_CERTS` with the absolute path to a trusted CA certificate before Node starts. Verification stays enabled.

## Contributing

Contributions are welcome! Please follow these steps to contribute:

1. **Fork the Repository**
2. **Create a New Branch**

   ```cmd
   git checkout -b feature/your-feature-name
   ```

3. **Commit Your Changes**

   ```cmd
   git commit -m "Add some feature"
   ```

4. **Push to the Branch**

   ```cmd
   git push origin feature/your-feature-name
   ```

5. **Open a Pull Request**

## License

This project is licensed under the [MIT License](LICENSE).
