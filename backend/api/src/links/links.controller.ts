import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { LinksService } from './links.service';
import { CreateLinkDto } from './dto/create-link.dto';
import { QueryLinksDto } from './dto/query-links.dto';
import { TagsService } from '../tags/tags.service';
import { AddTagDto } from '../tags/dto/add-tag.dto';

@Controller('links')
export class LinksController {
  constructor(
    private readonly linksService: LinksService,
    private readonly tagsService: TagsService,
  ) {}

  @Post()
  create(@Body() dto: CreateLinkDto) {
    return this.linksService.create(dto.url);
  }

  @Get()
  findAll(@Query() query: QueryLinksDto) {
    return this.linksService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.linksService.findOne(id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.linksService.remove(id);
  }

  @Post(':id/tags')
  addTag(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AddTagDto) {
    return this.tagsService.addTagToLink(id, dto.name);
  }

  @Delete(':id/tags/:tagId')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeTag(@Param('id', ParseUUIDPipe) id: string, @Param('tagId', ParseUUIDPipe) tagId: string) {
    return this.tagsService.removeTagFromLink(id, tagId);
  }
}
