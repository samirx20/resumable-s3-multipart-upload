# AWS S3 Setup

This project uses standard S3 multipart upload APIs, so AWS S3 works without a custom endpoint.

## 1. Create A Bucket

Create a bucket in AWS S3.

Use the bucket name as:

```env
S3_BUCKET_NAME=your-bucket-name
```

## 2. Create IAM Credentials

Create an IAM user or role with access to multipart upload operations for your bucket.

Minimum useful actions:

```json
[
  "s3:CreateMultipartUpload",
  "s3:UploadPart",
  "s3:ListMultipartUploadParts",
  "s3:CompleteMultipartUpload",
  "s3:AbortMultipartUpload"
]
```

Depending on your app, you may also need read/list permissions elsewhere.

## 3. Set Environment Variables

```env
S3_REGION=us-east-1
S3_ENDPOINT=
S3_ACCESS_KEY_ID=your-access-key
S3_SECRET_ACCESS_KEY=your-secret-key
S3_BUCKET_NAME=your-bucket-name
S3_FORCE_PATH_STYLE=false
```

Use the region where your bucket lives.

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

- Leave `S3_ENDPOINT` empty for AWS S3.
- Use `S3_FORCE_PATH_STYLE=false` for normal AWS S3 buckets.
- Keep AWS credentials server-side only.
