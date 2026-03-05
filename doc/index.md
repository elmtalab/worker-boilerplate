# Interview Prep Docs (Worker Boilerplate)

Use this folder as your quick lookup pack before the interview.

## What to read first

1. **Worker mental model + runtime basics**  
   Start with the cheatsheet for architecture-level answers and practical examples.
2. **Code walkthrough of this repo**  
   Be able to explain what each file does, how local dev works, and how deployment works.
3. **Common interview prompts**  
   Practice concise answers with the included snippets.

## Repo walkthrough (what to explain confidently)

### 1) Entry point (`src/index.ts`)
- A Worker exports an object with a `fetch` handler.
- Every incoming HTTP request calls `fetch(request, env, ctx)`.
- You return a `Response` object.

### 2) Configuration (`wrangler.toml`)
- Worker name and compatibility date.
- Entry script path.
- Environment-specific variables/secrets can be attached at deploy/runtime.

### 3) Tooling (`package.json`, `tsconfig.json`)
- TypeScript typing for Worker runtime objects (`Request`, `Response`, `ExecutionContext`, and env bindings).
- Local scripts for dev and deployment.

## High-value interview topics checklist

- [ ] Explain edge runtime vs traditional server runtime.
- [ ] Discuss stateless compute and where state should live (KV, D1, Durable Objects, R2, external DB).
- [ ] Show request routing and method-based handlers.
- [ ] Explain error handling and status code strategy.
- [ ] Explain caching (HTTP headers + Cache API patterns).
- [ ] Explain auth patterns (JWT verification, signed headers, API key middleware).
- [ ] Explain observability (structured logs, request IDs, timing).
- [ ] Explain CI/CD and safe rollout strategy.

## Quick snippets

### Health check endpoint
```ts
export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/health') {
      return Response.json({ ok: true, ts: Date.now() })
    }

    return new Response('Not Found', { status: 404 })
  },
}
```

### Method + path router pattern
```ts
function route(req: Request): string {
  const url = new URL(req.url)
  return `${req.method.toUpperCase()} ${url.pathname}`
}

export default {
  async fetch(request: Request): Promise<Response> {
    switch (route(request)) {
      case 'GET /':
        return new Response('Hello from Worker')
      case 'POST /echo':
        return new Response(await request.text())
      default:
        return new Response('Not Found', { status: 404 })
    }
  },
}
```

### Error boundary pattern
```ts
export default {
  async fetch(request: Request): Promise<Response> {
    try {
      // business logic
      return Response.json({ ok: true })
    } catch (error) {
      console.error('unhandled_error', {
        message: error instanceof Error ? error.message : String(error),
      })
      return Response.json({ error: 'Internal Server Error' }, { status: 500 })
    }
  },
}
```

## Practice prompt ideas

- "How would you design an API rate limiter on Workers?"
- "When do you choose Durable Objects over KV?"
- "How would you debug latency spikes in edge regions?"
- "How would you do zero-downtime migrations for API versions?"

## Additional skeleton

Open **`worker-todo-app-skeleton.md`** for a different app skeleton you can discuss in interviews.

## Next file

Open **`cloudflare-worker-interview-cheatsheet.md`** for deeper Q&A and implementation patterns.
