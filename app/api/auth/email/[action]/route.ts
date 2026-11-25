import { env } from 'cloudflare:workers';
import { handlePasswordAuth } from '@/lib/auth/email-password';
import { getAppUser } from '@/app/auth';
export const dynamic='force-dynamic';
async function route(request:Request, context:{params:Promise<{action:string}>}) {
  const {action}=await context.params;
  if(action==='captcha'&&request.method==='GET') return Response.json({siteKey:env.HARNESS_TURNSTILE_SITE_KEY||null,enabled:!!env.HARNESS_TURNSTILE_SECRET_KEY},{headers:{'Cache-Control':'no-store'}});
  if(!['register','verify','resend','login','logout','forgot','reset','change-email','email-change','delete-account','change-password'].includes(action)) return Response.json({error:'Not found.'},{status:404});
  const user=['change-email','delete-account','change-password'].includes(action)?await getAppUser():null;
  const authEnv = {
    ...env,
    FIREBASE_API_KEY: env.FIREBASE_API_KEY || (typeof process !== 'undefined' ? process.env?.FIREBASE_API_KEY : undefined),
    FIREBASE_PROJECT_ID: env.FIREBASE_PROJECT_ID || (typeof process !== 'undefined' ? process.env?.FIREBASE_PROJECT_ID : undefined),
  };
  return handlePasswordAuth(request,authEnv as never,action as 'register'|'verify'|'resend'|'login'|'logout'|'forgot'|'reset'|'change-email'|'email-change'|'delete-account'|'change-password',user?.userId);
}
export const POST=route;
export const GET=route;
