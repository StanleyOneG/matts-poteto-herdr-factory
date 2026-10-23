# Disposable controlled delivery platform (operator/test only)

`controlled-delivery-provider.ts` is a **network-free fake/test platform**, separate from the receipt-only `delivery-provider.mjs`. It is outside the shipped `src`/`skills`/README package files. Keep this candidate checkout and its existing Node/tsx/zod dependencies available: it is not an installed production service or a GitHub/GitLab adapter. Do not install dependencies for this fixture.

It creates a unique `fixture-<UUID>` project with open issues A/B/C and no reviews. Accepted adapter submissions close only their named issue. A draft stores one stable `test-fixture:…/reviews/<UUID>` identity, project, specification, exact task revisions/owning workspace and tip/tree. Ready requires the confirmed original draft operation/reference and identical scope; it updates **that object**, records the ready operation and final tip/tree. The original draft receipt remains unchanged.

The native adapter/state owner still controls acceptance, independent review, permission and effect authority. This fixture parses the actual `DeliveryProviderRequest` schema; it does not independently attest models, reviews or implementation, create actors/results/native receipts, push, contact a tracker, or publish remotely. Its focused tests use existing synthetic accepted-result helpers **only as deterministic contract inputs**, not installed-journey evidence. No overall #41 or general hosted-platform acceptance follows.

## Initialize owned disk storage

These are future operator commands, not authority to run a native journey. Obtain independent review first. Use a new root; never reset/adopt existing state. Check the mount/capacity before writing:

```bash
set -euo pipefail
CANDIDATE=/workspaces/astraprojects/matts-poteto-herdr-factory
BASE=/workspaces/astraprojects/.tmp
findmnt -T "$BASE"
df -hT / /tmp "$BASE"
OWNER=$(mktemp -d "$BASE/cpf-op-XXXX")
mkdir "$OWNER/tmp" "$OWNER/xdg" "$OWNER/npm" "$OWNER/npm2"
export TMPDIR="$OWNER/tmp" TMP="$OWNER/tmp" TEMP="$OWNER/tmp"
export XDG_CACHE_HOME="$OWNER/xdg" npm_config_cache="$OWNER/npm" NPM_CONFIG_CACHE="$OWNER/npm2"
NODE=$(readlink -f "$(command -v node)")
LOADER="$CANDIDATE/node_modules/tsx/dist/loader.mjs"
FIXTURE="$CANDIDATE/tests/support/controlled-delivery-provider.ts"
ROOT="$OWNER/platform"                  # must NOT exist
"$NODE" --version                     # use the supported installed Node
"$NODE" --import "$LOADER" "$FIXTURE" init "$ROOT" > "$OWNER/initial.json"
"$NODE" --import "$LOADER" "$FIXTURE" inspect "$ROOT"
```

Record OWNER, ROOT, project, code hashes and the operator custodian. All controlled logs/caches/state stay on the workspace disk. Export routing in the eventual native owning session too; changing this shell does not migrate an already-running Pi's managed temporary/runtime files. Retain those existing files in place.

## Checkout-local routing (later, explicitly authorized operator setup)

Do not select this provider globally or blindly overwrite an old selector/configuration. Preserve pinned old configurations for old-operation reconciliation. For a linked worktree, `.git` is a file: use real operator-ignored checkout-local files instead. Set `OWNING` to the **actual authorized owning checkout**, not automatically the candidate checkout.

### Fresh setup only

This absent-only path is **not** the retained-checkout transition. Use it only when both files are absent and the operator has already explicitly ignored the new filename (for example `/controlled-delivery.json` in the checkout's `.legion/.gitignore`, preserving its existing entries) and the selector. Otherwise stop and use the separately authorized transition below; do not delete the existing selector or disable noclobber. Verify both paths are ignored before creation:

```bash
OWNING=/absolute/authorized/owning-checkout
for file in .legion/controlled-delivery.json .pi/legion-delivery.json; do
  git -C "$OWNING" check-ignore -q "$file"
  test ! -e "$OWNING/$file"
done
mkdir -p "$OWNING/.legion" "$OWNING/.pi"
# noclobber deliberately refuses existing configuration.
set -C
"$NODE" --input-type=module - "$ROOT" "$NODE" "$LOADER" "$FIXTURE" \
  > "$OWNING/.legion/controlled-delivery.json" <<'JS'
import fs from 'node:fs';
const [root, executable, loader, fixture] = process.argv.slice(2);
const { provider, project } = JSON.parse(fs.readFileSync(`${root}/state.json`, 'utf8'));
const command = { executable, args: ['--import', loader, fixture, 'provider', root] };
console.log(JSON.stringify({ version: 1, revision: 'controlled-fixture-v1',
  identity: { provider, project },
  tracker: { provider, project, closeTask: command, observe: { ...command, readOnly: true } },
  review: { provider, project, draft: command, ready: command, observe: { ...command, readOnly: true } }
}, null, 2));
JS
printf '%s\n' '{"configurationFile":".legion/controlled-delivery.json"}' \
  > "$OWNING/.pi/legion-delivery.json"
set +C
```

### Existing retained selector: separately authorized transition and restoration

The retained owning checkout already has `.pi/legion-delivery.json` selecting `.legion/delivery.json` (the pinned old local-report configuration). Its `.legion/.gitignore` does not cover the new filename. Initialization alone does not change that routing. The following is an **operator-only, separately authorized configuration transition**, not a native delivery command or permission to start a journey.

Before **prepare**, and again immediately before **switch** or **restore**, the operator must establish and save native evidence/operation IDs in OWNER: all prior relevant operations/effects settled, no pending/prepared/dispatched/unknown effect binding to the current configuration, and no in-flight execution or configuration writer. Reconcile old operations under the old selection first; retain exact original configuration/revision. Missing evidence or uncertainty means stop. Status/prose or this script cannot attest settlement. Pause dispatch and keep configuration writes exclusive throughout each command; the byte checks are not a cross-process compare-and-swap lock. Restoration needs the same explicit authority and fixture-operation settlement, not an automatic teardown.

Set canonical `OWNING` to that authorized checkout, retain the earlier OWNER/ROOT/NODE/LOADER/FIXTURE values, and create this small guard script **exclusively in owned evidence**, not in the checkout. It supports only the existing `.legion/delivery.json` selector shape. It preserves exact selector/configuration/ignore bytes plus raw-byte SHA256 and old identity/revision before creating anything in the checkout. Preparation appends an explicit checkout-local ignore rule without dropping existing entries, creates the new configuration exclusively, and leaves the selector unchanged.

```bash
TRANSITION="$OWNER/selector-transition"   # must not exist
TRANSITION_SCRIPT="$OWNER/selector-transition.mjs"
(set -C; cat > "$TRANSITION_SCRIPT" <<'JS'
// BEGIN documented selector transition
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const [action, owning, evidence, root, executable, loader, fixture] = process.argv.slice(2);
assert(['prepare', 'switch', 'restore'].includes(action));
assert(path.isAbsolute(owning) && fs.realpathSync(owning) === owning);
assert(path.isAbsolute(evidence) && path.join(fs.realpathSync(path.dirname(evidence)), path.basename(evidence)) === evidence);
const selector = path.join(owning, '.pi/legion-delivery.json');
const oldFile = path.join(owning, '.legion/delivery.json');
const newFile = path.join(owning, '.legion/controlled-delivery.json');
const ignore = path.join(owning, '.legion/.gitignore');
const read = file => {
  assert(fs.lstatSync(file).isFile() && fs.realpathSync(file) === file, `Not a canonical regular file: ${file}`);
  return fs.readFileSync(file);
};
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const syncDir = directory => {
  const fd = fs.openSync(directory, 'r');
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
};
const exclusive = (file, bytes) => {
  const fd = fs.openSync(file, 'wx', 0o600);
  try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
};
const ignored = relative => execFileSync('git', ['-C', owning, 'check-ignore', '-q', relative]);
if (action === 'prepare') {
  const original = read(selector), configuration = read(oldFile), originalIgnore = read(ignore);
  assert.deepEqual(JSON.parse(original), { configurationFile: '.legion/delivery.json' });
  const old = JSON.parse(configuration);
  assert(old.version === 1 && typeof old.revision === 'string' && old.identity && old.localReport);
  const platform = JSON.parse(read(path.join(root, 'state.json')));
  assert(platform.provider === 'controlled-fixture' && platform.project.startsWith('fixture-'));
  const command = { executable, args: ['--import', loader, fixture, 'provider', root] };
  const configured = Buffer.from(JSON.stringify({ version: 1, revision: 'controlled-fixture-v1',
    identity: { provider: platform.provider, project: platform.project },
    tracker: { provider: platform.provider, project: platform.project, closeTask: command, observe: { ...command, readOnly: true } },
    review: { provider: platform.provider, project: platform.project, draft: command, ready: command, observe: { ...command, readOnly: true } }
  }, null, 2) + '\n');
  const selected = Buffer.from('{"configurationFile":".legion/controlled-delivery.json"}\n');
  fs.mkdirSync(evidence, { mode: 0o700 }); // Never reset/adopt an existing evidence directory.
  const snapshots = { 'selector.original': original, 'configuration.original': configuration,
    'ignore.original': originalIgnore, 'configuration.fixture': configured, 'selector.fixture': selected };
  for (const [name, bytes] of Object.entries(snapshots)) exclusive(path.join(evidence, name), bytes);
  exclusive(path.join(evidence, 'manifest.json'), JSON.stringify({ owning,
    oldIdentity: old.identity, oldRevision: old.revision,
    sha256: Object.fromEntries(Object.entries(snapshots).map(([name, bytes]) => [name, hash(bytes)])) }, null, 2) + '\n');
  syncDir(evidence); syncDir(path.dirname(evidence));
  assert(read(selector).equals(original) && read(oldFile).equals(configuration) && read(ignore).equals(originalIgnore), 'Preparation drift');
  exclusive(newFile, configured);
  // Append only: preserve every prior entry, including any needed final newline.
  fs.appendFileSync(ignore, (originalIgnore.length && originalIgnore.at(-1) !== 10 ? '\n' : '') + '/controlled-delivery.json\n');
  const fd = fs.openSync(ignore, 'r');
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  syncDir(path.dirname(newFile));
  ignored('.legion/controlled-delivery.json'); ignored('.pi/legion-delivery.json');
} else {
  const manifest = JSON.parse(read(path.join(evidence, 'manifest.json')));
  assert.equal(manifest.owning, owning);
  const snapshot = name => {
    const bytes = read(path.join(evidence, name));
    assert.equal(hash(bytes), manifest.sha256[name], `Evidence drift: ${name}`);
    return bytes;
  };
  const original = snapshot('selector.original'), selected = snapshot('selector.fixture');
  const configuration = snapshot('configuration.original'), configured = snapshot('configuration.fixture');
  const expected = action === 'switch' ? original : selected;
  const replacement = action === 'switch' ? selected : original;
  const guard = () => {
    assert(read(selector).equals(expected), 'Selector drift: do not overwrite');
    assert(read(oldFile).equals(configuration), 'Old configuration drift: do not overwrite');
    assert(read(newFile).equals(configured), 'Fixture configuration drift: do not overwrite');
    ignored('.legion/controlled-delivery.json'); ignored('.pi/legion-delivery.json');
  };
  guard();
  const pending = selector + '.controlled-transition.pending';
  exclusive(pending, replacement);
  guard(); // Recompare exact selector and both configuration identities immediately before rename.
  fs.renameSync(pending, selector);
  syncDir(path.dirname(selector));
  assert(read(selector).equals(replacement));
}
console.log(JSON.stringify({ action, selectorSha256: hash(read(selector)), oldConfigurationSha256: hash(read(oldFile)) }));
// END documented selector transition
JS
)
"$NODE" "$TRANSITION_SCRIPT" prepare "$OWNING" "$TRANSITION" "$ROOT" "$NODE" "$LOADER" "$FIXTURE"
```

Inspect `TRANSITION/manifest.json` and preserved files against the recorded original selector/configuration hashes and identity/revision. Preparation does **not** establish authority or settle operations. After the operator rechecks the prerequisites above, switch atomically with exact current-byte guards:

```bash
"$NODE" "$TRANSITION_SCRIPT" switch "$OWNING" "$TRANSITION"
```

For old-operation read-only reconciliation or an explicitly authorized return to old routing, first settle all fixture-bound operations and ensure no pending effect binding remains. Then restore **only the exact saved selector**; the pinned old configuration is never overwritten, copied back over drift, or re-created:

```bash
"$NODE" "$TRANSITION_SCRIPT" restore "$OWNING" "$TRANSITION"
```

A different selector, changed old/new configuration, changed evidence snapshot, missing ignore, or existing destination/pending file refuses nonzero. Do not delete the selector, disable noclobber, overwrite drift, replay with a different evidence directory, or steal a pending file. Preserve all artifacts and expose a decision. I/O/crash after rename may leave selection changed without acknowledgment: inspect exact bytes/hashes before any further action. The new configuration, added ignore rule and all evidence remain retained on restoration; restoration never removes receipts or grants native execution authority. Keep old configuration bytes **at their original path and revision** for old-operation reconciliation, and keep fixture configuration/evidence for fixture-operation reconciliation. This procedure is intentionally not a general migration/recovery service.

Both capabilities deliberately use provider `controlled-fixture` and the exact generated project. Bind actual native tasks to tracker IDs A/B/C with that identity. The final specification name may differ from the generated project, but must stay identical between draft and ready, as must task membership/revisions and workspace. Tip/tree and accepted proof set may advance. Executable/loader/fixture/root are fixed configuration arguments, **never tool-selected commands**. Pin their reviewed contents and change the operator revision if behavior changes. No configuration is installed by fixture initialization or tests.

## Actual executable protocol and independent observation

The configured command is the resolved absolute Node executable, with arguments `['--import', ABSOLUTE_TSX_LOADER, ABSOLUTE_FIXTURE, 'provider', ABSOLUTE_ROOT]`. Stdin/stdout are exactly the existing `legion-delivery/v1` request/result protocol documented in `docs/delivery.md`: the native adapter renders the complete intent/report, and stdout is only `{protocol,outcome}` JSON. Do not manually fabricate native requests or receipts for acceptance. `mode: "reconcile"` reads the exact operation receipt; it performs no effect or storage write.

For independent driver inspection, outside native effect execution:

```bash
"$NODE" --import "$LOADER" "$FIXTURE" inspect "$ROOT" > "$OWNER/observed.json"
"$NODE" --input-type=module - "$OWNER/observed.json" <<'JS'
import fs from 'node:fs';
const s = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
console.log(JSON.stringify({ project: s.project, issues: s.issues, reviews: s.reviews,
  operations: s.operations.map(({operation,digest,requestHash,linkage,outcome}) =>
    ({operation,digest,requestHash,linkage,outcome})) }, null, 2));
JS
```

Join issue `closure`, review `draft`/`ready`, and `operations[].operation` to actual native operation IDs/outcomes. `linkage` retains supplied result/digest, verification digests, review IDs/references and integration operation IDs; publication entries retain final scope/tip/tree and corresponding result/final links. `requestHash` is SHA256 of JSON of the **schema-parsed request excluding mode** (includes the report); it is not a raw stdin/file checksum. No credentials, issue bodies, review bodies or full rendered reports are stored. Do not supply secrets in reference fields.

## Refusal and storage limits

- `init` exclusively creates ROOT. Reinitialization, noncanonical/symlink roots, malformed state/request, mismatched operation/digest, changed same-ID content, or repeated execute exits nonzero (normally 2), with generic stderr and no success response. No automatic retry/reset exists.
- A valid fresh request for a foreign project, missing/non-open issue, or incorrect original draft/reference/scope records an immutable `failed/noEffect:true` receipt and exits 0. Only issue/review **objects** are unchanged; the refusal receipt is retained. The adapter—not exit zero alone—interprets the response.
- Same-ID execute never repeats, even after confirmation/failure. Exact reconciliation returns the retained success/failure; a missing receipt returns `unknown`, never invented no-effect proof. Different content under that ID is refused, including during reconciliation. New attempts remain subject to native explicit predecessor/authority guards.
- One private `state.json` atomically contains all object transitions and immutable receipt entries. Writes use exclusive pending file, file fsync, rename and directory fsync on the checked disk filesystem; writers serialize with an exclusive lock. Observation writes nothing. This is trusted operator storage, not tamper-proof/sandboxed storage or a concurrent platform service.
- Crashes/I/O errors/unsupported filesystem behavior may leave pending files/locks or an applied but unacknowledged effect. Preserve ROOT and reconcile read-only; nonzero/malformed output is unknown to the adapter. No crash-recovery daemon, lock stealing, destructive repair or permissive replay is promised. Unknown outcomes remain held for operator disposition.

Retain owned roots/logs for review/continuation; only their recorded custodian may clean disposable data after all consumers settle and evidence is saved. Never delete worktrees, branches or existing runtime journals as fixture cleanup.
