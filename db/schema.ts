import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const cases=sqliteTable('cases',{
  ownerId:text('owner_id').primaryKey(),
  caseId:text('case_id').notNull(),
  revision:integer('revision').notNull().default(0),
  stateJson:text('state_json').notNull(),
  updatedAt:text('updated_at').notNull(),
});

export const accountIntakeEntries=sqliteTable('account_intake_entries',{
  ownerId:text('owner_id').primaryKey(),
  firstSeenAt:text('first_seen_at').notNull(),
  firstShownAt:text('first_shown_at'),
  flowVersion:integer('flow_version').notNull().default(1),
  coreCompletedAt:text('core_completed_at'),
  evidenceCompletedAt:text('evidence_completed_at'),
});

export const evidenceObjects=sqliteTable('evidence_objects',{
  id:text('id').primaryKey(),
  ownerId:text('owner_id').notNull(),
  caseId:text('case_id').notNull(),
  objectKey:text('object_key').notNull(),
  metadataJson:text('metadata_json').notNull(),
  createdAt:text('created_at').notNull(),
  deletedAt:text('deleted_at'),
});

export const evidenceDeletions=sqliteTable('evidence_deletions',{
  id:text('id').primaryKey(),
  ownerId:text('owner_id').notNull(),
  caseId:text('case_id').notNull(),
  targetKind:text('target_kind').notNull(),
  targetId:text('target_id').notNull(),
  expectedRevision:integer('expected_revision').notNull(),
  objectKeysJson:text('object_keys_json').notNull(),
  deletedFiles:integer('deleted_files').notNull(),
  deletedFolders:integer('deleted_folders').notNull(),
  createdAt:text('created_at').notNull(),
  completedAt:text('completed_at'),
},table=>[index('evidence_deletions_pending').on(table.ownerId,table.completedAt)]);

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

export const adminOwner=sqliteTable('admin_owner',{
  id:text('id').primaryKey(),
  userId:text('user_id').notNull(),
  provider:text('provider').notNull(),
  email:text('email').notNull(),
  displayName:text('display_name').notNull(),
  createdAt:integer('created_at').notNull(),
});

export const adminMembers=sqliteTable('admin_members',{
  userId:text('user_id').primaryKey(),
  provider:text('provider').notNull(),
  email:text('email').notNull(),
  displayName:text('display_name').notNull(),
  createdAt:integer('created_at').notNull(),
  createdBy:text('created_by').notNull(),
});

export const adminAudit=sqliteTable('admin_audit',{
  id:text('id').primaryKey(),
  action:text('action').notNull(),
  actorId:text('actor_id').notNull(),
  actorEmail:text('actor_email').notNull(),
  targetId:text('target_id').notNull(),
  targetEmail:text('target_email').notNull(),
  createdAt:integer('created_at').notNull(),
},table=>[index('admin_audit_created').on(table.createdAt)]);

export const analyticsUsers=sqliteTable('analytics_users',{
  userId:text('user_id').primaryKey(),
  provider:text('provider').notNull(),
  email:text('email').notNull(),
  displayName:text('display_name').notNull(),
  firstSeen:integer('first_seen').notNull(),
  lastSeen:integer('last_seen').notNull(),
  lastCountry:text('last_country'),
  lastRegion:text('last_region'),
  lastCity:text('last_city'),
},table=>[index('analytics_users_last_seen').on(table.lastSeen),index('analytics_users_first_seen').on(table.firstSeen)]);

export const analyticsEvents=sqliteTable('analytics_events',{
  id:text('id').primaryKey(),
  userId:text('user_id'),
  kind:text('kind').notNull(),
  page:text('page').notNull(),
  country:text('country'),
  region:text('region'),
  city:text('city'),
  device:text('device').notNull(),
  browser:text('browser').notNull(),
  referrer:text('referrer').notNull(),
  createdAt:integer('created_at').notNull(),
},table=>[index('analytics_events_created').on(table.createdAt),index('analytics_events_user_created').on(table.userId,table.createdAt),index('analytics_events_kind_created').on(table.kind,table.createdAt)]);

export const analyticsMeta=sqliteTable('analytics_meta',{
  key:text('key').primaryKey(),
  value:text('value').notNull(),
});

export const uscisSourceSnapshots=sqliteTable('uscis_source_snapshots',{
  sourceId:text('source_id').primaryKey(),
  snapshotJson:text('snapshot_json').notNull(),
  checkedAt:integer('checked_at').notNull().default(0),
  leaseUntil:integer('lease_until').notNull().default(0),
});

export const cloudDriveConnections = sqliteTable('cloud_drive_connections', {
  id: text('id').primaryKey(),
  ownerId: text('owner_id').notNull(),
  provider: text('provider').notNull(),
  displayName: text('display_name').notNull().default(''),
  scope: text('scope').notNull().default('whole_drive'),
  rootId: text('root_id').notNull(),
  rootName: text('root_name').notNull(),
  driveId: text('drive_id'),
  accountId: text('account_id').notNull(),
  accountLabel: text('account_label').notNull(),
  tokenCiphertext: text('token_ciphertext').notNull(),
  tokenExpiresAt: integer('token_expires_at').notNull(),
  status: text('status').notNull(),
  caseId: text('case_id'),
  evidenceFolderId: text('evidence_folder_id'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, table => [index('cloud_drive_owner_status').on(table.ownerId, table.status)]);

export const cloudDriveAuthorizations = sqliteTable('cloud_drive_authorizations', {
  stateHash: text('state_hash').primaryKey(),
  ownerId: text('owner_id').notNull(),
  provider: text('provider').notNull(),
  browserHash: text('browser_hash').notNull(),
  verifierCiphertext: text('verifier_ciphertext').notNull(),
  returnTo: text('return_to').notNull(),
  expiresAt: integer('expires_at').notNull(),
}, table => [index('cloud_drive_authorization_expiry').on(table.expiresAt)]);
