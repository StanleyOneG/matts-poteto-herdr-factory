# Bundled Herdr skill verification

This follow-up checks the uncommitted static resource change on `feat/bundle-herdr-skill`, based on `15e3c7ef720f66175dc0c39dcf15a95b650e990d`. It does not replace the historical T01 acceptance or its implementation manifest. Fresh independent review returned OK with notes and found no blocking issues.

The package supplies the unmodified official Herdr skill from v0.9.3. [The attribution](../../skills/herdr/ATTRIBUTION.md) records its tagged source, resolved commit, and SHA-256. Both the skill and accompanying Apache-2.0 license match the explicit upstream tag blobs byte for byte.

## Checks

| Command | Result |
| --- | --- |
| `npm run verify:pi` before adding the resource | Failed as expected at `Published package includes skills/herdr/SKILL.md`. |
| `npm test` | All 48 tests passed with no skips. |
| `npm run typecheck` | Passed. |
| `npm run build` | Passed. |
| `node --check scripts/verify-pi.mjs` | Passed. |
| `node --check scripts/verify-provider.mjs` | Passed. No paid provider trial ran. |
| `npm run verify:pi` after adding the resource | Passed twice. The final run passed 20 RPC/TUI groups with 45 controlled-provider requests. |

The runtime script performs `npm pack`, installs the resulting tarball with npm in a test-owned directory, and runs real `pi install` against that installed package. It checks that the tarball contains the skill, license, and attribution. It verifies the installed license hash and the loaded skill hash. Pi reports `skill:herdr` with `source: skill`, package origin, and the installed package directory. There is no user Herdr skill fixture. Test-owned package configuration disables the bundled skill for the missing-skill diagnostic, then restores it for positive behavior checks. The runtime suite also asserts that host settings and final fixture settings remain unchanged.

The final environment is Pi 1.0.4, Node 22.23.1, and local Herdr 0.9.1 with protocol 22. Final temporary evidence is `/tmp/legion-pi-787wSE/result.json`, `rpc.json`, and `tui.txt`. Command output is in `/tmp/herdr-simple-tests.txt`, `/tmp/herdr-simple-typecheck.txt`, `/tmp/herdr-simple-build.txt`, `/tmp/herdr-simple-runtime.txt`, and `/tmp/herdr-simple-red.txt`. These temporary paths can expire. The script reruns the package and discovery checks.

## Independent review and parent verification

The independent reviewer compared the upstream tag blobs and reran all 48 tests, typecheck, build, script syntax checks, and 20 isolated runtime groups. Its report is `/tmp/herdr-skill-simple-review.md`, with runtime evidence in `/tmp/legion-pi-ayHipu/`.

The parent inspected the diff, confirmed exact upstream skill and license bytes, and reran all 48 tests, typecheck, build, and 20 runtime groups with 45 controlled-provider requests. Parent runtime evidence is `/tmp/legion-pi-XjbCR8/result.json`, `rpc.json`, and `tui.txt`. Command logs are `/tmp/herdr-parent-tests.txt`, `/tmp/herdr-parent-typecheck.txt`, `/tmp/herdr-parent-build.txt`, and `/tmp/herdr-parent-runtime.txt`. Pi discovered the skill from the installed package with the expected hash. Only these review notes changed after the parent runtime run.

## Limits

The bundled skill removes the earlier need for a user-supplied Herdr fixture. It does not guarantee readiness of other prerequisites or override user skill collisions and package filters. The v0.9.3 skill does not change Legion's verified Herdr runtime target. Maintainers update the bundled files manually. No upstream checks, lifecycle scripts, update state, or runtime API changes were added. Verification reads Herdr server status without pane control or server restart. The selected-provider script now checks package-native skill provenance, but its paid trial was not rerun for this static resource change.
