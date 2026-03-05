# Cloudflare Worker Interview Cheatsheet

This document is optimized for fast review before interviews: concept -> practical answer -> code.

---

## 1) Core runtime model

### What is a Worker?
A Cloudflare Worker is JavaScript/TypeScript code executed at edge locations close to users. It handles requests via a `fetch` event-style API.

### Good interview answer (short)
> "A Worker is a lightweight edge function. Instead of running on one regional server, it executes near the client, reducing latency and improving global performance."

### Skeleton
```ts
interface Env {
  API_BASE_URL: string
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return new Response(`API=${env.API_BASE_URL}`)
  },
}
```

---

## 2) Request lifecycle and `ctx.waitUntil`

`ctx.waitUntil(promise)` lets you continue background work after returning the response (logging, analytics, async cache write).

```ts
export default {
  async fetch(_req: Request, _env: unknown, ctx: ExecutionContext): Promise<Response> {
    ctx.waitUntil(
      fetch('https://example.com/audit', {
        method: 'POST',
        body: JSON.stringify({ event: 'request_seen', at: Date.now() }),
      }),
    )

    return Response.json({ ok: true })
  },
}
```

Interview note: mention that **critical** writes should not only rely on `waitUntil` if strict durability guarantees are needed.

---

## 3) Routing strategies

### Simple switch router
```ts
function key(req: Request): string {
  const url = new URL(req.url)
  return `${req.method} ${url.pathname}`
}

export default {
  async fetch(req: Request): Promise<Response> {
    switch (key(req)) {
      case 'GET /users':
        return Response.json([{ id: 1, name: 'Ada' }])
      case 'GET /health':
        return Response.json({ ok: true })
      default:
        return new Response('Not Found', { status: 404 })
    }
  },
}
```

### Middleware-like helper for auth
```ts
function requireApiKey(req: Request, expected: string): Response | null {
  const provided = req.headers.get('x-api-key')
  if (!provided || provided !== expected) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return null
}
```

---

## 4) Data/storage choices (how to explain tradeoffs)

- **KV**: globally distributed key-value, great for read-heavy and config/session-like data; eventual consistency characteristics.
- **Durable Objects**: strongly consistent per-object state + coordination; best for counters, locks, websockets, per-entity serialization.
- **D1**: relational SQL at edge-oriented stack; useful for structured app data.
- **R2**: object/blob storage (files, media, backups).
- **External DB/API**: use when existing systems already own source of truth.

Good interview line:
> "I choose the storage primitive based on consistency and access pattern: KV for globally cached reads, Durable Objects for coordination, and D1 when relational querying is central."

---

## 5) Caching patterns

### Cache-Control headers
```ts
return new Response(JSON.stringify(data), {
  headers: {
    'content-type': 'application/json',
    'cache-control': 'public, max-age=60, s-maxage=300',
  },
})
```

### Cache API example
```ts
export default {
  async fetch(req: Request): Promise<Response> {
    const cache = caches.default
    const cacheKey = new Request(req.url, req)

    let res = await cache.match(cacheKey)
    if (res) return res

    res = Response.json({ generatedAt: Date.now() }, { headers: { 'cache-control': 'public, max-age=30' } })
    await cache.put(cacheKey, res.clone())
    return res
  },
}
```

Mention invalidation strategy in interviews (versioned keys, path-based purge, or tag/prefix-driven purge workflows).

---

## 6) Error handling + observability

### Consistent error envelope
```ts
function jsonError(message: string, status = 500): Response {
  return Response.json(
    {
      error: {
        message,
        status,
      },
    },
    { status },
  )
}
```

### Structured log example
```ts
console.log(JSON.stringify({
  level: 'info',
  event: 'request_complete',
  path: new URL(request.url).pathname,
  method: request.method,
  latencyMs,
  requestId,
}))
```

Interview points:
- Include request IDs in logs and responses.
- Track latency, status code distribution, and upstream error rates.
- Separate client-facing error messages from internal diagnostics.

---

## 7) Security fundamentals

- Validate all input (query params, headers, JSON body shape).
- Keep secrets in Wrangler/Cloudflare secrets, not source files.
- Enforce auth before business logic.
- Use least-privilege tokens for outbound integrations.
- Consider rate limiting and abuse protection for public endpoints.

### Lightweight request body validation snippet
```ts
async function parseJson<T>(req: Request): Promise<T> {
  const contentType = req.headers.get('content-type') || ''
  if (!contentType.includes('application/json')) {
    throw new Error('Expected application/json')
  }
  return (await req.json()) as T
}
```

---

## 8) Testing strategy you can discuss

- Unit test pure utility functions (routing, validators, serializers).
- Integration test `fetch` handler with mocked env bindings.
- Contract test upstream/downstream APIs if the Worker orchestrates services.
- Add smoke checks post-deploy (health endpoint + key user journeys).

Example testable handler extraction:
```ts
export async function handleRequest(request: Request): Promise<Response> {
  if (new URL(request.url).pathname === '/health') {
    return Response.json({ ok: true })
  }
  return new Response('Not Found', { status: 404 })
}

export default {
  fetch: handleRequest,
}
```

---

## 9) Deployment + operations talking points

- Use environment-specific configs (`dev`, `staging`, `prod`).
- Store secrets per environment.
- Roll out with staged validation and monitoring.
- Keep rollback path straightforward (previous deployment version known).

Minimal deploy command pattern:
```bash
npm run deploy
```

---

## 10) Rapid-fire Q&A

### Q: Why edge?
A: Lower user-perceived latency and better global performance by executing closer to users.

### Q: When not edge-only?
A: When heavy CPU jobs, long-running workflows, or strict single-region data constraints dominate.

### Q: KV vs Durable Objects?
A: KV for read-heavy globally distributed key-value access; Durable Objects for strongly consistent coordinated mutable state.

### Q: How do you handle retries for flaky upstream APIs?
A: Bounded retries with jittered backoff for idempotent operations + timeout budgets + circuit-breaker-like degradation.

---

## Final pre-interview checklist

- [ ] I can explain this repo’s entrypoint and request flow.
- [ ] I can justify storage choices with consistency/access tradeoffs.
- [ ] I can talk through auth, caching, and error strategy.
- [ ] I can describe deployment and rollback plan.
- [ ] I have 2–3 stories of production debugging/performance wins.
