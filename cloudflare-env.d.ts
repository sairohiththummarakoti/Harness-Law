declare namespace Cloudflare {
  interface Env {
    HARNESS_GOOGLE_CLIENT_ID?: string;
    DB?: D1Database;
    BUCKET?: R2Bucket;
    HARNESS_WORKER_SECRET?: string;
    HARNESS_MODULE_REGISTRY?: string;
    HARNESS_CASE_RULE_REGISTRY?: string;
    HARNESS_FORM_REGISTRY?: string;
    HARNESS_S3_BUCKET?: string;
    HARNESS_S3_REGION?: string;
    HARNESS_S3_ACCESS_KEY_ID?: string;
    HARNESS_S3_SECRET_ACCESS_KEY?: string;
    HARNESS_S3_SESSION_TOKEN?: string;
    HARNESS_SCANNER_URL?: string;
    HARNESS_SCANNER_TOKEN?: string;
    HARNESS_EXTRACTOR_URL?: string;
    HARNESS_EXTRACTOR_TOKEN?: string;
    HARNESS_RENDERER_URL?: string;
    HARNESS_RENDERER_TOKEN?: string;
    OPENAI_API_KEY?: string;
    HARNESS_MODEL?: string;
  }
}
