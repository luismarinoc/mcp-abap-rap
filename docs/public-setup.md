# Set up the public macOS launchers

Run these `.command` files deliberately from the project directory after reviewing their effects. They target Claude Desktop on macOS and are **not** safe read-only checks.

## Before you start

Install Node.js/npm (including `npx`) and Python 3, build the project, and have Claude Desktop's `~/Library/Application Support/Claude/claude_desktop_config.json` available. The launchers locate the project from their own location; keep them at the repository root. Copy `clientes.example.json` to the ignored `clientes.json` and replace its placeholders with your own values only in the local copy. Do not put credentials, `.env`, or real client configuration in version control.

## What each launcher changes

| Launcher | Effect |
| --- | --- |
| `activar.command` | If `dist/index.js` is missing, installs dependencies and builds. Backs up Claude's config, migrates existing credentials to the local `.env` and possibly `clientes.json`, writes the Claude MCP entry, and stops matching old server processes. Review config and credential migration before running. |
| `generar-mcps.command` | Reads local `clientes.json`, backs up and rewrites Claude's config with one entry per client, then stops matching server processes. Re-run when clients change. |
| `revertir.command` | Requires `npx` on `PATH`; if absent, exits without changing config. Otherwise backs up Claude's config, switches its MCP entry to the npm package, and stops matching server processes. It does not restore credentials from `.env`. |

Each successful config-changing run creates a timestamped `.bak-…` copy beside Claude's config; retain and inspect backups before removing them. The backup may contain credentials and must never be committed. Activation modifies private configuration and running processes: run it only when you intend to migrate, and restart Claude Desktop afterward. These scripts do not verify your SAP connection or guarantee a reversible credential migration.
