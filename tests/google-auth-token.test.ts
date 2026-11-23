import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTPayload } from 'jose';
// @ts-ignore Node's built-in TypeScript runner requires explicit extensions.
import { verifyGoogleCredential } from '../lib/auth/verify.ts';

const clientId = 'test-client.apps.googleusercontent.com';
const nonce = 'b'.repeat(43);
const now = new Date('2026-11-22T12:00:00Z');
const issued = Math.floor(now.getTime() / 1000);
const keys = await generateKeyPair('RS256', { extractable: true });
const publicJWK = { ...await exportJWK(keys.publicKey), alg: 'RS256', use: 'sig', kid: 'local-test-key' };
const jwks = createLocalJWKSet({ keys: [publicJWK] });
const valid: JWTPayload = {
  iss: 'https://accounts.google.com', aud: clientId, sub: '123456789012345678901',
  iat: issued, exp: issued + 3600, email: 'applicant@example.com', email_verified: true,
  nonce, name: 'Alex Example',
};
const sign = (payload: JWTPayload) => new SignJWT(payload).setProtectedHeader({ alg: 'RS256', kid: publicJWK.kid }).sign(keys.privateKey);
const verify = (credential: string, expectedNonce = nonce) => verifyGoogleCredential(credential, clientId, expectedNonce, { jwks, now });

test('a signed Google token yields only verified subject and profile details', async () => {
  const identity = await verify(await sign(valid));
  assert.deepEqual(identity, { sub: valid.sub, email: valid.email, fullName: 'Alex Example' });
  assert.equal('nonce' in identity, false);
  assert.equal('credential' in identity, false);
  assert.deepEqual(await verify(await sign({ ...valid, iss: 'accounts.google.com' })), identity);
});

test('wrong issuer, audience, nonce, or email verification are rejected', async () => {
  for (const patch of [
    { iss: 'https://attacker.example' }, { aud: 'other-client.apps.googleusercontent.com' },
    { nonce: 'c'.repeat(43) }, { email_verified: false }, { email_verified: 'true' },
    { azp: 'other-client.apps.googleusercontent.com' },
  ]) await assert.rejects(verify(await sign({ ...valid, ...patch })), /could not be verified/);
  await assert.rejects(verify(await sign(valid), 'short-nonce'), /could not be verified/);
});

test('multiple audiences require the correct authorized party', async () => {
  const aud = [clientId, 'another-client.apps.googleusercontent.com'];
  await assert.rejects(verify(await sign({ ...valid, aud })), /could not be verified/);
  await assert.rejects(verify(await sign({ ...valid, aud, azp: 'another-client.apps.googleusercontent.com' })), /could not be verified/);
  assert.equal((await verify(await sign({ ...valid, aud, azp: clientId }))).sub, valid.sub);
});

test('expired, old, future-issued and inverted token times are rejected', async () => {
  for (const patch of [
    { iat: issued - 100, exp: issued - 31 },
    { iat: issued - 631, exp: issued + 1000 },
    { iat: issued + 31, exp: issued + 3600 },
    { iat: issued, exp: issued },
  ]) await assert.rejects(verify(await sign({ ...valid, ...patch })), /could not be verified/);
});

test('every required identity claim must be present', async () => {
  for (const claim of ['iss', 'aud', 'sub', 'iat', 'exp', 'email', 'email_verified', 'nonce']) {
    const payload = { ...valid }; delete payload[claim];
    await assert.rejects(verify(await sign(payload)), /could not be verified/);
  }
});

test('malformed subjects and email addresses cannot become session identities', async () => {
  for (const patch of [
    { sub: '' }, { sub: ' '.repeat(2) }, { sub: 'x'.repeat(256) }, { sub: 'id\u0000' },
    { email: 'not-an-email' }, { email: 'a@example.com\n' }, { email: 'a\u0000@example.com' }, { email: `${'x'.repeat(320)}@example.com` },
  ]) await assert.rejects(verify(await sign({ ...valid, ...patch })), /could not be verified/);
});

test('only RS256 tokens signed by a trusted JWKS key are accepted', async () => {
  const secret = new Uint8Array(32).fill(1);
  const hmac = await new SignJWT(valid).setProtectedHeader({ alg: 'HS256' }).sign(secret);
  await assert.rejects(verify(hmac), /could not be verified/);
  const impostor = await generateKeyPair('RS256');
  const badSignature = await new SignJWT(valid).setProtectedHeader({ alg: 'RS256', kid: publicJWK.kid }).sign(impostor.privateKey);
  await assert.rejects(verify(badSignature), /could not be verified/);
});

test('malformed credentials fail generically without exposing token or provider details', async () => {
  for (const credential of ['private-token-content', 'x'.repeat(16385)]) {
    await assert.rejects(verify(credential), error => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, 'Google sign-in could not be verified. Please try again.');
      assert.doesNotMatch(error.message, /private-token-content|JWKS|audience|signature/);
      return true;
    });
  }
});

test('optional names are bounded and stripped of controls without changing the subject identity', async () => {
  assert.equal((await verify(await sign({ ...valid, name: '  Alex\u0000 Example\n ' }))).fullName, 'Alex Example');
  assert.equal((await verify(await sign({ ...valid, name: 'x'.repeat(501) }))).fullName, null);
  const withoutName = { ...valid }; delete withoutName.name;
  assert.equal((await verify(await sign(withoutName))).fullName, null);
});
