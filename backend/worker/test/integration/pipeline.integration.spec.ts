import 'dotenv/config';
import { Queue, Worker } from 'bullmq';
import { PrismaClient } from '@linkarchive/shared';
import type { LinkScrapeJobData } from '@linkarchive/shared';
import { createFailedHandler, createJobProcessor } from '../../src/job-processor';
import { startTestServer, type TestServerHandle } from './test-server';

// Exercises the real pipeline: a job on a real Redis-backed queue, picked up
// by a real BullMQ Worker running the actual job processor, against a real
// Postgres database. Only the "external site" is faked (a local HTTP server)
// so the test stays fast and deterministic — scrapeUrl's parsing logic
// itself is already covered by scrape.spec.ts.

const connection = {
  host: process.env.REDIS_HOST ?? 'localhost',
  port: Number(process.env.REDIS_PORT ?? 6379),
};

async function waitForStatus(prisma: PrismaClient, linkId: string, statuses: string[], timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const link = await prisma.link.findUniqueOrThrow({ where: { id: linkId } });
    if (statuses.includes(link.status)) return link;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for link ${linkId} to reach status in [${statuses.join(', ')}]`);
}

describe('full pipeline: enqueue -> real worker -> real DB (integration)', () => {
  const prisma = new PrismaClient();
  const queueName = `link-scrape-pipeline-test-${Date.now()}`;
  const createdLinkIds: string[] = [];
  let queue: Queue<LinkScrapeJobData>;
  let worker: Worker<LinkScrapeJobData>;
  let server: TestServerHandle;

  beforeAll(async () => {
    server = await startTestServer((_req, res) => {
      res.setHeader('Content-Type', 'text/html');
      res.end(`
        <html><head>
          <meta property="og:title" content="Integration Test Page">
          <meta property="og:description" content="Served by the local test server">
        </head></html>
      `);
    });

    queue = new Queue<LinkScrapeJobData>(queueName, { connection });
    worker = new Worker<LinkScrapeJobData>(queueName, createJobProcessor(prisma), {
      connection,
      concurrency: 1,
    });
    worker.on('failed', createFailedHandler(prisma));
  });

  afterAll(async () => {
    await worker.close();
    await queue.close();
    await server.close();
    if (createdLinkIds.length > 0) {
      await prisma.link.deleteMany({ where: { id: { in: createdLinkIds } } });
    }
    await prisma.$disconnect();
  });

  it('moves a link from pending to completed with scraped metadata once the worker processes it', async () => {
    const link = await prisma.link.create({ data: { url: server.baseUrl } });
    createdLinkIds.push(link.id);
    expect(link.status).toBe('pending');

    await queue.add('scrape', { linkId: link.id, url: link.url });

    await waitForStatus(prisma, link.id, ['completed', 'failed']);

    const updated = await prisma.link.findUniqueOrThrow({ where: { id: link.id } });
    expect(updated.status).toBe('completed');
    expect(updated.title).toBe('Integration Test Page');
    expect(updated.description).toBe('Served by the local test server');
  }, 15000);

  it('marks the link failed with an error message after exhausting retries against an unreachable URL', async () => {
    const link = await prisma.link.create({ data: { url: 'http://127.0.0.1:1' } });
    createdLinkIds.push(link.id);

    await queue.add(
      'scrape',
      { linkId: link.id, url: link.url },
      { attempts: 2, backoff: { type: 'fixed', delay: 50 } },
    );

    await waitForStatus(prisma, link.id, ['failed']);

    const updated = await prisma.link.findUniqueOrThrow({ where: { id: link.id } });
    expect(updated.status).toBe('failed');
    expect(updated.errorMessage).toBeTruthy();
    expect(updated.retryCount).toBe(2);
  }, 15000);
});
