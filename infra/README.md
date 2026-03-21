# AWS Deployment Notes

Use the root `template.yaml` with AWS SAM.

High-level flow:
1. Deploy backend infrastructure with SAM
2. Grab the `ApiBaseUrl` and `FrontendBucketName` outputs
3. Generate `dist/web/` for that API URL
4. Upload `dist/web/` to the S3 website bucket

The detailed step-by-step instructions live in the root `README.md`.
