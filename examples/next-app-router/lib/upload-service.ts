import { createClient } from "@supabase/supabase-js";
import {
  createMultipartUploadService,
  createS3CompatibleClient,
} from "../../../src";
import { createSupabaseUploadSessionStore } from "../../../src/supabase";

function readBoolean(value: string | undefined, fallback: boolean) {
  if (value === undefined) return fallback;
  return value === "true";
}

export function createUploadService() {
  const s3 = createS3CompatibleClient({
    region: process.env.S3_REGION ?? "auto",
    endpoint: process.env.S3_ENDPOINT || undefined,
    accessKeyId: process.env.S3_ACCESS_KEY_ID!,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
    forcePathStyle: readBoolean(process.env.S3_FORCE_PATH_STYLE, true),
  });

  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    },
  );

  return createMultipartUploadService({
    s3,
    sessionStore: createSupabaseUploadSessionStore(supabase),
    config: {
      bucketName: process.env.S3_BUCKET_NAME!,
      defaultChunkSizeBytes: 10 * 1024 * 1024,
      uploadPolicy: {
        maxSizeBytes: 10 * 1024 * 1024 * 1024,
        allowedMimeTypes: [
          "video/mp4",
          "video/quicktime",
          "video/webm",
          "application/octet-stream",
        ],
        keyPrefix: "uploads",
      },
    },
  });
}
