# Backend Interview Snippets (Copy/Paste Starter Kit)

Use this as a **quick backend template library** for interview projects.
It is written to work for:

- URL shortener
- Todo/task API
- E-commerce mini API (products/orders)
- Auth + profile service
- Any small CRUD backend

> Strategy: copy one snippet block, rename fields, ship fast.

---

## 0) Fast adaptation map (rename once)

Before coding, replace these placeholders globally:

- `RESOURCE` → `link`, `user`, `task`, `product`, etc.
- `resource` → lower-case singular (`link`)
- `resources` → lower-case plural (`links`)
- `RESOURCE_KV` → your KV binding (`LINKS_KV`)
- `id` field → `code`, `id`, `slug`, etc.

---

## 1) Standard response + error helpers

```js
export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...extraHeaders,
    },
  });
}

export function ok(data, status = 200) {
  return json({ ok: true, data }, status);
}

export function fail(code, message, status = 400, details = null) {
  return json(
    {
      ok: false,
      error: { code, message, details },
      requestId: crypto.randomUUID(),
    },
    status
  );
}
```

---

## 2) Safe JSON parser + tiny validator helpers

```js
export async function parseJson(request) {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    return { error: "INVALID_CONTENT_TYPE" };
  }

  try {
    return { body: await request.json() };
  } catch {
    return { error: "INVALID_JSON" };
  }
}

export function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}

export function isHttpUrl(v) {
  try {
    const u = new URL(v);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}
```

---

## 3) CORS + OPTIONS handler (frontend-safe)

```js
export function withCors(response, origin = "*") {
  const headers = new Headers(response.headers);
  headers.set("access-control-allow-origin", origin);
  headers.set("access-control-allow-methods", "GET,POST,PATCH,DELETE,OPTIONS");
  headers.set("access-control-allow-headers", "content-type,authorization");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function handleOptions(origin = "*") {
  return new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": origin,
      "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
      "access-control-allow-headers": "content-type,authorization",
    },
  });
}
```

---

## 4) Minimal auth guard (Bearer token)

```js
import { fail } from "./http.js";

export function requireBearer(request, env) {
  const auth = request.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";

  if (!token || token !== env.API_TOKEN) {
    return fail("UNAUTHORIZED", "Invalid or missing token", 401);
  }

  return null; // authorized
}
```

---

## 5) Route skeleton for most interview backends

```js
import { ok, fail } from "./http.js";
import { handleOptions, withCors } from "./cors.js";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method;

    if (method === "OPTIONS") {
      return handleOptions(env.CORS_ORIGIN || "*");
    }

    let res;

    // Health
    if (method === "GET" && pathname === "/health") {
      res = ok({ status: "up", now: new Date().toISOString() });
      return withCors(res, env.CORS_ORIGIN || "*");
    }

    // Collection routes: /api/v1/resources
    if (method === "POST" && pathname === "/api/v1/resources") {
      res = await handleCreateResource(request, env);
      return withCors(res, env.CORS_ORIGIN || "*");
    }

    // Item routes: /api/v1/resources/:id
    const m = pathname.match(/^\/api\/v1\/resources\/([^/]+)$/);
    if (m) {
      const id = decodeURIComponent(m[1]);

      if (method === "GET") {
        res = await handleGetResource(env, id);
      } else if (method === "PATCH") {
        res = await handlePatchResource(request, env, id);
      } else if (method === "DELETE") {
        res = await handleDeleteResource(env, id);
      } else {
        res = fail("METHOD_NOT_ALLOWED", "Unsupported method", 405);
      }

      return withCors(res, env.CORS_ORIGIN || "*");
    }

    return withCors(fail("NOT_FOUND", "Route not found", 404), env.CORS_ORIGIN || "*");
  },
};
```

---

## 6) Generic KV CRUD handlers (replace names, keep flow)

```js
import { ok, fail } from "./http.js";
import { parseJson, isNonEmptyString } from "./validation.js";

const keyOf = (id) => `resource:${id}`; // rename prefix

export async function handleCreateResource(request, env) {
  const parsed = await parseJson(request);
  if (parsed.error === "INVALID_CONTENT_TYPE") return fail("INVALID_CONTENT_TYPE", "Expected application/json", 415);
  if (parsed.error === "INVALID_JSON") return fail("INVALID_JSON", "Malformed JSON body", 400);

  const p = parsed.body;
  if (!isNonEmptyString(p?.name)) {
    return fail("VALIDATION_ERROR", "name is required", 422, [{ field: "name", rule: "non-empty string" }]);
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const row = { id, name: p.name.trim(), active: true, createdAt: now, updatedAt: now };

  await env.RESOURCE_KV.put(keyOf(id), JSON.stringify(row));
  return ok(row, 201);
}

export async function handleGetResource(env, id) {
  const raw = await env.RESOURCE_KV.get(keyOf(id));
  if (!raw) return fail("NOT_FOUND", "Resource not found", 404);
  return ok(JSON.parse(raw));
}

export async function handlePatchResource(request, env, id) {
  const raw = await env.RESOURCE_KV.get(keyOf(id));
  if (!raw) return fail("NOT_FOUND", "Resource not found", 404);

  const parsed = await parseJson(request);
  if (parsed.error) return fail(parsed.error, "Invalid request body", 400);

  const current = JSON.parse(raw);
  const p = parsed.body;

  const updated = {
    ...current,
    name: isNonEmptyString(p?.name) ? p.name.trim() : current.name,
    active: typeof p?.active === "boolean" ? p.active : current.active,
    updatedAt: new Date().toISOString(),
  };

  await env.RESOURCE_KV.put(keyOf(id), JSON.stringify(updated));
  return ok(updated);
}

export async function handleDeleteResource(env, id) {
  const raw = await env.RESOURCE_KV.get(keyOf(id));
  if (!raw) return fail("NOT_FOUND", "Resource not found", 404);

  const current = JSON.parse(raw);
  const updated = { ...current, active: false, updatedAt: new Date().toISOString() };

  await env.RESOURCE_KV.put(keyOf(id), JSON.stringify(updated));
  return ok({ deleted: true, id });
}
```

---

## 7) URL shortener-specific snippet (high interview probability)

```js
import { ok, fail } from "./http.js";
import { parseJson, isHttpUrl, isNonEmptyString } from "./validation.js";

const linkKey = (code) => `link:${code}`;

export async function createShortLink(request, env) {
  const parsed = await parseJson(request);
  if (parsed.error) return fail(parsed.error, "Invalid JSON request", 400);

  const { url, code } = parsed.body;
  if (!isHttpUrl(url)) return fail("VALIDATION_ERROR", "url must be a valid http/https URL", 422);
  if (!isNonEmptyString(code) || code.length < 4) {
    return fail("VALIDATION_ERROR", "code must be at least 4 chars", 422);
  }

  const existing = await env.LINKS_KV.get(linkKey(code));
  if (existing) return fail("CONFLICT", "code already exists", 409);

  const now = new Date().toISOString();
  const link = {
    code,
    targetUrl: url,
    active: true,
    visits: 0,
    createdAt: now,
    updatedAt: now,
  };

  await env.LINKS_KV.put(linkKey(code), JSON.stringify(link));
  return ok(link, 201);
}

export async function redirectByCode(env, code) {
  const raw = await env.LINKS_KV.get(linkKey(code));
  if (!raw) return fail("NOT_FOUND", "Code not found", 404);

  const link = JSON.parse(raw);
  if (!link.active) return fail("GONE", "Code is disabled", 410);

  const updated = { ...link, visits: (link.visits || 0) + 1, updatedAt: new Date().toISOString() };
  await env.LINKS_KV.put(linkKey(code), JSON.stringify(updated));

  return Response.redirect(link.targetUrl, 302);
}
```

---

## 8) Cursor pagination pattern (list endpoint)

```js
import { ok } from "./http.js";

export async function listResources(request, env) {
  const url = new URL(request.url);
  const cursor = url.searchParams.get("cursor") || undefined;
  const limit = Math.min(Number(url.searchParams.get("limit") || 20), 100);

  const page = await env.RESOURCE_KV.list({ prefix: "resource:", cursor, limit });
  const items = await Promise.all(
    page.keys.map(async ({ name }) => {
      const raw = await env.RESOURCE_KV.get(name);
      return raw ? JSON.parse(raw) : null;
    })
  );

  return ok({
    items: items.filter(Boolean),
    nextCursor: page.list_complete ? null : page.cursor,
  });
}
```

---

## 9) Idempotency key pattern (prevent duplicate create)

```js
import { fail } from "./http.js";

export async function guardIdempotency(request, env) {
  const key = request.headers.get("idempotency-key");
  if (!key) return null; // optional

  const lockKey = `idem:${key}`;
  const exists = await env.RESOURCE_KV.get(lockKey);
  if (exists) {
    return fail("DUPLICATE_REQUEST", "This request was already processed", 409);
  }

  // keep a short lock window
  await env.RESOURCE_KV.put(lockKey, "1", { expirationTtl: 60 });
  return null;
}
```

---

## 10) Copy/paste interview delivery checklist

1. Start from section **5** (route skeleton).
2. Add section **1 + 2** immediately (consistent API behavior).
3. Add section **6** for CRUD baseline.
4. If assignment is URL shortener, paste section **7**.
5. Add section **3** if frontend/browser calls are needed.
6. Add section **4** if endpoint should be private.
7. Add section **8** if listing many records.
8. Add section **9** if interviewer asks about duplicate requests/retries.
9. Keep error format stable (`ok`, `error.code`, `requestId`).
10. Demo with curl quickly before coding extras.

---

## Quick curl smoke tests (edit routes as needed)

```bash
# health
curl -i http://127.0.0.1:8787/health

# create
curl -i -X POST http://127.0.0.1:8787/api/v1/resources \
  -H 'content-type: application/json' \
  -d '{"name":"demo"}'

# get by id
curl -i http://127.0.0.1:8787/api/v1/resources/<id>

# patch
curl -i -X PATCH http://127.0.0.1:8787/api/v1/resources/<id> \
  -H 'content-type: application/json' \
  -d '{"name":"updated","active":true}'

# soft delete
curl -i -X DELETE http://127.0.0.1:8787/api/v1/resources/<id>
```
