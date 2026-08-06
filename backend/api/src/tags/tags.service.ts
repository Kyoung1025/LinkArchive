import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class TagsService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectPinoLogger(TagsService.name) private readonly logger: PinoLogger,
  ) {}

  findAll() {
    return this.prisma.tag.findMany({ orderBy: { name: 'asc' } });
  }

  async addTagToLink(linkId: string, name: string) {
    await this.assertLinkExists(linkId);

    const tag = await this.prisma.tag.upsert({
      where: { name },
      create: { name },
      update: {},
    });

    await this.prisma.linkTag.upsert({
      where: { linkId_tagId: { linkId, tagId: tag.id } },
      create: { linkId, tagId: tag.id },
      update: {},
    });

    this.logger.info({ linkId, tagId: tag.id, tagName: tag.name }, 'tag added to link');
    return tag;
  }

  async removeTagFromLink(linkId: string, tagId: string): Promise<void> {
    await this.assertLinkExists(linkId);
    await this.prisma.linkTag.deleteMany({ where: { linkId, tagId } });
    this.logger.info({ linkId, tagId }, 'tag removed from link');
  }

  private async assertLinkExists(linkId: string) {
    const link = await this.prisma.link.findUnique({ where: { id: linkId }, select: { id: true } });
    if (!link) {
      throw new NotFoundException(`Link ${linkId} not found`);
    }
  }
}
