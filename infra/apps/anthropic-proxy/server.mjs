import http from 'node:http';
import { URL } from 'node:url';

const PORT = Number(process.env.PORT || 3000);
const OPENROUTER_BASE_URL = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';
const REASONING_MODEL = process.env.REASONING_MODEL || 'openrouter/free';
const COMPLETION_MODEL = process.env.COMPLETION_MODEL || 'openrouter/free';
const REQUIRE_FREE_MODELS = (process.env.REQUIRE_FREE_MODELS || 'true').toLowerCase() !== 'false';
const FALLBACK_MODELS = (process.env.FALLBACK_MODELS || '')
  .split(',')
  .map((m) => m.trim())
  .filter(Boolean);

if (!OPENROUTER_API_KEY) {
  console.error('OPENROUTER_API_KEY is required');
  process.exit(1);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      data += chunk;
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

function estimateInputTokens(payload) {
  const text = JSON.stringify(payload?.messages || []);
  return Math.max(1, Math.ceil(text.length / 4));
}

function buildTargetUrl(pathname, search) {
  const base = OPENROUTER_BASE_URL.endsWith('/') ? OPENROUTER_BASE_URL : `${OPENROUTER_BASE_URL}/`;
  const target = new URL(pathname.replace(/^\//, ''), base);
  target.search = search || '';
  return target;
}

function normalizeModel(model) {
  const selected = typeof model === 'string' ? model.trim() : '';
  if (!REQUIRE_FREE_MODELS) return selected;
  if (selected.includes(':free') || selected === 'openrouter/free') return selected;
  return '';
}

function assertConfiguredModelPolicy() {
  if (!REQUIRE_FREE_MODELS) return;
  const configured = [REASONING_MODEL, COMPLETION_MODEL, ...FALLBACK_MODELS];
  const invalid = configured.filter((model) => model && !normalizeModel(model));
  if (invalid.length > 0) {
    console.error(
      `Invalid non-free model configuration while REQUIRE_FREE_MODELS=true: ${invalid.join(', ')}`,
    );
    process.exit(1);
  }
}

function isRetryableProviderError(status, bodyText) {
  if (status === 429) return true;
  if (status === 503) return true;
  if (status === 404 && /No endpoints found matching your data policy/i.test(bodyText)) {
    return true;
  }
  if (status === 429 && /rate-limited upstream/i.test(bodyText)) {
    return true;
  }
  return false;
}

function buildModelCandidates(primaryModel) {
  const all = [primaryModel, ...FALLBACK_MODELS]
    .map((m) => normalizeModel(m))
    .filter(Boolean);
  return [...new Set(all)];
}

async function handleMessages(req, res, url) {
  let bodyText;
  try {
    bodyText = await readBody(req);
  } catch (err) {
    sendJson(res, 400, { error: 'Failed to read request body', detail: String(err) });
    return;
  }

  let payload;
  try {
    payload = bodyText ? JSON.parse(bodyText) : {};
  } catch (err) {
    sendJson(res, 400, { error: 'Invalid JSON body', detail: String(err) });
    return;
  }

  if (url.pathname === '/v1/messages/count_tokens') {
    sendJson(res, 200, { input_tokens: estimateInputTokens(payload) });
    return;
  }

  const preferredModel = payload.thinking ? REASONING_MODEL : COMPLETION_MODEL;
  if (REQUIRE_FREE_MODELS && typeof payload.model === 'string' && !normalizeModel(payload.model)) {
    sendJson(res, 400, {
      error: 'Non-free model blocked by policy',
      model: payload.model,
      requireFreeModels: true,
    });
    return;
  }
  const primaryModel = normalizeModel(preferredModel) || 'openrouter/free';
  const candidates = buildModelCandidates(primaryModel);
  if (candidates.length === 0) {
    sendJson(res, 500, { error: 'No valid free model candidates configured' });
    return;
  }

  const target = buildTargetUrl('messages', url.search);

  let lastStatus = 0;
  let lastBody = '';
  let lastContentType = 'application/json';

  for (let i = 0; i < candidates.length; i += 1) {
    const model = candidates[i];
    const requestPayload = { ...payload, model };
    let upstream;
    try {
      upstream = await fetch(target, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${OPENROUTER_API_KEY}`,
          'content-type': 'application/json',
          'anthropic-version': req.headers['anthropic-version'] || '2023-06-01',
        },
        body: JSON.stringify(requestPayload),
      });
    } catch (err) {
      sendJson(res, 502, { error: 'Upstream request failed', detail: String(err) });
      return;
    }

    const responseText = await upstream.text();
    const contentType = upstream.headers.get('content-type') || 'application/json';

    if (upstream.ok) {
      if (i > 0) {
        console.warn(`Recovered with fallback model: ${model}`);
      }
      res.writeHead(upstream.status, { 'content-type': contentType });
      res.end(responseText);
      return;
    }

    lastStatus = upstream.status;
    lastBody = responseText;
    lastContentType = contentType;

    if (!isRetryableProviderError(upstream.status, responseText) || i === candidates.length - 1) {
      break;
    }

    console.warn(
      `Model ${model} failed (${upstream.status}), retrying with next fallback model`,
    );
  }

  res.writeHead(lastStatus || 502, {
    'content-type': lastContentType,
  });
  res.end(lastBody || JSON.stringify({ error: 'Upstream request failed' }));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || `127.0.0.1:${PORT}`}`);

  if (req.method === 'GET' && url.pathname === '/health') {
    sendJson(res, 200, { status: 'ok' });
    return;
  }

  if (req.method === 'POST' && (url.pathname === '/v1/messages' || url.pathname === '/v1/messages/count_tokens')) {
    await handleMessages(req, res, url);
    return;
  }

  sendJson(res, 404, { error: 'Not Found', path: url.pathname });
});

assertConfiguredModelPolicy();
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Anthropic proxy listening on http://0.0.0.0:${PORT}`);
  console.log(`Forwarding to ${buildTargetUrl('messages', '').toString()}`);
  console.log(`Models: reasoning=${REASONING_MODEL}, completion=${COMPLETION_MODEL}`);
  console.log(`Require free models: ${REQUIRE_FREE_MODELS}`);
  if (FALLBACK_MODELS.length > 0) {
    console.log(`Fallback models: ${FALLBACK_MODELS.join(', ')}`);
  }
});
