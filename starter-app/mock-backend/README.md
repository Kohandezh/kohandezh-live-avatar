# mock-backend

A throwaway API that implements `docs/api/openapi.yaml` so the app runs end-to-end on a laptop.
It stands in for the *separate* backend repository. It is not a template for the real backend's
code — only for its **contract** and its **rules** (auth transports, tiers, allowlists, error
and pagination envelopes).

```bash
pnpm dev            # http://localhost:8787
curl localhost:8787/public/users
curl -c c.txt -X POST localhost:8787/auth/login -H 'content-type: application/json' \
     -d '{"email":"demo@example.com","password":"demo1234"}'
curl -b c.txt localhost:8787/auth/me
```
