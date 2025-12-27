/**
 * GentlyOS Edge Worker
 * Serves CODIE sites from the edge (Cloudflare/Deno Deploy)
 */

const { hydrate } = require('../../core/codie/parser');
const { THEMES } = require('../../core/primitives/catalog');

/**
 * Edge Worker Handler
 * Runs on Cloudflare Workers / Deno Deploy
 */
async function handleRequest(request, env) {
  const url = new URL(request.url);
  const domain = url.hostname;
  const path = url.pathname;

  // Health check
  if (path === '/health') {
    return new Response('OK', { status: 200 });
  }

  // API routes
  if (path.startsWith('/api/')) {
    return handleAPI(request, env, path);
  }

  // Serve site
  try {
    // Lookup domain → hash
    const siteHash = await lookupDomain(domain, env);
    if (!siteHash) {
      return new Response('Site not found', { status: 404 });
    }

    // Load CODIE from storage
    const codie = await loadBlob(siteHash, env);
    if (!codie) {
      return new Response('Site data not found', { status: 404 });
    }

    // Hydrate to HTML
    const html = hydrateToPage(codie);

    return new Response(html, {
      status: 200,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'public, max-age=3600',
        'x-gentlyos-hash': siteHash
      }
    });

  } catch (error) {
    return new Response(`Error: ${error.message}`, { status: 500 });
  }
}

/**
 * Handle API requests
 */
async function handleAPI(request, env, path) {
  const method = request.method;

  // POST /api/sites - Create site
  if (path === '/api/sites' && method === 'POST') {
    const body = await request.json();
    return createSite(body, env);
  }

  // PATCH /api/sites/:hash - Update site
  if (path.startsWith('/api/sites/') && method === 'PATCH') {
    const hash = path.split('/')[3];
    const body = await request.json();
    return updateSite(hash, body, env);
  }

  // GET /api/sites/:hash - Get site
  if (path.startsWith('/api/sites/') && method === 'GET') {
    const hash = path.split('/')[3];
    return getSite(hash, env);
  }

  return new Response('Not found', { status: 404 });
}

/**
 * Create a new site
 */
async function createSite(body, env) {
  const { crystallization, codie, domain } = body;

  // Generate CODIE from crystallization if not provided
  const siteCodie = codie || crystallizeToCODIE(crystallization);

  // Store blob
  const hash = await storeBlob(siteCodie, env);

  // Register domain
  if (domain) {
    await registerDomain(domain, hash, env);
  }

  // Generate XOR
  const xor = generateXOR(siteCodie);

  return new Response(JSON.stringify({
    hash,
    xor,
    codie: siteCodie,
    url: domain ? `https://${domain}` : `https://${hash}.gentlyos.app`
  }), {
    status: 201,
    headers: { 'content-type': 'application/json' }
  });
}

/**
 * Update a site
 */
async function updateSite(hash, body, env) {
  const { delta } = body;

  // Load current
  const current = await loadBlob(hash, env);
  if (!current) {
    return new Response('Site not found', { status: 404 });
  }

  // Apply delta
  const updated = applyDelta(current, delta);

  // Store new version
  const newHash = await storeBlob(updated, env);

  // Generate new XOR
  const xor = generateXOR(updated);

  return new Response(JSON.stringify({
    oldHash: hash,
    newHash,
    xor,
    codie: updated
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
}

/**
 * Get site info
 */
async function getSite(hash, env) {
  const codie = await loadBlob(hash, env);
  if (!codie) {
    return new Response('Site not found', { status: 404 });
  }

  return new Response(JSON.stringify({
    hash,
    codie,
    size: codie.length
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
}

/**
 * Lookup domain to hash
 */
async function lookupDomain(domain, env) {
  // In production: query KV or database
  // For now: simple in-memory or env lookup
  if (env && env.DOMAINS) {
    return env.DOMAINS.get(domain);
  }
  return null;
}

/**
 * Register domain
 */
async function registerDomain(domain, hash, env) {
  if (env && env.DOMAINS) {
    await env.DOMAINS.put(domain, hash);
  }
}

/**
 * Load blob from storage
 */
async function loadBlob(hash, env) {
  if (env && env.BLOBS) {
    return env.BLOBS.get(hash);
  }
  return null;
}

/**
 * Store blob
 */
async function storeBlob(content, env) {
  const crypto = require('crypto');
  const hash = crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);

  if (env && env.BLOBS) {
    await env.BLOBS.put(hash, content);
  }

  return hash;
}

/**
 * Generate XOR key
 */
function generateXOR(content) {
  const crypto = require('crypto');
  const hash = crypto.createHash('sha256').update(content).digest('hex');
  const num = parseInt(hash.slice(0, 8), 16) & 0xFFF;
  return num.toString(16).toUpperCase().padStart(3, '0');
}

/**
 * Crystallization to CODIE
 */
function crystallizeToCODIE(crystal) {
  const parts = [];

  if (crystal.domain) parts.push(`d:${crystal.domain}`);
  if (crystal.subdomain) parts.push(`s:${crystal.subdomain}`);
  if (crystal.features) {
    const f = Array.isArray(crystal.features) ? crystal.features.join('+') : crystal.features;
    parts.push(`f:${f}`);
  }
  if (crystal.theme) parts.push(`t:${crystal.theme}`);
  if (crystal.layout) parts.push(`l:${crystal.layout}`);

  return `W{${parts.join(',')}}`;
}

/**
 * Apply delta to CODIE
 */
function applyDelta(codie, delta) {
  // Simple replacement for now
  // Real implementation would parse and merge
  let result = codie;

  for (const [key, value] of Object.entries(delta)) {
    const regex = new RegExp(`${key}:[^,}]+`);
    if (regex.test(result)) {
      result = result.replace(regex, `${key}:${value}`);
    } else {
      // Add new property
      result = result.replace(/}$/, `,${key}:${value}}`);
    }
  }

  return result;
}

/**
 * Hydrate CODIE to full HTML page
 */
function hydrateToPage(codie) {
  const content = hydrate(codie);
  const theme = THEMES['purple-green'];

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>GentlyOS Site</title>
  <style>
    :root {
      --primary: ${theme.primary};
      --secondary: ${theme.secondary};
      --accent: ${theme.accent};
      --bg: ${theme.bg};
      --surface: ${theme.surface};
      --text: ${theme.text};
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
    }
    gentlyos-app { display: block; min-height: 100vh; padding: 2rem; }
    .grid { display: grid; gap: 1rem; }
    .flex { display: flex; gap: 1rem; }
    .btn { padding: 0.75rem 1.5rem; border: none; border-radius: 0.5rem; cursor: pointer; }
    .btn-primary { background: var(--primary); color: white; }
    .card { background: var(--surface); border-radius: 1rem; padding: 1.5rem; }
  </style>
</head>
<body>
  ${content}
  <script>
    // GentlyOS runtime
    window.GENTLYOS = {
      xor: '${generateXOR(codie)}',
      codie: '${codie.replace(/'/g, "\\'")}'
    };
  </script>
</body>
</html>`;
}

module.exports = {
  handleRequest,
  hydrateToPage,
  crystallizeToCODIE,
  generateXOR
};
