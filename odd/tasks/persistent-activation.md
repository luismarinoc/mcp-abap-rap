# Persistent shared MCP activation
Objective: activate the shared local executable, preserve credentials and existing edits. Branch: feat/connection-robustness.
Runner: staged tsc, Jest offline public MCP checks. No push, config migration, process kill, or live SAP mutation.

## Specs
S1. «Lo puedes activar y que quede permanente, así apague la máquina. No sé si me entiendes.»
S2. «Ya, esto lo estoy utilizando tanto en Claude como en OpenAI, en Grok, en varios. ¿Este cambio queda para todos o tengo que meterme en cada uno?»
S3. «Sí, yo busqué, ocupé el mismo archivo.»
S4. «Ok, actívalo por favor. Y dime cómo validar si lo cambias también.»

## Tasks
T1 | S1-S4 | inline preparation | done | Job1 exit0 staged build, physical dependencies and 38-file verified backup; installed hashes unchanged | commit: n/a local artifacts
T2 | S4 | independent check | done | Independent offline PASS: 97/97, tsc, compiled MCP probe, candidate/source/backup hashes valid; parent staged 97/97 exit0 | commit: n/a evidence
T3 | S1-S4 | inline maintenance | done | Parent replaced dist after independent PASS, all44 installed hashes match; node --check exit0; validation doc provided | commit: local artifacts + closing docs commit

## Log
L1. «Ok, actívalo por favor. Y dime cómo validar si lo cambias también.»
L2. User confirmed all clients launch same local dist/index.js. Authorized exact external Claude config read confirmed five enabled local launches. No external config writes authorized or necessary.
L3. Source latest five features verified 97/97 offline, typecheck exit0; dist still older. Prior auth isolated review failed preparation before any tests due copy/symlink conflict; do not retry automatically or treat history as native authority.
L4. Parent observed missing .local-builds/isolated-review-script-20261106T022651Z/node_modules. Disk free39GiB, node_modules95MiB, dist428KiB, src440KiB; sufficient for bounded physical staging. No top-level dependency symlinks. scripts/prepare-review.cjs unimplemented and must not run.
L5. Risk: item 5 (replace installed executable used by multiple clients). Backup/artifact validation/recovery required. Source auth changes also retain their existing missing independent proof; no waiver or substitute inferred from activation request.
L6. Job1 exit0 (4s): stage .local-builds/persistent-activation-20261106T035209Z has full physical dependencies (no symlinks), src/config snapshot and compiled candidate. Backup .local-backups/pre-persistent-activation-20261106T035209Z/dist.tar and manifest verified per-file (38 files) and archive SHA256. Candidate markers present, installed dist and source hashes unchanged. Preparation repaired; prior failed review attempt preserved. No active/uncertain children (subagent_list_tasks all completed).
L7. User selected «Sí, verificar y activar si pasa»: one new bounded gentle-ai-verify attempt covering offline auth/session/MCP/new tools, no SAP; one correction batch and blocker-only recheck for genuine findings, no automatic setup retry. If passed, activate shared executable. Previous failed attempt is not erased; previously unavailable real-ADT stalled-login proof remains unverified and is not retried.
L8. Independent verifier mw4fwjdu-8-jqb2 completed PASS: isolated 97/97, 8 suites, tsc exit0; compiled public MCP probe exit0 with138tools and all feature schemas/dispatch. Initial probe assertion omitted standard MCP error prefix, corrected assertion passed (no product finding). Candidate44/source44 hashes unchanged; installed38 unchanged, backup SHA+38members valid. Parent staged Jest97/97 exit0. No live SAP tests or prior unavailable proof retry. Verifier suggested an extra test duplicating existing coverage; advisory only, no new code defect or code changes required. All children completed.
L9. Parent installed validated candidate: original dist renamed to verified backup/previous-dist, fresh44-file candidate renamed into dist; per-file hashes matched exact verified candidate. Source matched prepared manifest; private config and existing human edits unchanged by hash. Activation state installedNewVersion true; entry SHA256 8ee0c7a5e643e9a7fec05cbc94dfb2dc7ea581e5dffc18b509b3dcf0ef014da8. Postinstall node --check and shasum/diffcheck exit0. No processes killed or configuration changes.
L10. docs/permanent-activation.md provides reconnect instructions, public tools/list markers, read-only optional objectTypes filter, exact local SHA and backup locator. Permanence established by persistent local executable and previously confirmed shared client paths; individual running clients have not yet reconnected and must do so themselves. No reboot performed, no new live SAP proof claimed. Older activation-blocked notes are historical, superseded for this installed candidate by L7-L9, not erased.
L11. Outcome: T1-T3 complete. Risk: item 5, independently verified offline plus guarded backup/installation hashes. Old setup failure preserved, verifier probe assertion failure corrected, final checks pass; prior unavailable real-ADT stalled-login/stdio proof remains unverified. No source behavior changes/extra auth verification retries, publishing, or dependency changes.
