import { Body, Controller, Delete, HttpCode, HttpStatus, Inject, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiContractResponse, ApiProblem } from '../../../http/api-problem.decorator.js';
import { CreateSession } from '../application/create-session.use-case.js';
import { RegisterUser } from '../application/register-user.use-case.js';
import { RevokeSession } from '../application/revoke-session.use-case.js';
import { SessionGuard } from '../../../http/session.guard.js';
import type { AuthenticatedRequest } from '../../../http/authenticated-request.js';
import { LoginRateLimitGuard } from '../../../http/login-rate-limit.guard.js';
import { SessionResponseDto, UserResponseDto, CreateSessionDto, RegisterUserDto } from './identity.dto.js';

@ApiTags('identity')
@Controller()
export class IdentityController {
  constructor(
    @Inject(RegisterUser) private readonly registerUser: RegisterUser,
    @Inject(CreateSession) private readonly createSession: CreateSession,
    @Inject(RevokeSession) private readonly revokeSession: RevokeSession,
  ) {}

  @Post('users')
  @ApiOperation({ summary: 'Register an account' })
  @ApiBody({ type: RegisterUserDto })
  @ApiContractResponse({ status: 201, description: 'User registered.', type: UserResponseDto })
  @ApiProblem(400, 'Request validation failed.')
  @ApiProblem(409, 'The email address is already registered.')
  @ApiProblem(413, 'The request body exceeds the allowed size.')
  @ApiProblem(500, 'The request could not be completed.')
  @ApiProblem(503, 'The service is temporarily unavailable.')
  async register(@Body() body: RegisterUserDto): Promise<UserResponseDto> {
    const user = await this.registerUser.execute(body.email, body.password);
    return { id: user.id, email: user.email, createdAt: user.createdAt.toISOString() };
  }

  @Post('sessions')
  @UseGuards(LoginRateLimitGuard)
  @ApiOperation({
    summary: 'Create a bearer session',
    description: 'Limited to 10 requests per source and 10 per normalized account email in a 15-minute window. If account tracking reaches capacity, new account keys are untracked while source throttling remains active. If source tracking reaches capacity, new sources are rejected until capacity becomes available.',
  })
  @ApiBody({ type: CreateSessionDto })
  @ApiContractResponse({ status: 201, description: 'Session created.', type: SessionResponseDto })
  @ApiProblem(400, 'Request validation failed.')
  @ApiProblem(401, 'Credentials are invalid.')
  @ApiProblem(413, 'The request body exceeds the allowed size.')
  @ApiProblem(500, 'The request could not be completed.')
  @ApiProblem(429, 'The source limit or a tracked account limit was exceeded, or source tracking capacity is saturated.', {
    'Retry-After': {
      description: 'Seconds until the active source and account limits may be retried.',
      schema: { type: 'integer' },
    },
  })
  @ApiProblem(503, 'The service is temporarily unavailable.')
  async login(@Body() body: CreateSessionDto): Promise<SessionResponseDto> {
    const session = await this.createSession.execute(body.email, body.password);
    return {
      accessToken: session.token,
      tokenType: 'Bearer',
      expiresAt: session.expiresAt.toISOString(),
    };
  }

  @Delete('sessions/current')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(SessionGuard)
  @ApiOperation({ summary: 'Revoke the current bearer session' })
  @ApiContractResponse({ status: 204, description: 'Session revoked.' })
  @ApiProblem(401, 'A valid bearer session is required.')
  async logout(@Req() request: AuthenticatedRequest): Promise<void> {
    const token = request.header('authorization')?.slice('Bearer '.length);
    if (token) { await this.revokeSession.execute(token); }
  }
}
