import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { LINK_SCRAPE_QUEUE, LinkScrapeJobData } from '@linkarchive/shared';

@Injectable()
export class QueueService implements OnModuleDestroy {
  readonly linkScrapeQueue: Queue<LinkScrapeJobData>;

  constructor(config: ConfigService) {
    this.linkScrapeQueue = new Queue<LinkScrapeJobData>(LINK_SCRAPE_QUEUE, {
      connection: {
        host: config.get<string>('REDIS_HOST', 'localhost'),
        port: config.get<number>('REDIS_PORT', 6379),
      },
    });
  }

  addLinkScrapeJob(data: LinkScrapeJobData) {
    return this.linkScrapeQueue.add('scrape', data, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: { count: 1000 },
      removeOnFail: { count: 1000 },
    });
  }

  async onModuleDestroy() {
    await this.linkScrapeQueue.close();
  }
}
