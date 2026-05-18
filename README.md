# Resumable S3 Multipart Upload

A small starter for uploading large files from the browser to S3-compatible storage.

The browser uploads file chunks directly to your bucket. Your server only creates the multipart upload, signs each part, remembers the upload session, and completes the upload at the end.

It works with AWS S3, Cloudflare R2, MinIO, Backblaze B2, DigitalOcean Spaces, Wasabi, and other S3-compatible providers.

## What You Need

- A Next.js app or another server that can expose API routes
- An S3-compatible bucket
- S3 access key and secret
- A database table for upload sessions
- Supabase if you want to use the included session-store adapter

This repo includes a Supabase adapter because it is easy to set up. The upload logic itself does not require Supabase.

## Maintainer Checklist

If you are publishing this repo, the only required checks are:

```bash
npm run typecheck
npm run build
```

Users of the project provide their own bucket, credentials, database, and auth.

## 1. Install Dependencies

```bash
npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner @supabase/supabase-js
```

If you are copying this into an existing app, copy the `src/` folder into your project.

If you publish or install it as a package later, import from the package name instead of `../src`.

## 2. Add Environment Variables

Create `.env.local` in your app:

```env
S3_REGION=auto
S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
S3_ACCESS_KEY_ID=your-access-key
S3_SECRET_ACCESS_KEY=your-secret-key
S3_BUCKET_NAME=your-bucket-name
S3_FORCE_PATH_STYLE=true

SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

For AWS S3, use this shape instead:

```env
S3_REGION=us-east-1
S3_ENDPOINT=
S3_FORCE_PATH_STYLE=false
```

Keep these values server-side. Do not expose access keys to the browser.

Provider-specific notes:

- Cloudflare R2: `docs/cloudflare-r2.md`
- AWS S3: `docs/aws-s3.md`

## 3. Create The Upload Sessions Table

If you are using Supabase, run this file in the SQL editor:

```text
sql/upload_sessions.sql
```

That creates the `upload_sessions` table used to resume uploads later.

If you are using another database, create a table with the same fields and implement this interface:

```ts
import type { UploadSessionStore } from "./src/types";
```

The rest of the code will work the same way.

## 4. Configure Bucket CORS

Your bucket must allow browser `PUT` requests to signed URLs.

Example CORS config:

```json
[
  {
    "AllowedOrigins": ["http://localhost:3000", "https://your-app.com"],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

Without this, the signed URLs may work from the server but fail in the browser.

## 5. Create The Upload Service

Create a server-only file in your app, for example:

```text
lib/upload-service.ts
```

```ts
import { createClient } from "@supabase/supabase-js";
import {
  createMultipartUploadService,
  createS3CompatibleClient,
} from "../src";
import {
  createSupabaseUploadSessionStore,
} from "../src/supabase";

const s3 = createS3CompatibleClient({
  region: process.env.S3_REGION ?? "auto",
  endpoint: process.env.S3_ENDPOINT || undefined,
  accessKeyId: process.env.S3_ACCESS_KEY_ID!,
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
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

export const uploadService = createMultipartUploadService({
  s3,
  sessionStore: createSupabaseUploadSessionStore(supabase),
  config: {
    bucketName: process.env.S3_BUCKET_NAME!,
    defaultChunkSizeBytes: 10 * 1024 * 1024,
    uploadPolicy: {
      maxSizeBytes: 10 * 1024 * 1024 * 1024,
      allowedMimeTypes: ["video/mp4", "video/quicktime", "video/webm"],
      keyPrefix: "uploads",
    },
  },
});
```

Change `allowedMimeTypes`, `maxSizeBytes`, and `keyPrefix` for your app.

## 6. Add The API Route

For Next.js App Router, create:

```text
app/api/upload/multipart/route.ts
```

You can copy the example from:

```text
examples/next-app-router/app/api/upload/multipart/route.ts
```

The important part is authentication. Replace this placeholder:

```ts
async function getCurrentUserId(request: Request) {
  return request.headers.get("x-user-id");
}
```

with your real auth code.

For example:

- Supabase SSR: `supabase.auth.getUser()`
- NextAuth/Auth.js: `auth()`
- Custom auth: verify your session cookie or JWT

Every action must be scoped to the current user. Do not sign upload parts for unauthenticated users.

The route supports four actions:

```ts
{ action: "create", fileName, mimeType, sizeBytes, fileLastModified, chunkSizeBytes, totalParts }
{ action: "status", sessionId }
{ action: "signPart", sessionId, partNumber }
{ action: "complete", sessionId }
```

The client hook already sends these actions for you.

## 7. Use The React Hook

Create an upload component:

```tsx
"use client";

import { useResumableMultipartUpload } from "../src/client";

export function VideoUpload() {
  const { uploadFile, progress, isUploading, error } = useResumableMultipartUpload({
    endpoint: "/api/upload/multipart",
    concurrency: 6,
    onSuccess: ({ objectKey }) => {
      console.log("Uploaded object key:", objectKey);
    },
  });

  return (
    <div>
      <input
        type="file"
        disabled={isUploading}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void uploadFile(file);
        }}
      />

      <div>Progress: {progress}%</div>

      {error ? <div>{error}</div> : null}
    </div>
  );
}
```

When an upload is interrupted, the user can select the same file again. The hook checks `localStorage`, asks the server which parts already exist, and uploads only the missing parts.

## 8. Test Locally

1. Start your app.

```bash
npm run dev
```

2. Upload a large file.

3. Refresh the page halfway through.

4. Select the same file again.

The upload should continue instead of starting from zero.

You can also check your `upload_sessions` table. A successful upload should move to `completed`.

## How It Works

The flow is:

1. The browser asks your API route to create an upload.
2. Your server calls `CreateMultipartUpload` on your storage provider.
3. Your server saves the upload id in `upload_sessions`.
4. The browser asks your server for a signed URL for each part.
5. The browser uploads each chunk directly to the bucket.
6. If the page refreshes, the browser asks your server which parts already exist.
7. After all parts are uploaded, your server calls `CompleteMultipartUpload`.

Your server never receives the file bytes.

## Common Problems

### Browser upload fails immediately

Check your bucket CORS settings. The bucket must allow `PUT` from your app origin.

### Upload resumes from zero

Make sure the user selected the exact same file. The local resume key uses file name, size, and `lastModified`.

Also check that the `status` action can read the existing session for the same user.

### `NoSuchUpload` or `upload does not exist`

The storage provider no longer has that multipart upload. This can happen if it expired or was manually aborted. The user needs to start again.

### Part signing works, but complete fails

Check that every part except the last one is at least 5 MB. S3-compatible providers enforce this rule.

## Production Notes

Add a cleanup job for abandoned uploads. Object storage providers can keep unfinished multipart uploads around until they are aborted.

This repo includes `cleanupAbandonedMultipartUploads` to abort sessions your app has already selected as old or abandoned. See `docs/cleanup.md`.

A cleanup job should:

1. Find old `upload_sessions` rows with `status = 'uploading'`.
2. Call `AbortMultipartUpload`.
3. Mark the row as `aborted` or `failed`.

Also make sure you:

- authenticate every upload route action
- generate object keys on the server
- validate file size and MIME type on the server
- keep S3 credentials out of client code
- never let the client choose arbitrary bucket names

## Files To Look At

- `src/server/multipart-service.ts` - main server upload flow
- `src/server/s3.ts` - S3-compatible storage calls
- `src/server/cleanup.ts` - abandoned multipart upload cleanup helper
- `src/client/use-resumable-multipart-upload.ts` - React upload hook
- `src/adapters/supabase-session-store.ts` - Supabase session storage
- `sql/upload_sessions.sql` - Supabase table
- `examples/next-app-router/app/api/upload/multipart/route.ts` - Next.js route example
- `docs/cloudflare-r2.md` - Cloudflare R2 setup
- `docs/aws-s3.md` - AWS S3 setup
- `docs/cleanup.md` - cleanup job notes

## Publishing

This project is set up like a small TypeScript package.

```bash
npm run typecheck
npm run build
```

The build output goes to `dist/`. The examples import from local `src/` so they are easy to copy into an app. If you publish this to npm, change those imports to the package name in your own app.
