import fs from 'node:fs';
import path from 'node:path';

export const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

export const write = (rel, data) => {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof data === 'string' ? data : `${JSON.stringify(data, null, 2)}\n`);
};

const words = (name) =>
  name
    .replace(/^_+/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/^./, (c) => c.toUpperCase());

// Turn a sample value into a Make interface (type/label/spec) list.
export const toInterface = (value) => {
  const out = [];
  for (const [name, v] of Object.entries(value)) {
    const label = words(name);
    if (Array.isArray(v)) {
      const first = v.find((x) => x !== null && x !== undefined);
      if (first && typeof first === 'object' && !Array.isArray(first)) {
        out.push({ name, type: 'array', label, spec: toInterface(first) });
      } else {
        out.push({ name, type: 'array', label, spec: { type: typeof first === 'number' ? 'number' : 'text' } });
      }
    } else if (v && typeof v === 'object') {
      out.push({ name, type: 'collection', label, spec: toInterface(v) });
    } else if (typeof v === 'number') {
      out.push({ name, type: 'number', label });
    } else if (typeof v === 'boolean') {
      out.push({ name, type: 'boolean', label });
    } else {
      out.push({ name, type: 'text', label });
    }
  }
  return out;
};
