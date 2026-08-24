import type { JsonSchema } from './types.ts';

export function stubForSchema(schema: JsonSchema): unknown {
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0];

  switch (schema.type) {
    case 'object': {
      const object: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(schema.properties ?? {})) {
        object[key] = stubForSchema(child);
      }
      return object;
    }
    case 'array': {
      const count = Math.max(1, schema.minItems ?? 1);
      const item = schema.items ? stubForSchema(schema.items) : null;
      return Array.from({ length: count }, () => item);
    }
    case 'integer':
    case 'number':
      return schema.minimum ?? 0;
    case 'boolean':
      return false;
    case 'null':
      return null;
    default:
      return 'dry-run';
  }
}
