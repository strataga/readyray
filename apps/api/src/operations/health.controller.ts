import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { ApiContractResponse, ApiProblem } from '../http/api-problem.decorator.js';
import { READINESS_PROBE } from './readiness.port.js';
import type { ReadinessProbe } from './readiness.port.js';

class HealthStatus {
  @ApiProperty({ enum: ['ok', 'ready'] })
  status!: 'ok' | 'ready';
}

@ApiTags('operations')
@Controller('health')
export class HealthController {
  constructor(@Inject(READINESS_PROBE) private readonly readiness: ReadinessProbe) {}

  @Get('live')
  @ApiOperation({ summary: 'Process liveness' })
  @ApiContractResponse({ status: 200, description: 'The API process is running.', type: HealthStatus })
  @ApiProblem(500, 'The request could not be completed.')
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get('ready')
  @ApiOperation({ summary: 'Dependency readiness' })
  @ApiContractResponse({ status: 200, description: 'Required dependencies are ready.', type: HealthStatus })
  @ApiProblem(500, 'The request could not be completed.')
  @ApiProblem(503, 'A required dependency is unavailable.')
  async ready(): Promise<{ status: 'ready' }> {
    try {
      await this.readiness.check();
      return { status: 'ready' };
    } catch {
      throw new ServiceUnavailableException('A required dependency is unavailable.');
    }
  }
}
