import * as http from 'node:http';
import { Counter, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

export const registry = new Registry();
collectDefaultMetrics({ register: registry, prefix: 'linkarchive_worker_' });

export const scrapeJobsTotal = new Counter({
  name: 'linkarchive_worker_scrape_jobs_total',
  help: 'Total number of link-scrape job attempts, labeled by outcome',
  labelNames: ['outcome'] as const,
  registers: [registry],
});

export const scrapeDurationSeconds = new Histogram({
  name: 'linkarchive_worker_scrape_duration_seconds',
  help: 'Duration of link-scrape job attempts in seconds, labeled by outcome',
  labelNames: ['outcome'] as const,
  buckets: [0.1, 0.5, 1, 2, 5, 10, 20],
  registers: [registry],
});

export function startMetricsServer(port: number): http.Server {
  const server = http.createServer((req, res) => {
    if (req.url === '/metrics') {
      registry
        .metrics()
        .then((body) => {
          res.setHeader('Content-Type', registry.contentType);
          res.end(body);
        })
        .catch((error) => {
          res.statusCode = 500;
          res.end(String(error));
        });
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  server.listen(port);
  return server;
}
