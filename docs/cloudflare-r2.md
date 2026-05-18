# Cloudflare R2 Setup

This project works with R2 because R2 supports the S3 multipart upload API.

## 1. Create A Bucket

Create a bucket in the Cloudflare dashboard.

Use the bucket name as:

```env
S3_BUCKET_NAME=your-bucket-name
```

## 2. Create An R2 API Token

Create an R2 token with access to the bucket.

Use the values as:

```env
S3_ACCESS_KEY_ID=your-r2-access-key
S3_SECRET_ACCESS_KEY=your-r2-secret-key
```

## 3. Set The Endpoint

R2 uses your Cloudflare account id in the S3 endpoint:

```env
S3_REGION=auto
S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
S3_FORCE_PATH_STYLE=true
```

## 4. Configure CORS

Your bucket needs to allow browser `PUT` requests.

Example:

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

## Notes

- R2 uses `auto` as the region.
- `S3_FORCE_PATH_STYLE=true` is recommended for R2.
- Keep R2 credentials server-side only.
