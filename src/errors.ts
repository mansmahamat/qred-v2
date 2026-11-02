import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import type { components } from './contract/types.js';

type Problem = components['schemas']['Problem'];

/** Expected error, sent as an RFC 9457 problem. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly title: string,
    readonly detail?: string,
  ) {
    super(title);
  }
}

// Same 404 for "not yours" and "doesn't exist".
export const errors = {
  unauthorized: () => new ApiError(401, 'UNAUTHORIZED', 'Unauthorized'),
  companyNotFound: () => new ApiError(404, 'COMPANY_NOT_FOUND', 'Company not found'),
  cardNotFound: () => new ApiError(404, 'CARD_NOT_FOUND', 'Card not found'),
  invalidCursor: () => new ApiError(400, 'INVALID_CURSOR', 'Invalid cursor'),
  cardNotActivatable: (status: string) =>
    new ApiError(409, 'CARD_NOT_ACTIVATABLE', 'Card cannot be activated', `The card is ${status}.`),
};

const problemTypes: Record<string, string> = {
  UNAUTHORIZED: 'unauthorized',
  COMPANY_NOT_FOUND: 'not-found',
  CARD_NOT_FOUND: 'not-found',
  ROUTE_NOT_FOUND: 'not-found',
  INVALID_CURSOR: 'invalid-cursor',
  VALIDATION_ERROR: 'validation-error',
  BAD_REQUEST: 'bad-request',
  CARD_NOT_ACTIVATABLE: 'card-not-activatable',
  INTERNAL_ERROR: 'internal-error',
};

function sendProblem(reply: FastifyReply, status: number, code: string, title: string, detail?: string) {
  const problem: Problem = {
    type: `https://qred.example/problems/${problemTypes[code] ?? 'error'}`,
    title,
    status,
    code,
    ...(detail ? { detail } : {}),
  };
  return reply.status(status).type('application/problem+json').send(problem);
}

export function errorHandler(error: FastifyError, request: FastifyRequest, reply: FastifyReply) {
  if (error instanceof ApiError) {
    return sendProblem(reply, error.status, error.code, error.title, error.detail);
  }
  // Contract validation errors.
  if (error.validation) {
    return sendProblem(reply, 400, 'VALIDATION_ERROR', 'Invalid request', error.message);
  }
  // Other client errors from Fastify (bad JSON, wrong content type).
  if (error.statusCode && error.statusCode < 500) {
    return sendProblem(reply, error.statusCode, 'BAD_REQUEST', 'Bad request', error.message);
  }
  // Unexpected: log it, don't leak details.
  request.log.error({ err: error }, 'Unhandled error');
  return sendProblem(reply, 500, 'INTERNAL_ERROR', 'Something went wrong');
}

export function notFoundHandler(_request: FastifyRequest, reply: FastifyReply) {
  return sendProblem(reply, 404, 'ROUTE_NOT_FOUND', 'Route not found');
}
