import { applyDecorators } from '@nestjs/common';
import { ApiExtraModels, ApiResponse, getSchemaPath } from '@nestjs/swagger';
import type { ApiResponseOptions } from '@nestjs/swagger';
import { ProblemDetailsDto } from './problem-details.dto.js';

export function ApiProblem(
  status: number,
  description: string,
  headers?: ApiResponseOptions['headers'],
): MethodDecorator {
  return applyDecorators(
    ApiExtraModels(ProblemDetailsDto),
    ApiResponse({
      status,
      description,
      headers: withRequestIdHeader(headers),
      content: {
        'application/problem+json': {
          schema: { $ref: getSchemaPath(ProblemDetailsDto) },
        },
      },
    }),
  );
}

export function ApiContractResponse(options: ApiResponseOptions): MethodDecorator {
  return applyDecorators(
    ApiResponse({
      ...options,
      headers: withRequestIdHeader(options.headers),
    }),
  );
}

function withRequestIdHeader(headers?: ApiResponseOptions['headers']): ApiResponseOptions['headers'] {
  return {
    ...headers,
    'X-Request-Id': {
      description: 'Correlation identifier assigned to this request.',
      schema: { type: 'string', format: 'uuid' },
    },
  };
}
