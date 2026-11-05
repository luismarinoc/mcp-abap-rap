# RAP write and activation results

Use `createAndActivate` for create, optional source write, and activation in one call. A successful activation keeps the existing `status: "success"`, `activated: true`, `steps`, and `messages` payload. An ADT activation result with `success: false` returns MCP `isError: true`, `status: "failure"`, `activated: false`, `steps` ending in `"ACTIVATION FAILED"`, and the activation messages. It does not repeat creation or source writes.

`setSourceByName` writes once while holding the ADT lock and always attempts to unlock. If unlocking fails after a successful write, the call fails rather than claiming success: **the write may have completed**, so inspect the object and lock before trying again. If both write and unlock fail, the result names the write failure first and also reports the unlock failure. The combined error omits raw ADT exception text to avoid exposing connection details. Neither command retries a mutation automatically.

These results do not repair objects, release a failed lock automatically, or change other ADT tool behavior. `checkObjectRegistered` remains available for checking package registration separately.
