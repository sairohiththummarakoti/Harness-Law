import { matchesExpectedAccount } from '../account-context.ts';
import { authCookie, authJson, cookieSecurityForUrl, isSameOrigin, readAuthBody, readTokenCookie } from '../auth/runtime.ts';
import { folderIntegrityError, folderNameError } from '../evidence-folders.ts';
import { caseSchema, MAX_CASE_BODY } from '../validation.ts';
import type { CaseState } from '../model.ts';
import { capabilities, driveSecret, providerConfig, type DriveEnvironment } from './config.ts';
import { assertWithinRoot, DriveError, exchangeToken, listChildren, providerIdentity, type DriveTokens } from './providers.ts';
import { publicConnection, type DriveConnection, type DriveRepository } from './repository.ts';
import { connectionName, pkceChallenge, randomToken, returnPath, seal, tokenHash, unseal, validConnectionId, validItemId } from './security.ts';

export interface DriveDependencies { env: DriveEnvironment; repository: DriveRepository; getUser(): Promise<{userId:string}|null>; fetch?: typeof fetch; development?: boolean }
export class DriveConflictError extends DriveError {
  state:CaseState|null;
  constructor(message:string,state:CaseState|null,code='revision_conflict'){super(message,409,code);this.state=state;}
}
function fail(error: unknown): Response { return error instanceof DriveError ? authJson({error:error.message,code:error.code,needsReauth:error.code==='drive_reconnect_required',...(error instanceof DriveConflictError&&error.state?{state:error.state,revision:error.state.revision}:{})},error.status) : authJson({error:'Cloud drive access is temporarily unavailable.',code:'drive_unavailable'},503); }
export async function connectionFailure(error:unknown,deps:DriveDependencies,row?:DriveConnection){
  if(row&&error instanceof DriveError&&error.code==='drive_reconnect_required')await deps.repository.markReconnect(row.owner_id,row.id,row.token_ciphertext);
  return fail(error);
}
async function owner(request:Request,deps:DriveDependencies,write=false) {
  const user=await deps.getUser();
  if(!user)throw new DriveError('Sign in to manage your evidence connections.',401,'session_expired');
  if(!matchesExpectedAccount(request,user.userId))throw new DriveError('Your account changed. Reload before continuing.',401,'session_changed');
  if(write&&!isSameOrigin(request))throw new DriveError('Invalid request origin.',403,'invalid_origin');
  return user.userId;
}
async function body(request:Request):Promise<Record<string,unknown>> {
  if(request.headers.get('content-type')?.split(';',1)[0]!=='application/json')throw new DriveError('Send this request as JSON.',415,'invalid_body');
  try{const text=await readAuthBody(request);if(text===null)throw new Error();const data=JSON.parse(text);if(!data||typeof data!=='object'||Array.isArray(data))throw new Error();return data;}catch{throw new DriveError('The request is invalid or too large.',400,'invalid_body');}
}
function context(row:DriveConnection){return `drive:${row.owner_id}:${row.id}`;}
function nonceName(state:string,secure:boolean){return `${secure?'__Host-':''}harness_drive_${state.slice(0,16)}`;}
function requireConfig(deps:DriveDependencies,provider:unknown){const config=providerConfig(deps.env,provider);if(!config)throw new DriveError('This provider is not configured. Use device upload for now.',503,'provider_unavailable');return config;}
export async function authorizedConnection(request:Request,deps:DriveDependencies,id:unknown,allowPending=false) {
  const userId=await owner(request,deps);
  if(!validConnectionId(id))throw new DriveError('Choose a connection.',400,'invalid_connection');
  let row=await deps.repository.get(userId,id);
  if(!row)throw new DriveError('This connection is not available.',404,'connection_not_found');
  if(row.status==='reconnect_required'||row.status==='pending'&&(!allowPending||Math.floor(Date.now()/1000)-row.created_at>1800))throw new DriveError('Reconnect this drive to continue.',401,'drive_reconnect_required');
  const config=requireConfig(deps,row.provider), secret=driveSecret(deps.env);
  let tokens:DriveTokens;
  try{tokens=await unseal<DriveTokens>(row.token_ciphertext,secret,context(row));}
  catch{await deps.repository.markReconnect(userId,row.id,row.token_ciphertext);throw new DriveError('Reconnect this drive to continue.',401,'drive_reconnect_required');}
  if(tokens.expiresAt<=Math.floor(Date.now()/1000)+30){
    if(!tokens.refreshToken){await deps.repository.markReconnect(userId,row.id,row.token_ciphertext);throw new DriveError('Reconnect this drive to continue.',401,'drive_reconnect_required');}
    try{const renewed=await exchangeToken(config,{grant_type:'refresh_token',refresh_token:tokens.refreshToken},deps.fetch);tokens={...renewed,refreshToken:renewed.refreshToken||tokens.refreshToken};await deps.repository.updateToken(row,await seal(tokens,secret,context(row)),tokens.expiresAt);const latest=await deps.repository.get(userId,row.id);if(!latest)throw new DriveError('Connection removed.',404,'connection_not_found');row=latest;tokens=await unseal<DriveTokens>(latest.token_ciphertext,secret,context(latest));}
    catch(error){if(error instanceof DriveError&&error.code==='drive_reconnect_required')await deps.repository.markReconnect(userId,row.id,row.token_ciphertext);throw error;}
  }
  return {row,tokens,userId};
}
export async function handleDriveConfig(request:Request,deps:DriveDependencies){try{await owner(request,deps);return authJson(capabilities(deps.env));}catch(error){return fail(error);}}
export async function handleDriveConnect(request:Request,deps:DriveDependencies){
  try{
    const userId=await owner(request,deps,true), input=await body(request), config=requireConfig(deps,input.provider), secure=cookieSecurityForUrl(request.url,deps.development);
    if(secure===null)throw new DriveError('Use a secure site connection.',403,'insecure_origin');
    const state=randomToken(),browser=randomToken(),verifier=randomToken(),hash=await tokenHash(state), callback=new URL('/api/drives/callback',request.url).href;
    const saved=await deps.repository.authorizationStart({state_hash:hash,owner_id:userId,provider:config.provider,browser_hash:await tokenHash(browser),verifier_ciphertext:await seal({verifier,callback},driveSecret(deps.env),`authorize:${userId}:${hash}`),return_to:returnPath(input.returnTo),expires_at:Math.floor(Date.now()/1000)+600});
    if(!saved)throw new DriveError('Too many connection attempts. Wait a few minutes and try again.',429,'too_many_attempts');
    const url=new URL(config.authorizeUrl);url.search=new URLSearchParams({client_id:config.clientId,redirect_uri:callback,response_type:'code',scope:config.scope,state,code_challenge:await pkceChallenge(verifier),code_challenge_method:'S256',...(config.provider==='google_drive'?{access_type:'offline',prompt:'consent select_account'}:{prompt:'select_account',response_mode:'query'})}).toString();
    const headers=new Headers();headers.append('Set-Cookie',authCookie(nonceName(state,secure),browser,600,secure));
    return authJson({authorizationUrl:url.href},200,headers);
  }catch(error){return fail(error);}
}
export async function handleDriveCallback(request:Request,deps:DriveDependencies){
  const secure=cookieSecurityForUrl(request.url,deps.development);let destination='/workspace?view=evidence';const headers=new Headers();
  const redirect=(key:string,value:string)=>{const url=new URL(destination,request.url);url.searchParams.set(key,value);headers.set('Location',url.href);return authJson(null,303,headers);};
  try{
    const userId=await owner(request,deps);if(secure===null)throw new Error();const query=new URL(request.url).searchParams,state=query.get('state');
    if(!state||!/^[A-Za-z0-9_-]{43}$/.test(state)||query.getAll('state').length!==1)throw new DriveError('The connection attempt expired. Please try again.',400,'invalid_state');
    const browser=readTokenCookie(request.headers.get('cookie')||'',nonceName(state,secure));if(!browser)throw new DriveError('The connection attempt expired. Please try again.',400,'invalid_state');
    headers.append('Set-Cookie',authCookie(nonceName(state,secure),'',0,secure));
    const hash=await tokenHash(state),transaction=await deps.repository.authorizationTake(hash,userId,await tokenHash(browser),Math.floor(Date.now()/1000));
    if(!transaction)throw new DriveError('The connection attempt expired. Please try again.',400,'invalid_state');destination=returnPath(transaction.return_to);
    if(query.has('error'))return redirect('driveError','Connection cancelled. Your existing files are unchanged.');
    const code=query.get('code');if(!code||code.length>8192||query.getAll('code').length!==1)throw new DriveError('The provider returned an invalid authorization code.',400,'invalid_code');
    const secret=driveSecret(deps.env),config=requireConfig(deps,transaction.provider),stored=await unseal<{verifier:string;callback:string}>(transaction.verifier_ciphertext,secret,`authorize:${userId}:${hash}`);
    if(stored.callback!==new URL('/api/drives/callback',request.url).href)throw new DriveError('The callback origin changed.',400,'invalid_state');
    const tokens=await exchangeToken(config,{grant_type:'authorization_code',code,redirect_uri:stored.callback,code_verifier:stored.verifier},deps.fetch), identity=await providerIdentity(config.provider,tokens.accessToken,deps.fetch),now=Math.floor(Date.now()/1000),id=`drv-${crypto.randomUUID()}`;
    const row:DriveConnection={id,owner_id:userId,provider:config.provider,display_name:'',scope:'whole_drive',root_id:identity.root.id,root_name:identity.root.name,drive_id:identity.root.driveId,account_id:identity.accountId,account_label:identity.accountLabel,token_ciphertext:'',token_expires_at:tokens.expiresAt,status:'pending',case_id:null,evidence_folder_id:null,created_at:now,updated_at:now};row.token_ciphertext=await seal(tokens,secret,context(row));await deps.repository.insert(row);
    return redirect('driveConnection',id);
  }catch(error){return redirect('driveError',error instanceof DriveError?error.message:'Could not connect the drive. Please try again.');}
}
export async function handleDriveList(request:Request,deps:DriveDependencies){try{const userId=await owner(request,deps);return authJson({drives:(await deps.repository.list(userId)).map(row=>publicConnection(row))});}catch(error){return fail(error);}}
export async function handleDriveBrowse(request:Request,deps:DriveDependencies){
  let connection:DriveConnection|undefined;
  try{
    const url=new URL(request.url),{row,tokens}=await authorizedConnection(request,deps,url.searchParams.get('connectionId'),true),folderId=url.searchParams.get('folderId')||row.root_id;
    connection=row;
    if(!validItemId(folderId))throw new DriveError('Invalid cloud folder.',400,'invalid_item');
    const folder=await assertWithinRoot(row.provider,tokens.accessToken,folderId,row.root_id,row.drive_id,deps.fetch);if(!folder.isFolder)throw new DriveError('Choose a folder.',422,'invalid_folder');
    let pageToken:string|undefined;const cursor=url.searchParams.get('cursor');if(cursor){if(cursor.length>20000)throw new DriveError('Invalid page cursor.',400,'invalid_cursor');let data:{folderId:string;token:string;expiresAt:number};try{data=await unseal(cursor,driveSecret(deps.env),`page:${row.owner_id}:${row.id}:${row.root_id}`);}catch{throw new DriveError('Invalid page cursor.',400,'invalid_cursor');}if(data.folderId!==folderId||data.expiresAt<Math.floor(Date.now()/1000)||typeof data.token!=='string')throw new DriveError('This page cursor expired. Reopen the folder.',400,'invalid_cursor');pageToken=data.token;}
    const result=await listChildren(row.provider,tokens.accessToken,folder.id,row.drive_id,pageToken,deps.fetch),nextCursor=result.nextPageToken?await seal({folderId,token:result.nextPageToken,expiresAt:Math.floor(Date.now()/1000)+900},driveSecret(deps.env),`page:${row.owner_id}:${row.id}:${row.root_id}`):null;
    return authJson({connectionId:row.id,folderId:folder.id,items:result.items,nextCursor,root:{id:row.root_id,name:row.root_name}});
  }catch(error){return connectionFailure(error,deps,connection);}
}
async function caseForWrite(deps:DriveDependencies,userId:string,input:Record<string,unknown>){const state=await deps.repository.caseRead(userId);if(!state||state.id!==input.caseId||state.mode!=='personal')throw new DriveConflictError('Reload your personal case before connecting evidence.',state,'case_changed');if(!Number.isSafeInteger(input.expectedRevision)||state.revision!==input.expectedRevision)throw new DriveConflictError('Your case changed. Reload it before continuing.',state);return state;}
export async function handleDriveSave(request:Request,deps:DriveDependencies,rename=false){
  let connection:DriveConnection|undefined;
  try{
    await owner(request,deps,true);const input=await body(request),{row,tokens,userId}=await authorizedConnection(request,deps,rename?input.id:input.connectionId,!rename),name=connectionName(input.displayName);
    connection=row;
    if(!name||folderNameError(name))throw new DriveError(folderNameError(name||'')||'Enter a connection name.',422,'invalid_name');
    const state=await caseForWrite(deps,userId,input),next=structuredClone(state),nextRow={...row,display_name:name,updated_at:Math.floor(Date.now()/1000)};
    if(rename){if(row.case_id!==state.id||!row.evidence_folder_id)throw new DriveError('This connection belongs to another case.',409,'case_changed');const folder=next.folders?.find(item=>item.id===row.evidence_folder_id);if(!folder)throw new DriveError('The connection folder was removed.',409,'folder_missing');folder.name=name;}
    else{
      if(row.status!=='pending')throw new DriveError('This connection has already been saved.',409,'connection_already_saved');
      if(input.scope!=='folder'&&input.scope!=='whole_drive')throw new DriveError('Choose a folder or the whole drive.',422,'invalid_scope');
      const rootId=input.scope==='whole_drive'?row.root_id:input.rootId;if(!validItemId(rootId))throw new DriveError('Choose a cloud folder.',422,'invalid_folder');
      const root=await assertWithinRoot(row.provider,tokens.accessToken,rootId,row.root_id,row.drive_id,deps.fetch);if(!root.isFolder)throw new DriveError('Choose a folder.',422,'invalid_folder');
      const folder={id:`folder-${crypto.randomUUID()}`,name,parentId:null,origin:'external' as const,connectionId:row.id};next.folders=[...(next.folders||[]),folder];Object.assign(nextRow,{scope:input.scope,root_id:root.id,root_name:root.name,drive_id:root.driveId,status:'connected',case_id:state.id,evidence_folder_id:folder.id});
    }
    const integrity=folderIntegrityError(next);if(integrity)throw new DriveError(integrity,422,'invalid_folder');
    next.revision=state.revision+1;next.updatedAt=new Date().toISOString();
    if(!caseSchema.safeParse(next).success)throw new DriveError('This connection cannot be added to the current case. Reload before continuing.',422,'invalid_state');
    if(new TextEncoder().encode(JSON.stringify({state:next,expectedRevision:state.revision})).byteLength>MAX_CASE_BODY)throw new DriveError('This case is too large to save another connection.',413,'case_limit');
    if(!await deps.repository.saveConnectionCase(row,nextRow,next,state.revision))throw new DriveConflictError('Your case or connection changed. Reload before continuing.',await deps.repository.caseRead(userId));
    return authJson({drives:(await deps.repository.list(userId)).map(item=>publicConnection(item)),state:next,revision:next.revision});
  }catch(error){return connectionFailure(error,deps,connection);}
}
export async function handleDriveDisconnect(request:Request,deps:DriveDependencies){try{const userId=await owner(request,deps,true),id=new URL(request.url).searchParams.get('id');if(!validConnectionId(id))throw new DriveError('Choose a connection.',400,'invalid_connection');await deps.repository.delete(userId,id);return authJson({drives:(await deps.repository.list(userId)).map(row=>publicConnection(row))});}catch(error){return fail(error);}}
export { fail as driveFailure, owner as driveOwner, body as driveBody };
