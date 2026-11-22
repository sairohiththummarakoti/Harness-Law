import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

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
