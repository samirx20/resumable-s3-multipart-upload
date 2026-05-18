import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  CreateUploadSessionInput,
  UploadSession,
  UploadSessionStore,
} from "../types";

type UploadSessionRow = {
  id: string;
  user_id: string;
  bucket_name: string;
  object_key: string;
  upload_id: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number;
  file_last_modified: number | null;
  chunk_size_bytes: number;
  total_parts: number;
  status: UploadSession["status"];
  completed_at: string | null;
  last_parts_sync_at: string | null;
  metadata: Record<string, unknown> | null;
};

function mapRow(row: UploadSessionRow): UploadSession {
  return {
    id: row.id,
    userId: row.user_id,
    bucketName: row.bucket_name,
    objectKey: row.object_key,
    uploadId: row.upload_id,
    fileName: row.file_name,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    fileLastModified: row.file_last_modified,
    chunkSizeBytes: row.chunk_size_bytes,
    totalParts: row.total_parts,
    status: row.status,
    completedAt: row.completed_at,
    lastPartsSyncAt: row.last_parts_sync_at,
    metadata: row.metadata ?? {},
  };
}

export function createSupabaseUploadSessionStore(
  supabase: SupabaseClient,
  tableName = "upload_sessions",
): UploadSessionStore {
  return {
    async create(input: CreateUploadSessionInput) {
      const { data, error } = await supabase
        .from(tableName)
        .insert({
          user_id: input.userId,
          bucket_name: input.bucketName,
          object_key: input.objectKey,
          upload_id: input.uploadId,
          file_name: input.fileName,
          mime_type: input.mimeType ?? null,
          size_bytes: input.sizeBytes,
          file_last_modified: input.fileLastModified ?? null,
          chunk_size_bytes: input.chunkSizeBytes,
          total_parts: input.totalParts,
          status: "uploading",
          metadata: input.metadata ?? {},
        })
        .select()
        .single();

      if (error || !data) {
        throw error ?? new Error("Failed to create upload session.");
      }

      return mapRow(data as UploadSessionRow);
    },

    async getForUser(sessionId: string, userId: string) {
      const { data, error } = await supabase
        .from(tableName)
        .select("*")
        .eq("id", sessionId)
        .eq("user_id", userId)
        .maybeSingle();

      if (error) {
        throw error;
      }

      return data ? mapRow(data as UploadSessionRow) : null;
    },

    async markCompleted(sessionId: string, userId: string) {
      const { error } = await supabase
        .from(tableName)
        .update({
          status: "completed",
          completed_at: new Date().toISOString(),
          last_parts_sync_at: new Date().toISOString(),
        })
        .eq("id", sessionId)
        .eq("user_id", userId);

      if (error) {
        throw error;
      }
    },

    async markFailed(sessionId: string, userId: string, reason: string) {
      const { data: existing } = await supabase
        .from(tableName)
        .select("metadata")
        .eq("id", sessionId)
        .eq("user_id", userId)
        .maybeSingle();

      const metadata =
        existing?.metadata && typeof existing.metadata === "object"
          ? existing.metadata
          : {};

      const { error } = await supabase
        .from(tableName)
        .update({
          status: "failed",
          metadata: { ...metadata, last_error: reason },
        })
        .eq("id", sessionId)
        .eq("user_id", userId);

      if (error) {
        throw error;
      }
    },

    async markAborted(sessionId: string, userId: string, reason?: string) {
      const { data: existing } = await supabase
        .from(tableName)
        .select("metadata")
        .eq("id", sessionId)
        .eq("user_id", userId)
        .maybeSingle();

      const metadata =
        existing?.metadata && typeof existing.metadata === "object"
          ? existing.metadata
          : {};

      const { error } = await supabase
        .from(tableName)
        .update({
          status: "aborted",
          metadata: reason ? { ...metadata, abort_reason: reason } : metadata,
        })
        .eq("id", sessionId)
        .eq("user_id", userId);

      if (error) {
        throw error;
      }
    },

    async touchPartsSync(sessionId: string, userId: string) {
      const { error } = await supabase
        .from(tableName)
        .update({ last_parts_sync_at: new Date().toISOString() })
        .eq("id", sessionId)
        .eq("user_id", userId);

      if (error) {
        throw error;
      }
    },
  };
}
