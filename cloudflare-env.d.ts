declare namespace Cloudflare {
  interface Env {
    HARNESS_GOOGLE_CLIENT_ID?: string;
    DB?: D1Database;
    BUCKET?: R2Bucket;
  }
}
