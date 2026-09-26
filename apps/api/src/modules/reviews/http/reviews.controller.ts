import { Body, Controller, Get, HttpException, HttpStatus, Inject, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { AuthenticatedRequest } from '../../../http/authenticated-request.js';
import { ApiContractResponse, ApiProblem } from '../../../http/api-problem.decorator.js';
import { SessionGuard } from '../../../http/session.guard.js';
import { EVIDENCE_ARCHIVE_STORAGE, EVIDENCE_WORKSPACE_AUTHORIZATION } from '../../evidence/http/evidence.tokens.js';
import type { EvidenceArchiveInventoryReadPort, WorkspaceEvidenceAuthorizationPort } from '@archgauge/evidence/application';
import { ReviewsApplicationError, ReviewsService } from '../application/reviews.service.js';
import type { ReviewRepository } from '../application/reviews.port.js';
import { REVIEW_REPOSITORY } from '../application/reviews.port.js';
import { AddFindingDto, CreateReviewDto, DecideFindingDto, ReviewResponseDto } from './reviews.dto.js';

@ApiTags('reviews') @ApiBearerAuth('bearer') @UseGuards(SessionGuard) @Controller()
export class ReviewsController {
  private readonly service: ReviewsService;
  constructor(@Inject(REVIEW_REPOSITORY) repository: ReviewRepository,
    @Inject(EVIDENCE_WORKSPACE_AUTHORIZATION) authorization: WorkspaceEvidenceAuthorizationPort,
    @Inject(EVIDENCE_ARCHIVE_STORAGE) inventory: EvidenceArchiveInventoryReadPort) {
    this.service = new ReviewsService(repository, authorization, inventory);
  }
  @Post('workspaces/:workspaceId/reviews')
  @ApiOperation({ summary: 'Create an empty reviewer draft for an accepted evidence intake' }) @ApiParam({ name: 'workspaceId', format: 'uuid' }) @ApiBody({ type: CreateReviewDto }) @ApiContractResponse({ status: 201, type: ReviewResponseDto, description: 'Review draft created; no automated findings are generated.' })
  @ApiProblem(400, 'The request is invalid.') @ApiProblem(401, 'A valid bearer session is required.') @ApiProblem(403, 'Workspace access is denied.') @ApiProblem(404, 'Accepted evidence intake was not found.') @ApiProblem(503, 'Review storage or authorization is unavailable.')
  async create(@Param('workspaceId') workspaceId: string, @Body() body: CreateReviewDto, @Req() request: AuthenticatedRequest): Promise<ReviewResponseDto> {
    return toResponse(await this.invoke(() => this.service.create(request.userId, workspaceId, body?.evidenceIntakeId, body?.sourceCommitSha)));
  }
  @Get('workspaces/:workspaceId/reviews')
  @ApiOperation({ summary: 'List reviews in a workspace' }) @ApiContractResponse({ status: 200, type: ReviewResponseDto, isArray: true, description: 'Workspace review drafts and published reviews.' })
  @ApiProblem(400, 'Workspace identifier is invalid.') @ApiProblem(401, 'A valid bearer session is required.') @ApiProblem(403, 'Workspace access is denied.') @ApiProblem(503, 'Review storage or authorization is unavailable.')
  async list(@Param('workspaceId') workspaceId: string, @Req() request: AuthenticatedRequest): Promise<readonly ReviewResponseDto[]> {
    return (await this.invoke(() => this.service.list(request.userId, workspaceId))).map(toResponse);
  }
  @Get('workspaces/:workspaceId/reviews/:reviewId')
  @ApiOperation({ summary: 'Get a review and its human findings' }) @ApiContractResponse({ status: 200, type: ReviewResponseDto, description: 'Review details and citations.' })
  @ApiProblem(400, 'An identifier is invalid.') @ApiProblem(401, 'A valid bearer session is required.') @ApiProblem(403, 'Workspace access is denied.') @ApiProblem(404, 'Review was not found.') @ApiProblem(503, 'Review storage or authorization is unavailable.')
  async get(@Param('workspaceId') workspaceId: string, @Param('reviewId') reviewId: string, @Req() request: AuthenticatedRequest): Promise<ReviewResponseDto> {
    return toResponse(await this.invoke(() => this.service.get(request.userId, workspaceId, reviewId)));
  }
  @Post('workspaces/:workspaceId/reviews/:reviewId/findings')
  @ApiOperation({ summary: 'Add a manually proposed finding with exact evidence citations' }) @ApiBody({ type: AddFindingDto }) @ApiContractResponse({ status: 201, type: ReviewResponseDto, description: 'Updated review with a proposed finding.' })
  @ApiProblem(400, 'Finding or evidence citation is invalid.') @ApiProblem(401, 'A valid bearer session is required.') @ApiProblem(403, 'Workspace access is denied.') @ApiProblem(404, 'Review or evidence intake was not found.') @ApiProblem(409, 'Review is not editable or changed concurrently.') @ApiProblem(503, 'Review storage or authorization is unavailable.')
  async addFinding(@Param('workspaceId') workspaceId: string, @Param('reviewId') reviewId: string, @Body() body: AddFindingDto, @Req() request: AuthenticatedRequest): Promise<ReviewResponseDto> {
    return toResponse(await this.invoke(() => this.service.addFinding(request.userId, workspaceId, reviewId, body)));
  }
  @Post('workspaces/:workspaceId/reviews/:reviewId/findings/:findingId/decision')
  @ApiOperation({ summary: 'Record a human approve or reject decision' }) @ApiBody({ type: DecideFindingDto }) @ApiContractResponse({ status: 200, type: ReviewResponseDto, description: 'Review with the recorded reviewer decision.' })
  @ApiProblem(400, 'Decision input is invalid.') @ApiProblem(401, 'A valid bearer session is required.') @ApiProblem(403, 'Workspace access is denied.') @ApiProblem(404, 'Review or finding was not found.') @ApiProblem(409, 'Finding is already resolved or review changed concurrently.') @ApiProblem(503, 'Review storage or authorization is unavailable.')
  async decide(@Param('workspaceId') workspaceId: string, @Param('reviewId') reviewId: string, @Param('findingId') findingId: string, @Body() body: DecideFindingDto, @Req() request: AuthenticatedRequest): Promise<ReviewResponseDto> {
    return toResponse(await this.invoke(() => this.service.decide(request.userId, workspaceId, reviewId, findingId, body?.decision)));
  }
  @Post('workspaces/:workspaceId/reviews/:reviewId/publish')
  @ApiOperation({ summary: 'Publish a resolved review after at least one explicit approval' }) @ApiContractResponse({ status: 200, type: ReviewResponseDto, description: 'Published review.' })
  @ApiProblem(401, 'A valid bearer session is required.') @ApiProblem(403, 'Workspace access is denied.') @ApiProblem(404, 'Review was not found.') @ApiProblem(409, 'Review has unresolved findings or no approval.') @ApiProblem(503, 'Review storage or authorization is unavailable.')
  async publish(@Param('workspaceId') workspaceId: string, @Param('reviewId') reviewId: string, @Req() request: AuthenticatedRequest): Promise<ReviewResponseDto> {
    return toResponse(await this.invoke(() => this.service.publish(request.userId, workspaceId, reviewId)));
  }
  @Get('workspaces/:workspaceId/reviews/:reviewId/export')
  @ApiOperation({ summary: 'Export a published review' }) @ApiQuery({ name: 'format', enum: ['json', 'html', 'markdown'], required: false }) @ApiContractResponse({ status: 200, description: 'Published review export.' })
  @ApiProblem(400, 'Export format or identifier is invalid.') @ApiProblem(401, 'A valid bearer session is required.') @ApiProblem(403, 'Workspace access is denied.') @ApiProblem(404, 'Review was not found.') @ApiProblem(409, 'Only published reviews can be exported.') @ApiProblem(503, 'Review storage or authorization is unavailable.')
  async export(@Param('workspaceId') workspaceId: string, @Param('reviewId') reviewId: string, @Query('format') format: string | undefined, @Req() request: AuthenticatedRequest, @Res() writer: Response): Promise<void> {
    const review = await this.invoke(() => this.service.get(request.userId, workspaceId, reviewId));
    if (review.status !== 'published') {throw new HttpException('conflict', HttpStatus.CONFLICT);}
    const selected = format ?? 'json';
    if (!['json', 'html', 'markdown'].includes(selected)) {throw new HttpException('invalid_input', HttpStatus.BAD_REQUEST);}
    const body = selected === 'json' ? JSON.stringify(toResponse(review), null, 2) : selected === 'html' ? renderHtml(review) : renderMarkdown(review);
    writer.setHeader('Content-Type', selected === 'json' ? 'application/json; charset=utf-8' : selected === 'html' ? 'text/html; charset=utf-8' : 'text/markdown; charset=utf-8');
    writer.setHeader('Content-Disposition', `attachment; filename="review-${review.id}.${selected === 'markdown' ? 'md' : selected}"`);
    writer.send(body);
  }
  private async invoke<T>(operation: () => Promise<T>): Promise<T> {
    try { return await operation(); } catch (error) {
      if (!(error instanceof ReviewsApplicationError)) {throw error;}
      const status = error.code === 'invalid_input' ? HttpStatus.BAD_REQUEST : error.code === 'forbidden' ? HttpStatus.FORBIDDEN : error.code === 'not_found' ? HttpStatus.NOT_FOUND : error.code === 'conflict' ? HttpStatus.CONFLICT : HttpStatus.SERVICE_UNAVAILABLE;
      throw new HttpException(error.code, status);
    }
  }
}

function toResponse(review: Awaited<ReturnType<ReviewsService['get']>>): ReviewResponseDto {
  return { id: review.id, workspaceId: review.workspaceId, evidenceIntakeId: review.evidenceIntakeId, ...(review.sourceCommitSha ? { sourceCommitSha: review.sourceCommitSha } : {}), status: review.status, createdAt: review.createdAt, version: review.version, ...(review.publishedAt ? { publishedAt: review.publishedAt } : {}), findings: review.findings.map((finding) => ({ ...finding, citations: finding.citations.map((citation) => ({ ...citation })) })) };
}
function escapeHtml(value: string): string { return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;'); }
function renderHtml(review: Awaited<ReturnType<ReviewsService['get']>>): string {
  const source = review.sourceCommitSha ? `<p>Source commit: <code>${escapeHtml(review.sourceCommitSha)}</code></p>` : '';
  return `<!doctype html><html><head><meta charset="utf-8"><title>Review ${escapeHtml(review.id)}</title></head><body><h1>Review ${escapeHtml(review.id)}</h1><p>Status: published</p>${source}<ul>${review.findings.map((finding) => `<li><strong>${escapeHtml(finding.classification)}: ${escapeHtml(finding.title)}</strong><p>${escapeHtml(finding.description)}</p><ul>${finding.citations.map((citation) => `<li>${escapeHtml(citation.path)}:${citation.startLine}-${citation.endLine} sha256:${escapeHtml(citation.sha256)}</li>`).join('')}</ul></li>`).join('')}</ul></body></html>`;
}
function renderMarkdown(review: Awaited<ReturnType<ReviewsService['get']>>): string {
  const source = review.sourceCommitSha ? `\n\nSource commit: \`${review.sourceCommitSha}\`` : '';
  return `# Review ${review.id}\n\nStatus: published\n\nEvidence intake: ${review.evidenceIntakeId}${source}\n\n${review.findings.map((finding) => `## ${finding.classification}: ${finding.title.replaceAll('\n', ' ')}\n\n${finding.description.replaceAll('\n', ' ')}\n\n${finding.citations.map((citation) => `- \`${citation.path}:${citation.startLine}-${citation.endLine}\` (SHA-256 \`${citation.sha256}\`)`).join('\n')}`).join('\n\n')}`;
}
