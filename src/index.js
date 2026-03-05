const CODE_REGEX = /^[a-zA-Z0-9_-]{4,32}$/

function getKey(code) {
  return `link:${code}`
}

function isValidHttpUrl(value) {
  return typeof value === 'string' && (value.startsWith('http://') || value.startsWith('https://'))
}

function generateCode() {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 7)
}

function jsonResponse(payload, status, requestId) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'x-request-id': requestId,
    },
  })
}

function jsonError(status, code, message, requestId) {
  return jsonResponse({ ok: false, error: { code, message }, requestId }, status, requestId)
}

async function parseJson(request) {
  try {
    return await request.json()
  } catch {
    return null
  }
}

async function loadLink(kv, code) {
  const raw = await kv.get(getKey(code))
  if (!raw) return null

  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function redirectResponse(location, requestId) {
  return new Response(null, {
    status: 302,
    headers: {
      location,
      'x-request-id': requestId,
    },
  })
}

async function handleCreateLink(request, env, requestId) {
  const body = await parseJson(request)
  if (!body) {
    return jsonError(400, 'INVALID_JSON', 'Request body must be valid JSON', requestId)
  }

  const url = body.url
  const requestedCode = body.code

  if (!isValidHttpUrl(url)) {
    return jsonError(400, 'VALIDATION_ERROR', 'URL must start with http:// or https://', requestId)
  }

  if (requestedCode !== undefined && !CODE_REGEX.test(requestedCode)) {
    return jsonError(400, 'VALIDATION_ERROR', 'Code must be 4-32 chars: letters, numbers, _ or -', requestId)
  }

  let code = requestedCode || generateCode()

  if (!requestedCode) {
    let attempts = 0
    while (attempts < 5) {
      const existing = await env.LINKS_KV.get(getKey(code))
      if (!existing) break
      code = generateCode()
      attempts += 1
    }

    if (attempts === 5) {
      return jsonError(500, 'CODE_GENERATION_FAILED', 'Could not generate a unique code', requestId)
    }
  } else {
    const existing = await env.LINKS_KV.get(getKey(code))
    if (existing) {
      return jsonError(409, 'CODE_TAKEN', 'Code already exists', requestId)
    }
  }

  const now = new Date().toISOString()
  const record = {
    code,
    targetUrl: url,
    active: true,
    createdAt: now,
    updatedAt: now,
  }

  await env.LINKS_KV.put(getKey(code), JSON.stringify(record))

  const baseUrl = env.BASE_URL || new URL(request.url).origin
  return jsonResponse(
    {
      ok: true,
      data: {
        code,
        url,
        shortUrl: `${baseUrl}/${code}`,
        active: true,
        createdAt: now,
        updatedAt: now,
      },
      requestId,
    },
    201,
    requestId
  )
}

async function handleReadLink(code, env, requestId) {
  if (!CODE_REGEX.test(code)) {
    return jsonError(400, 'INVALID_CODE', 'Code format is invalid', requestId)
  }

  const record = await loadLink(env.LINKS_KV, code)
  if (!record) {
    return jsonError(404, 'NOT_FOUND', 'Code not found', requestId)
  }

  return jsonResponse({ ok: true, data: record, requestId }, 200, requestId)
}

async function handleUpdateLink(request, code, env, requestId) {
  if (!CODE_REGEX.test(code)) {
    return jsonError(400, 'INVALID_CODE', 'Code format is invalid', requestId)
  }

  const existing = await loadLink(env.LINKS_KV, code)
  if (!existing) {
    return jsonError(404, 'NOT_FOUND', 'Code not found', requestId)
  }

  const body = await parseJson(request)
  if (!body) {
    return jsonError(400, 'INVALID_JSON', 'Request body must be valid JSON', requestId)
  }

  const hasUrl = Object.prototype.hasOwnProperty.call(body, 'url')
  const hasActive = Object.prototype.hasOwnProperty.call(body, 'active')

  if (!hasUrl && !hasActive) {
    return jsonError(400, 'VALIDATION_ERROR', 'At least one field (url or active) must be provided', requestId)
  }

  if (hasUrl && !isValidHttpUrl(body.url)) {
    return jsonError(400, 'VALIDATION_ERROR', 'URL must start with http:// or https://', requestId)
  }

  if (hasActive && typeof body.active !== 'boolean') {
    return jsonError(400, 'VALIDATION_ERROR', 'active must be a boolean', requestId)
  }

  const updated = {
    ...existing,
    targetUrl: hasUrl ? body.url : existing.targetUrl,
    active: hasActive ? body.active : existing.active,
    updatedAt: new Date().toISOString(),
  }

  await env.LINKS_KV.put(getKey(code), JSON.stringify(updated))

  return jsonResponse({ ok: true, data: updated, requestId }, 200, requestId)
}

async function handleDeleteLink(code, env, requestId) {
  if (!CODE_REGEX.test(code)) {
    return jsonError(400, 'INVALID_CODE', 'Code format is invalid', requestId)
  }

  const existing = await loadLink(env.LINKS_KV, code)
  if (!existing) {
    return jsonError(404, 'NOT_FOUND', 'Code not found', requestId)
  }

  const disabled = {
    ...existing,
    active: false,
    updatedAt: new Date().toISOString(),
  }

  await env.LINKS_KV.put(getKey(code), JSON.stringify(disabled))

  return jsonResponse({ ok: true, data: { code, disabled: true }, requestId }, 200, requestId)
}

async function handleRedirect(code, env, requestId) {
  if (!CODE_REGEX.test(code)) {
    return jsonError(404, 'NOT_FOUND', 'Code not found', requestId)
  }

  const record = await loadLink(env.LINKS_KV, code)
  if (!record || !record.active) {
    return jsonError(404, 'NOT_FOUND', 'Code not found', requestId)
  }

  return redirectResponse(record.targetUrl, requestId)
}

export default {
  async fetch(request, env) {
    const requestId = crypto.randomUUID()
    const url = new URL(request.url)
    const { pathname } = url
    const method = request.method.toUpperCase()

    if (method === 'POST' && pathname === '/api/v1/links') {
      return handleCreateLink(request, env, requestId)
    }

    const apiMatch = pathname.match(/^\/api\/v1\/links\/([^/]+)$/)
    if (apiMatch) {
      const code = apiMatch[1]

      if (method === 'GET') {
        return handleReadLink(code, env, requestId)
      }
      if (method === 'PATCH') {
        return handleUpdateLink(request, code, env, requestId)
      }
      if (method === 'DELETE') {
        return handleDeleteLink(code, env, requestId)
      }
    }

    const redirectMatch = pathname.match(/^\/([^/]+)$/)
    if (method === 'GET' && redirectMatch && redirectMatch[1] !== 'api') {
      return handleRedirect(redirectMatch[1], env, requestId)
    }

    return jsonError(404, 'NOT_FOUND', 'Route not found', requestId)
  },
}
