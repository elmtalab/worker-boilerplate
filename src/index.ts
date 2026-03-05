import { Hono } from 'hono'
import { z } from 'zod'

interface Env {
  LINKS_KV: KVNamespace
  BASE_URL?: string
}

type LinkRecord = {
  code: string
  targetUrl: string
  active: boolean
  createdAt: string
  updatedAt: string
}

const createLinkSchema = z.object({
  url: z.string().url().refine((value) => value.startsWith('http://') || value.startsWith('https://'), {
    message: 'URL must start with http:// or https://',
  }),
  code: z.string().regex(/^[a-zA-Z0-9_-]{4,32}$/).optional(),
})

const updateLinkSchema = z
  .object({
    url: z
      .string()
      .url()
      .refine((value) => value.startsWith('http://') || value.startsWith('https://'), {
        message: 'URL must start with http:// or https://',
      })
      .optional(),
    active: z.boolean().optional(),
  })
  .refine((data) => data.url !== undefined || data.active !== undefined, {
    message: 'At least one field (url or active) must be provided',
  })

const codeRegex = /^[a-zA-Z0-9_-]{4,32}$/
const app = new Hono<{ Bindings: Env; Variables: { requestId: string } }>()

const jsonError = (c: any, status: number, code: string, message: string) => {
  return c.json({ ok: false, error: { code, message }, requestId: c.get('requestId') }, status)
}

const getKey = (code: string) => `link:${code}`

const loadLink = async (kv: KVNamespace, code: string): Promise<LinkRecord | null> => {
  const raw = await kv.get(getKey(code))
  if (!raw) return null
  return JSON.parse(raw) as LinkRecord
}

const generateCode = () => crypto.randomUUID().replace(/-/g, '').slice(0, 7)

app.use('*', async (c, next) => {
  const requestId = crypto.randomUUID()
  c.set('requestId', requestId)
  await next()
  c.header('x-request-id', requestId)
})

app.post('/api/v1/links', async (c) => {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return jsonError(c, 400, 'INVALID_JSON', 'Request body must be valid JSON')
  }

  const parsed = createLinkSchema.safeParse(body)
  if (!parsed.success) {
    return jsonError(c, 400, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid input')
  }

  const requestedCode = parsed.data.code
  const url = parsed.data.url

  let code = requestedCode ?? generateCode()

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
  const record: LinkRecord = { code, targetUrl: url, active: true, createdAt: now, updatedAt: now }
  await c.env.LINKS_KV.put(getKey(code), JSON.stringify(record))

  const baseUrl = c.env.BASE_URL ?? new URL(c.req.url).origin
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
  if (!codeRegex.test(code)) {
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
  if (!codeRegex.test(code)) {
    return jsonError(c, 400, 'INVALID_CODE', 'Code format is invalid')
  }

  const existing = await loadLink(c.env.LINKS_KV, code)
  if (!existing) {
    return jsonError(c, 404, 'NOT_FOUND', 'Code not found')
  }

  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return jsonError(c, 400, 'INVALID_JSON', 'Request body must be valid JSON')
  }

  const parsed = updateLinkSchema.safeParse(body)
  if (!parsed.success) {
    return jsonError(c, 400, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid input')
  }

  const updated: LinkRecord = {
    ...existing,
    targetUrl: parsed.data.url ?? existing.targetUrl,
    active: parsed.data.active ?? existing.active,
    updatedAt: new Date().toISOString(),
  }

  await c.env.LINKS_KV.put(getKey(code), JSON.stringify(updated))

  return c.json({ ok: true, data: updated, requestId: c.get('requestId') })
})

app.delete('/api/v1/links/:code', async (c) => {
  const code = c.req.param('code')
  if (!codeRegex.test(code)) {
    return jsonError(c, 400, 'INVALID_CODE', 'Code format is invalid')
  }

  const existing = await loadLink(c.env.LINKS_KV, code)
  if (!existing) {
    return jsonError(c, 404, 'NOT_FOUND', 'Code not found')
  }

  const disabled: LinkRecord = {
    ...existing,
    active: false,
    updatedAt: new Date().toISOString(),
  }
  await c.env.LINKS_KV.put(getKey(code), JSON.stringify(disabled))

  return c.json({ ok: true, data: { code, disabled: true }, requestId: c.get('requestId') })
})

app.get('/:code', async (c) => {
  const code = c.req.param('code')
  if (!codeRegex.test(code)) {
    return jsonError(c, 404, 'NOT_FOUND', 'Code not found')
  }

  const record = await loadLink(c.env.LINKS_KV, code)
  if (!record || !record.active) {
    return jsonError(c, 404, 'NOT_FOUND', 'Code not found')
  }

  return c.redirect(record.targetUrl, 302)
})

export default app
