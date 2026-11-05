# Keep the working version recoverable

The pre-change backup preserves the working source, uncommitted changes, compiled `dist/`, Git metadata and existing private configuration. Development of connection robustness must not overwrite the installed `dist/` automatically.

## Backup location

From the project root:

- Archive: `.local-backups/pre-robustness-20261105T214937Z.tar`
- Verification manifest: `.local-backups/pre-robustness-20261105T214937Z.manifest.json`
- Original branch: `gpartner-rap`
- Development branch: `feat/connection-robustness`

The archive contains private configuration. Keep it local; do not attach it to issues, upload it, or commit it. The directory is private (0700), and the archive and manifest are private (0600). A local Git exclusion keeps the backup out of normal staging.

## Verify without restoring

Run this from the project root. It reads the archive and its manifest without displaying file contents or contacting SAP:

```sh
python3 - <<'PY'
from pathlib import Path
import hashlib
import json
import tarfile

folder = Path('.local-backups')
manifest = json.loads((folder / 'pre-robustness-20261105T214937Z.manifest.json').read_text())
archive = folder / manifest['archive']
assert hashlib.sha256(archive.read_bytes()).hexdigest() == manifest['sha256']
with tarfile.open(archive, 'r') as backup:
    for name, expected in manifest['files'].items():
        with backup.extractfile(name) as source:
            assert hashlib.sha256(source.read()).hexdigest() == expected
print('Backup verified; nothing restored.')
PY
```

The manifest records the backup-time contents, not the expected contents of the evolving working tree.

## Recovery is selective, not a blanket reset

1. Stop and identify which source or compiled files need recovery. Compare with the backed-up version before overwriting anything.
2. Preserve any work created after this backup separately.
3. Restore only the confirmed files, with explicit approval. Do not extract the whole archive over the repository: it also contains historical `.git` state and private configuration.
4. If reverting the executable is necessary, recover the compiled files as a coherent set and restart the MCP client deliberately. Restoring code does not undo objects or source already changed in SAP.

`node_modules`, `.codegraph` and `.atl` caches are not included. Dependencies can be reconstructed from the backed-up lockfile if needed; doing so is a separate maintenance operation, not part of verification.

## Validate changes without replacing the current executable

Use `./node_modules/.bin/tsc -p tsconfig.json --noEmit` for type checks. An ordinary `npm run build` writes into `dist/`; do not run it in this working installation until intentionally adopting the new version. Perform a full emitted build in an isolated copy instead.

The backup is verified locally, but it is on the same disk as the project. It is not an off-device disaster-recovery copy.
