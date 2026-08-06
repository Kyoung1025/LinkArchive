import { Injectable } from '@nestjs/common';
import { Counter, Gauge, Registry, collectDefaultMetrics } from 'prom-client';
import { QueueService } from '../queue/queue.service';

@Injectable()
export class MetricsService {
  readonly registry = new Registry();

  readonly linksCreatedTotal = new Counter({
    name: 'linkarchive_links_created_total',
    help: 'Total number of links submitted via POST /links',
    registers: [this.registry],
  });

  private readonly queueWaiting = new Gauge({
    name: 'linkarchive_queue_waiting_jobs',
    help: 'Number of link-scrape jobs waiting to be processed',
    registers: [this.registry],
  });

  private readonly queueActive = new Gauge({
    name: 'linkarchive_queue_active_jobs',
    help: 'Number of link-scrape jobs currently being processed',
    registers: [this.registry],
  });

  private readonly queueDelayed = new Gauge({
    name: 'linkarchive_queue_delayed_jobs',
    help: 'Number of link-scrape jobs delayed (awaiting retry backoff)',
    registers: [this.registry],
  });

  private readonly queueFailed = new Gauge({
    name: 'linkarchive_queue_failed_jobs',
    help: 'Number of link-scrape jobs in the failed set',
    registers: [this.registry],
  });

  constructor(private readonly queue: QueueService) {
    collectDefaultMetrics({ register: this.registry, prefix: 'linkarchive_api_' });
  }

  async getMetrics(): Promise<string> {
    const counts = await this.queue.linkScrapeQueue.getJobCounts('wait', 'active', 'delayed', 'failed');
    this.queueWaiting.set(counts.wait ?? 0);
    this.queueActive.set(counts.active ?? 0);
    this.queueDelayed.set(counts.delayed ?? 0);
    this.queueFailed.set(counts.failed ?? 0);
    return this.registry.metrics();
  }

  get contentType(): string {
    return this.registry.contentType;
  }
}
