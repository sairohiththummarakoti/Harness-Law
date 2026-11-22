# Harness Law implementation record

Source requirements: UI and User Experience, version 1.2, November 22, 2026. This implementation is a preparation MVP with a fictional demonstration case. It does not claim completion of the full production release described by the six-document specification set.

## Implemented foundation

- Authenticated, owner-scoped case storage and optimistic revision checks.
- Personal and professional intake, editable criterion selection, evidence associations and fact confirmation.
- Actual consent-gated private uploads into quarantine, with a separate immutable metadata registry.
- Independent criterion state and deterministic sample runs; personal manual section preparation.
- Claim-level support/review, locks, revisions, undo, and exact-version sample source references.
- Explicit composition selection, pinned result revisions, targeted dependency invalidation, and retained composition snapshots.
- Forms worksheet, final-review blockers, and clearly labeled working-draft downloads.

## Automated verification

`npm test` verifies 17 domain and input-validation scenarios, including:

- Edits reset both support and review; locked text is preserved.
- Shared-source replacement invalidates C04/C05 while C08 remains unchanged.
- Removing one association preserves the shared source and unrelated composition paragraphs.
- A proposed or unavailable source cannot enter a run; unresolved relevant facts block execution.
- Late results cannot overwrite the active run generation.
- A removed source cannot regain evidence support after a retry.
- Composition pins exact result revisions and retains earlier snapshots.
- A later review downgrade invalidates the dependent composed decision.
- Personal manual writing remains evidence-missing until support exists.
- Schema validation and streamed body limits reject malformed/oversized inputs.
- Late upload completions cannot attach evidence to another case or the sample; replacement completion uses its explicit source target.

`node scripts/check-local-api.mjs` verifies 12 checks against the loopback development server: anonymous denial, no-store responses, origin checks, malformed state, forged attorney review, advancing revisions, stale save conflicts, processing consent, actual quarantine storage, metadata tampering, foreign/unregistered object denial, and registration of an owned upload. It restores the original local case content after testing. The synthetic uploaded QA object remains in local quarantine storage; the test does not upload real user evidence.

## Independent review

The backend review identified two defects, both fixed and regression-checked:

1. Changing the review decision on a criterion result did not invalidate its composed copy. Review changes now retain the preceding result, advance its revision, and invalidate the affected composition claims.
2. The API rejected forged attorney review only in the current composition. Validation now covers current and historical result claims, composition snapshots, and nested claim histories.

A focused UI review also found upload races. Upload batches now capture their case and replacement target, prevent case switches and overlapping batches while pending, retain the target on retry, and reject completion against a different active case. Replacement pickers accept one file; drag-and-drop always creates new sources.

## Browser verification

The local application was exercised in the Codex in-app browser. Verified section selection and composition, exact sample citation passage/version/page, Escape and focus return, material claim edits resetting both statuses, undo and composition history, finalization blockers, and the downloaded draft's source references. Sign-in, successive autosaves, and reload restoration of profile values and workflow location passed. Sample exploration preserved the separate saved personal case. Mobile dashboard and profile entry were checked at a 390 px viewport with no horizontal page overflow; the closed navigation is removed from the accessibility tree.

TypeScript validation and the production Worker build passed. These checks establish the behavior exercised here; they are not a complete WCAG audit or a production security certification.

## Production integration work

The requirements depend on services and specifications not supplied in this task. Production release requires the remaining specifications plus malware scanning, extraction/OCR, approved criterion modules and rules, official form editions/mappings, actual final-packet assembly with exact-byte approval, and the separate optional attorney-engagement permissions model. These services remain visibly unavailable. Working drafts and UI completion do not establish legal eligibility or filing readiness.
