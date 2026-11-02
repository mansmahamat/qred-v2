import type { FastifyRequest } from 'fastify';
import { errors } from './errors.js';

declare module 'fastify' {
  interface FastifyRequest {
    userId: string;
  }
}

/** Returns the user id, or undefined for an invalid token. */
export type VerifyToken = (token: string) => string | undefined | Promise<string | undefined>;

// TODO: verify a JWT from the identity provider. Until then, reject everything.
export const rejectAllTokens: VerifyToken = () => undefined;

export function authenticateWith(verifyToken: VerifyToken) {
  return async (request: FastifyRequest) => {
    const [scheme, token] = request.headers.authorization?.split(' ') ?? [];
    // "Bearer" is case-insensitive, the token isn't.
    const userId = scheme?.toLowerCase() === 'bearer' && token ? await verifyToken(token) : undefined;
    if (!userId) throw errors.unauthorized();
    request.userId = userId;
  };
}
