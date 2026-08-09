import 'dotenv/config';
import { Queue, Worker } from 'bullmq';
import { PrismaClient } from '@linkarchive/shared';
import type { LinkScrapeJobData } from '@linkarchive/shared';
import { createFailedHandler, createJobProcessor, WORKER_CONCURRENCY } from '../../src/job-processor';
import { startTestServer, type TestServerHandle } from './test-server';

// Proves the worker's concurrency:5 setting actually processes jobs in
// parallel rather than one at a time, and that concurrent jobs don't
// cross-contaminate each other's results (each link ends up with its own
// scraped title, not a neighbor's).

const connection = {
  host: process.env.REDIS_HOST ?? 'localhost',
  port: Number(process.env.REDIS_PORT ?? 6379),
};

const REQUEST_DELAY_MS = 150;
const JOB_COUNT = WORKER_CONCURRENCY + 3; // more than the concurrency limit, to prove overlap

async function waitForAllToFinish(prisma: PrismaClient, ids: string[], timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const links = await prisma.link.findMany({ where: { id: { in: ids } } });
    if (links.length === ids.length && links.every((link) => link.status !== 'pending' && link.status !== 'processing')) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Timed out waiting for all links to finish processing');
}

describe('worker concurrency (integration)', () => {
  const prisma = new PrismaClient();
  const queueName = `link-scrape-concurrency-test-${Date.now()}`;
  const createdLinkIds: string[] = [];
  let queue: Queue<LinkScrapeJobData>;
  let worker: Worker<LinkScrapeJobData>;
  let server: TestServerHandle;
  let inFlight = 0;
  let maxInFlight = 0;

  beforeAll(async () => {
    server = await startTestServer((req, res) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      const index = (req.url ?? '/0').slice(1);
      setTimeout(() => {
        res.setHeader('Content-Type', 'text/html');
        res.end(`<html><head><meta property="og:title" content="Page ${index}"></head></html>`);
        inFlight -= 1;
      }, REQUEST_DELAY_MS);
    });

    queue = new Queue<LinkScrapeJobData>(queueName, { connection });
    worker = new Worker<LinkScrapeJobData>(queueName, createJobProcessor(prisma), {
      connection,
      concurrency: WORKER_CONCURRENCY,
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

  it(`processes ${JOB_COUNT} links with real overlap (up to ${WORKER_CONCURRENCY} in flight) and never mixes up their results`, async () => {
    const links = await Promise.all(
      Array.from({ length: JOB_COUNT }, (_, i) => prisma.link.create({ data: { url: `${server.baseUrl}/${i}` } })),
    );
    createdLinkIds.push(...links.map((link) => link.id));

    await Promise.all(links.map((link) => queue.add('scrape', { linkId: link.id, url: link.url })));

    await waitForAllToFinish(
      prisma,
      links.map((link) => link.id),
    );

    const finalLinks = await prisma.link.findMany({ where: { id: { in: links.map((link) => link.id) } } });

    for (let i = 0; i < links.length; i++) {
      const final = finalLinks.find((link) => link.id === links[i].id);
      expect(final?.status).toBe('completed');
      expect(final?.title).toBe(`Page ${i}`); // proves no cross-contamination between concurrent jobs
    }

    // A serial implementation would never exceed 1 in-flight request at a time.
    expect(maxInFlight).toBeGreaterThan(1);
  }, 20000);
});
