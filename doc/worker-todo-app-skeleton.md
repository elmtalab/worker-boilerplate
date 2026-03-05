# Cloudflare Worker Skeleton: Todo API App

Use this as a second interview-ready skeleton (different from URL shortener) for a small Todo API service.

## 1) App scope

Build a minimal API with these endpoints:

- `GET /health`
- `POST /api/v1/todos`
- `GET /api/v1/todos/{id}`
- `PATCH /api/v1/todos/{id}`
- `DELETE /api/v1/todos/{id}` (soft delete)

## 2) Suggested data model

Store each todo document in KV under key `todo:{id}`:

```json
{
  "id": "todo_7a2f",
  "title": "Prepare interview notes",
  "completed": false,
  "deleted": false,
  "priority": "medium",
  "createdAt": "2026-01-01T00:00:00.000Z",
  "updatedAt": "2026-01-01T00:00:00.000Z"
}
```

## 3) Worker skeleton (plain JS)

```js
/**
 * @typedef {{ TODOS_KV: KVNamespace }} Env
 */

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })

const nowIso = () => new Date().toISOString()

const routeKey = (req) => {
  const u = new URL(req.url)
  return `${req.method.toUpperCase()} ${u.pathname}`
}

const idFromPath = (pathname) => pathname.split('/').filter(Boolean).pop()

export default {
  async fetch(request, env) {
    const url = new URL(request.url)

    if (routeKey(request) === 'GET /health') {
      return json({ ok: true, service: 'todo-api', ts: Date.now() })
    }

    // POST /api/v1/todos
    if (routeKey(request) === 'POST /api/v1/todos') {
      const body = await request.json().catch(() => null)
      if (!body?.title || typeof body.title !== 'string') {
        return json({ ok: false, error: { code: 'BAD_REQUEST', message: 'title is required' } }, 400)
      }

      const id = crypto.randomUUID().slice(0, 8)
      const todo = {
        id: `todo_${id}`,
        title: body.title.trim(),
        completed: false,
        deleted: false,
        priority: body.priority ?? 'medium',
        createdAt: nowIso(),
        updatedAt: nowIso(),
      }

      await env.TODOS_KV.put(`todo:${todo.id}`, JSON.stringify(todo))
      return json({ ok: true, data: todo }, 201)
    }

    // GET/PATCH/DELETE /api/v1/todos/{id}
    if (url.pathname.startsWith('/api/v1/todos/')) {
      const id = idFromPath(url.pathname)
      const key = `todo:${id}`
      const raw = await env.TODOS_KV.get(key)
      if (!raw) return json({ ok: false, error: { code: 'NOT_FOUND', message: 'Todo not found' } }, 404)

      const todo = JSON.parse(raw)

      if (request.method === 'GET') {
        if (todo.deleted) return json({ ok: false, error: { code: 'NOT_FOUND', message: 'Todo not found' } }, 404)
        return json({ ok: true, data: todo })
      }

      if (request.method === 'PATCH') {
        const body = await request.json().catch(() => null)
        if (!body || typeof body !== 'object') {
          return json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Invalid JSON body' } }, 400)
        }

        if (typeof body.title === 'string') todo.title = body.title.trim()
        if (typeof body.completed === 'boolean') todo.completed = body.completed
        if (typeof body.priority === 'string') todo.priority = body.priority
        todo.updatedAt = nowIso()

        await env.TODOS_KV.put(key, JSON.stringify(todo))
        return json({ ok: true, data: todo })
      }

      if (request.method === 'DELETE') {
        todo.deleted = true
        todo.updatedAt = nowIso()
        await env.TODOS_KV.put(key, JSON.stringify(todo))
        return json({ ok: true, data: { id: todo.id, deleted: true } })
      }
    }

    return json({ ok: false, error: { code: 'NOT_FOUND', message: 'Route not found' } }, 404)
  },
}
```

## 4) Interview talking points for this skeleton

- Why soft delete (`deleted=true`) can be helpful for auditing/recovery.
- Why idempotency matters for `PATCH` and `DELETE` endpoints.
- How to evolve from KV-only to D1 when list filtering/searching becomes more important.
- How to add `GET /api/v1/todos?completed=true` efficiently (secondary index strategy).

## 5) Optional extensions

- Add simple API key auth (`x-api-key`) for write routes.
- Add request IDs and structured logs.
- Add `dueDate` + validation.
- Add pagination/list endpoint (`GET /api/v1/todos`).
