# File-assisted form filling

Applicants can choose or drop a document on every intake step, either profile tab, the preparation worksheet, a criterion's manual draft, an open paragraph editor, an open fact correction, and case-name settings. The review panel shows current and proposed answers, editable values, field selection, and source excerpts. Only valid selected fields are applied. Nonempty answers are never selected automatically.

## Supported files and limits

- Text PDFs, DOCX, TXT, Markdown (`.md` or `.markdown`), CSV, and JSON. Text formats accept UTF-8 or UTF-16 with a byte-order mark.
- Maximum input: 10 MiB. Maximum PDF length: 50 pages. Maximum expanded DOCX archive: 20 MiB. Maximum extracted text: 200,000 characters. Maximum processing time: 20 seconds.
- DOCX additionally allows up to 512 archive entries and 2 MiB combined text XML. JSON nesting is limited to 20 levels. CSV is limited to 2,000 rows and 100 columns.
- Scans, images, encrypted or malformed files, excessively expanded archives, and unsupported formats produce a recoverable error. There is no OCR. Convert a scan to a text document before importing it.
- PDF text order follows the document's text layer; complex layouts can read out of order. DOCX import reads body, header, and footer text, not document HTML. Footnotes, images, embedded objects, and formatting are not form answers.
- DOCX compatibility alternatives use one supported branch or its fallback. Directly hidden, deleted, and moved-from runs are excluded. If Word styles contain inherited hidden-text settings that this reader cannot resolve, automatic matching is disabled and the applicant must compare the document and assign visible text manually.
- One flat JSON object with single-line scalar values or simple choice arrays, and unambiguous single-record or field/value CSV, can become labeled text. Nested JSON, record arrays, multiline scalar/cell values, and ambiguous or multiple-record CSV require manual assignment. The review panel explains why automatic matching is disabled; the readable text remains available without mixing people or treating a scalar's embedded labels as separate answers.

Matching is deliberately conservative. Exact field labels, explicit visa/country/criteria answers, and ordinary resume section headings are recognized. A clear resume/CV name header and unique bare contact email or strongly formatted phone line may supply contact suggestions. Header heuristics stop before resume body sections; reference contacts are excluded unless an explicit applicant-details section resumes. Date ranges are not treated as phone numbers. Narrative colon lines remain part of their source paragraph, and Markdown label emphasis does not enter field values. Contradictory repeated answers remain for manual assignment. Achievements never establish a legal criterion or eligibility. If no reliable match exists, the applicant can select a passage in the extracted text, assign it to a current-form field, edit it, and explicitly select it.

## Privacy and saving

File bytes and unused extracted text stay in the browser. No document is transmitted to an external service, and no API key is needed. Parser code, fonts, and character maps are bundled or served from the application's own origin. Canceling, switching the form/case, locking the form for saving or conflict, or leaving the importer aborts pending work. Selecting another file discards the prior result. Files and reviews are not persisted between visits.

Applied answers follow the form's existing save behavior. Intake imports fill only the displayed step and save when the applicant continues. Profile and worksheet imports use normal case autosave. Paragraph, fact-correction, and manual-section imports fill the editor and retain its explicit Save action. The case save status remains authoritative.

An imported personal profile clears profile confirmation. Worksheet changes clear worksheet review. Existing domain actions invalidate dependent drafts and human/evidence review exactly as manual edits do. Manual sections remain unsupported and unreviewed. Fact correction preserves the original source value and association and requires the existing explicit Save correction action. Importing never creates evidence sources, citations, associations, consent, support decisions, review confirmations, or account-identity changes. The editable profile contact email is distinct from the read-only account email shown during intake.

Evidence-library uploads remain a separate private quarantine feature. Local form import does not scan, release, or attach quarantined evidence, and it does not turn applicant-entered text into verified source facts.

## Implementation

`lib/form-import.ts` contains independently testable matching, normalization, validation, and selected-patch construction. `lib/form-import-catalog.ts` defines allowed fields and limits for each surface; every catalog label also ends a text block even when that field is unavailable on the current form. Unknown narrative labels remain part of the text. `lib/form-import-fields.ts` preserves intake visa/criteria/country normalization. A failed selected value prevents the whole patch from being applied. Unknown or unavailable fields cannot enter a patch.

`components/file-form-import.tsx` owns the local file/review lifecycle and accessible review controls. Context keys scope each importer to its current form. Abort signals and request generations prevent late results from applying; an Apply-time comparison requires reselecting any proposed replacement whose current answer changed during review.

The extraction entry point owns its workers and terminates them on completion, cancellation, or timeout. PDF.js 6.5.438 extracts text through a dedicated worker; fflate 0.8.3 expands the bounded DOCX text parts in the raw-text worker, which also handles plain structured/text formats. All displayed extracted content is React text or textarea content, never parsed document HTML. Parser integrations follow the [PDF.js API](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib.html) and [fflate streaming Unzip API](https://github.com/101arrowz/fflate/blob/master/docs/classes/Unzip.md).

`scripts/run-framework.mjs` runs `prepare-form-import-assets.mjs` before development and production builds. It copies the pinned raw PDF worker, CMaps, and fonts into the ignored generated `public/form-import-pdf/<version>` directory. The raw worker avoids Vinext/Vite rewriting or injecting browser-only development code into PDF.js. The text/DOCX worker uses a lazy Vite worker wrapper. Use the normal npm build/Sites helper so production includes those same-origin assets.

## Verification

Run `npm run typecheck` and `npm test`. The `form-import` tests cover matching, ambiguous/no-match input, choice validation, country/stateless conflicts, field limits, current-step scoping, selected-only atomic patches, and domain invalidation/source preservation. Extraction tests use real synthetic file content and cover supported formats plus cancellation, malformed/empty documents, and resource limits.

Browser QA should verify file selection/drop, editable review, manual assignment, Apply versus Save behavior, cancellation/retry, changing forms/cases, saving/conflict locks, PDF worker loading, and keyboard/mobile use at 390px. The release owner runs the Sites production build and publication checks. No production schema or Site configuration change is required.
