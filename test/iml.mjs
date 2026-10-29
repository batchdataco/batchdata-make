// A small evaluator for the subset of IML (Make's expression language) used by this app.
// It is NOT Make's real engine. It exists so the request bodies can be checked offline.
const isEmpty = (v) => v === undefined || v === null || v === '';
const fns = {
  ifempty: (a, b) => (isEmpty(a) ? b : a),
  __if: (c, a, b) => (c ? a : b),
  omit: (o, ...keys) => Object.fromEntries(Object.entries(o || {}).filter(([k]) => !keys.includes(k))),
  length: (v) => (v === undefined || v === null ? 0 : v.length),
  first: (a) => (Array.isArray(a) ? a[0] : undefined),
  lower: (s) => String(s ?? '').toLowerCase(),
  trim: (s) => String(s ?? '').trim(),
  contains: (s, x) => (s ?? '').includes(x),
  replace: (s, a, b) => String(s ?? '').split(a).join(b),
  formatDate: (d) => (d ? new Date(d).toISOString().slice(0, 10) : undefined),
  parseJSON: (s) => (s === undefined || s === null || s === '' ? undefined : JSON.parse(s)),
  toCollection: (arr, k, v) => Object.fromEntries((arr || []).map((e) => [e[k], e[v]])),
};

const evalExpr = (expr, scope) => {
  // IML reads missing paths as empty instead of failing, so use optional chaining.
  const js = expr.replace(/\bif\(/g, '__if(').replace(/([\w)\]])\.(?=[A-Za-z_])/g, '$1?.');
  const f = new Function('scope', 'fns', `with (fns) { with (scope) { return (${js}); } }`);
  return f(scope, fns);
};

const whole = /^\{\{([\s\S]*)\}\}$/;

export const render = (node, scope) => {
  if (typeof node === 'string') {
    const m = node.match(whole);
    if (m && !m[1].includes('{{')) return m[1].trim() === '...' ? node : evalExpr(m[1], scope);
    return node.replace(/\{\{([\s\S]*?)\}\}/g, (_, e) => {
      const v = evalExpr(e, scope);
      return v === undefined || v === null ? '' : String(v);
    });
  }
  if (Array.isArray(node)) return node.map((n) => render(n, scope)).filter((v) => v !== undefined);
  if (node && typeof node === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(node)) {
      if (k === '{{...}}') {
        Object.assign(out, render(v, scope));
        continue;
      }
      const r = render(v, scope);
      if (r !== undefined) out[k] = r;
    }
    return out;
  }
  return node;
};
