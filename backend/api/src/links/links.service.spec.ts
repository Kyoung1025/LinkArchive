import { NotFoundException } from '@nestjs/common';
import type { PinoLogger } from 'nestjs-pino';
import { LinksService } from './links.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { QueueService } from '../queue/queue.service';
import type { MetricsService } from '../metrics/metrics.service';

function createLinksService() {
  const prisma = {
    link: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      delete: jest.fn(),
    },
  };

  const queue = {
    addLinkScrapeJob: jest.fn(),
  };

  const metrics = {
    linksCreatedTotal: { inc: jest.fn() },
  };

  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };

  const service = new LinksService(
    prisma as unknown as PrismaService,
    queue as unknown as QueueService,
    metrics as unknown as MetricsService,
    logger as unknown as PinoLogger,
  );

  return { service, prisma, queue, metrics, logger };
}

const RAW_LINK = {
  id: 'link-1',
  url: 'https://example.com',
  title: null,
  description: null,
  thumbnailUrl: null,
  status: 'pending',
  errorMessage: null,
  retryCount: 0,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  tags: [{ linkId: 'link-1', tagId: 'tag-1', tag: { id: 'tag-1', name: 'tech' } }],
} as const;

describe('LinksService', () => {
  describe('create', () => {
    it('persists the link, enqueues a scrape job, records the metric, and flattens tags in the response', async () => {
      const { service, prisma, queue, metrics, logger } = createLinksService();
      prisma.link.create.mockResolvedValue(RAW_LINK as never);

      const result = await service.create('https://example.com');

      expect(prisma.link.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: { url: 'https://example.com' } }),
      );
      expect(queue.addLinkScrapeJob).toHaveBeenCalledWith({ linkId: 'link-1', url: 'https://example.com' });
      expect(metrics.linksCreatedTotal.inc).toHaveBeenCalledTimes(1);
      expect(logger.info).toHaveBeenCalled();
      expect(result.tags).toEqual([{ id: 'tag-1', name: 'tech' }]);
    });
  });

  describe('findAll', () => {
    it('queries with no filters when the query is empty', async () => {
      const { service, prisma } = createLinksService();
      prisma.link.findMany.mockResolvedValue([]);

      await service.findAll({});

      expect(prisma.link.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
    });

    it('combines status, tag, and search into a single where clause', async () => {
      const { service, prisma } = createLinksService();
      prisma.link.findMany.mockResolvedValue([]);

      await service.findAll({ status: 'completed', tag: 'tech', search: 'example' });

      const [{ where }] = prisma.link.findMany.mock.calls[0];
      expect(where).toEqual({
        status: 'completed',
        tags: { some: { tag: { name: 'tech' } } },
        OR: [
          { title: { contains: 'example', mode: 'insensitive' } },
          { tags: { some: { tag: { name: { contains: 'example', mode: 'insensitive' } } } } },
        ],
      });
    });
  });

  describe('findOne', () => {
    it('returns the flattened link when it exists', async () => {
      const { service, prisma } = createLinksService();
      prisma.link.findUnique.mockResolvedValue(RAW_LINK as never);

      const result = await service.findOne('link-1');

      expect(result.id).toBe('link-1');
      expect(result.tags).toEqual([{ id: 'tag-1', name: 'tech' }]);
    });

    it('throws NotFoundException when the link does not exist', async () => {
      const { service, prisma } = createLinksService();
      prisma.link.findUnique.mockResolvedValue(null);

      await expect(service.findOne('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('deletes the link after confirming it exists', async () => {
      const { service, prisma, logger } = createLinksService();
      prisma.link.findUnique.mockResolvedValue(RAW_LINK as never);
      prisma.link.delete.mockResolvedValue(RAW_LINK as never);

      await service.remove('link-1');

      expect(prisma.link.delete).toHaveBeenCalledWith({ where: { id: 'link-1' } });
      expect(logger.info).toHaveBeenCalledWith({ linkId: 'link-1' }, 'link deleted');
    });

    it('propagates NotFoundException and never calls delete when the link is missing', async () => {
      const { service, prisma } = createLinksService();
      prisma.link.findUnique.mockResolvedValue(null);

      await expect(service.remove('missing')).rejects.toThrow(NotFoundException);
      expect(prisma.link.delete).not.toHaveBeenCalled();
    });
  });
});
