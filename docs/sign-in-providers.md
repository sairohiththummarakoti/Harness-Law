# Sign-in providers

The sign-in and sign-up pages offer Google, Apple, Microsoft, and ChatGPT. Email and password remain available separately.

- Google retains the existing Google Identity Services flow. Its Firebase OAuth route remains a fallback.
- ChatGPT retains the hosted Sites sign-in flow.
- Apple and Microsoft use Firebase Authentication's `createAuthUri` / `signInWithIdp` flow. Provider credentials belong in the Firebase provider configuration, not in client code or the repository.

## Activation required for Apple and Microsoft

As of November 26, 2026, read-only authorization URL checks returned `OPERATION_NOT_ALLOWED` for both Apple and Microsoft. Their buttons and integration are prepared, but these providers must be enabled before they can sign users in. Until then, selecting either returns to sign-in with a provider-specific message and the other sign-in choices.

1. In Firebase Authentication, enable the relevant provider under **Sign-in method**.
2. For Apple, configure the web Services ID, Apple Team ID, key ID, and private key. Configure the website domain and return URL in the Apple Developer account. If using Apple private relay addresses, configure the authorized email sender as described in Firebase's Apple setup guide.
3. For Microsoft, register an application supporting the intended work/school and personal account audience, then supply its client ID and client secret to Firebase.
4. Add the production site domains to Firebase's authorized domains. This application uses a direct REST callback at `https://harnesslaw.ai/api/auth/oauth/callback`; register that exact return URL with the provider. If users also authenticate on the native Sites domain, register `https://harness-law-workspace.sairohith-thummarako.chatgpt.site/api/auth/oauth/callback` as well. The `redirect_uri` returned by Firebase must match a registered URL.
5. After enabling each provider, verify a complete sign-in and sign-out with a test account, including cancellation and returning to a saved workspace. Do not run the repository's live Firebase E2E test as an ordinary unit test; it creates real accounts.

## Callback behavior

Each OAuth start binds Firebase's authorization `state` and `sessionId` to short-lived, HttpOnly transaction cookies. The callback validates both before exchanging credentials. Accounts must have a verified email and the same immutable Firebase identity; matching an email never silently links unrelated accounts.

Apple requires a cross-site `form_post` response when requesting email/name. The callback accepts a bounded form body only from `https://appleid.apple.com`, then returns a CSP-protected bridge page. That page submits the payload to the same-origin JSON callback, where the existing `SameSite=Lax` cookies are available and the state/session checks run. The bridge itself creates no session. Google and Microsoft continue using query or fragment callbacks.

References: [Firebase Apple setup](https://firebase.google.com/docs/auth/web/apple), [Firebase Microsoft setup](https://firebase.google.com/docs/auth/web/microsoft-oauth), [createAuthUri](https://docs.cloud.google.com/identity-platform/docs/reference/rest/v1/accounts/createAuthUri), [signInWithIdp](https://docs.cloud.google.com/identity-platform/docs/reference/rest/v1/accounts/signInWithIdp), [Apple authorization responses](https://developer.apple.com/documentation/signinwithapple/configuring-your-webpage-for-sign-in-with-apple).
