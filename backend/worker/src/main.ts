import 'dotenv/config';
import { Job, Worker } from 'bullmq';
import { LINK_SCRAPE_QUEUE, LinkScrapeJobData, PrismaClient } from '@linkarchive/shared';
import { scrapeUrl } from './scrape';
import { logger } from './logger';
import { scrapeDurationSeconds, scrapeJobsTotal, startMetricsServer } from './metrics';

const prisma = new PrismaClient();
const metricsServer = startMetricsServer(Number(process.env.METRICS_PORT ?? 9100));

const connection = {
  host: process.env.REDIS_HOST ?? 'localhost',
  port: Number(process.env.REDIS_PORT ?? 6379),
};

async function processLinkScrapeJob(job: Job<LinkScrapeJobData>) {
  const { linkId, url } = job.data;
  const attempt = job.attemptsMade + 1;

  logger.info('processing link scrape job', { linkId, url, attempt });

  await prisma.link.update({
    where: { id: linkId },
    data: { status: 'processing', retryCount: job.attemptsMade },
  });

  const startedAt = process.hrtime.bigint();

  try {
    const result = await scrapeUrl(url);

    await prisma.link.update({
      where: { id: linkId },
      data: {
        status: 'completed',
        title: result.title,
        description: result.description,
        thumbnailUrl: result.thumbnailUrl,
        errorMessage: null,
      },
    });

    recordOutcome('success', startedAt);
    logger.info('link scrape completed', { linkId, url });
  } catch (error) {
    recordOutcome('failure', startedAt);
    const message = error instanceof Error ? error.message : 'unknown error';
    logger.error('link scrape attempt failed', { linkId, url, attempt, error: message });
    throw error;
  }
}

function recordOutcome(outcome: 'success' | 'failure', startedAt: bigint) {
  const seconds = Number(process.hrtime.bigint() - startedAt) / 1e9;
  scrapeJobsTotal.inc({ outcome });
  scrapeDurationSeconds.observe({ outcome }, seconds);
}

const worker = new Worker<LinkScrapeJobData>(LINK_SCRAPE_QUEUE, processLinkScrapeJob, {
  connection,
  concurrency: 5,
});

worker.on('failed', async (job, error) => {
  if (!job) return;

  const maxAttempts = job.opts.attempts ?? 1;
  const isFinalAttempt = job.attemptsMade >= maxAttempts;

  logger.warn('link scrape job failed', {
    linkId: job.data.linkId,
    url: job.data.url,
    attemptsMade: job.attemptsMade,
    maxAttempts,
    isFinalAttempt,
    error: error.message,
  });

  if (!isFinalAttempt) return;

  try {
    await prisma.link.update({
      where: { id: job.data.linkId },
      data: { status: 'failed', errorMessage: error.message, retryCount: job.attemptsMade },
    });
  } catch (updateError) {
    const message = updateError instanceof Error ? updateError.message : 'unknown error';
    logger.error('failed to persist final failure status', { linkId: job.data.linkId, error: message });
  }
});

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
