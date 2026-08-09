import 'dotenv/config';
import { Worker } from 'bullmq';
import { LINK_SCRAPE_QUEUE, LinkScrapeJobData, PrismaClient } from '@linkarchive/shared';
import { logger } from './logger';
import { startMetricsServer } from './metrics';
import { createFailedHandler, createJobProcessor, WORKER_CONCURRENCY } from './job-processor';

const prisma = new PrismaClient();
const metricsServer = startMetricsServer(Number(process.env.METRICS_PORT ?? 9100));

const connection = {
  host: process.env.REDIS_HOST ?? 'localhost',
  port: Number(process.env.REDIS_PORT ?? 6379),
};

const worker = new Worker<LinkScrapeJobData>(LINK_SCRAPE_QUEUE, createJobProcessor(prisma), {
  connection,
  concurrency: WORKER_CONCURRENCY,
});

worker.on('failed', createFailedHandler(prisma));

worker.on('error', (error) => {
  logger.error('worker connection error', { error: error.message });
});

process.on('unhandledRejection', (reason) => {
  const message = reason instanceof Error ? reason.message : String(reason);
  logger.error('unhandled rejection', { error: message });
});

logger.info('worker started', { queue: LINK_SCRAPE_QUEUE, redis: connection });

async function shutdown() {
  logger.info('worker shutting down');
  await worker.close();
  await prisma.$disconnect();
  metricsServer.close();
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
