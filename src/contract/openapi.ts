import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance, FastifySchema, HTTPMethods } from 'fastify';
import { parse } from 'yaml';

// Routes take their URL, params and schemas from the contract, so the code can't drift from it.

type JsonSchema = Record<string, unknown>;
type Parameter = { name: string; in: 'path' | 'query'; required?: boolean; schema: JsonSchema };
type Operation = {
  operationId: string;
  parameters?: (Parameter | { $ref: string })[];
  responses: Record<string, { content?: Record<string, { schema: JsonSchema }> } | { $ref: string }>;
};

export const contractPath = fileURLToPath(new URL('../../contract/openapi.yaml', import.meta.url));
export const contractYaml = readFileSync(contractPath, 'utf8');
const doc = parse(contractYaml) as {
  paths: Record<string, Partial<Record<string, Operation>>>;
  components: { schemas: Record<string, JsonSchema>; parameters: Record<string, Parameter> };
};

/** `maxItems` of `LatestTransactions.items` in the contract. */
export const dashboardPreviewSize = (() => {
  const items = (doc.components.schemas.LatestTransactions?.properties as { items?: { maxItems?: unknown } } | undefined)
    ?.items;
  if (typeof items?.maxItems !== 'number') throw new Error('LatestTransactions.items.maxItems is missing in the contract');
  return items.maxItems;
})();

/** `#/components/schemas/Card` → `Card#`, the id Fastify uses for shared schemas. */
function toFastifyRefs<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value).replaceAll(/"#\/components\/schemas\/(\w+)"/g, '"$1#"'),
  ) as T;
}

function resolveParameter(p: Parameter | { $ref: string }): Parameter {
  if (!('$ref' in p)) return p;
  const name = p.$ref.replace('#/components/parameters/', '');
  const resolved = doc.components.parameters[name];
  if (!resolved) throw new Error(`Unknown parameter ${p.$ref} in the contract`);
  return resolved;
}

function objectSchema(params: Parameter[]): JsonSchema | undefined {
  if (params.length === 0) return undefined;
  return {
    type: 'object',
    properties: Object.fromEntries(params.map((p) => [p.name, toFastifyRefs(p.schema)])),
    required: params.filter((p) => p.required).map((p) => p.name),
  };
}

/** Registers every `components.schemas` entry once, so routes can `$ref` them. */
export function registerContractSchemas(app: FastifyInstance) {
  for (const [name, schema] of Object.entries(doc.components.schemas)) {
    app.addSchema({ $id: name, ...toFastifyRefs(schema) });
  }
}

/** Method, URL and validation schemas of one contract operation, ready for `app.route()`. */
export function contractRoute(operationId: string): { method: HTTPMethods; url: string; schema: FastifySchema } {
  for (const [path, operations] of Object.entries(doc.paths)) {
    for (const [method, operation] of Object.entries(operations)) {
      if (operation?.operationId !== operationId) continue;

      const params = (operation.parameters ?? []).map(resolveParameter);
      // Only success bodies: serialising with the schema drops any field not in the contract.
      const response: Record<string, JsonSchema> = {};
      for (const [status, res] of Object.entries(operation.responses)) {
        if (!status.startsWith('2') || '$ref' in res) continue;
        const schema = res.content?.['application/json']?.schema;
        if (schema) response[status] = toFastifyRefs(schema);
      }

      const schema: FastifySchema = { response };
      const pathParams = objectSchema(params.filter((p) => p.in === 'path'));
      const queryParams = objectSchema(params.filter((p) => p.in === 'query'));
      if (pathParams) schema.params = pathParams;
      // No query params declared: unknown ones are ignored, not rejected.
      schema.querystring = queryParams ?? { type: 'object', properties: {} };
      if (!pathParams) schema.params = { type: 'object', properties: {} };

      return { method: method.toUpperCase() as HTTPMethods, url: path.replaceAll(/\{(\w+)\}/g, ':$1'), schema };
    }
  }
  throw new Error(`Operation ${operationId} is not in the contract`);
}
