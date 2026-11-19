// Mirrors dsh-tools' assertSupportedJsonSchema subset check against this plugin's schemas.
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync } from 'node:fs';

process.env.DSH_HOME = mkdtempSync(path.join(os.tmpdir(), 'dsh-keyless-search-schema-'));
const { apply } = await import('../lib/plugin.js');

const CONSTRAINT = new Set(['type', 'oneOf', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'const']);
const ANNOTATION = new Set(['description', 'title', 'default', 'examples']);
const TYPES = ['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'];
const ON_TYPE = {
  properties: ['object'],
  required: ['object'],
  additionalProperties: ['object'],
  items: ['array'],
  enum: ['string', 'number', 'integer', 'boolean', 'null'],
  const: ['string', 'number', 'integer', 'boolean', 'null'],
};

function validate(node, path, violations) {
  if (node === null || typeof node !== 'object' || Array.isArray(node)) {
    violations.push(`${path} must be a schema object`);
    return;
  }
  for (const key of Object.keys(node)) {
    if (CONSTRAINT.has(key)) continue;
    if (ANNOTATION.has(key)) continue;
    violations.push(`${path}.${key} is not a supported keyword`);
  }
  const hasType = Object.hasOwn(node, 'type');
  const hasOneOf = Object.hasOwn(node, 'oneOf');
  if (hasType && hasOneOf) return violations.push(`${path} cannot declare both type and oneOf`);
  if (!hasType && !hasOneOf) return;
  if (hasOneOf) {
    const list = node.oneOf;
    if (!Array.isArray(list) || list.length < 2) violations.push(`${path}.oneOf must have >= 2 schemas`);
    else list.forEach((child, index) => validate(child, `${path}.oneOf[${index}]`, violations));
    return;
  }
  if (typeof node.type !== 'string' || !TYPES.includes(node.type)) return violations.push(`${path}.type must be one of ${TYPES.join('/')}`);
  for (const [key, types] of Object.entries(ON_TYPE)) {
    if (Object.hasOwn(node, key) && !types.includes(node.type)) violations.push(`${path}.${key} is not supported on type "${node.type}"`);
  }
  if (node.type === 'object') {
    if (Object.hasOwn(node, 'required') && (!Array.isArray(node.required) || node.required.some((key) => typeof key !== 'string'))) {
      violations.push(`${path}.required must be an array of strings`);
    }
    for (const [key, child] of Object.entries(node.properties ?? {})) validate(child, `${path}.properties.${key}`, violations);
    if (Object.hasOwn(node, 'required')) {
      for (const key of node.required) if (!Object.hasOwn(node.properties ?? {}, key)) violations.push(`${path}.required names "${key}" which is not in properties`);
    }
  }
  if (node.type === 'array' && Object.hasOwn(node, 'items')) validate(node.items, `${path}.items`, violations);
}

let capturedTool = null;
await apply(
  {
    get: () => undefined,
    effect: (fn) => { fn(); return () => {}; },
    provide: () => {},
    web: { registerSearchProvider: () => () => {} },
    tools: { register: (definition) => { capturedTool = definition; return () => {}; } },
    webServer: { register: () => () => {} },
  },
  {},
);

const violations = [];
validate(capturedTool.parameters, 'parameters', violations);
validate(capturedTool.output.schema, 'output.schema', violations);
if (typeof capturedTool.output.render !== 'function') violations.push('output.render missing');
if (typeof capturedTool.output.presentationMeta !== 'function') violations.push('output.presentationMeta missing');
if (typeof capturedTool.execute !== 'function') violations.push('execute missing');

console.log(violations.length === 0 ? 'SCHEMA OK 鈥?supported subset, object roots, required keys declared' : `SCHEMA VIOLATIONS:\n  ${violations.join('\n  ')}`);
process.exit(violations.length === 0 ? 0 : 1);