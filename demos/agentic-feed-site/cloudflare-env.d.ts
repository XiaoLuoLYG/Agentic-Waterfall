declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    DATASET_ARCHIVE?: R2Bucket;
  }
}
