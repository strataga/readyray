import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { FindingClassification } from '@archgauge/reviews';

export class CreateReviewDto {
  @ApiProperty({ format: 'uuid' }) evidenceIntakeId!: string;
  @ApiPropertyOptional({ pattern: '^[a-fA-F0-9]{40}$', description: 'Exact source commit for GitHub imports. Omit for ZIP evidence.' }) sourceCommitSha?: string;
}
export class CitationDto {
  @ApiProperty() path!: string;
  @ApiProperty({ minimum: 1 }) startLine!: number;
  @ApiProperty({ minimum: 1 }) endLine!: number;
  @ApiProperty({ pattern: '^[a-fA-F0-9]{64}$' }) sha256!: string;
}
export class AddFindingDto {
  @ApiProperty({ enum: ['fact', 'inference', 'assumption', 'insufficient_evidence'] }) classification!: FindingClassification;
  @ApiProperty() title!: string;
  @ApiProperty() description!: string;
  @ApiProperty({ type: [CitationDto] }) citations!: CitationDto[];
}
export class DecideFindingDto { @ApiProperty({ enum: ['approve', 'reject'] }) decision!: 'approve' | 'reject'; }
export class ReviewResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) workspaceId!: string;
  @ApiProperty({ format: 'uuid' }) evidenceIntakeId!: string;
  @ApiPropertyOptional({ pattern: '^[a-f0-9]{40}$' }) sourceCommitSha?: string;
  @ApiProperty({ enum: ['draft', 'published'] }) status!: 'draft' | 'published';
  @ApiProperty() createdAt!: string;
  @ApiProperty({ type: 'array', items: { type: 'object' } }) findings!: readonly object[];
  @ApiProperty() version!: number;
  @ApiPropertyOptional() publishedAt?: string;
}
