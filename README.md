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

## Use it with Claude

Claude can read and edit your projects through MCP: board a script, rewrite VO to fit a length, make a cutdown, write image prompts, or attach a Blender render to a frame. Its edits show up live for everyone, grouped into change sets that you keep or undo from the bar in the app.

1. In Weft, open your account menu and choose **Connect Claude**, then make a key.
2. Paste the settings it shows into Claude Desktop (Settings, Developer, Edit Config) and restart it, or run the command it shows for Claude Code.
3. Ask Claude "List my Weft projects". Weft's ready-made prompts are in Claude's attach menu.

The connector Claude Desktop runs is built by `npm run dev` (or `npm run build -w @weft/mcp`). Claude's changes can be undone from the app until the server restarts.

## Check it

```bash
npm test
npm run typecheck
```

## Layout

| Folder | What's in it |
|---|---|
| `packages/model` | The project data model: frames, links, variations, cuts, timing and shot numbering, plus notes pages, the bible and the moodboard, stored in a Yjs document. Every edit goes through its commands. |
| `apps/server` | HTTP API (`/api`), live sync (`/sync`, Hocuspocus), media storage, link previews, and the MCP endpoint for Claude (`/mcp`). SQLite database in `apps/server/data/`. |
| `apps/mcp` | The connector Claude Desktop runs: passes MCP through to the server and uploads files from your computer. |
| `apps/web` | The React app: projects list and the Write, Board and Play workspaces. |

## Data

Everything the local server stores (database, uploaded media) lives in `apps/server/data/`, which git ignores. Back that folder up to keep your projects. Settings go in `apps/server/.env`; see `.env.example`.
