import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const cases=sqliteTable('cases',{
  ownerId:text('owner_id').primaryKey(),
  caseId:text('case_id').notNull(),
  revision:integer('revision').notNull().default(0),
  stateJson:text('state_json').notNull(),
  updatedAt:text('updated_at').notNull(),
});

export const evidenceObjects=sqliteTable('evidence_objects',{
  id:text('id').primaryKey(),
  ownerId:text('owner_id').notNull(),
  caseId:text('case_id').notNull(),
  objectKey:text('object_key').notNull(),
  metadataJson:text('metadata_json').notNull(),
  createdAt:text('created_at').notNull(),
});

export const integrationCases=sqliteTable('integration_cases',{
  caseId:text('case_id').primaryKey(),
  ownerId:text('owner_id').notNull().unique(),
  revision:integer('revision').notNull().default(0),
  commitToken:text('commit_token').notNull(),
  nextJobAt:text('next_job_at'),
  updatedAt:text('updated_at').notNull(),
},table=>[index('integration_cases_next_job').on(table.nextJobAt)]);

export const integrationCaseChunks=sqliteTable('integration_case_chunks',{
  caseId:text('case_id').notNull().references(()=>integrationCases.caseId),
  revision:integer('revision').notNull(),
  chunkIndex:integer('chunk_index').notNull(),
  payload:text('payload').notNull(),
},table=>[primaryKey({columns:[table.caseId,table.revision,table.chunkIndex]})]);

export const authChallenges=sqliteTable('auth_challenges',{
  nonceHash:text('nonce_hash').primaryKey(),
  expiresAt:integer('expires_at').notNull(),
},table=>[index('auth_challenges_expiry').on(table.expiresAt)]);

export const authSessions=sqliteTable('auth_sessions',{
  tokenHash:text('token_hash').primaryKey(),
  userId:text('user_id').notNull(),
  email:text('email').notNull(),
  fullName:text('full_name'),
  expiresAt:integer('expires_at').notNull(),
},table=>[index('auth_sessions_expiry').on(table.expiresAt)]);

export const passwordAccounts=sqliteTable('password_accounts',{
  userId:text('user_id').primaryKey(),
  name:text('name').notNull(),
  email:text('email').notNull().unique(),
  pendingEmail:text('pending_email'),
  passwordHash:text('password_hash').notNull(),
  verifiedAt:integer('verified_at'),
  termsAcceptedAt:integer('terms_accepted_at').notNull(),
  termsVersion:text('terms_version').notNull().default('unspecified'),
  privacyVersion:text('privacy_version').notNull().default('unspecified'),
  createdAt:integer('created_at').notNull(),
},table=>[uniqueIndex('password_accounts_pending_email_unique').on(table.pendingEmail)]);
export const emailChallenges=sqliteTable('email_challenges',{
  tokenHash:text('token_hash').primaryKey(),
  userId:text('user_id').notNull(),
  purpose:text('purpose').notNull(),
  expiresAt:integer('expires_at').notNull(),
  createdAt:integer('created_at').notNull(),
});
export const passwordSessions=sqliteTable('password_sessions',{
  tokenHash:text('token_hash').primaryKey(),
  userId:text('user_id').notNull(),
  expiresAt:integer('expires_at').notNull(),
});
export const authRateLimits=sqliteTable('auth_rate_limits',{
  bucket:text('bucket').primaryKey(),
  windowStartedAt:integer('window_started_at').notNull(),
  attempts:integer('attempts').notNull(),
});
