import test from 'node:test';
import assert from 'node:assert/strict';
import { IntegrationConfigError, loadIntegrationConfig } from '../lib/integrations/config.ts';
import { MODEL_OUTPUT_SCHEMA } from '../lib/integrations/model-schema.ts';

const moduleFixture = {
  criterion_id: 'C04', module_version: '1', rule_pack_version: '1', prompt_version: '1',
  output_schema_version: '1', evaluation_version: '1', model: 'configured-model', active: true,
  activation_approval: 'review-1', instructions: 'Use only supplied evidence.', required_fact_keys: ['name'], required_element_ids: ['element-1'],
  authority_refs: ['reviewed-authority-1'],
};
const formFixture = {
  template_id: 'form-1', version: '1', edition: '2026-11-01', source_url: 'https://example.test/form.pdf',
  retrieved_at: '2026-11-22T10:00:00Z', sha256: 'A'.repeat(64), approval: 'review-2', active: true,
  fields: [{ field_id: 'full-name', fact_key: 'name', required: true, max_length: 100, format: 'text' }],
};
const s3Fixture = {
  HARNESS_S3_BUCKET: 'synthetic-evidence', HARNESS_S3_REGION: 'us-east-1',
  HARNESS_S3_ACCESS_KEY_ID: 'synthetic-access', HARNESS_S3_SECRET_ACCESS_KEY: 'synthetic-secret',
};

test('missing integration configuration leaves adapters and registries disabled', () => {
  assert.deepEqual(loadIntegrationConfig({}), { modules: [], formTemplates: [], providers: {} });
  assert.deepEqual(loadIntegrationConfig({ HARNESS_MODULE_REGISTRY: '', HARNESS_SCANNER_URL: undefined }),
    { modules: [], formTemplates: [], providers: {} });
});

test('valid explicit configuration loads approved registries and provider settings', () => {
  const loaded = loadIntegrationConfig({
    ...s3Fixture, HARNESS_S3_SESSION_TOKEN: 'synthetic-session',
    HARNESS_MODULE_REGISTRY: JSON.stringify([moduleFixture]), HARNESS_FORM_REGISTRY: JSON.stringify([formFixture]),
    HARNESS_SCANNER_URL: 'https://scan.example.test/v1/scan', HARNESS_SCANNER_TOKEN: 'synthetic-scan',
    HARNESS_EXTRACTOR_URL: 'https://extract.example.test/v1/extract', HARNESS_EXTRACTOR_TOKEN: 'synthetic-extract',
    HARNESS_RENDERER_URL: 'https://render.example.test/v1/render', HARNESS_RENDERER_TOKEN: 'synthetic-render',
    OPENAI_API_KEY: 'synthetic-model-key', HARNESS_MODEL: 'configured-model',
  });
  assert.deepEqual(loaded.modules, [moduleFixture]);
  assert.equal(loaded.formTemplates[0].sha256, 'a'.repeat(64));
  assert.equal(loaded.providers.model?.model, 'configured-model');
  assert.equal(loaded.providers.renderer?.token, 'synthetic-render');
  assert.equal(loaded.s3?.requireVersionId, true);
  assert.equal(loaded.s3?.sessionToken, 'synthetic-session');
});

test('module registries reject unknown fields, unapproved versions and duplicate criteria', () => {
  for (const modules of [
    [moduleFixture, { ...moduleFixture, module_version: '2' }],
    [{ ...moduleFixture, activation_approval: ' ' }],
    [{ ...moduleFixture, extra: true }],
    [{ ...moduleFixture, authority_refs: [] }],
    [{ ...moduleFixture, criterion_id: 'C11' }],
    [{ ...moduleFixture, required_fact_keys: ['name', 'name'] }],
    [{ ...moduleFixture, required_element_ids: [] }],
    [{ ...moduleFixture, required_element_ids: ['duplicate', 'duplicate'] }],
    [{ ...moduleFixture, required_element_ids: ['element:invalid'] }],
    [{ ...moduleFixture, required_element_ids: ['x'.repeat(101)] }],
    [{ ...moduleFixture, output_schema_version: '2' }],
    [{ ...moduleFixture, instructions: 'a'.repeat(20001) }],
  ]) assert.throws(() => loadIntegrationConfig({ HARNESS_MODULE_REGISTRY: JSON.stringify(modules) }), IntegrationConfigError);
});

test('case-wide rules require approved versioned authority configuration', () => {
  const rule = { version: 'case-rules-1', approval: 'review-123', authority_refs: ['case-authority-1'] };
  assert.deepEqual(loadIntegrationConfig({ HARNESS_CASE_RULE_REGISTRY: JSON.stringify(rule) }).caseRule, rule);
  assert.equal(loadIntegrationConfig({}).caseRule, undefined);
  for (const invalid of [[rule], { ...rule, approval: '' }, { ...rule, authority_refs: [] }, { ...rule, version: '' }, { ...rule, invented: true }, { ...rule, authority_refs: ['duplicate', 'duplicate'] }]) {
    assert.throws(() => loadIntegrationConfig({ HARNESS_CASE_RULE_REGISTRY: JSON.stringify(invalid) }), IntegrationConfigError);
  }
});

test('form registries reject malformed dates, hashes, URLs, duplicate fields and active editions', () => {
  for (const forms of [
    [{ ...formFixture, retrieved_at: 'not-a-date' }],
    [{ ...formFixture, retrieved_at: '2026-02-30T10:00:00Z' }],
    [{ ...formFixture, sha256: 'bad-hash' }],
    [{ ...formFixture, source_url: 'http://example.test/form.pdf' }],
    [{ ...formFixture, source_url: 'https://secret@example.test/form.pdf' }],
    [{ ...formFixture, fields: [formFixture.fields[0], formFixture.fields[0]] }],
    [formFixture, { ...formFixture, version: '2' }],
    [{ ...formFixture, approval: '' }],
    [{ ...formFixture, template_id: 'form/invalid' }],
    [{ ...formFixture, template_id: 'x'.repeat(101) }],
  ]) assert.throws(() => loadIntegrationConfig({ HARNESS_FORM_REGISTRY: JSON.stringify(forms) }), IntegrationConfigError);
  const registry = [formFixture, { ...formFixture, version: 'old', active: false }];
  assert.equal(loadIntegrationConfig({ HARNESS_FORM_REGISTRY: JSON.stringify(registry) }).formTemplates.length, 2);
});

test('partially configured adapters fail closed instead of silently using defaults', () => {
  for (const env of [
    { HARNESS_SCANNER_URL: 'https://scanner.example.test' },
    { HARNESS_RENDERER_TOKEN: 'synthetic-secret' },
    { HARNESS_EXTRACTOR_URL: 'http://extract.example.test', HARNESS_EXTRACTOR_TOKEN: 'synthetic-secret' },
    { HARNESS_SCANNER_URL: 'https://scan.example.test/?secret=bad', HARNESS_SCANNER_TOKEN: 'synthetic-secret' },
    { OPENAI_API_KEY: 'synthetic-secret' },
    { HARNESS_MODEL: 'configured-model' },
    { HARNESS_S3_BUCKET: 'synthetic-bucket' },
    { HARNESS_S3_SESSION_TOKEN: 'synthetic-session' },
    { ...s3Fixture, HARNESS_S3_BUCKET: '../unsafe' },
    { ...s3Fixture, HARNESS_S3_REGION: 'https://example.test' },
    { HARNESS_MODULE_REGISTRY: [] },
  ]) assert.throws(() => loadIntegrationConfig(env), IntegrationConfigError);
});

test('configuration errors expose setting names without rejected secret values', () => {
  const secret = 'never-echo-this\nsecret';
  try {
    loadIntegrationConfig({ HARNESS_SCANNER_URL: 'https://scan.example.test', HARNESS_SCANNER_TOKEN: secret });
    assert.fail('Expected invalid configuration');
  } catch (error) {
    assert.ok(error instanceof IntegrationConfigError);
    assert.equal(error.code, 'integration_config_invalid');
    assert.equal(error.setting, 'HARNESS_SCANNER');
    assert.equal(String(error).includes('never-echo-this'), false);
  }
  assert.throws(() => loadIntegrationConfig({ HARNESS_FORM_REGISTRY: '{"private":"never-echo-this"' }),
    (error: unknown) => error instanceof IntegrationConfigError && !error.message.includes('never-echo-this'));
});

test('model wire schema is strict throughout and makes optional locators nullable', () => {
  type Schema = Record<string, unknown>;
  function visit(schema: Schema) {
    if (schema.type === 'object') {
      assert.equal(schema.additionalProperties, false);
      const properties = schema.properties as Record<string, Schema>;
      assert.deepEqual(schema.required, Object.keys(properties));
      Object.values(properties).forEach(visit);
    }
    if (schema.items) visit(schema.items as Schema);
    if (Array.isArray(schema.anyOf)) schema.anyOf.forEach(visit);
  }
  visit(MODEL_OUTPUT_SCHEMA);
  const properties = MODEL_OUTPUT_SCHEMA.properties as Record<string, Schema>;
  const claims = (properties.claims.items as Schema).properties as Record<string, Schema>;
  const citation = (claims.citations.items as Schema).properties as Record<string, Schema>;
  assert.deepEqual(citation.rendition_version_id.type, ['string', 'null']);
  const locator = citation.locator.properties as Record<string, Schema>;
  assert.deepEqual(locator.page_label.type, ['string', 'null']);
  assert.deepEqual((locator.bbox.anyOf as Schema[])[1], { type: 'null' });
  assert.equal((locator.bbox.anyOf as Schema[])[0].minItems, 4);
});
