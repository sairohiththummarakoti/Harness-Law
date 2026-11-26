# USCIS source checks

The EB-1A Guide separates reviewed editorial guidance, USCIS publication dates, and automated source-check dates. A successful network check is not an attorney review and does not certify the guide as current law.

`GET /api/uscis-guidance` checks two fixed public USCIS pages: the EB-1 overview and Policy Manual Volume 6, Part F, Chapter 2. It sends no account identifiers, case data, or documents. URLs supplied by visitors are never fetched. Redirects must remain within that two-page allowlist.

Checks run on a guide visit, at most once per source per 24 hours. This is an on-visit check, not a scheduled background task. A D1 lease prevents simultaneous requests from duplicating a check. Failed attempts are cached for the same interval. Network time, response size, redirect count, stored history, and displayed change excerpts are bounded.

The source checker requires recognizable article content and rejects access-denied pages, unexpected content types, and incomplete responses. Navigation, footer content, scripts, and the printed review-date line are excluded from the content fingerprint. The only `sourceUpdatedAt` date is a valid, non-future Last Reviewed/Updated date printed on the source; the checker never substitutes the request date or an HTTP header. A Policy Manual “Current as of” date is exposed separately as `sourceCurrentAsOf`, and excluded from the text fingerprint. It is not a substantive policy-change date.

The first readable response establishes a baseline. Subsequent text changes store SHA-256 versions, detection time, and up to three added and three removed excerpts. These are unreviewed source differences, not summaries of legal effect. Up to five recent changes and the latest full normalized public-source text are retained per source in `uscis_source_snapshots`.

If USCIS blocks automated access or an error occurs, the API reports `unavailable` and preserves the last successful snapshot and its date. It does not claim that no updates occurred. The interface must link to the official sources and distinguish the latest documented policy alert from newer, unreviewed detected text changes.

The schema is migration-owned. Apply the appended Drizzle migration through the usual local/hosted Sites migration workflow; the request handler does not create or alter tables.

## Updating the reviewed guide

`lib/uscis-guidance.ts` records the official source dates, the editorial verification date, policy-alert summaries, a guide version, and the two normalized source hashes reviewed with that version. The interface flags a source whose observed hash differs from the reviewed hash, including when the first monitoring snapshot already differs. A later failed check does not clear that flag. Source differences never automatically rewrite criteria or a person's case.

After reviewing a change against the official source, revise any affected explanations and alert summaries, record the actual USCIS dates, bump the guide version and verification date, and update only the source hashes actually reviewed. Publish the reviewed changes through the normal code workflow. Matching hashes clear the pending-review banner while retaining the included policy history. Never update the hashes merely to suppress an alert.
