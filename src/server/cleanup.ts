import type { S3Client } from "@aws-sdk/client-s3";
import type { UploadSession, UploadSessionStore } from "../types";
import { abortStorageMultipartUpload } from "./s3";

export interface CleanupResult {
  scanned: number;
  aborted: number;
  failed: number;
  errors: Array<{
    sessionId: string;
    message: string;
  }>;
}

export interface CleanupAbandonedUploadsInput {
  s3: S3Client;
  sessionStore: UploadSessionStore;
  sessions: UploadSession[];
  reason?: string;
}

export async function cleanupAbandonedMultipartUploads(
  input: CleanupAbandonedUploadsInput,
): Promise<CleanupResult> {
  const result: CleanupResult = {
    scanned: input.sessions.length,
    aborted: 0,
    failed: 0,
    errors: [],
  };

  for (const session of input.sessions) {
    if (session.status !== "uploading") {
      continue;
    }

    try {
      await abortStorageMultipartUpload({
        s3: input.s3,
        bucketName: session.bucketName,
        objectKey: session.objectKey,
        uploadId: session.uploadId,
      });

      if (input.sessionStore.markAborted) {
        await input.sessionStore.markAborted(
          session.id,
          session.userId,
          input.reason ?? "Abandoned multipart upload cleanup.",
        );
      } else {
        await input.sessionStore.markFailed(
          session.id,
          session.userId,
          input.reason ?? "Abandoned multipart upload aborted.",
        );
      }

      result.aborted += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown cleanup error.";
      result.failed += 1;
      result.errors.push({
        sessionId: session.id,
        message,
      });
    }
  }

  return result;
}
