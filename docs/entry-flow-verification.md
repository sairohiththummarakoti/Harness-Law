# Talent visa entry flow verification

Verified on November 22, 2026. This change adds the public landing and account-entry/setup journey to the existing EB-1A preparation workspace.

## Reference inspection

Inspected Tsenta's live homepage, product preview, and four-stage walkthrough. Inspected Grammarly's public signup structure and the signed-in document workspace. The browser's existing Grammarly account redirected to its workspace; a brand-new account's full post-registration questionnaire was not observed. The Harness Law flow adapts the focused-entry and progressive-setup patterns using its existing ChatGPT authentication.

## Browser checks performed

- Signup's real provider link returned to `/onboarding` using the local development sign-in flow.
- Required empty fields prevented continuation.
- Saving professional details advanced to the goal step; refreshing resumed that saved step. Back restored field and role.
- A competing API save advanced the case revision while the setup form remained open. Saving an edited role displayed the conflict comparison without losing the local edit. Choosing **Keep my answers and retry** saved against the latest revision and advanced to the next step.
- A final-step competing save changed the role and preparation goal. The conflict comparison displayed both changes, kept the entered names, and retry completed with the latest role/goal and the preserved names. The success screen linked to final review as expected.
- Selecting the narrative goal, reviewing names, and completing setup displayed a personalized success screen and opened criteria selection in the workspace. The saved record retained the entered profile and professional details, recorded the goal, and kept `profile.confirmed` false.
- Revisiting `/onboarding` after completion returned to the saved workspace.
- A signed-in visit to `/workspace?sample=1` displayed the fictional Maya Chen case and six fictional documents. Editing the sample preferred name left the complete saved personal case and its revision byte-for-byte equivalent as parsed JSON. Returning to the personal case restored the narrative focus and criteria destination.
- Desktop landing composition and keyboard walkthrough navigation were checked. ArrowRight changed the selected tab and matching panel.
- The mobile navigation expanded, its FAQ link closed the menu and navigated to the section, and the FAQ answer expanded.
- Signup and setup were checked at 390 px; landing and sample workspace were checked at 360 px. These views had no horizontal document overflow.

These are executed manual browser checks, not a persistent automated browser suite. Pure transition and validation regressions run in `npm test`; they do not substitute for the browser checks above. Hosted identity itself was already integrated and was not replaced or independently re-certified by this change.

Final isolated release checks: `npm run typecheck`, all 37 tests in `npm test`, and the Sites production build completed successfully. Focused tests cover current-step draft merging, completion conflict rows, dirty-state tracking, safe HTTP response parsing, timeout recovery, and cancellation. Local fictional QA changes were restored to the original case content after testing.

## Release isolation

Concurrent changes to database/integration files were present in the shared development checkout. This release was assembled from the prior Site source plus only the entry-flow files, with a separate typecheck, test run, and production build. It contains no database migration or change to Site identity, audience, or service integrations.

The existing boundaries remain: personal document extraction, production AI processing, attorney engagement, official-form validation, and government filing are not added by this screen update.
