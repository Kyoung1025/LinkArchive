import { IsUrl } from 'class-validator';

export class CreateLinkDto {
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  url!: string;
}
