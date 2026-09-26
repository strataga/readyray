import {
  Catch,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import type { Request, Response } from 'express';
import { IdentityInputError } from '../modules/identity/domain/user.js';
import { IdentityUseCaseError } from '../modules/identity/application/identity-errors.js';
import { WorkspaceInputError } from '../modules/workspaces/domain/workspace.js';
import { PasswordHashCapacityError } from '../modules/identity/application/security.port.js';
import { EvidenceUploadHttpError } from '../modules/evidence/http/evidence-upload.error.js';

@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request & { id?: string }>();
    const response = http.getResponse<Response>();
    const problem = this.describe(exception);
    const requestId = response.getHeader('x-request-id');
    if (problem.code === 'upload_busy') {
      response.setHeader('Retry-After', '1');
    }

    if (problem.status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      process.stderr.write(`${JSON.stringify({
        level: 'error',
        event: 'unexpected_http_error',
        requestId,
        exceptionType: safeExceptionType(exception),
      })}\n`);
    }

    response
      .status(problem.status)
      .type('application/problem+json')
      .json({
        type: `urn:archgauge:problem:${problem.code}`,
        title: problem.title,
        status: problem.status,
        detail: problem.detail,
        instance: request.path,
        code: problem.code,
        requestId,
      });
  }

  private describe(exception: unknown): { status: number; title: string; detail: string; code: string } {
    if (exception instanceof EvidenceUploadHttpError) {
      return {
        status: exception.getStatus(),
        title: titleForStatus(exception.getStatus()),
        detail: exception.safeDetail,
        code: exception.problemCode,
      };
    }
    if (exception instanceof PasswordHashCapacityError || isPostgresUnavailable(exception)) {
      return {
        status: HttpStatus.SERVICE_UNAVAILABLE,
        title: 'Service Unavailable',
        detail: 'The service is temporarily unavailable.',
        code: 'service_unavailable',
      };
    }
    if (exception instanceof IdentityInputError) {
      return { status: HttpStatus.BAD_REQUEST, title: 'Bad Request', detail: 'Identity input is invalid.', code: exception.code };
    }
    if (exception instanceof WorkspaceInputError) {
      return { status: HttpStatus.BAD_REQUEST, title: 'Bad Request', detail: 'Workspace name is invalid.', code: 'invalid_workspace_name' };
    }
    if (exception instanceof IdentityUseCaseError) {
      switch (exception.code) {
        case 'email_conflict': return { status: HttpStatus.CONFLICT, title: 'Conflict', detail: 'An account with that email already exists.', code: exception.code };
        case 'invalid_credentials': return { status: HttpStatus.UNAUTHORIZED, title: 'Unauthorized', detail: 'Email or password is incorrect.', code: exception.code };
        case 'unauthorized': return { status: HttpStatus.UNAUTHORIZED, title: 'Unauthorized', detail: 'A valid session is required.', code: exception.code };
      }
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const mapped = status === HttpStatus.BAD_REQUEST
        ? { code: 'validation_error', detail: 'The request is invalid.' }
        : status === HttpStatus.UNAUTHORIZED
          ? { code: 'unauthorized', detail: 'A valid session is required.' }
          : status === HttpStatus.FORBIDDEN
            ? { code: 'access_denied', detail: 'Access is denied.' }
            : status === HttpStatus.NOT_FOUND
              ? { code: 'not_found', detail: 'The requested resource was not found.' }
              : status === HttpStatus.CONFLICT
                ? { code: 'conflict', detail: 'The request conflicts with current state.' }
                : status === HttpStatus.TOO_MANY_REQUESTS
                  ? { code: 'rate_limited', detail: 'Too many requests. Try again later.' }
                  : status === HttpStatus.SERVICE_UNAVAILABLE
                    ? { code: 'service_unavailable', detail: 'The service is temporarily unavailable.' }
                    : status >= 500
                  ? { code: 'internal_error', detail: 'The request could not be completed.' }
                  : { code: `http_${status}`, detail: 'The request could not be completed.' };
      return { status, title: titleForStatus(status), ...mapped };
    }
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      title: 'Internal Server Error',
      detail: 'The request could not be completed.',
      code: 'internal_error',
    };
  }
}

function safeExceptionType(exception: unknown): string {
  if (exception === null) {
    return 'null';
  }
  if (typeof exception !== 'object' && typeof exception !== 'function') {
    return typeof exception;
  }

  try {
    const prototype = Object.getPrototypeOf(exception);
    const constructor = prototype && Object.getOwnPropertyDescriptor(prototype, 'constructor')?.value;
    const name = typeof constructor === 'function'
      ? Object.getOwnPropertyDescriptor(constructor, 'name')?.value
      : undefined;
    return typeof name === 'string' && /^[A-Za-z_$][A-Za-z0-9_$]{0,63}$/.test(name)
      ? name
      : typeof exception === 'function' ? 'Function' : 'Object';
  } catch {
    return 'Object';
  }
}

function isPostgresUnavailable(exception: unknown): boolean {
  if (typeof exception !== 'object' || exception === null) {
    return false;
  }
  const error = exception as { code?: unknown; message?: unknown };
  if (typeof error.code === 'string') {
    return /^08[A-Z0-9]{3}$/.test(error.code) ||
      ['53300', '57014', '57P01', '57P02', '57P03', 'ECONNREFUSED', 'ECONNRESET',
        'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH', 'ENOTFOUND', 'EAI_AGAIN'].includes(error.code);
  }
  return error.message === 'Query read timeout' ||
    error.message === 'timeout exceeded when trying to connect';
}

function titleForStatus(status: number): string {
  switch (status) {
    case HttpStatus.BAD_REQUEST: return 'Bad Request';
    case HttpStatus.UNAUTHORIZED: return 'Unauthorized';
    case HttpStatus.FORBIDDEN: return 'Forbidden';
    case HttpStatus.NOT_FOUND: return 'Not Found';
    case HttpStatus.CONFLICT: return 'Conflict';
    case HttpStatus.PAYLOAD_TOO_LARGE: return 'Content Too Large';
    case HttpStatus.TOO_MANY_REQUESTS: return 'Too Many Requests';
    case HttpStatus.SERVICE_UNAVAILABLE: return 'Service Unavailable';
    default: return status >= 500 ? 'Internal Server Error' : 'Request Failed';
  }
}
