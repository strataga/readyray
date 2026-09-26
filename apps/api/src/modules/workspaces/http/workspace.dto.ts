import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';

export class CreateWorkspaceDto {
  @ApiProperty({ minLength: 1, maxLength: 120, pattern: '.*\\S.*', example: 'Platform Engineering' })
  @IsString()
  @MaxLength(120)
  name!: string;
}

export class WorkspaceResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ maxLength: 120 })
  name!: string;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}
