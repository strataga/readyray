import { ApiProperty } from '@nestjs/swagger';

export class ProblemDetailsDto {
  @ApiProperty({ format: 'uri-reference' })
  type!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty({ minimum: 400, maximum: 599 })
  status!: number;

  @ApiProperty()
  detail!: string;

  @ApiProperty({ format: 'uri-reference' })
  instance!: string;

  @ApiProperty({ minLength: 1 })
  code!: string;

  @ApiProperty({ format: 'uuid' })
  requestId!: string;
}
