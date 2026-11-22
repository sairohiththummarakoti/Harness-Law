import { z } from 'zod';
import { CRITERION_IDS, type CaseRule, type FormTemplate, type ModuleConfig } from './contracts.ts';
import type { ProviderConfig, S3Config } from './provider-contracts';

const nonempty = z.string().trim().min(1).max(1000);
const identifier = nonempty.max(200).regex(/^[A-Za-z0-9][A-Za-z0-9_.:/-]*$/);
const opaque = z.string().min(1).max(100).regex(/^[A-Za-z0-9_-]+$/);
const secret = z.string().min(1).max(16384).refine(value => value.trim() === value && !/[\r\n\x00]/.test(value));
const httpsUrl = z.string().url().max(2048).refine(value => {
  const url = new URL(value);
  return url.protocol === 'https:' && !url.username && !url.password && !url.hash;
});
const uniqueStrings = z.array(identifier).max(100).refine(values => new Set(values).size === values.length);
const authorities = z.array(nonempty.max(200)).min(1).max(100).refine(values => new Set(values).size === values.length);
const caseRuleSchema = z.object({ version: identifier, approval: nonempty.max(200), authority_refs: authorities }).strict();
const moduleSchema = z.object({
  criterion_id: z.enum(CRITERION_IDS),
  module_version: identifier,
  rule_pack_version: identifier,
  prompt_version: identifier,
  output_schema_version: z.literal('1'),
  evaluation_version: identifier,
  model: identifier,
  active: z.boolean(),
  activation_approval: nonempty.max(200),
  instructions: z.string().trim().min(1).max(20000),
  required_fact_keys: uniqueStrings,
  required_element_ids: z.array(opaque).min(1).max(100).refine(values => new Set(values).size === values.length),
  authority_refs: authorities,
}).strict();
const formFieldSchema = z.object({
  field_id: identifier,
  fact_key: identifier,
  required: z.boolean(),
  max_length: z.number().int().min(1).max(100000),
  format: z.enum(['date', 'text']).optional(),
}).strict();
const formSchema = z.object({
  template_id: opaque,
  version: identifier,
  edition: nonempty,
  source_url: httpsUrl,
  retrieved_at: z.string().datetime({ offset: true }),
  sha256: z.string().regex(/^[a-fA-F0-9]{64}$/).transform(value => value.toLowerCase()),
  approval: nonempty,
  active: z.boolean(),
  fields: z.array(formFieldSchema).min(1).max(1000).refine(fields => new Set(fields.map(field => field.field_id)).size === fields.length),
}).strict();
const moduleRegistrySchema = z.array(moduleSchema).max(10).refine(modules => new Set(modules.map(module => module.criterion_id)).size === modules.length);
const formRegistrySchema = z.array(formSchema).max(100).superRefine((forms, context) => {
  const versions = new Set<string>();
  const active = new Set<string>();
  for (const form of forms) {
    const version = JSON.stringify([form.template_id, form.version]);
    if (versions.has(version) || (form.active && active.has(form.template_id))) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Duplicate form configuration.' });
    }
    versions.add(version);
    if (form.active) active.add(form.template_id);
  }
});
const serviceSchema = z.object({ url: httpsUrl.refine(value => !new URL(value).search), token: secret }).strict();
const modelSchema = z.object({ apiKey: secret, model: identifier }).strict();
const s3Schema = z.object({
  bucket: z.string().min(3).max(63).regex(/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/)
    .refine(value => !value.includes('..') && !/^\d+\.\d+\.\d+\.\d+$/.test(value)),
  region: z.string().regex(/^[a-z]{2}(?:-[a-z0-9]+)+-\d+$/),
  accessKeyId: secret,
  secretAccessKey: secret,
  sessionToken: secret.optional(),
  requireVersionId: z.literal(true),
}).strict();

export class IntegrationConfigError extends Error {
  readonly code = 'integration_config_invalid';
  readonly setting: string;
  constructor(setting: string) {
    super(`Integration configuration ${setting} is invalid.`);
    this.name = 'IntegrationConfigError';
    this.setting = setting;
  }
}

export interface IntegrationConfig {
  modules: ModuleConfig[];
  formTemplates: FormTemplate[];
  providers: ProviderConfig;
  s3?: S3Config;
  caseRule?: CaseRule;
}

function setting(env: Record<string, unknown>, name: string): string | undefined {
  const value = env[name];
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') throw new IntegrationConfigError(name);
  return value;
}

function parse<T>(schema: z.ZodType<T>, value: unknown, name: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new IntegrationConfigError(name);
  return parsed.data;
}

function registry<T>(env: Record<string, unknown>, name: string, schema: z.ZodType<T>, empty: T): T {
  const source = setting(env, name);
  if (source === undefined) return empty;
  let value: unknown;
  try { value = JSON.parse(source); } catch { throw new IntegrationConfigError(name); }
  return parse(schema, value, name);
}

/** Parse only explicitly injected bindings. This module never reads process.env. */
export function loadIntegrationConfig(env: Record<string, unknown>): IntegrationConfig {
  const modules = registry(env, 'HARNESS_MODULE_REGISTRY', moduleRegistrySchema, []);
  const formTemplates = registry(env, 'HARNESS_FORM_REGISTRY', formRegistrySchema, []);
  const caseRule = registry(env, 'HARNESS_CASE_RULE_REGISTRY', caseRuleSchema.optional(), undefined);
  const providers: ProviderConfig = {};
  for (const [name, key] of [['SCANNER', 'scanner'], ['EXTRACTOR', 'extractor'], ['RENDERER', 'renderer']] as const) {
    const url = setting(env, `HARNESS_${name}_URL`);
    const token = setting(env, `HARNESS_${name}_TOKEN`);
    if (url !== undefined || token !== undefined) providers[key] = parse(serviceSchema, { url, token }, `HARNESS_${name}`);
  }
  const apiKey = setting(env, 'OPENAI_API_KEY');
  const model = setting(env, 'HARNESS_MODEL');
  if (apiKey !== undefined || model !== undefined) providers.model = parse(modelSchema, { apiKey, model }, 'OPENAI_API_KEY/HARNESS_MODEL');

  const s3Values = {
    bucket: setting(env, 'HARNESS_S3_BUCKET'),
    region: setting(env, 'HARNESS_S3_REGION'),
    accessKeyId: setting(env, 'HARNESS_S3_ACCESS_KEY_ID'),
    secretAccessKey: setting(env, 'HARNESS_S3_SECRET_ACCESS_KEY'),
    sessionToken: setting(env, 'HARNESS_S3_SESSION_TOKEN'),
  };
  const s3 = Object.values(s3Values).some(value => value !== undefined)
    ? parse(s3Schema, { ...s3Values, requireVersionId: true }, 'HARNESS_S3')
    : undefined;
  return { modules, formTemplates, providers, ...(s3 ? { s3 } : {}), ...(caseRule ? { caseRule } : {}) };
}
