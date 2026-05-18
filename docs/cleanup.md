# Cleaning Up Abandoned Uploads

Multipart uploads can be abandoned when a user closes the tab, loses network, or never returns to finish the upload.

Object storage providers may keep unfinished parts until they are explicitly aborted or removed by a lifecycle rule.

## Helper

This project includes:

```ts
import { cleanupAbandonedMultipartUploads } from "../src";
```

The helper receives upload sessions that your app has already selected as old or abandoned.

```ts
const result = await cleanupAbandonedMultipartUploads({
  s3,
  sessionStore,
  sessions,
  reason: "Upload was older than 24 hours.",
});

console.log(result);
```

The helper:

1. Calls `AbortMultipartUpload` for each `uploading` session.
2. Marks the session as `aborted` if the store supports it.
3. Falls back to `markFailed` for custom stores that do not implement `markAborted`.

## Selecting Old Sessions

How you select sessions depends on your database.

For Supabase, you can query rows where:

```sql
status = 'uploading'
and created_at < now() - interval '24 hours'
```

Then map those rows to the `UploadSession` shape from `src/types.ts`.

## Schedule

Run cleanup from your own scheduler:

- Vercel Cron
- GitHub Actions schedule
- Cloudflare Cron Trigger
- a background worker
- a normal server cron job

Run it often enough to avoid storage cost surprises. Daily cleanup is a reasonable default.
