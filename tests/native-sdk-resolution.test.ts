import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { test } from "node:test";

// Actual dependency SDK/CLI resolution; no sessions, model turns or child execution.
for (const scenario of ["host", "broken-host", "override", "direct-cli", "bin-launcher"]) {
  test(`pi-subagents native SDK and CLI resolution: ${scenario}`, async () => {
    await promisify(execFile)(process.execPath, ["--import", "tsx", "tests/support/native-sdk-resolution.mjs", scenario]);
  });
}
