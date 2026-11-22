/**
 * OpenAI strict Structured Outputs schema for a proposed ResultCandidate.
 * Nullable fields are required on the wire; the provider normalizes nulls to
 * absent optional fields before the domain validates provenance and scope.
 */
const text = { type: 'string' };
const nullableText = { type: ['string', 'null'] };
function object(properties: Record<string, unknown>) {
  return { type: 'object', additionalProperties: false, properties, required: Object.keys(properties) };
}
const locator = object({
  page_index: { type: 'integer', minimum: 1 },
  page_label: nullableText,
  block_id: text,
  bbox: {
    anyOf: [
      { type: 'array', items: { type: 'number', minimum: 0, maximum: 1 }, minItems: 4, maxItems: 4 },
      { type: 'null' },
    ],
  },
});
const citation = object({
  document_version_id: text,
  source_artifact_id: text,
  rendition_version_id: nullableText,
  extraction_run_id: text,
  locator,
  excerpt: text,
});

export const MODEL_OUTPUT_SCHEMA: Record<string, unknown> = object({
  section_title: text,
  claims: {
    type: 'array',
    items: object({
      text,
      event_id: text,
      citations: { type: 'array', items: citation },
    }),
  },
  element_assessments: {
    type: 'array',
    items: object({
      element_id: text,
      status: { type: 'string', enum: ['supported', 'needs_review', 'evidence_missing', 'conflicting'] },
      authority_refs: { type: 'array', items: text },
      explanation: text,
    }),
  },
  missing_evidence_tasks: {
    type: 'array', items: object({ task_id: text, description: text }),
  },
  contradictions: {
    type: 'array',
    items: object({ description: text, document_version_ids: { type: 'array', items: text } }),
  },
});
