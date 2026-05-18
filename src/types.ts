export type UploadSessionStatus = "uploading" | "completed" | "aborted" | "failed";

export interface UploadedPart {
  etag: string;
  partNumber: number;
  size?: number;
}

export interface UploadSession {
  id: string;
  userId: string;
  bucketName: string;
  objectKey: string;
  uploadId: string;
  fileName: string;
  mimeType: string | null;
  sizeBytes: number;
  fileLastModified: number | null;
  chunkSizeBytes: number;
  totalParts: number;
  status: UploadSessionStatus;
  completedAt: string | null;
  lastPartsSyncAt: string | null;
  metadata: Record<string, unknown>;
}

export interface CreateUploadSessionInput {
  userId: string;
  bucketName: string;
  objectKey: string;
  uploadId: string;
  fileName: string;
  mimeType?: string | null;
  sizeBytes: number;
  fileLastModified?: number | null;
  chunkSizeBytes: number;
  totalParts: number;
  metadata?: Record<string, unknown>;
}

export interface UploadSessionStore {
  create(input: CreateUploadSessionInput): Promise<UploadSession>;
  getForUser(sessionId: string, userId: string): Promise<UploadSession | null>;
  markCompleted(sessionId: string, userId: string): Promise<void>;
  markFailed(sessionId: string, userId: string, reason: string): Promise<void>;
  markAborted?(sessionId: string, userId: string, reason?: string): Promise<void>;
  touchPartsSync(sessionId: string, userId: string): Promise<void>;
}

export interface UploadPolicy {
  maxSizeBytes?: number;
  allowedMimeTypes?: string[];
  keyPrefix?: string;
}

export interface MultipartUploadConfig {
  bucketName: string;
  defaultChunkSizeBytes?: number;
  uploadPolicy?: UploadPolicy;
}

export interface CreateMultipartUploadRequest {
  userId: string;
  fileName: string;
  mimeType?: string | null;
  sizeBytes: number;
  fileLastModified?: number | null;
  chunkSizeBytes?: number;
  totalParts?: number;
  objectKey?: string;
  metadata?: Record<string, unknown>;
}

export interface CreateMultipartUploadResponse {
  sessionId: string;
  uploadId: string;
  objectKey: string;
  bucketName: string;
  chunkSizeBytes: number;
  totalParts: number;
}

export interface ResumeMultipartUploadResponse {
  sessionId: string;
  status: UploadSessionStatus;
  uploadId: string;
  objectKey: string;
  bucketName: string;
  uploadedPartNumbers: number[];
  uploadedSizeBytes: number;
  chunkSizeBytes: number;
  totalParts: number;
}
