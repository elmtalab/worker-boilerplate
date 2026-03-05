# Worker Boilerplate: Minimal KV-Only URL Shortener API

This is an operational Cloudflare Worker URL shortener with **KV only**, using plain Worker JavaScript (no routing framework), and exactly these APIs:

- `GET /{code}` (redirect)
- `POST /api/v1/links` (create)
- `GET /api/v1/links/{code}` (read)
- `PATCH /api/v1/links/{code}` (update)
- `DELETE /api/v1/links/{code}` (disable)

## What is stored in KV

Each link is stored as JSON under key `link:{code}`:

```json
{
  "code": "demo123",
  "targetUrl": "https://example.com",
  "active": true,
  "createdAt": "2026-01-01T00:00:00.000Z",
  "updatedAt": "2026-01-01T00:00:00.000Z"
}
```

## Setup

1) Install dependencies

```bash
npm install
```

2) Create KV namespaces

```bash
npx wrangler kv namespace create LINKS_KV
npx wrangler kv namespace create LINKS_KV --preview
```

3) Put the generated IDs in `wrangler.toml`.

4) Run locally

```bash
npm run dev
```

## Reusable backend snippets

Copy-paste, interview-ready backend snippets (easy to adapt beyond URL shortener projects) are available at `docs/backend-snippets.md`.

## API examples

### Create

```bash
curl -X POST http://127.0.0.1:8787/api/v1/links \
  -H 'content-type: application/json' \
  -d '{"url":"https://example.com","code":"demo1234"}'
```

### Read

```bash
curl http://127.0.0.1:8787/api/v1/links/demo1234
```

### Update URL or active state

```bash
curl -X PATCH http://127.0.0.1:8787/api/v1/links/demo1234 \
  -H 'content-type: application/json' \
  -d '{"url":"https://example.org/new","active":true}'
```

### Disable (soft delete)

```bash
curl -X DELETE http://127.0.0.1:8787/api/v1/links/demo1234
```

### Redirect

```txt
http://127.0.0.1:8787/demo1234
```

## Notes

- All error responses follow this shape:

```json
{
  "ok": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "Code not found"
  },
  "requestId": "..."
}
```

- `DELETE` disables a link by setting `active=false` (no hard delete), so it can be restored via `PATCH`.

## Python smoke test (Google Colab-friendly)

A ready-to-run script is available at `colab_api_smoke_test.py` to exercise all API routes:

- `POST /api/v1/links`
- `GET /api/v1/links/{code}`
- `PATCH /api/v1/links/{code}`
- `GET /{code}` redirect
- `DELETE /api/v1/links/{code}`
- `GET /{code}` after delete (expects 404)

### In Google Colab

```python
!pip -q install requests
!python colab_api_smoke_test.py --base-url "https://<your-worker-domain>"
```

### Local run

```bash
python colab_api_smoke_test.py --base-url "http://127.0.0.1:8787"
```
