/**
 * CODIE Encoder
 * Encodes objects/AST into compressed CODIE syntax
 *
 * Output: TYPE{key:value,key:value,...}
 */

const { PRIMITIVES } = require('../primitives/catalog');

// Key abbreviations for maximum compression
const KEY_MAP = {
  domain: 'd',
  subdomain: 's',
  features: 'f',
  theme: 't',
  layout: 'l',
  title: 'h',
  content: 'c',
  type: 't',
  value: 'v',
  name: 'n',
  email: 'e',
  price: 'p',
  action: 'a',
  method: 'm',
  columns: 'c',
  gap: 'g',
  size: 's',
  width: 'w',
  height: 'h',
  source: 's',
  alt: 'a',
  label: 'l',
  items: 'i',
  rows: 'r',
  placeholder: 'p',
  required: 'q',
  xor: 'x'
};

// Reverse map for decoding
const KEY_UNMAP = Object.fromEntries(
  Object.entries(KEY_MAP).map(([k, v]) => [v, k])
);

/**
 * Encode an object to CODIE syntax
 * @param {string} type - Primitive type (e.g., 'APP', 'GRD')
 * @param {Object} props - Properties
 * @returns {string} CODIE string
 */
function encode(type, props) {
  if (!PRIMITIVES[type]) {
    throw new Error(`Unknown primitive: ${type}`);
  }

  const encoded = [];

  for (const [key, value] of Object.entries(props)) {
    // Skip undefined/null/empty
    if (value === undefined || value === null || value === '') continue;

    // Skip if matches default
    const primitive = PRIMITIVES[type];
    if (primitive.defaults && primitive.defaults[key] === value) continue;

    // Abbreviate key
    const k = KEY_MAP[key] || key;

    // Encode value
    let v;
    if (Array.isArray(value)) {
      v = value.join('+');
    } else if (typeof value === 'object') {
      // Nested object - recursively encode
      v = encodeNested(value);
    } else {
      v = String(value);
    }

    encoded.push(`${k}:${v}`);
  }

  return `${type}{${encoded.join(',')}}`;
}

/**
 * Encode nested object
 */
function encodeNested(obj) {
  const parts = [];
  for (const [key, value] of Object.entries(obj)) {
    const k = KEY_MAP[key] || key;
    const v = typeof value === 'object' ? encodeNested(value) : value;
    parts.push(`${k}:${v}`);
  }
  return parts.join(',');
}

/**
 * Encode a website definition
 * @param {Object} site - Website config
 * @returns {string} CODIE string
 */
function encodeWebsite(site) {
  const props = {
    d: site.domain,
    s: site.subdomain,
    f: site.features,
    t: site.theme,
    l: site.layout
  };

  // Filter out undefined
  const filtered = Object.fromEntries(
    Object.entries(props).filter(([_, v]) => v !== undefined)
  );

  return `W{${Object.entries(filtered).map(([k, v]) =>
    `${k}:${Array.isArray(v) ? v.join('+') : v}`
  ).join(',')}}`;
}

/**
 * Encode a mutation
 * @param {string} target - Target primitive
 * @param {Object} changes - Changes to apply
 * @returns {string} CODIE string
 */
function encodeMutation(target, changes) {
  const changesStr = encodeNested(changes);
  return `MUT{${target}:{${changesStr}}}`;
}

/**
 * Encode delta (changes only)
 * @param {Object} before - Previous state
 * @param {Object} after - New state
 * @returns {Object} Delta object
 */
function encodeDelta(before, after) {
  const delta = {};

  function diff(path, b, a) {
    if (typeof a !== typeof b) {
      delta[path] = a;
      return;
    }

    if (typeof a === 'object' && a !== null) {
      for (const key of new Set([...Object.keys(b || {}), ...Object.keys(a || {})])) {
        diff(path ? `${path}.${key}` : key, b?.[key], a?.[key]);
      }
    } else if (a !== b) {
      delta[path] = a;
    }
  }

  diff('', before, after);
  return delta;
}

/**
 * Calculate compression ratio
 * @param {Object} original - Original data
 * @param {string} codie - CODIE encoded
 * @returns {number} Compression ratio
 */
function compressionRatio(original, codie) {
  const originalSize = JSON.stringify(original).length;
  const codieSize = codie.length;
  return originalSize / codieSize;
}

/**
 * Expand abbreviated keys
 * @param {Object} props - Abbreviated props
 * @returns {Object} Full props
 */
function expandKeys(props) {
  const expanded = {};
  for (const [key, value] of Object.entries(props)) {
    const fullKey = KEY_UNMAP[key] || key;
    expanded[fullKey] = value;
  }
  return expanded;
}

module.exports = {
  encode,
  encodeWebsite,
  encodeMutation,
  encodeDelta,
  compressionRatio,
  expandKeys,
  KEY_MAP,
  KEY_UNMAP
};
