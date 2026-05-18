import { randomUUID } from "node:crypto";
import type { S3Client } from "@aws-sdk/client-s3";
import type {
  CreateMultipartUploadRequest,
  CreateMultipartUploadResponse,
  MultipartUploadConfig,
  ResumeMultipartUploadResponse,
  UploadSessionStore,
} from "../types";
import {
  completeStorageMultipartUpload,
  createStorageMultipartUpload,
  listAllUploadedParts,
  signUploadPart,
} from "./s3";

const MIN_PART_SIZE_BYTES = 5 * 1024 * 1024;
const DEFAULT_CHUNK_SIZE_BYTES = 10 * 1024 * 1024;

export class MultipartUploadError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
    this.name = "MultipartUploadError";
  }
}

export function getSafePartConfig(input: {
  sizeBytes: number;
  chunkSizeBytes?: number;
  totalParts?: number;
  defaultChunkSizeBytes?: number;
}) {
  const fallback = input.defaultChunkSizeBytes ?? DEFAULT_CHUNK_SIZE_BYTES;
  const chunkSizeBytes =
    typeof input.chunkSizeBytes === "number" && input.chunkSizeBytes >= MIN_PART_SIZE_BYTES
      ? input.chunkSizeBytes
      : fallback;
  const totalParts =
    typeof input.totalParts === "number" && input.totalParts > 0
      ? input.totalParts
      : Math.ceil(input.sizeBytes / chunkSizeBytes);

  return { chunkSizeBytes, totalParts };
}

export function validateUploadRequest(
  request: Pick<CreateMultipartUploadRequest, "sizeBytes" | "mimeType">,
  config: MultipartUploadConfig,
) {
  if (!Number.isFinite(request.sizeBytes) || request.sizeBytes <= 0) {
    throw new MultipartUploadError("File size must be a positive number.");
  }

  const maxSizeBytes = config.uploadPolicy?.maxSizeBytes;
  if (maxSizeBytes && request.sizeBytes > maxSizeBytes) {
    throw new MultipartUploadError(`File too large. Maximum size is ${maxSizeBytes} bytes.`);
  }

  const allowedMimeTypes = config.uploadPolicy?.allowedMimeTypes;
  if (
    allowedMimeTypes?.length &&
    request.mimeType &&
    !allowedMimeTypes.includes(request.mimeType)
  ) {
    throw new MultipartUploadError(`File type "${request.mimeType}" is not allowed.`);
  }
}

export function createObjectKey(fileName: string, keyPrefix?: string) {
  const extension = fileName.includes(".") ? fileName.split(".").pop() : null;
  const id = randomUUID();
  const key = extension ? `${id}.${extension}` : id;
  return keyPrefix ? `${keyPrefix.replace(/\/$/, "")}/${key}` : key;
}

export function createMultipartUploadService(input: {
  s3: S3Client;
  sessionStore: UploadSessionStore;
  config: MultipartUploadConfig;
}) {
  const { s3, sessionStore, config } = input;

  return {
    async create(request: CreateMultipartUploadRequest): Promise<CreateMultipartUploadResponse> {
      validateUploadRequest(request, config);

      const objectKey =
        request.objectKey ?? createObjectKey(request.fileName, config.uploadPolicy?.keyPrefix);
      const { chunkSizeBytes, totalParts } = getSafePartConfig({
        sizeBytes: request.sizeBytes,
        chunkSizeBytes: request.chunkSizeBytes,
        totalParts: request.totalParts,
        defaultChunkSizeBytes: config.defaultChunkSizeBytes,
      });

      const uploadId = await createStorageMultipartUpload({
        s3,
        bucketName: config.bucketName,
        objectKey,
        mimeType: request.mimeType,
      });

      const session = await sessionStore.create({
        userId: request.userId,
        bucketName: config.bucketName,
        objectKey,
        uploadId,
        fileName: request.fileName,
        mimeType: request.mimeType,
        sizeBytes: request.sizeBytes,
        fileLastModified: request.fileLastModified,
        chunkSizeBytes,
        totalParts,
        metadata: request.metadata,
      });

      return {
        sessionId: session.id,
        uploadId,
        objectKey,
        bucketName: config.bucketName,
        chunkSizeBytes,
        totalParts,
      };
    },

    async status(sessionId: string, userId: string): Promise<ResumeMultipartUploadResponse> {
      const session = await sessionStore.getForUser(sessionId, userId);
      if (!session) {
        throw new MultipartUploadError("Upload session not found.", 404);
      }

      if (session.status === "completed") {
        return {
          sessionId: session.id,
          status: session.status,
          uploadId: session.uploadId,
          objectKey: session.objectKey,
          bucketName: session.bucketName,
          uploadedPartNumbers: [],
          uploadedSizeBytes: session.sizeBytes,
          chunkSizeBytes: session.chunkSizeBytes,
          totalParts: session.totalParts,
        };
      }

      try {
        const parts = await listAllUploadedParts({
          s3,
          bucketName: session.bucketName,
          objectKey: session.objectKey,
          uploadId: session.uploadId,
        });

        await sessionStore.touchPartsSync(session.id, userId);

        return {
          sessionId: session.id,
          status: session.status,
          uploadId: session.uploadId,
          objectKey: session.objectKey,
          bucketName: session.bucketName,
          uploadedPartNumbers: parts.map((part) => part.partNumber),
          uploadedSizeBytes: parts.reduce((sum, part) => sum + (part.size ?? 0), 0),
          chunkSizeBytes: session.chunkSizeBytes,
          totalParts: session.totalParts,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to read upload status.";
        if (/NoSuchUpload|specified upload does not exist|404/i.test(message)) {
          await sessionStore.markFailed(session.id, userId, "Multipart upload no longer exists.");
          throw new MultipartUploadError("Stored multipart upload could not be resumed.", 409);
        }

        throw error;
      }
    },

    async signPart(input: {
      userId: string;
      sessionId: string;
      partNumber: number;
      expiresInSeconds?: number;
    }) {
      const session = await sessionStore.getForUser(input.sessionId, input.userId);
      if (!session) {
        throw new MultipartUploadError("Upload session not found.", 404);
      }

      if (input.partNumber < 1 || input.partNumber > session.totalParts) {
        throw new MultipartUploadError("Invalid part number.");
      }

      return signUploadPart({
        s3,
        bucketName: session.bucketName,
        objectKey: session.objectKey,
        uploadId: session.uploadId,
        partNumber: input.partNumber,
        expiresInSeconds: input.expiresInSeconds,
      });
    },

    async complete(input: { userId: string; sessionId: string }) {
      const session = await sessionStore.getForUser(input.sessionId, input.userId);
      if (!session) {
        throw new MultipartUploadError("Upload session not found.", 404);
      }

      await completeStorageMultipartUpload({
        s3,
        bucketName: session.bucketName,
        objectKey: session.objectKey,
        uploadId: session.uploadId,
      });
      await sessionStore.markCompleted(session.id, input.userId);

      return {
        objectKey: session.objectKey,
        bucketName: session.bucketName,
      };
    },
  };
}
