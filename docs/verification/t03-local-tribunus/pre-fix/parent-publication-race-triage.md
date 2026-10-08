# Parent review test failure

Parent typecheck and build passed. Full npm test on T03 source 863f49e036a0104bdf58b30638e053e1c726ad4181994bee0c4e3ac8b01ac53e failed 98/99. tests/workspace-git.test.ts:471 received uncertain SyntaxError: Unexpected end of JSON input instead of the allowed diagnostic regex. Exact output tests.txt in this directory. Real lost-receipt evidence verification passed independently in runtime.txt.

This differs from the earlier zero-owner SQLite-busy failure and was not waived by name alone.

## Baseline comparison

Twenty focused runs on the base-source disposable copy reproduced two original zero-owner failures but did not reproduce this JSON shape. Outputs base-contention-1.txt through base-contention-20.txt.

To test the pending-publication hypothesis, the parent inserted only a 100ms scheduling delay after exclusive open of assignments.pending and before its write in the disposable base src/assignments.ts. The base test already had one diagnostic printing completed contender results and public observations. No T03 code is in that disposable copy and the real repository was not edited.

The focused test then reproduced the exact JSON error and regex assertion failure. One contender owns a ready reservation and the other retains its pending request and observes the same foreign owner. See base-controlled-publication.txt.

Mechanism: exclusive open publishes an empty assignments.pending pathname before writeFileSync populates it. A second contender can see the pathname and JSON.parse its empty contents in AssignmentLedger.identity. The writer's open/write ordering, pending-file reader, and failure-message wrapping are inherited unchanged from f24bc6e72e0d4d916b02de7244987cbfeb4c86ef. The scheduling probe demonstrates a reachable baseline interleaving, not a naturally reproduced pristine-base JSON failure.

## Disposition

Classify this exact observed failure as an inherited pending-identity publication race, distinct from the earlier SQLite-busy outcome. No T03 retry, reset, or test weakening is approved. Keep the parent full-suite result 98/99 explicit even though the writer previously saw 99/99. Any different new failure still requires triage. Record this inherited race as follow-up evidence rather than claim #24 or T03 fixed it. T03 unknown/unavailable-claim no-launch safeguards remain required.
