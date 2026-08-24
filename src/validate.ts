import type { JsonSchema } from './types.ts';

export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = [fenced?.[1], trimmed].filter((c): c is string => typeof c === 'string');

  for (const candidate of candidates) {
    const direct = tryParse(candidate);
    if (direct.ok) return direct.value;
    const sliced = sliceBalanced(candidate);
    if (sliced !== null) {
      const parsed = tryParse(sliced);
      if (parsed.ok) return parsed.value;
    }
  }
  throw new Error('no JSON object or array found in agent output');
}

function tryParse(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

function sliceBalanced(text: string): string | null {
  const start = text.search(/[{[]/);
  if (start === -1) return null;
  const open = text[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === open) depth += 1;
    else if (ch === close) {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

export function validate(value: unknown, schema: JsonSchema, path = '$'): string[] {
  const errors: string[] = [];

  if (schema.enum && !schema.enum.some((option) => deepEqual(option, value))) {
    errors.push(`${path}: expected one of ${JSON.stringify(schema.enum)}, got ${JSON.stringify(value)}`);
    return errors;
  }

  if (schema.type && !matchesType(value, schema.type)) {
    errors.push(`${path}: expected ${schema.type}, got ${describe(value)}`);
    return errors;
  }

  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) {
      errors.push(`${path}: ${value} is below minimum ${schema.minimum}`);
    }
    if (typeof schema.maximum === 'number' && value > schema.maximum) {
      errors.push(`${path}: ${value} is above maximum ${schema.maximum}`);
    }
  }

  if (Array.isArray(value)) {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) {
      errors.push(`${path}: expected at least ${schema.minItems} items, got ${value.length}`);
    }
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) {
      errors.push(`${path}: expected at most ${schema.maxItems} items, got ${value.length}`);
    }
    if (schema.items) {
      value.forEach((item, index) => {
        errors.push(...validate(item, schema.items as JsonSchema, `${path}[${index}]`));
      });
    }
    return errors;
  }

  if (isPlainObject(value)) {
    for (const key of schema.required ?? []) {
      if (!(key in value)) errors.push(`${path}: missing required property "${key}"`);
    }
    for (const [key, child] of Object.entries(schema.properties ?? {})) {
      if (key in value) errors.push(...validate(value[key], child, `${path}.${key}`));
    }
    if (schema.additionalProperties === false && schema.properties) {
      for (const key of Object.keys(value)) {
        if (!(key in schema.properties)) errors.push(`${path}: unexpected property "${key}"`);
      }
    }
  }

  return errors;
}

function matchesType(value: unknown, type: string): boolean {
  if (type === 'object') return isPlainObject(value);
  if (type === 'array') return Array.isArray(value);
  if (type === 'string') return typeof value === 'string';
  if (type === 'boolean') return typeof value === 'boolean';
  if (type === 'null') return value === null;
  if (type === 'integer') return typeof value === 'number' && Number.isInteger(value);
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  return true;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
