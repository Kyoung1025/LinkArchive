import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class AddTagDto {
  @IsString({ message: '태그명은 문자열이어야 합니다' })
  @IsNotEmpty({ message: '태그명을 입력해주세요' })
  @MaxLength(50, { message: '태그명은 50자를 넘을 수 없습니다' })
  name!: string;
}
