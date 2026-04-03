import { Queue, Worker, type Processor, type WorkerOptions } from 'bullmq';
import { Redis, type RedisOptions } from 'ioredis';
import { env } from './env.js';

// Upstash requires TLS and BullMQ requires maxRetriesPerRequest: null
function buildRedisOpts(): RedisOptions {
  const parsed = new URL(env.REDIS_URL);
  return {
    host: parsed.hostname,
    port: Number(parsed.port) || 6379,
    username: parsed.username || 'default',
    password: decodeURIComponent(parsed.password),
    tls: {},
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  };
}

const redisOpts = buildRedisOpts();

// BullMQ needs separate connections per Queue/Worker — factory creates fresh ones
export function createQueue(name: string): Queue {
  return new Queue(name, { connection: new Redis(redisOpts) });
}

export function createWorker<T = unknown>(
  name: string,
  processor: Processor<T>,
  opts?: Partial<WorkerOptions>,
): Worker<T> {
  return new Worker<T>(name, processor, {
    connection: new Redis(redisOpts),
    concurrency: env.WORKER_CONCURRENCY,
    ...opts,
  });
}

// Standalone connection for one-off commands (PING, etc.)
export function createRedisConnection(): Redis {
  return new Redis(redisOpts);
}

export const QUEUE_NAMES = {
  ingestion: 'ingestion',
  planning: 'planning',
  rendering: 'rendering',
  export: 'export',
} as const;
