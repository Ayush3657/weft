# Weft

Storyboards for ads and films. You direct, AI assists. The product spec is in [docs/product-spec.md](docs/product-spec.md).

## Run it

Needs Node 22 or newer.

On Windows, double-click **Start Weft.cmd** in this folder. It installs what's needed on first run, starts Weft and opens it in your browser. Keep its window open while you (or Claude) use Weft; close it to stop Weft. To start Weft whenever you sign in to Windows, put a shortcut to it in your Startup folder (Win+R, `shell:startup`).

Or from a terminal:

```bash
npm install
npm run dev
```

Open http://localhost:5173. The API and sync server runs on port 8787, and the web dev server forwards to it.

Sign-in is dev mode for now (name and email, no password). Google and Microsoft sign-in come before team testing.

For everyday use, run the built app instead. It loads much faster than the dev server:

```bash
npm run app
```

Then open http://localhost:8787. In Chrome or Edge you can install it as an app (the install icon in the address bar), which gives Weft its own window and taskbar icon.

## Keep projects in a folder

In Chrome or Edge, Weft can keep a copy of your projects in folders on your computer:

- **A vault folder** (on the projects page): every project you open gets a folder of its own there.
- **A folder for one project**: use the folder button in the project's header.
- **Open from folder** (projects page): opens a project folder from anywhere, for example one copied from another computer. It keeps its id, so it's the same project, and its pictures upload if the server doesn't have them.

Each project folder holds `project.sync` (what Weft opens), `project.json` (a readable copy), `script.md`, `notes/` and `media/` (the original pictures, clips and sound). Weft keeps it up to date while the project is open and merges in changes made elsewhere when you reopen it, so the folder can live in OneDrive or Dropbox. The browser asks once per visit before Weft can write to the folder again; installed as an app, it can remember.

## Use it with Claude

Claude can read and edit your projects through MCP: board a script, rewrite VO to fit a length, make a cutdown, write image prompts, or attach a Blender render to a frame. Its edits show up live for everyone, grouped into change sets that you keep or undo from the bar in the app.

1. In Weft, open your account menu, choose **Connect Claude**, then **Connect Claude on this computer**. Weft makes a key for Claude, saves it in your user folder (`~/.weft/connector.json`) and adds Weft to Claude Desktop's settings.
2. Quit Claude Desktop fully (from its icon by the clock) and open it again.
3. In a new chat, ask Claude "List my Weft projects". Weft's ready-made prompts are in Claude's attach menu.

Claude Code sessions opened in this folder offer Weft too (from `.mcp.json`). For Claude on another computer, the same dialog shows how to set it up by hand. The connector is built by `npm run dev` (or `npm run build -w @weft/mcp`). Claude's changes can be undone from the app until the server restarts.

## Keep projects in a folder

In Chrome or Edge, Weft can keep a copy of your projects in folders on your computer:

- **A vault folder** (on the projects page): every project you open gets a folder of its own there.
- **A folder for one project**: use the folder button in the project's header.
- **Open from folder** (projects page): opens a project folder from anywhere, for example one copied from another computer. It keeps its id, so it's the same project, and its pictures upload if the server doesn't have them.

Each project folder holds `project.sync` (what Weft opens), `project.json` (a readable copy), `script.md`, `notes/` and `media/` (the original pictures, clips and sound). Weft keeps it up to date while the project is open and merges in changes made elsewhere when you reopen it, so the folder can live in OneDrive or Dropbox. The browser asks once per visit before Weft can write to the folder again; installed as an app, it can remember.

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
