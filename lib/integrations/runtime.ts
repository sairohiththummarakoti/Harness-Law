import { loadIntegrationConfig } from './config.ts';
import { D1CaseRepository } from './repository.ts';
import { createR2Store, createS3Store } from './providers.ts';
import { processDueJobs, processJob, type ProcessorDependencies } from './processor.ts';
import type { ApiDependencies } from './http.ts';
import { ApiError } from './transactions.ts';

export function integrationRuntime(env: Cloudflare.Env, actorId?: string): ApiDependencies {
  if (!env.DB) throw new ApiError(503, 'database_unavailable', 'Case storage is not configured.');
  const config = loadIntegrationConfig(env as unknown as Record<string, unknown>);
  const repository = new D1CaseRepository(env.DB);
  const store = config.s3 ? createS3Store(config.s3) : env.BUCKET ? createR2Store(env.BUCKET) : undefined;
  const processor: ProcessorDependencies = { repository, store, providers: config.providers, context: { modules: config.modules, formTemplates: config.formTemplates, caseRule: config.caseRule } };
  return { repository, store, actorId, modules: config.modules, formTemplates: config.formTemplates, caseRule: config.caseRule, workerSecret: env.HARNESS_WORKER_SECRET, executeJob: (caseId, jobId) => processJob(caseId, jobId, processor) };
}

export async function scheduledIntegrationJobs(env: Cloudflare.Env) {
  if (!env.DB) return;
  const config = loadIntegrationConfig(env as unknown as Record<string, unknown>);
  const repository = new D1CaseRepository(env.DB), store = config.s3 ? createS3Store(config.s3) : env.BUCKET ? createR2Store(env.BUCKET) : undefined;
  return processDueJobs({ repository, store, providers: config.providers, context: { modules: config.modules, formTemplates: config.formTemplates, caseRule: config.caseRule } });
}
