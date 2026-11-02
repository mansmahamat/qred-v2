// Checks a response against the contract: declared status, content type, body schema.
import { readFileSync } from 'node:fs';
import { Ajv2020 } from 'ajv/dist/2020.js';
import * as addFormatsModule from 'ajv-formats';
import type { LightMyRequestResponse } from 'fastify';
import { expect } from 'vitest';
import { parse } from 'yaml';
import { contractPath } from '../src/contract/openapi.js';
import type { operations } from '../src/contract/types.js';

type Response = { $ref?: string; content?: Record<string, { schema: unknown }> };
type Doc = {
  paths: Record<string, Record<string, { operationId?: string; responses: Record<string, Response> }>>;
  components: { responses: Record<string, Response> };
};

const doc = parse(readFileSync(contractPath, 'utf8')) as Doc;

/** Stricter than clients need: our tests reject any field the contract doesn't declare. */
function forbidUndeclaredFields(node: unknown): void {
  if (Array.isArray(node)) return node.forEach(forbidUndeclaredFields);
  if (typeof node !== 'object' || node === null) return;
  const schema = node as Record<string, unknown>;
  if (schema.properties && typeof schema.properties === 'object' && !('additionalProperties' in schema)) {
    schema.additionalProperties = false;
  }
  Object.values(schema).forEach(forbidUndeclaredFields);
}
forbidUndeclaredFields(doc);

// strict: false so Ajv ignores OpenAPI-only keywords.
const ajv = new Ajv2020({ strict: false, allErrors: true });
// ajv-formats is CommonJS: under NodeNext its function is the namespace's `default`.
const addFormats = ((addFormatsModule as { default?: unknown }).default ?? addFormatsModule) as (ajv: Ajv2020) => unknown;
addFormats(ajv);
ajv.addSchema(doc, 'contract');

/** JSON Pointer escaping: `/v1/companies` → `~1v1~1companies`. */
const escape = (segment: string) => segment.replaceAll('~', '~0').replaceAll('/', '~1');

function findOperation(operationId: keyof operations) {
  for (const [path, methods] of Object.entries(doc.paths)) {
    for (const [method, operation] of Object.entries(methods)) {
      if (operation.operationId === operationId) return { path, method, operation };
    }
  }
  throw new Error(`Operation ${operationId} is not in the contract`);
}

export function expectToMatchContract(operationId: keyof operations, response: LightMyRequestResponse) {
  const { path, method, operation } = findOperation(operationId);
  const status = String(response.statusCode);

  let declared = operation.responses[status];
  expect(declared, `${operationId} returned ${status}, which the contract does not declare`).toBeDefined();
  let pointer = `#/paths/${escape(path)}/${method}/responses/${status}`;
  if (declared?.$ref) {
    pointer = declared.$ref;
    declared = doc.components.responses[declared.$ref.split('/').at(-1)!];
  }

  const [contentType] = Object.keys(declared?.content ?? {});
  expect(response.headers['content-type']).toContain(contentType);

  const validate = ajv.getSchema(`contract${pointer}/content/${escape(contentType!)}/schema`)!;
  const body: unknown = response.json();
  expect(validate(body) ? [] : validate.errors, `${operationId} ${status} does not match the contract`).toEqual([]);
}
