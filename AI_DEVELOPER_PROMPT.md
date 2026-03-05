# Prompt for AI Developer: Build a Minimal KV-Only Cloudflare Worker URL Shortener

Build an **operational** Cloudflare Worker URL shortener using **TypeScript + Hono + Zod + KV only**.

## API requirements (only these)
- `GET /{code}` → redirect
- `POST /api/v1/links` → create
- `GET /api/v1/links/{code}` → read
- `PATCH /api/v1/links/{code}` → update
- `DELETE /api/v1/links/{code}` → disable (soft delete)

## Constraints
- Do not use D1, R2, Queues, or Durable Objects.
- Use only KV for storage.
- Return consistent JSON errors:
  ```json
  {
    "ok": false,
    "error": { "code": "NOT_FOUND", "message": "Code not found" },
    "requestId": "..."
  }
  ```
- Add `x-request-id` response header.

## Data model in KV
- Key: `link:{code}`
- Value:
  ```json
  {
    "code": "demo1234",
    "targetUrl": "https://example.com",
    "active": true,
    "createdAt": "ISO_DATE",
    "updatedAt": "ISO_DATE"
  }
  ```

## Validation rules
- URL must be valid and start with `http://` or `https://`.
- Code format: `[a-zA-Z0-9_-]{4,32}`.
- If code omitted on create, auto-generate 7 chars and retry up to 5 collisions.

## Endpoint behavior

### POST /api/v1/links
Input:
```json
{ "url": "https://example.com", "code": "optional-code" }
```
- Create active record in KV.
- Return short URL and metadata.

### GET /api/v1/links/{code}
- Return record if exists.
- 404 if not found.

### PATCH /api/v1/links/{code}
Input supports either/both:
```json
{ "url": "https://new-url.com", "active": true }
```
- Update provided fields.
- Keep `createdAt` unchanged; refresh `updatedAt`.

### DELETE /api/v1/links/{code}
- Soft delete by setting `active=false`.

### GET /{code}
- Redirect with `302` only when record exists and `active=true`.
- Otherwise 404 JSON error.

## Deliverables
- `src/index.ts`
- `wrangler.toml` (KV binding only)
- `package.json`
- `tsconfig.json`
- `README.md` with setup and curl examples

Ensure it runs with:
- `npm install`
- `npm run dev`
- `npm run typecheck`
