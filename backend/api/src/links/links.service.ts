import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { Prisma } from '@linkarchive/shared';
import { PrismaService } from '../prisma/prisma.service';
import { QueueService } from '../queue/queue.service';
import { MetricsService } from '../metrics/metrics.service';
import { QueryLinksDto } from './dto/query-links.dto';

const LINK_WITH_TAGS = Prisma.validator<Prisma.LinkDefaultArgs>()({
  include: { tags: { include: { tag: true } } },
});

type LinkWithTags = Prisma.LinkGetPayload<typeof LINK_WITH_TAGS>;

function toResponse(link: LinkWithTags) {
  const { tags, ...rest } = link;
  return { ...rest, tags: tags.map((lt) => lt.tag) };
}

@Injectable()
export class LinksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
    private readonly metrics: MetricsService,
    @InjectPinoLogger(LinksService.name) private readonly logger: PinoLogger,
  ) {}

  async create(url: string) {
    const link = await this.prisma.link.create({ data: { url }, ...LINK_WITH_TAGS });
    await this.queue.addLinkScrapeJob({ linkId: link.id, url: link.url });
    this.metrics.linksCreatedTotal.inc();
    this.logger.info({ linkId: link.id, url: link.url }, 'link created, scrape job enqueued');
    return toResponse(link);
  }

  async findAll(query: QueryLinksDto) {
    const where: Prisma.LinkWhereInput = {};

    if (query.status) {
      where.status = query.status;
    }

    if (query.tag) {
      where.tags = { some: { tag: { name: query.tag } } };
    }

    if (query.search) {
      where.OR = [
        { title: { contains: query.search, mode: 'insensitive' } },
        { tags: { some: { tag: { name: { contains: query.search, mode: 'insensitive' } } } } },
      ];
    }

    const links = await this.prisma.link.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      ...LINK_WITH_TAGS,
    });
    return links.map(toResponse);
  }

  async findOne(id: string) {
    const link = await this.prisma.link.findUnique({ where: { id }, ...LINK_WITH_TAGS });
    if (!link) {
      throw new NotFoundException(`링크를 찾을 수 없습니다 (id: ${id})`);
    }
    return toResponse(link);
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);
    await this.prisma.link.delete({ where: { id } });
    this.logger.info({ linkId: id }, 'link deleted');
  }
}
