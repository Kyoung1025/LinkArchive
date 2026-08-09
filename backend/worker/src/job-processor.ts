import type { Job } from 'bullmq';
import type { LinkScrapeJobData, PrismaClient } from '@linkarchive/shared';
import { scrapeUrl } from './scrape';
import { logger } from './logger';
import { scrapeDurationSeconds, scrapeJobsTotal } from './metrics';

export const WORKER_CONCURRENCY = 5;

function recordOutcome(outcome: 'success' | 'failure', startedAt: bigint) {
  const seconds = Number(process.hrtime.bigint() - startedAt) / 1e9;
  scrapeJobsTotal.inc({ outcome });
  scrapeDurationSeconds.observe({ outcome }, seconds);
}

export function createJobProcessor(prisma: PrismaClient) {
  return async function processLinkScrapeJob(job: Job<LinkScrapeJobData>) {
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
  };
}

export function createFailedHandler(prisma: PrismaClient) {
  return async function handleFailed(job: Job<LinkScrapeJobData> | undefined, error: Error) {
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
  };
}
