import type { ErrorRequestHandler } from 'express';

export const bodyParserProblem: ErrorRequestHandler = (error, request, response, next) => {
  if (response.headersSent) {
    return next(error);
  }
  const status = typeof error === 'object' && error !== null && 'status' in error &&
    typeof error.status === 'number' ? error.status : 400;
  const tooLarge = status === 413;
  const code = tooLarge ? 'payload_too_large' : 'malformed_request_body';
  const title = tooLarge ? 'Content Too Large' : 'Bad Request';
  response
    .status(tooLarge ? 413 : 400)
    .type('application/problem+json')
    .json({
      type: `urn:archgauge:problem:${code}`,
      title,
      status: tooLarge ? 413 : 400,
      detail: tooLarge ? 'The request body exceeds the allowed size.' : 'The request body is malformed.',
      instance: request.path,
      code,
      requestId: response.getHeader('x-request-id'),
    });
};
