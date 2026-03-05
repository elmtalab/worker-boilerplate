import { Hono } from 'hono'

const app = new Hono()
const CODE_REGEX = /^[a-zA-Z0-9_-]{4,32}$/

function jsonError(c, status, code, message) {
  return c.json({ ok: false, error: { code, message }, requestId: c.get('requestId') }, status)
}

function getKey(code) {
  return `link:${code}`
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

function isValidHttpUrl(value) {
  if (typeof value !== 'string') return false
  return value.startsWith('http://') || value.startsWith('https://')
}

function generateCode() {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 7)
}

app.use('*', async (c, next) => {
  const requestId = crypto.randomUUID()
  c.set('requestId', requestId)
  await next()
  c.header('x-request-id', requestId)
})

app.post('/api/v1/links', async (c) => {
  let body
  try {
    body = await c.req.json()
  } catch {
    return jsonError(c, 400, 'INVALID_JSON', 'Request body must be valid JSON')
  }

  const url = body?.url
  const requestedCode = body?.code

  if (!isValidHttpUrl(url)) {
    return jsonError(c, 400, 'VALIDATION_ERROR', 'URL must start with http:// or https://')
  }

  if (requestedCode !== undefined && !CODE_REGEX.test(requestedCode)) {
    return jsonError(c, 400, 'VALIDATION_ERROR', 'Code must be 4-32 chars: letters, numbers, _ or -')
  }

  let code = requestedCode || generateCode()

  if (!requestedCode) {
    let attempts = 0
    while (attempts < 5) {
      const existing = await c.env.LINKS_KV.get(getKey(code))
      if (!existing) break
      code = generateCode()
      attempts += 1
    }

    if (attempts === 5) {
      return jsonError(c, 500, 'CODE_GENERATION_FAILED', 'Could not generate a unique code')
    }
  } else {
    const existing = await c.env.LINKS_KV.get(getKey(code))
    if (existing) {
      return jsonError(c, 409, 'CODE_TAKEN', 'Code already exists')
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

  await c.env.LINKS_KV.put(getKey(code), JSON.stringify(record))

  const baseUrl = c.env.BASE_URL || new URL(c.req.url).origin
  return c.json(
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
      requestId: c.get('requestId'),
    },
    201
  )
})

app.get('/api/v1/links/:code', async (c) => {
  const code = c.req.param('code')
  if (!CODE_REGEX.test(code)) {
    return jsonError(c, 400, 'INVALID_CODE', 'Code format is invalid')
  }

  const record = await loadLink(c.env.LINKS_KV, code)
  if (!record) {
    return jsonError(c, 404, 'NOT_FOUND', 'Code not found')
  }

  return c.json({ ok: true, data: record, requestId: c.get('requestId') })
})

app.patch('/api/v1/links/:code', async (c) => {
  const code = c.req.param('code')
  if (!CODE_REGEX.test(code)) {
    return jsonError(c, 400, 'INVALID_CODE', 'Code format is invalid')
  }

  const existing = await loadLink(c.env.LINKS_KV, code)
  if (!existing) {
    return jsonError(c, 404, 'NOT_FOUND', 'Code not found')
  }

  let body
  try {
    body = await c.req.json()
  } catch {
    return jsonError(c, 400, 'INVALID_JSON', 'Request body must be valid JSON')
  }

  const hasUrl = body && Object.prototype.hasOwnProperty.call(body, 'url')
  const hasActive = body && Object.prototype.hasOwnProperty.call(body, 'active')

  if (!hasUrl && !hasActive) {
    return jsonError(c, 400, 'VALIDATION_ERROR', 'At least one field (url or active) must be provided')
  }

  if (hasUrl && !isValidHttpUrl(body.url)) {
    return jsonError(c, 400, 'VALIDATION_ERROR', 'URL must start with http:// or https://')
  }

  if (hasActive && typeof body.active !== 'boolean') {
    return jsonError(c, 400, 'VALIDATION_ERROR', 'active must be a boolean')
  }

  const updated = {
    ...existing,
    targetUrl: hasUrl ? body.url : existing.targetUrl,
    active: hasActive ? body.active : existing.active,
    updatedAt: new Date().toISOString(),
  }

  await c.env.LINKS_KV.put(getKey(code), JSON.stringify(updated))

  return c.json({ ok: true, data: updated, requestId: c.get('requestId') })
})

app.delete('/api/v1/links/:code', async (c) => {
  const code = c.req.param('code')
  if (!CODE_REGEX.test(code)) {
    return jsonError(c, 400, 'INVALID_CODE', 'Code format is invalid')
  }

  const existing = await loadLink(c.env.LINKS_KV, code)
  if (!existing) {
    return jsonError(c, 404, 'NOT_FOUND', 'Code not found')
  }

  const disabled = {
    ...existing,
    active: false,
    updatedAt: new Date().toISOString(),
  }

  await c.env.LINKS_KV.put(getKey(code), JSON.stringify(disabled))

  return c.json({ ok: true, data: { code, disabled: true }, requestId: c.get('requestId') })
})

app.get('/:code', async (c) => {
  const code = c.req.param('code')
  if (!CODE_REGEX.test(code)) {
    return jsonError(c, 404, 'NOT_FOUND', 'Code not found')
  }

  const record = await loadLink(c.env.LINKS_KV, code)
  if (!record || !record.active) {
    return jsonError(c, 404, 'NOT_FOUND', 'Code not found')
  }

  return c.redirect(record.targetUrl, 302)
})

export default app
