import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class RegisterUserDto {
  @ApiProperty({ format: 'email', maxLength: 254, example: 'architect@example.com' })
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty({ format: 'password', minLength: 12, maxLength: 128, writeOnly: true })
  @IsString()
  @MinLength(12)
  @MaxLength(128)
  password!: string;
}

export class CreateSessionDto {
  @ApiProperty({ format: 'email', maxLength: 254 })
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty({ format: 'password', minLength: 1, maxLength: 128, writeOnly: true })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password!: string;
}

export class UserResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'email' })
  email!: string;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export class SessionResponseDto {
  @ApiProperty({ minLength: 1, description: 'Opaque bearer token. Store securely.' })
  accessToken!: string;

  @ApiProperty({ enum: ['Bearer'], example: 'Bearer' })
  tokenType!: 'Bearer';

  @ApiProperty({ format: 'date-time' })
  expiresAt!: string;
}
