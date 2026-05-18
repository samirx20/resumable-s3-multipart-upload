import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  ListPartsCommand,
  S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { UploadedPart } from "../types";

export interface S3CompatibleClientOptions {
  region: string;
  endpoint?: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle?: boolean;
}

export function createS3CompatibleClient(options: S3CompatibleClientOptions) {
  return new S3Client({
    region: options.region,
    endpoint: options.endpoint || undefined,
    forcePathStyle: options.forcePathStyle ?? false,
    credentials: {
      accessKeyId: options.accessKeyId,
      secretAccessKey: options.secretAccessKey,
    },
  });
}

export async function createStorageMultipartUpload(input: {
  s3: S3Client;
  bucketName: string;
  objectKey: string;
  mimeType?: string | null;
}) {
  const response = await input.s3.send(
    new CreateMultipartUploadCommand({
      Bucket: input.bucketName,
      Key: input.objectKey,
      ContentType: input.mimeType ?? undefined,
    }),
  );

  if (!response.UploadId) {
    throw new Error("Storage provider did not return an upload id.");
  }

  return response.UploadId;
}

export async function listAllUploadedParts(input: {
  s3: S3Client;
  bucketName: string;
  objectKey: string;
  uploadId: string;
}): Promise<UploadedPart[]> {
  const parts: UploadedPart[] = [];
  let partNumberMarker: string | undefined;

  while (true) {
    const response = await input.s3.send(
      new ListPartsCommand({
        Bucket: input.bucketName,
        Key: input.objectKey,
        UploadId: input.uploadId,
        PartNumberMarker: partNumberMarker,
      }),
    );

    for (const part of response.Parts ?? []) {
      if (part.ETag && typeof part.PartNumber === "number") {
        parts.push({
          etag: part.ETag,
          partNumber: part.PartNumber,
          size: part.Size,
        });
      }
    }

    if (!response.IsTruncated || !response.NextPartNumberMarker) {
      break;
    }

    partNumberMarker = response.NextPartNumberMarker;
  }

  return parts;
}

export async function signUploadPart(input: {
  s3: S3Client;
  bucketName: string;
  objectKey: string;
  uploadId: string;
  partNumber: number;
  expiresInSeconds?: number;
}) {
  return getSignedUrl(
    input.s3,
    new UploadPartCommand({
      Bucket: input.bucketName,
      Key: input.objectKey,
      UploadId: input.uploadId,
      PartNumber: input.partNumber,
    }),
    { expiresIn: input.expiresInSeconds ?? 3600 },
  );
}

export async function completeStorageMultipartUpload(input: {
  s3: S3Client;
  bucketName: string;
  objectKey: string;
  uploadId: string;
}) {
  const parts = await listAllUploadedParts(input);

  if (parts.length === 0) {
    throw new Error("No uploaded parts found to complete.");
  }

  await input.s3.send(
    new CompleteMultipartUploadCommand({
      Bucket: input.bucketName,
      Key: input.objectKey,
      UploadId: input.uploadId,
      MultipartUpload: {
        Parts: parts
          .sort((a, b) => a.partNumber - b.partNumber)
          .map((part) => ({
            ETag: part.etag,
            PartNumber: part.partNumber,
          })),
      },
    }),
  );
}

export async function abortStorageMultipartUpload(input: {
  s3: S3Client;
  bucketName: string;
  objectKey: string;
  uploadId: string;
}) {
  await input.s3.send(
    new AbortMultipartUploadCommand({
      Bucket: input.bucketName,
      Key: input.objectKey,
      UploadId: input.uploadId,
    }),
  );
}
