// Demo only. Imported by server.ts in demo mode, nowhere else.
import type { VerifyToken } from './auth.js';
import { demo } from './db/seed.js';

const tokens: Record<string, string> = {
  anna: demo.users.anna,
  bob: demo.users.bob,
  carl: demo.users.carl,
};

/** `Authorization: Bearer anna` logs in as Anna. */
export const demoTokens: VerifyToken = (token) => tokens[token];
