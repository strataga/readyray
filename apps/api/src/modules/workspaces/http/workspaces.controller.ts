import { Body, Controller, Get, Inject, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedRequest } from '../../../http/authenticated-request.js';
import { ApiContractResponse, ApiProblem } from '../../../http/api-problem.decorator.js';
import { SessionGuard } from '../../../http/session.guard.js';
import { CreateWorkspace } from '../application/create-workspace.use-case.js';
import { ListWorkspaces } from '../application/list-workspaces.use-case.js';
import { WorkspaceResponseDto, CreateWorkspaceDto } from './workspace.dto.js';

@ApiTags('workspaces')
@ApiBearerAuth('bearer')
@UseGuards(SessionGuard)
@Controller()
export class WorkspacesController {
  constructor(
    @Inject(CreateWorkspace) private readonly createWorkspace: CreateWorkspace,
    @Inject(ListWorkspaces) private readonly listWorkspaces: ListWorkspaces,
  ) {}

  @Post('workspaces')
  @ApiOperation({
    summary: 'Create a workspace owned by the current user',
    description: 'Creates a workspace and grants the authenticated caller the owner role.',
  })
  @ApiBody({ type: CreateWorkspaceDto })
  @ApiContractResponse({ status: 201, description: 'Workspace created with the caller as owner.', type: WorkspaceResponseDto })
  @ApiProblem(400, 'Request validation failed.')
  @ApiProblem(401, 'A valid bearer session is required.')
  @ApiProblem(413, 'The request body exceeds the allowed size.')
  @ApiProblem(500, 'The request could not be completed.')
  @ApiProblem(503, 'The service is temporarily unavailable.')
  async create(
    @Req() request: AuthenticatedRequest,
    @Body() body: CreateWorkspaceDto,
  ): Promise<WorkspaceResponseDto> {
    const workspace = await this.createWorkspace.execute(body.name, request.userId);
    return { id: workspace.id, name: workspace.name, createdAt: workspace.createdAt.toISOString() };
  }

  @Get('workspaces')
  @ApiOperation({ summary: 'List workspaces visible to the current user' })
  @ApiContractResponse({ status: 200, description: 'Workspaces where the authenticated caller is a member.', type: WorkspaceResponseDto, isArray: true })
  @ApiProblem(401, 'A valid bearer session is required.')
  @ApiProblem(500, 'The request could not be completed.')
  @ApiProblem(503, 'The service is temporarily unavailable.')
  async list(@Req() request: AuthenticatedRequest): Promise<readonly WorkspaceResponseDto[]> {
    const workspaces = await this.listWorkspaces.execute(request.userId);
    return workspaces.map((workspace) => ({
      id: workspace.id,
      name: workspace.name,
      createdAt: workspace.createdAt.toISOString(),
    }));
  }
}
