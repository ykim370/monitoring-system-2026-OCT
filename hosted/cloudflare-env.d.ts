declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    DATA_ENCRYPTION_KEY?: string;
    ALPHA_VANTAGE_API_KEY?: string;
    BUCKET?: R2Bucket;
  }
}
