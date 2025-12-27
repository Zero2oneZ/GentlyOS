/**
 * CODIE Parser
 * Parses compressed CODIE syntax into AST
 *
 * Syntax: TYPE{key:value,key:value,...}
 * Example: W{d:sports,s:mlb,f:live+pool,t:purple}
 */

const { PRIMITIVES } = require('../primitives/catalog');

// Token types
const TOKEN = {
  PRIMITIVE: /^[A-Z]{2,4}/,
  OPEN_BRACE: /^\{/,
  CLOSE_BRACE: /^\}/,
  COLON: /^:/,
  COMMA: /^,/,
  PLUS: /^\+/,
  KEY: /^[a-z][a-z0-9]*/,
  VALUE: /^[^,\}\+]+/,
  WHITESPACE: /^\s+/
};

class CODIEParser {
  constructor() {
    this.pos = 0;
    this.input = '';
  }

  /**
   * Parse CODIE string into AST
   * @param {string} codie - CODIE syntax string
   * @returns {Object} AST representation
   */
  parse(codie) {
    this.input = codie.trim();
    this.pos = 0;

    return this.parseNode();
  }

  parseNode() {
    this.skipWhitespace();

    // Match primitive type
    const typeMatch = this.match(TOKEN.PRIMITIVE);
    if (!typeMatch) {
      throw new Error(`Expected primitive type at position ${this.pos}`);
    }

    const type = typeMatch[0];

    // Check if primitive exists
    if (!PRIMITIVES[type]) {
      throw new Error(`Unknown primitive: ${type}`);
    }

    // Match opening brace
    if (!this.match(TOKEN.OPEN_BRACE)) {
      // Primitive without properties
      return { type, props: {}, children: [] };
    }

    // Parse properties
    const props = this.parseProps();

    // Match closing brace
    if (!this.match(TOKEN.CLOSE_BRACE)) {
      throw new Error(`Expected } at position ${this.pos}`);
    }

    return { type, props, children: [] };
  }

  parseProps() {
    const props = {};

    while (!this.peek(TOKEN.CLOSE_BRACE) && this.pos < this.input.length) {
      this.skipWhitespace();

      // Parse key
      const keyMatch = this.match(TOKEN.KEY);
      if (!keyMatch) break;

      const key = keyMatch[0];

      // Match colon
      if (!this.match(TOKEN.COLON)) {
        throw new Error(`Expected : after key "${key}"`);
      }

      // Parse value (can be compound with +)
      const values = [];
      do {
        const valueMatch = this.match(TOKEN.VALUE);
        if (valueMatch) {
          values.push(valueMatch[0].trim());
        }
      } while (this.match(TOKEN.PLUS));

      props[key] = values.length === 1 ? values[0] : values;

      // Comma separator (optional for last prop)
      this.match(TOKEN.COMMA);
      this.skipWhitespace();
    }

    return props;
  }

  match(pattern) {
    const remaining = this.input.slice(this.pos);
    const match = remaining.match(pattern);

    if (match) {
      this.pos += match[0].length;
      return match;
    }

    return null;
  }

  peek(pattern) {
    const remaining = this.input.slice(this.pos);
    return pattern.test(remaining);
  }

  skipWhitespace() {
    this.match(TOKEN.WHITESPACE);
  }
}

/**
 * Parse CODIE and hydrate with primitive template
 * @param {string} codie - CODIE string
 * @returns {string} HTML output
 */
function hydrate(codie) {
  const parser = new CODIEParser();
  const ast = parser.parse(codie);

  return hydrateNode(ast);
}

function hydrateNode(node) {
  const primitive = PRIMITIVES[node.type];
  if (!primitive) {
    throw new Error(`Unknown primitive: ${node.type}`);
  }

  // Merge defaults with provided props
  const props = { ...primitive.defaults, ...node.props };

  // Interpolate template
  let html = primitive.template;
  for (const [key, value] of Object.entries(props)) {
    const v = Array.isArray(value) ? value.join(' ') : value;
    html = html.replace(new RegExp(`\\$\\{${key}\\}`, 'g'), v);
  }

  return html;
}

/**
 * Parse website shorthand
 * W{d:sports,s:mlb,f:live+pool,t:purple}
 */
function parseWebsite(codie) {
  const parser = new CODIEParser();
  const ast = parser.parse(codie);

  if (ast.type !== 'W') {
    throw new Error('Expected W{} website definition');
  }

  return {
    domain: ast.props.d,
    subdomain: ast.props.s,
    features: Array.isArray(ast.props.f) ? ast.props.f : [ast.props.f],
    theme: ast.props.t || 'dark',
    layout: ast.props.l,
    raw: ast.props
  };
}

/**
 * Parse mutation shorthand
 * MUT{GRD:{t:running,f:sz:10}}
 */
function parseMutation(codie) {
  const parser = new CODIEParser();
  const ast = parser.parse(codie);

  if (ast.type !== 'MUT') {
    throw new Error('Expected MUT{} mutation definition');
  }

  return {
    target: Object.keys(ast.props)[0],
    changes: ast.props[Object.keys(ast.props)[0]]
  };
}

module.exports = {
  CODIEParser,
  hydrate,
  parseWebsite,
  parseMutation
};
