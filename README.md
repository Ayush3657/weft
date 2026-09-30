# Weft

Storyboards for ads and films. You direct, AI assists. The product spec is in [docs/product-spec.md](docs/product-spec.md).

## Run it

Needs Node 22 or newer.

```bash
npm install
npm run dev
```

Open http://localhost:5173. The API and sync server runs on port 8787, and the web dev server forwards to it.

Sign-in is dev mode for now (name and email, no password). Google and Microsoft sign-in come before team testing.

## Check it

```bash
npm test
npm run typecheck
```

## Layout

| Folder | What's in it |
|---|---|
| `packages/model` | The project data model: frames, links, variations, cuts, timing and shot numbering, stored in a Yjs document. Every edit goes through its commands. |
| `apps/server` | HTTP API (`/api`), live sync (`/sync`, Hocuspocus) and media storage. SQLite database in `apps/server/data/`. |
| `apps/web` | The React app: projects list and the Write, Board and Play workspaces. |

## Data

Everything the local server stores (database, uploaded media) lives in `apps/server/data/`, which git ignores. Back that folder up to keep your projects. Settings go in `apps/server/.env`; see `.env.example`.
