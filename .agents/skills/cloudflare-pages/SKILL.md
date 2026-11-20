---
name: cloudflare-pages
description: Preview or deploy this repository's Bun, React, and Vite frontend to giinii06.pages.dev with Cloudflare Pages Direct Upload.
---

Run frontend commands from `web/`. Install dependencies with `bun install --frozen-lockfile`. Use `bun run dev` for development and `bun run build` for a production build.

When asked to publish, use `bun run deploy`. It builds the frontend and uploads only `web/dist` to the `main` production branch of the `giinii06` Pages project. The Oracle backend is deployed separately.

If Wrangler needs authentication, run `bun run cf login --device --browser=false --scopes account:read user:read pages:write`. Give the user Wrangler's verification URL and short code, then wait for approval. The `cf` script keeps Wrangler's configuration in the ignored `web/.wrangler/` directory on the project host.

If the project does not exist in the user's Cloudflare account, create it with `bun run cf pages project create giinii06 --production-branch=main --force`. Wrangler 4.165 can delegate new projects to Workers, so use `--force` for initial creation to get a `pages.dev` address. Check that Cloudflare assigned the exact subdomain before deploying. After deployment, verify that https://giinii06.pages.dev serves the new build.

[Cloudflare Pages Direct Upload](https://developers.cloudflare.com/pages/get-started/direct-upload/)
