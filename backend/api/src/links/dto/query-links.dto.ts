import { IsIn, IsOptional, IsString } from 'class-validator';
import { LinkStatus } from '@linkarchive/shared';

export class QueryLinksDto {
  @IsOptional()
  @IsIn(['pending', 'processing', 'completed', 'failed'])
  status?: LinkStatus;

  @IsOptional()
  @IsString()
  tag?: string;

  @IsOptional()
  @IsString()
  search?: string;
}
