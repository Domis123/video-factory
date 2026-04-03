import {
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { s3, R2_BUCKET } from '../config/r2.js';

const MULTIPART_THRESHOLD = 5 * 1024 * 1024; // 5MB

export async function uploadFile(
  r2Key: string,
  body: Buffer | Readable,
  contentType?: string,
): Promise<void> {
  const isLarge = Buffer.isBuffer(body) && body.length > MULTIPART_THRESHOLD;

  if (isLarge || body instanceof Readable) {
    const upload = new Upload({
      client: s3,
      params: {
        Bucket: R2_BUCKET,
        Key: r2Key,
        Body: body,
        ContentType: contentType,
      },
    });
    await upload.done();
  } else {
    await s3.send(
      new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: r2Key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }
}

export async function downloadFile(r2Key: string): Promise<Readable> {
  const res = await s3.send(
    new GetObjectCommand({ Bucket: R2_BUCKET, Key: r2Key }),
  );
  return res.Body as Readable;
}

export async function downloadToFile(
  r2Key: string,
  localPath: string,
): Promise<void> {
  await mkdir(dirname(localPath), { recursive: true });
  const stream = await downloadFile(r2Key);
  await pipeline(stream, createWriteStream(localPath));
}

export async function fileExists(r2Key: string): Promise<boolean> {
  try {
    await s3.send(
      new HeadObjectCommand({ Bucket: R2_BUCKET, Key: r2Key }),
    );
    return true;
  } catch {
    return false;
  }
}

export async function getPresignedUrl(
  r2Key: string,
  expiresInSeconds = 3600,
): Promise<string> {
  return getSignedUrl(
    s3,
    new GetObjectCommand({ Bucket: R2_BUCKET, Key: r2Key }),
    { expiresIn: expiresInSeconds },
  );
}

export async function deleteFile(r2Key: string): Promise<void> {
  await s3.send(
    new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: r2Key }),
  );
}

export async function listFiles(prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let continuationToken: string | undefined;

  do {
    const res = await s3.send(
      new ListObjectsV2Command({
        Bucket: R2_BUCKET,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }),
    );
    for (const obj of res.Contents ?? []) {
      if (obj.Key) keys.push(obj.Key);
    }
    continuationToken = res.NextContinuationToken;
  } while (continuationToken);

  return keys;
}
