import { useState } from "react";

export interface ResumableUploadResult {
  sessionId: string;
  objectKey: string;
  bucketName: string;
}

export interface UseResumableMultipartUploadOptions {
  endpoint?: string;
  chunkSizeBytes?: number;
  concurrency?: number;
  storageKeyPrefix?: string;
  onSuccess?: (result: ResumableUploadResult) => void;
  onError?: (message: string) => void;
}

interface PersistedSession {
  sessionId: string;
  fileName: string;
  fileSize: number;
  fileLastModified: number;
  chunkSizeBytes: number;
}

interface StatusResponse {
  sessionId: string;
  status: "uploading" | "completed" | "aborted" | "failed";
  objectKey: string;
  bucketName: string;
  uploadedPartNumbers: number[];
  uploadedSizeBytes: number;
  chunkSizeBytes: number;
  totalParts: number;
}

const DEFAULT_ENDPOINT = "/api/upload/multipart";
const DEFAULT_CHUNK_SIZE_BYTES = 10 * 1024 * 1024;
const DEFAULT_CONCURRENCY = 6;

function getSessionStorageKey(file: File, prefix: string) {
  return [prefix, file.name, file.size, file.lastModified].join(":");
}

function readPersistedSession(file: File, prefix: string) {
  if (typeof window === "undefined") return null;

  const key = getSessionStorageKey(file, prefix);
  const raw = window.localStorage.getItem(key);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as PersistedSession;
  } catch {
    window.localStorage.removeItem(key);
    return null;
  }
}

function writePersistedSession(file: File, prefix: string, session: PersistedSession) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(getSessionStorageKey(file, prefix), JSON.stringify(session));
}

function clearPersistedSession(file: File, prefix: string) {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(getSessionStorageKey(file, prefix));
}

async function postJson<T>(endpoint: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.error ?? `Request failed with status ${response.status}`);
  }

  return data as T;
}

export function useResumableMultipartUpload(options: UseResumableMultipartUploadOptions = {}) {
  const endpoint = options.endpoint ?? DEFAULT_ENDPOINT;
  const chunkSizeBytes = options.chunkSizeBytes ?? DEFAULT_CHUNK_SIZE_BYTES;
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
  const storageKeyPrefix = options.storageKeyPrefix ?? "resumable-multipart-upload";

  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);

  async function uploadFile(file: File): Promise<ResumableUploadResult | null> {
    setIsUploading(true);
    setError(null);
    setProgress(0);

    const totalParts = Math.ceil(file.size / chunkSizeBytes);
    let activeSessionId: string | null = null;
    let objectKey: string | null = null;
    let bucketName: string | null = null;
    let uploadedParts = new Set<number>();

    try {
      const persisted = readPersistedSession(file, storageKeyPrefix);
      let resumeData: StatusResponse | null = null;

      if (persisted?.sessionId) {
        try {
          resumeData = await postJson<StatusResponse>(endpoint, {
            action: "status",
            sessionId: persisted.sessionId,
          });
        } catch {
          clearPersistedSession(file, storageKeyPrefix);
        }
      }

      if (resumeData?.status === "completed") {
        clearPersistedSession(file, storageKeyPrefix);
        setProgress(100);
        setIsUploading(false);
        const result = {
          sessionId: resumeData.sessionId,
          objectKey: resumeData.objectKey,
          bucketName: resumeData.bucketName,
        };
        options.onSuccess?.(result);
        return result;
      }

      if (resumeData) {
        activeSessionId = resumeData.sessionId;
        objectKey = resumeData.objectKey;
        bucketName = resumeData.bucketName;
        uploadedParts = new Set(resumeData.uploadedPartNumbers);
        setSessionId(activeSessionId);
        setProgress(Math.min(99, Math.round((resumeData.uploadedSizeBytes * 100) / file.size)));
      } else {
        const createData = await postJson<{
          sessionId: string;
          objectKey: string;
          bucketName: string;
        }>(endpoint, {
          action: "create",
          fileName: file.name,
          mimeType: file.type || null,
          sizeBytes: file.size,
          fileLastModified: file.lastModified,
          chunkSizeBytes,
          totalParts,
        });

        activeSessionId = createData.sessionId;
        objectKey = createData.objectKey;
        bucketName = createData.bucketName;
        setSessionId(activeSessionId);

        writePersistedSession(file, storageKeyPrefix, {
          sessionId: activeSessionId,
          fileName: file.name,
          fileSize: file.size,
          fileLastModified: file.lastModified,
          chunkSizeBytes,
        });
      }

      const partProgress = new Array(totalParts).fill(0);
      uploadedParts.forEach((partNumber) => {
        const index = partNumber - 1;
        const start = index * chunkSizeBytes;
        const end = Math.min(start + chunkSizeBytes, file.size);
        partProgress[index] = Math.max(end - start, 0);
      });

      const syncProgress = () => {
        const uploadedBytes = partProgress.reduce((sum, value) => sum + value, 0);
        setProgress(Math.round((uploadedBytes * 100) / file.size));
      };

      const uploadPart = async (index: number) => {
        const partNumber = index + 1;
        if (uploadedParts.has(partNumber)) return;

        const start = index * chunkSizeBytes;
        const end = Math.min(start + chunkSizeBytes, file.size);
        const chunk = file.slice(start, end);

        const { signedUrl } = await postJson<{ signedUrl: string }>(endpoint, {
          action: "signPart",
          sessionId: activeSessionId,
          partNumber,
        });

        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open("PUT", signedUrl, true);

          xhr.upload.onprogress = (event) => {
            if (event.lengthComputable) {
              partProgress[index] = event.loaded;
              syncProgress();
            }
          };

          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              partProgress[index] = chunk.size;
              uploadedParts.add(partNumber);
              syncProgress();
              resolve();
            } else {
              reject(new Error(`Part ${partNumber} failed with status ${xhr.status}.`));
            }
          };

          xhr.onerror = () => reject(new Error(`Network error while uploading part ${partNumber}.`));
          xhr.send(chunk);
        });
      };

      let currentIndex = 0;
      let stopped = false;
      const workers = Array.from({ length: concurrency }, async () => {
        while (currentIndex < totalParts && !stopped) {
          const index = currentIndex;
          currentIndex += 1;

          try {
            await uploadPart(index);
          } catch (uploadError) {
            stopped = true;
            throw uploadError;
          }
        }
      });

      await Promise.all(workers);

      const completeData = await postJson<{ objectKey: string; bucketName: string }>(endpoint, {
        action: "complete",
        sessionId: activeSessionId,
      });

      clearPersistedSession(file, storageKeyPrefix);
      setProgress(100);
      setIsUploading(false);

      const result = {
        sessionId: activeSessionId!,
        objectKey: completeData.objectKey ?? objectKey!,
        bucketName: completeData.bucketName ?? bucketName!,
      };
      options.onSuccess?.(result);
      return result;
    } catch (uploadError) {
      const message =
        uploadError instanceof Error
          ? uploadError.message
          : "Upload interrupted. Select the same file again to resume.";

      setError(message);
      setIsUploading(false);
      options.onError?.(message);
      return null;
    }
  }

  return {
    uploadFile,
    isUploading,
    progress,
    error,
    sessionId,
  };
}
