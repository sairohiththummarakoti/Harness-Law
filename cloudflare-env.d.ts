declare namespace Cloudflare {
  interface Env {
    HARNESS_GOOGLE_CLIENT_ID?: string;
    HARNESS_MAIL_MODE?: string;
    HARNESS_TURNSTILE_SITE_KEY?: string;
    HARNESS_TURNSTILE_SECRET_KEY?: string;
    HARNESS_TERMS_VERSION?: string;
    HARNESS_PRIVACY_VERSION?: string;
    HARNESS_MAIL_FROM?: string;
    HARNESS_MAIL_API_URL?: string;
    HARNESS_MAIL_API_KEY?: string;
    HARNESS_MAIL_PROVIDER?: string;
    FIREBASE_API_KEY?: string;
    FIREBASE_PROJECT_ID?: string;
    HARNESS_FIREBASE_API_KEY?: string;
    HARNESS_FIREBASE_PROJECT_ID?: string;
    EMAIL?: { send(message: { from: string; to: string; subject: string; text: string }): Promise<unknown> };
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
