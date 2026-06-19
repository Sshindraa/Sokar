/**
 * Client AWS universel — LocalStack en dev, AWS réel en prod.
 *
 * Le switch se fait via USE_LOCALSTACK env var ou NODE_ENV.
 * Zéro refactoring quand une intégration passe de LocalStack à AWS réel.
 *
 * Usage :
 *   import { s3, sqs, ses } from './shared/aws/client';
 *   await s3.putObject({ Bucket: '...', Key: '...', Body: '...' });
 */
import { S3Client } from '@aws-sdk/client-s3';
import { SQSClient } from '@aws-sdk/client-sqs';
import { SESClient } from '@aws-sdk/client-ses';

const REGION = process.env.AWS_REGION ?? 'eu-west-1';

function isLocal(): boolean {
  if (process.env.USE_LOCALSTACK === 'false') return false;
  if (process.env.USE_LOCALSTACK === 'true') return true;
  return process.env.NODE_ENV !== 'production';
}

function localConfig() {
  return {
    region: REGION,
    endpoint: 'http://127.0.0.1:4566',
    forcePathStyle: true,
    credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
  };
}

function prodConfig() {
  return { region: REGION };
}

const config = isLocal() ? localConfig() : prodConfig();

export const s3 = new S3Client(config);
export const sqs = new SQSClient(config);
export const ses = new SESClient(config);

export { isLocal as isLocalStack };
