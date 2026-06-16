import { S3Client } from '@aws-sdk/client-s3'
import { PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

export function r2Client() {
  return new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  })
}

export async function presignAvatarUpload(userId: string, contentType: string) {
  const ext = contentType === 'image/png' ? 'png' : 'jpg'
  const key = `avatars/${userId}.${ext}`
  const url = await getSignedUrl(
    r2Client(),
    new PutObjectCommand({ Bucket: process.env.R2_BUCKET!, Key: key, ContentType: contentType }),
    { expiresIn: 60 },
  )
  return { url, publicUrl: `${process.env.R2_PUBLIC_BASE_URL}/${key}` }
}
