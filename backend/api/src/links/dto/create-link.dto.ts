import { IsUrl } from 'class-validator';

export class CreateLinkDto {
  @IsUrl(
    { protocols: ['http', 'https'], require_protocol: true },
    { message: '올바른 URL 형식이 아닙니다 (http:// 또는 https://로 시작해야 합니다)' },
  )
  url!: string;
}
