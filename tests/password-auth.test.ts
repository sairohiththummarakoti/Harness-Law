import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
// @ts-ignore Node's built-in test runner requires explicit TypeScript extensions.
import { handlePasswordAuth, readPasswordUser } from '../lib/auth/email-password.ts';
// @ts-ignore Node's built-in test runner requires explicit TypeScript extensions.
import { tokenHash } from '../lib/auth/runtime.ts';

const origin='https://harnesslaw.test';
function fixture(){
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../drizzle/0006_password_accounts.sql',import.meta.url),'utf8'));
  sqlite.exec(readFileSync(new URL('../drizzle/0007_account_policy_versions.sql',import.meta.url),'utf8'));
  sqlite.exec(readFileSync(new URL('../drizzle/0000_same_leopardon.sql',import.meta.url),'utf8'));
  sqlite.exec(readFileSync(new URL('../drizzle/0001_integration_cases.sql',import.meta.url),'utf8'));
  sqlite.exec(readFileSync(new URL('../drizzle/0002_google_signin.sql',import.meta.url),'utf8'));
  const db={
    prepare(sql:string){return {bind(...values:(string|number|null)[]){return {
      async first<T>(){return (sqlite.prepare(sql).get(...values) as T|undefined)??null;},
      async all<T>(){return {results:sqlite.prepare(sql).all(...values) as T[]};},
      async run(){return sqlite.prepare(sql).run(...values);},
    };}};},
    async batch(statements:{run():Promise<unknown>}[]){sqlite.exec('BEGIN');try{const result=[];for(const statement of statements)result.push(await statement.run());sqlite.exec('COMMIT');return result;}catch(error){sqlite.exec('ROLLBACK');throw error;}},
  };
  const messages:{to:string;subject:string;text:string}[]=[];
  const env:{DB:typeof db;EMAIL:{send(message:{to:string;subject:string;text:string}):Promise<void>};HARNESS_MAIL_MODE:string;HARNESS_MAIL_FROM:string;HARNESS_TERMS_VERSION:string;HARNESS_PRIVACY_VERSION:string;HARNESS_TURNSTILE_SITE_KEY:string;HARNESS_TURNSTILE_SECRET_KEY:string;FIREBASE_API_KEY?:string;FIREBASE_PROJECT_ID?:string;fetch:typeof fetch}={DB:db,EMAIL:{async send(message:{to:string;subject:string;text:string}){messages.push(message);}},HARNESS_MAIL_MODE:'local',HARNESS_MAIL_FROM:'Harness Law <no-reply@example.test>',HARNESS_TERMS_VERSION:'test-terms-v1',HARNESS_PRIVACY_VERSION:'test-privacy-v1',HARNESS_TURNSTILE_SITE_KEY:'test-site',HARNESS_TURNSTILE_SECRET_KEY:'test-secret',fetch:async()=>Response.json({success:true,hostname:'harnesslaw.test'})};
  return {sqlite,db,env,messages};
}
function req(action:string,method='POST',body?:unknown,token?:string){return new Request(`${origin}/api/auth/email/${action}${token?`?token=${token}`:''}`,{method,headers:{origin,...(body!==undefined?{'content-type':'application/json'}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});}
async function send(f:ReturnType<typeof fixture>,action:string,body:unknown,actor?:string){const withBot=['register','login','forgot','resend','reset'].includes(action)?{...(body as object),turnstileToken:'test-turnstile'}:body;return handlePasswordAuth(req(action,'POST',withBot),f.env as never,action as never,actor);}
function linkToken(message:{text:string}){const found=message.text.match(/[A-Za-z0-9_-]{43}/);assert.ok(found);return found[0];}
function otpCode(message:{text:string}){const found=message.text.match(/\b\d{6}\b/);assert.ok(found);return found[0];}

test('signup stays inactive until explicit email confirmation; verified login creates revocable host session',async()=>{
 const f=fixture();try{
  let response=await send(f,'register',{name:'Alex Applicant',email:'alex@gmail.com',password:'correct horse battery staple',acceptedTerms:true});assert.equal(response.status,202);assert.equal(f.messages.length,1);
  assert.equal((await f.sqlite.prepare('SELECT verified_at FROM password_accounts').get() as {verified_at:number|null}).verified_at,null);
  response=await send(f,'login',{email:'alex@gmail.com',password:'correct horse battery staple'});assert.equal(response.status,403);
  const token=linkToken(f.messages[0]);response=await handlePasswordAuth(req('verify','GET',undefined,token),f.env as never,'verify');assert.equal(response.status,303);assert.ok((response.headers.get('location')||'').includes('#token='));
  response=await send(f,'verify',{token});assert.equal(response.status,200);
  response=await send(f,'login',{email:'alex@gmail.com',password:'correct horse battery staple'});assert.equal(response.status,200);const cookie=response.headers.getSetCookie().find(value=>value.startsWith('__Host-harness_password_session='));assert.ok(cookie);
  const session=cookie!.split(';',1)[0].split('=')[1];assert.ok(await readPasswordUser(f.db as never,`${session ? '__Host-harness_password_session='+session : ''}; __Host-harness_auth_provider=password`,true));
 } finally{f.sqlite.close();}
});

test('Firebase Auth registers user and requests email verification via Identity Toolkit REST API',async()=>{
 const f=fixture();const calls:{url:string;body?:Record<string,unknown>}[]=[];
 f.env.FIREBASE_API_KEY='fb_test_api_key';
 f.env.fetch=async(input:RequestInfo|URL,init?:RequestInit)=>{
  const url=String(input);
  const parsedBody = typeof init?.body==='string' ? JSON.parse(init.body) as Record<string,unknown> : undefined;
  calls.push({url,body:parsedBody});
  if(url.endsWith('/siteverify')) return Response.json({success:true,hostname:'harnesslaw.test'});
  if(url.includes('accounts:signUp')) return Response.json({localId:'fb_user_123',email:'firebase@example.com',idToken:'fb_id_token_123',refreshToken:'fb_refresh_123',expiresIn:'3600'});
  if(url.includes('accounts:sendOobCode')) return Response.json({email:'firebase@example.com'});
  if(url.includes('accounts:update')) return Response.json({localId:'fb_user_123',email:'firebase@example.com',emailVerified:true});
  return Response.json({});
 };
 try{
  const response=await send(f,'register',{name:'Firebase User',email:'firebase@example.com',password:'strong password 123',acceptedTerms:true});
  assert.equal(response.status,202);
  const signUpCall=calls.find(c=>c.url.includes('accounts:signUp'));assert.ok(signUpCall);
  assert.equal(signUpCall!.body?.email,'firebase@example.com');
  const oobCall=calls.find(c=>c.url.includes('accounts:sendOobCode'));assert.ok(oobCall);
  assert.equal(oobCall!.body?.requestType,'VERIFY_EMAIL');
  assert.equal(oobCall!.body?.idToken,'fb_id_token_123');

  // Verify email via Firebase oobCode
  const verifyRes=await send(f,'verify',{code:'fb_oob_code_xyz'});
  assert.equal(verifyRes.status,200);
  const updateCall=calls.find(c=>c.url.includes('accounts:update'));assert.ok(updateCall);
  assert.equal(updateCall!.body?.oobCode,'fb_oob_code_xyz');
 }finally{f.sqlite.close();}
});

test('Firebase Auth validates login credentials and enforces email verification check',async()=>{
 const f=fixture();let verifiedState=false;
 f.env.FIREBASE_API_KEY='fb_test_api_key';
 f.env.fetch=async(input:RequestInfo|URL,init?:RequestInit)=>{
  const url=String(input);
  if(url.endsWith('/siteverify')) return Response.json({success:true,hostname:'harnesslaw.test'});
  if(url.includes('accounts:signInWithPassword')) {
   const body=JSON.parse(String(init?.body)) as {email:string;password:string};
   if(body.password!=='correct password') return Response.json({error:{code:400,message:'INVALID_LOGIN_CREDENTIALS'}},{status:400});
   return Response.json({localId:'fb_user_456',email:body.email,idToken:'fb_token_456',refreshToken:'refresh',registered:true});
  }
  if(url.includes('accounts:lookup')) {
   return Response.json({users:[{localId:'fb_user_456',email:'user@example.com',emailVerified:verifiedState,displayName:'Firebase Applicant'}]});
  }
  return Response.json({});
 };
 try{
  // Wrong password fails
  const wrong=await send(f,'login',{email:'user@example.com',password:'wrong password'});
  assert.equal(wrong.status,401);

  // Unverified account fails with 403
  verifiedState=false;
  const unverified=await send(f,'login',{email:'user@example.com',password:'correct password'});
  assert.equal(unverified.status,403);
  const unverifiedBody=await unverified.json() as {code?:string};
  assert.equal(unverifiedBody.code,'email_unverified');

  // Verified account succeeds and establishes session
  verifiedState=true;
  const verified=await send(f,'login',{email:'user@example.com',password:'correct password',rememberMe:true});
  assert.equal(verified.status,200);
  const cookie=verified.headers.getSetCookie().find(v=>v.startsWith('__Host-harness_password_session='));
  assert.ok(cookie);
  assert.match(cookie!,/Max-Age=2592000/);
 }finally{f.sqlite.close();}
});

test('verification and password reset tokens are hashed, expiring and single use',async()=>{
 const f=fixture();try{
  await send(f,'register',{name:'Alex',email:'alex@outlook.com',password:'long password 123',acceptedTerms:true});
  const verification=linkToken(f.messages[0]);assert.equal(await f.sqlite.prepare('SELECT count(*) AS n FROM email_challenges WHERE token_hash=?').get(await tokenHash(verification))?.n,1);
  await send(f,'verify',{token:verification});
  await send(f,'forgot',{email:'alex@outlook.com'});const reset=linkToken(f.messages[1]);
  const response=await send(f,'reset',{token:reset,password:'a much stronger new password'});assert.equal(response.status,200);
  assert.equal((await send(f,'reset',{token:reset,password:'another strong password'})).status,400);
  assert.equal((await send(f,'login',{email:'alex@outlook.com',password:'long password 123'})).status,401);
  assert.equal((await send(f,'login',{email:'alex@outlook.com',password:'a much stronger new password'})).status,200);
 } finally{f.sqlite.close();}
});

test('email change requires new-address confirmation and duplicate registrations are rejected',async()=>{
 const f=fixture();try{
  await send(f,'register',{name:'Alex',email:'alex@yahoo.com',password:'password is long',acceptedTerms:true});
  await send(f,'register',{name:'Other',email:'ALEX@YAHOO.COM',password:'password is long',acceptedTerms:true});assert.equal((await f.sqlite.prepare('SELECT count(*) AS n FROM password_accounts').get() as {n:number}).n,1);
  const actor='password:actor';await f.sqlite.prepare('UPDATE password_accounts SET user_id=?').run(actor);
  const response=await send(f,'change-email',{email:'alex@outlook.com'},actor);assert.equal(response.status,202);assert.equal((await f.sqlite.prepare('SELECT email FROM password_accounts').get() as {email:string}).email,'alex@yahoo.com');
  const token=linkToken(f.messages.at(-1)!);const opened=await handlePasswordAuth(req('email-change','GET',undefined,token),f.env as never,'email-change');
  assert.match(opened.headers.get('location')||'',/confirm-email-change#token=/);
  assert.equal((await f.sqlite.prepare('SELECT email FROM password_accounts').get() as {email:string}).email,'alex@yahoo.com');
  const confirmed=await send(f,'email-change',{token},actor);assert.equal(confirmed.status,200);
  assert.equal((await f.sqlite.prepare('SELECT email FROM password_accounts').get() as {email:string}).email,'alex@outlook.com');
 } finally{f.sqlite.close();}
});

test('password change revokes sessions and account deletion removes account records',async()=>{
 const f=fixture();try{
  await send(f,'register',{name:'Alex',email:'alex@microsoft.com',password:'original secure password',acceptedTerms:true});
  await send(f,'verify',{token:linkToken(f.messages[0])});
  const login=await send(f,'login',{email:'alex@microsoft.com',password:'original secure password'});assert.equal(login.status,200);
  const actor='password:actor';await f.sqlite.prepare('UPDATE password_accounts SET user_id=?').run(actor);await f.sqlite.prepare('UPDATE password_sessions SET user_id=?').run(actor);
  const changed=await send(f,'change-password',{currentPassword:'original secure password',password:'replacement secure password'},actor);assert.equal(changed.status,200);
  assert.equal((await f.sqlite.prepare('SELECT count(*) AS n FROM password_sessions WHERE user_id=?').get(actor) as {n:number}).n,0);
  assert.equal((await send(f,'login',{email:'alex@microsoft.com',password:'original secure password'})).status,401);
  assert.equal((await send(f,'login',{email:'alex@microsoft.com',password:'replacement secure password'})).status,200);
  const deleted=await send(f,'delete-account',{password:'replacement secure password'},actor);assert.equal(deleted.status,200);
  assert.equal((await f.sqlite.prepare('SELECT count(*) AS n FROM password_accounts WHERE user_id=?').get(actor) as {n:number}).n,0);
 } finally{f.sqlite.close();}
});

test('6-digit OTP verification and Remember Me login work seamlessly', async () => {
 const f = fixture();
 try {
  const reg = await send(f, 'register', { name: 'Taylor Tester', email: 'taylor@gmail.com', password: 'secure password 123', acceptedTerms: true });
  assert.equal(reg.status, 202);
  const otp = otpCode(f.messages[0]);
  assert.match(otp, /^\d{6}$/);

  // Unverified login fails
  assert.equal((await send(f, 'login', { email: 'taylor@gmail.com', password: 'secure password 123' })).status, 403);

  // Verify using 6-digit OTP
  const verified = await send(f, 'verify', { code: otp });
  assert.equal(verified.status, 200);

  // OTP cannot be reused
  assert.equal((await send(f, 'verify', { code: otp })).status, 400);

  // Login with Remember Me enabled produces 30-day session
  const login = await send(f, 'login', { email: 'taylor@gmail.com', password: 'secure password 123', rememberMe: true });
  assert.equal(login.status, 200);
  const sessionCookie = login.headers.getSetCookie().find(v => v.startsWith('__Host-harness_password_session='));
  assert.ok(sessionCookie);
  assert.match(sessionCookie!, /Max-Age=2592000/);

  // Login without Remember Me produces 24-hour session
  const standardLogin = await send(f, 'login', { email: 'taylor@gmail.com', password: 'secure password 123', rememberMe: false });
  assert.equal(standardLogin.status, 200);
  const standardCookie = standardLogin.headers.getSetCookie().find(v => v.startsWith('__Host-harness_password_session='));
  assert.match(standardCookie!, /Max-Age=86400/);
 } finally { f.sqlite.close(); }
});

test('password reset with 6-digit OTP code and notification email', async () => {
 const f = fixture();
 try {
  await send(f, 'register', { name: 'Jordan', email: 'jordan@yahoo.com', password: 'initial password 123', acceptedTerms: true });
  const verifyOtp = otpCode(f.messages[0]);
  await send(f, 'verify', { token: verifyOtp });

  // Request forgot password
  const forgot = await send(f, 'forgot', { email: 'jordan@yahoo.com' });
  assert.equal(forgot.status, 202);
  const resetOtp = otpCode(f.messages[1]);

  // Reset password with 6-digit OTP
  const reset = await send(f, 'reset', { code: resetOtp, password: 'new robust password 456' });
  assert.equal(reset.status, 200);

  // Reset OTP cannot be reused
  assert.equal((await send(f, 'reset', { code: resetOtp, password: 'another password' })).status, 400);

  // Password changed notification email was sent
  const notif = f.messages.find(m => m.subject.includes('password changed'));
  assert.ok(notif);

  // Old password fails, new password succeeds
  assert.equal((await send(f, 'login', { email: 'jordan@yahoo.com', password: 'initial password 123' })).status, 401);
  assert.equal((await send(f, 'login', { email: 'jordan@yahoo.com', password: 'new robust password 456' })).status, 200);
 } finally { f.sqlite.close(); }
});

test('unverified user can resend verification and rate limiting protects endpoints', async () => {
 const f = fixture();
 try {
  await send(f, 'register', { name: 'Morgan', email: 'morgan@company.org', password: 'mypassword123', acceptedTerms: true });
  assert.equal(f.messages.length, 1);

  // Resend verification
  const resend = await send(f, 'resend', { email: 'morgan@company.org' });
  assert.equal(resend.status, 202);
  assert.equal(f.messages.length, 2);

  // Verify using new code
  const newOtp = otpCode(f.messages[1]);
  const verified = await send(f, 'verify', { code: newOtp });
  assert.equal(verified.status, 200);

  // Once verified, resend does not dispatch new verification messages
  f.messages.length = 0;
  await send(f, 'resend', { email: 'morgan@company.org' });
  assert.equal(f.messages.length, 0);
 } finally { f.sqlite.close(); }
});

test('change-password and delete-account fail closed if Firebase verification encounters a network error', async () => {
 const f = fixture();
 try {
  await send(f, 'register', { name: 'Alex', email: 'alex@example.com', password: 'initial-password-123', acceptedTerms: true });
  await send(f, 'verify', { code: otpCode(f.messages[0]) });
  const login = await send(f, 'login', { email: 'alex@example.com', password: 'initial-password-123' });
  const cookie = login.headers.get('set-cookie')?.split(';')[0] ?? '';
  const actor = await readPasswordUser(f.db as never, cookie, true);
  assert.ok(actor);

  // This case represents an explicitly Firebase-backed account, not a native one.
  const remoteHash = `firebase:${actor.userId.slice('password:'.length)}`;
  f.sqlite.prepare('UPDATE password_accounts SET password_hash=? WHERE user_id=?').run(remoteHash, actor.userId);
  const failingEnv = {
   ...f.env,
   FIREBASE_API_KEY: 'fb_test_api_key',
   fetch: (async () => { throw new Error('network timeout'); }) as unknown as typeof fetch,
  };

  const pwRes = await handlePasswordAuth(
   new Request('https://app.example/api/auth/email/change-password', {
    method: 'POST',
    headers: { origin: 'https://app.example', 'content-type': 'application/json' },
    body: JSON.stringify({ currentPassword: 'wrong', password: 'new-password-456' }),
   }),
   failingEnv as never,
   'change-password',
   actor.userId,
  );
  assert.equal(pwRes.status, 503);

  const delRes = await handlePasswordAuth(
   new Request('https://app.example/api/auth/email/delete-account', {
    method: 'POST',
    headers: { origin: 'https://app.example', 'content-type': 'application/json' },
    body: JSON.stringify({ password: 'wrong' }),
   }),
   failingEnv as never,
   'delete-account',
   actor.userId,
  );
  assert.equal(delRes.status, 503);

  // A provider outage cannot change the account or enable local-password fallback.
  assert.equal(f.sqlite.prepare('SELECT password_hash FROM password_accounts WHERE user_id=?').get(actor.userId)?.password_hash, remoteHash);
  assert.equal((await send(f, 'login', { email: 'alex@example.com', password: 'initial-password-123' })).status, 503);
 } finally { f.sqlite.close(); }
});

function firebaseFixture() {
 const f=fixture();
 const calls:{endpoint:string;body:Record<string,unknown>}[]=[];
 const remote={uid:'firebase-user-a',email:'remote@example.test',verified:true};
 f.env.FIREBASE_API_KEY='stub-only-key';
 f.env.fetch=async(input:RequestInfo|URL,init?:RequestInit)=>{
  const url=String(input);
  if(url.endsWith('/siteverify')) return Response.json({success:true,hostname:'harnesslaw.test'});
  const endpoint=new URL(url).pathname.split('/').at(-1)!;
  const body=JSON.parse(String(init?.body||'{}')) as Record<string,unknown>;
  calls.push({endpoint,body});
  if(endpoint==='accounts:signInWithPassword') {
   if(body.password!=='remote-password') return Response.json({error:{message:'INVALID_LOGIN_CREDENTIALS'}},{status:400});
   return Response.json({localId:remote.uid,email:remote.email,idToken:'stub-id-token',refreshToken:'stub-refresh',registered:true});
  }
  if(endpoint==='accounts:lookup') return Response.json({users:[{localId:remote.uid,email:remote.email,emailVerified:remote.verified}]});
  if(endpoint==='accounts:sendOobCode') return Response.json({email:remote.email});
  if(endpoint==='accounts:resetPassword') return Response.json({email:remote.email});
  throw new Error('Unexpected Firebase request: '+endpoint);
 };
 function addRemote(uid=remote.uid,verifiedAt:number|null=123) {
  f.sqlite.prepare('INSERT INTO password_accounts (user_id,name,email,password_hash,verified_at,terms_accepted_at,terms_version,privacy_version,created_at) VALUES (?,?,?,?,?,?,?,?,?)')
   .run('password:'+uid,'Remote User',remote.email,'firebase:'+uid,verifiedAt,1,'terms','privacy',1);
 }
 return {...f,calls,remote,addRemote};
}

test('locally verified account cannot override Firebase email verification or UID binding',async()=>{
 const f=firebaseFixture();try{
  f.addRemote();f.remote.verified=false;
  const unverified=await send(f,'login',{email:f.remote.email,password:'remote-password'});
  assert.equal(unverified.status,403);assert.equal((await unverified.json() as {code:string}).code,'email_unverified');
  f.remote.verified=true;f.remote.uid='different-firebase-user';
  const collision=await send(f,'login',{email:f.remote.email,password:'remote-password'});
  assert.equal(collision.status,409);
  assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM password_sessions').get()?.n,0);
  assert.equal(f.sqlite.prepare('SELECT user_id FROM password_accounts').get()?.user_id,'password:firebase-user-a');
 }finally{f.sqlite.close();}
});

test('Firebase cannot take over native credentials sharing its email; native login remains available',async()=>{
 const f=fixture();try{
  await send(f,'register',{name:'Native User',email:'remote@example.test',password:'native-password',acceptedTerms:true});
  await send(f,'verify',{token:linkToken(f.messages[0])});
  const originalId=f.sqlite.prepare('SELECT user_id FROM password_accounts').get()?.user_id;
  f.env.FIREBASE_API_KEY='stub-only-key';
  const attempts:string[]=[];
  f.env.fetch=async(input:RequestInfo|URL)=>{const url=String(input);if(url.endsWith('/siteverify'))return Response.json({success:true,hostname:'harnesslaw.test'});attempts.push(url);throw new Error('Native credentials must not be sent to Firebase');};
  assert.equal((await send(f,'login',{email:'remote@example.test',password:'remote-password'})).status,401);
  assert.equal((await send(f,'login',{email:'remote@example.test',password:'native-password'})).status,200);
  assert.deepEqual(attempts,[]);
  assert.equal(f.sqlite.prepare('SELECT user_id FROM password_accounts').get()?.user_id,originalId);
 }finally{f.sqlite.close();}
});

test('Firebase account stores provider marker and never falls back to a mirrored local password',async()=>{
 const f=firebaseFixture();try{
  assert.equal((await send(f,'login',{email:f.remote.email,password:'remote-password'})).status,200);
  assert.equal(f.sqlite.prepare('SELECT password_hash FROM password_accounts').get()?.password_hash,'firebase:firebase-user-a');
  delete f.env.FIREBASE_API_KEY;
  assert.equal((await send(f,'login',{email:f.remote.email,password:'remote-password'})).status,503);
 }finally{f.sqlite.close();}
});

test('Firebase resend authenticates the matching identity and sends VERIFY_EMAIL, never PASSWORD_RESET',async()=>{
 const f=firebaseFixture();try{
  f.addRemote(undefined,null);f.remote.verified=false;
  const missing=await send(f,'resend',{email:f.remote.email});assert.equal(missing.status,422);
  assert.equal((await missing.json() as {code:string}).code,'reauthentication_required');
  assert.equal((await send(f,'resend',{email:f.remote.email,password:'wrong-password'})).status,401);
  assert.equal((await send(f,'resend',{email:f.remote.email,password:'remote-password'})).status,202);
  const emails=f.calls.filter(call=>call.endpoint==='accounts:sendOobCode');
  assert.equal(emails.length,1);assert.deepEqual(emails[0].body,{requestType:'VERIFY_EMAIL',idToken:'stub-id-token'});
 }finally{f.sqlite.close();}
});

test('native verification resend retains its delivery adapter when Firebase is configured',async()=>{
 const f=fixture();try{
  await send(f,'register',{name:'Native User',email:'native@example.test',password:'native-password',acceptedTerms:true});
  f.env.FIREBASE_API_KEY='stub-only-key';
  f.env.fetch=async(input:RequestInfo|URL)=>{if(String(input).endsWith('/siteverify'))return Response.json({success:true,hostname:'harnesslaw.test'});throw new Error('Native resend must not call Firebase');};
  assert.equal((await send(f,'resend',{email:'native@example.test'})).status,202);
  assert.equal(f.messages.length,2);assert.match(f.messages[1].subject,/Verify/);
 }finally{f.sqlite.close();}
});

test('Firebase password reset cannot replace a native password through an email collision',async()=>{
 const f=fixture();try{
  await send(f,'register',{name:'Native User',email:'remote@example.test',password:'native-password',acceptedTerms:true});
  await send(f,'verify',{token:linkToken(f.messages[0])});
  const originalHash=f.sqlite.prepare('SELECT password_hash FROM password_accounts').get()?.password_hash;
  f.env.FIREBASE_API_KEY='stub-only-key';
  f.env.fetch=async(input:RequestInfo|URL)=>{
   if(String(input).endsWith('/siteverify'))return Response.json({success:true,hostname:'harnesslaw.test'});
   if(String(input).includes('accounts:resetPassword'))return Response.json({email:'remote@example.test'});
   throw new Error('Unexpected request');
  };
  assert.equal((await send(f,'reset',{token:'firebase-reset-code',password:'remote-password'})).status,200);
  assert.equal(f.sqlite.prepare('SELECT password_hash FROM password_accounts').get()?.password_hash,originalHash);
  assert.equal((await send(f,'login',{email:'remote@example.test',password:'native-password'})).status,200);
 }finally{f.sqlite.close();}
});


test('native verification and reset continue through a Firebase outage without calling its service',async()=>{
 const f=fixture();try{
  await send(f,'register',{name:'Native User',email:'native@example.test',password:'native-password',acceptedTerms:true});
  const verification=linkToken(f.messages[0]);
  f.env.FIREBASE_API_KEY='stub-only-key';
  f.env.fetch=async(input:RequestInfo|URL)=>{if(String(input).endsWith('/siteverify'))return Response.json({success:true,hostname:'harnesslaw.test'});throw new Error('Native flow must not call Firebase');};
  assert.equal((await send(f,'verify',{token:verification})).status,200);
  assert.equal((await send(f,'forgot',{email:'native@example.test'})).status,202);
  assert.equal((await send(f,'reset',{token:linkToken(f.messages[1]),password:'new-native-password'})).status,200);
  assert.equal((await send(f,'login',{email:'native@example.test',password:'new-native-password'})).status,200);
 }finally{f.sqlite.close();}
});

test('Firebase password changes and deletion reject a different UID without mutating the account',async()=>{
 const f=firebaseFixture();try{
  f.addRemote();f.remote.uid='different-uid';
  assert.equal((await send(f,'change-password',{currentPassword:'remote-password',password:'new-remote-password'},'password:firebase-user-a')).status,409);
  assert.equal((await send(f,'delete-account',{password:'remote-password'},'password:firebase-user-a')).status,409);
  assert.equal(f.sqlite.prepare('SELECT password_hash FROM password_accounts').get()?.password_hash,'firebase:firebase-user-a');
  assert.equal(f.calls.filter(call=>call.endpoint==='accounts:delete'||call.endpoint==='accounts:update').length,0);
 }finally{f.sqlite.close();}
});


test('Firebase accounts cannot change only their local email or use a stale local email-change challenge',async()=>{
 const f=firebaseFixture();try{
  f.addRemote();
  const changed=await send(f,'change-email',{email:'new@example.test'},'password:firebase-user-a');
  assert.equal(changed.status,409);assert.equal((await changed.json() as {code:string}).code,'provider_managed_email');
  assert.equal(f.sqlite.prepare('SELECT pending_email FROM password_accounts').get()?.pending_email,null);
  assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM email_challenges').get()?.n,0);
  const staleToken='stale-local-email-change';const now=Math.floor(Date.now()/1000);
  f.sqlite.prepare('UPDATE password_accounts SET pending_email=?').run('new@example.test');
  f.sqlite.prepare('INSERT INTO email_challenges (token_hash,user_id,purpose,expires_at,created_at) VALUES (?,?,?,?,?)').run(await tokenHash(staleToken),'password:firebase-user-a','email-change',now+600,now);
  assert.equal((await send(f,'email-change',{token:staleToken})).status,400);
  assert.equal(f.sqlite.prepare('SELECT email FROM password_accounts').get()?.email,f.remote.email);
 }finally{f.sqlite.close();}
});
