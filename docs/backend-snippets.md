# Interview-Ready Backend Snippets (Copy/Paste)

Use this when the interview project changes unexpectedly (URL shortener, tasks API, auth API, orders API, etc.).

## How to use this file quickly

1. Copy the **App skeleton** first.
2. Paste the **helpers** (`json`, `body`, `auth`, `cors`).
3. Pick one **resource template** (`links`, `users`, `tasks`, etc.) and rename fields.
4. Add only the endpoints you need for the interview scope.

---

## 1) App skeleton (Worker)

```js
import { jsonOk, jsonError } from "./lib/json.js";
import { parseJsonBody } from "./lib/body.js";
import { addCors, handlePreflight } from "./lib/cors.js";
import { requireApiToken } from "./lib/auth.js";

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return handlePreflight();
    }

    const response = await route(request, env);
    return addCors(response);
  },
};

async function route(request, env) {
  const url = new URL(request.url);
  const { pathname } = url;
  const method = request.method;

  if (method === "GET" && pathname === "/health") {
    return jsonOk({ status: "ok", ts: new Date().toISOString() });
  }

  // Example protected route group
  if (pathname.startsWith("/api/v1/")) {
    const unauthorized = requireApiToken(request, env);
    if (unauthorized) return unauthorized;
  }

  return jsonError("NOT_FOUND", "Route not found", 404);
}
```

---

## 2) JSON response helpers

```js
export function jsonOk(data, status = 200, meta = null) {
  return new Response(
    JSON.stringify({ ok: true, data, meta }),
    {
      status,
      headers: { "content-type": "application/json; charset=utf-8" },
    }
  );
}

export function jsonError(code, message, status = 400, details = null) {
  return new Response(
    JSON.stringify({
      ok: false,
      error: { code, message, details },
      requestId: crypto.randomUUID(),
    }),
    {
      status,
      headers: { "content-type": "application/json; charset=utf-8" },
    }
  );
}
```

---

## 3) Body parsing + validation shell

```js
export async function parseJsonBody(request) {
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

export function requireFields(body, fields) {
  const missing = fields.filter((f) => body?.[f] == null || body?.[f] === "");
  return missing.length ? { valid: false, missing } : { valid: true };
}
```

---

## 4) Auth middleware (simple Bearer token)

```js
import { jsonError } from "./json.js";

export function requireApiToken(request, env) {
  const auth = request.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";

  if (!token || token !== env.API_TOKEN) {
    return jsonError("UNAUTHORIZED", "Invalid or missing token", 401);
  }

  return null;
}
```

---

## 5) CORS helpers

```js
export function addCors(response) {
  const headers = new Headers(response.headers);
  headers.set("access-control-allow-origin", "*"); // TODO: restrict in production
  headers.set("access-control-allow-methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  headers.set("access-control-allow-headers", "content-type,authorization");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function handlePreflight() {
  return new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
      "access-control-allow-headers": "content-type,authorization",
    },
  });
}
```

---

## 6) Generic KV repository template

```js
export function createRepository(kv, prefix) {
  const key = (id) => `${prefix}:${id}`;

  return {
    async create(entity) {
      await kv.put(key(entity.id), JSON.stringify(entity));
      return entity;
    },

    async getById(id) {
      const raw = await kv.get(key(id));
      return raw ? JSON.parse(raw) : null;
    },

    async update(id, patch) {
      const existing = await this.getById(id);
      if (!existing) return null;

      const updated = {
        ...existing,
        ...patch,
        updatedAt: new Date().toISOString(),
      };

      await kv.put(key(id), JSON.stringify(updated));
      return updated;
    },

    async softDelete(id) {
      return this.update(id, { active: false });
    },
  };
}
```

---

## 7) CRUD handlers template (swap domain fields)

```js
import { jsonOk, jsonError } from "../lib/json.js";
import { parseJsonBody, requireFields } from "../lib/body.js";

export function createCrudHandlers(repo, requiredCreateFields = []) {
  return {
    async create(request) {
      const parsed = await parseJsonBody(request);
      if (parsed.error === "INVALID_CONTENT_TYPE") {
        return jsonError("INVALID_CONTENT_TYPE", "Expected application/json", 415);
      }
      if (parsed.error === "INVALID_JSON") {
        return jsonError("INVALID_JSON", "Malformed JSON", 400);
      }

      const check = requireFields(parsed.body, requiredCreateFields);
      if (!check.valid) {
        return jsonError("VALIDATION_ERROR", "Missing required fields", 422, {
          missing: check.missing,
        });
      }

      const now = new Date().toISOString();
      const entity = {
        id: crypto.randomUUID(),
        ...parsed.body,
        active: true,
        createdAt: now,
        updatedAt: now,
      };

      const created = await repo.create(entity);
      return jsonOk(created, 201);
    },

    async read(id) {
      const item = await repo.getById(id);
      if (!item) return jsonError("NOT_FOUND", "Resource not found", 404);
      return jsonOk(item);
    },

    async patch(request, id) {
      const parsed = await parseJsonBody(request);
      if (parsed.error) return jsonError(parsed.error, "Invalid request", 400);

      const updated = await repo.update(id, parsed.body);
      if (!updated) return jsonError("NOT_FOUND", "Resource not found", 404);
      return jsonOk(updated);
    },

    async remove(id) {
      const deleted = await repo.softDelete(id);
      if (!deleted) return jsonError("NOT_FOUND", "Resource not found", 404);
      return jsonOk({ deleted: true, id });
    },
  };
}
```

---

## 8) Router example with path params (no framework)

```js
import { createRepository } from "./lib/repository.js";
import { createCrudHandlers } from "./handlers/crud.js";
import { jsonError } from "./lib/json.js";

function matchPath(pathname, pattern) {
  const a = pathname.split("/").filter(Boolean);
  const b = pattern.split("/").filter(Boolean);
  if (a.length !== b.length) return null;

  const params = {};
  for (let i = 0; i < a.length; i++) {
    if (b[i].startsWith(":")) {
      params[b[i].slice(1)] = a[i];
    } else if (a[i] !== b[i]) {
      return null;
    }
  }

  return params;
}

export async function routeResource(request, env) {
  const url = new URL(request.url);
  const repo = createRepository(env.APP_KV, "resource"); // TODO: rename prefix
  const crud = createCrudHandlers(repo, ["name"]);

  if (request.method === "POST" && url.pathname === "/api/v1/resources") {
    return crud.create(request);
  }

  const params = matchPath(url.pathname, "/api/v1/resources/:id");
  if (!params) return jsonError("NOT_FOUND", "Route not found", 404);

  if (request.method === "GET") return crud.read(params.id);
  if (request.method === "PATCH") return crud.patch(request, params.id);
  if (request.method === "DELETE") return crud.remove(params.id);

  return jsonError("METHOD_NOT_ALLOWED", "Method not allowed", 405);
}
```

---

## 9) Pagination helper (list endpoint)

```js
export function parsePagination(url) {
  const page = Math.max(Number(url.searchParams.get("page") || 1), 1);
  const pageSize = Math.min(Math.max(Number(url.searchParams.get("pageSize") || 20), 1), 100);
  const offset = (page - 1) * pageSize;
  return { page, pageSize, offset };
}
```

---

## 10) Interview-ready curl snippets

```bash
# health
curl http://127.0.0.1:8787/health

# create resource
curl -X POST http://127.0.0.1:8787/api/v1/resources \
  -H 'content-type: application/json' \
  -H 'authorization: Bearer <TOKEN>' \
  -d '{"name":"demo","description":"example"}'

# read resource
curl -H 'authorization: Bearer <TOKEN>' \
  http://127.0.0.1:8787/api/v1/resources/<id>

# update resource
curl -X PATCH http://127.0.0.1:8787/api/v1/resources/<id> \
  -H 'content-type: application/json' \
  -H 'authorization: Bearer <TOKEN>' \
  -d '{"name":"updated-name"}'

# soft delete
curl -X DELETE -H 'authorization: Bearer <TOKEN>' \
  http://127.0.0.1:8787/api/v1/resources/<id>
```

---

## Fast adaptation map (change this based on interview prompt)

- **URL shortener**: `resource` -> `link`, required fields -> `url`, extra read handler -> redirect.
- **Todo API**: required fields -> `title`, extra patch field -> `completed`.
- **Orders API**: required fields -> `customerId`, `items`, compute totals in create handler.
- **Auth API**: replace token check with session/JWT flow; keep same response/error shapes.

If the prompt changes mid-interview, keep the same skeleton and only swap:
- route paths,
- required fields,
- KV key prefix,
- domain-specific validation.
