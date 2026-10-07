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

## Spaces, folders and libraries

The projects page has a sidebar of **spaces**: **Personal** (only you see it) and team spaces, which you share by adding people (their email; anyone who hasn't signed in yet joins when they do). Projects that existed before spaces were moved into a team space called **Team**, with everyone who had signed in; rename it from its menu.

- **Folders** nest inside a space, for example one folder per real-estate project with its storyboards inside. Make one with **New folder**, and drag storyboards or folders onto a folder (in the page, the sidebar or the path at the top) to move them, or use **Move to…** in a storyboard's menu to move it to another space.
- **Search** (press `/`) finds storyboards and folders anywhere in the space; **sort** by last edited, name, newest or type.
- Every space and folder has a **Library** tab: notes on what its storyboards are about (location, configurations, highlights, the lines every ad must include) and tagged renders, clips and sound. Drop or paste files there.
- A storyboard can use the libraries of its folder and of every folder above it. In the storyboard, open the Library panel (`L`) and choose **Folders** to see them, then drag a picture onto a frame.
- Claude reads the same libraries for a storyboard (and nothing outside them), finds pictures by tag, and can suggest tags; suggestions wait in the Library tab for someone to keep or drop.

## Sketch on a frame

Rough out a shot before there's a picture, or mark up the one there is: select a frame and press `D`, or use the pen button on its card (it shows when you point at the card) or **Sketch** in the inspector.

- **Pen** (`P`), **arrow** (`A`; hold Shift for a straight one) for camera and subject moves, **box** (`B`) for framing, and **eraser** (`E`). Six colours and three sizes (`[` and `]`).
- With a drawing tablet or a touch pen, lines follow your pressure.
- `H` changes what's under the sketch: the picture, the picture faded, or plain paper. A frame without a picture is sketched on paper.
- `←` and `→` go to the previous and next shot in the cut, and `Esc` closes. Each stroke is one undo (`Ctrl+Z`). **Clear** in the inspector removes a frame's sketch.
- The sketch shows on the board, in the inspector, in Play (turn it off with **Sketches** under the player) and on thumbnails. Claude sees it when it looks at the frames, and the vault keeps each one as an SVG in the storyboard's `sketches/` folder.

## Prompts for AI video

Each frame already says what a video model needs (what we see, the camera, who's in it, the dialogue, the brief's tone), so Weft writes it up as a prompt to paste into the tool.

- For one shot: **Video prompt** (the clapperboard) in the inspector, or right-click a frame. For the whole cut: the cut menu at the top, **Video prompts for this cut…**
- Choose the tool. **Google Flow** gets Veo's order: the camera, the action, the cast, the move, the tone, then dialogue in quotes and the sound, with no subtitles. **Higgsfield** gets the camera-move preset to pick there (push in is Dolly In, orbit is Arc Right). **Other tools** (Kling, Runway, a model on your computer) get the length, the aspect and a negative prompt.
- Tick what goes in: the brief's tone, dialogue, and voice-over (off at first, since it's usually recorded separately).
- **Start frame** downloads the frame's picture, for image-to-video.
- Edit a prompt before you copy it if you like. **Copy them all** copies every shot's prompt, numbered.
- With Claude, use the **Write video prompts** prompt: Claude writes them from the frames, their pictures and sketches, and the library.

## Keep a copy on this computer

In Chrome or Edge, Weft keeps a copy of everything in a folder on your computer, the **vault**. Choose it from **Keep a copy on this computer…** at the bottom of the projects page's sidebar, and tick the spaces it keeps. It's laid out like Weft:

```
Weft Vault/
  ASBL Ads/                 a space
    About.md                its library's notes
    Library/                its pictures and clips, and library.json with their tags and captions
    Broadway/               a folder, with its own About.md and Library/
      Launch 30s/           a storyboard
        project.sync        what Weft opens
        project.json        a readable copy, including where it lives in Weft
        script.md
        notes/              one Markdown file per notes page
        media/              the original pictures, clips and sound
        sketches/           each frame's sketch, as an SVG
```

- Every storyboard in the ticked spaces is kept, not only the ones you open: soon after Weft opens in that browser, every ten minutes, and after you change something. A storyboard you have open is saved as you work.
- Rename or move a folder or storyboard in Weft and its folder in the vault follows.
- Nothing is deleted from the vault. A storyboard deleted in Weft stays there, under **In the vault, not in Weft**, and **Open in Weft** brings it back where it was.
- **A folder for one storyboard** instead: use the folder button in its header.
- **Open from folder** (projects page) opens a storyboard's folder from anywhere, for example one copied from another computer. It keeps its id, so it's the same storyboard, goes back to the space and folder it came from if they're still there (otherwise where you're looking), and its pictures upload if the server doesn't have them.
- The vault is a copy for reading and backup: edit in Weft. Weft rewrites `project.json`, `script.md`, `notes/`, `About.md` and `Library/`.
- The browser asks once per visit before Weft can write to the vault again (**Allow access**); installed as an app, it can remember.

### A vault in OneDrive or Google Drive

Choose a folder inside OneDrive, or inside Google Drive for desktop's drive (for example `G:\My Drive\Weft Vault`, not the drive itself), and the vault is backed up to the cloud like any other files. You can browse it on the web or your phone (plain folders, Markdown, pictures and clips), and on another computer with the same drive, **Open from folder** opens a storyboard from it. If two computers save the same storyboard at once, the drive keeps a second copy (OneDrive: `project-LAPTOP.sync`, Google Drive: `project (1).sync`); Weft merges it in the next time it saves that storyboard and removes it. For working together, share a space in Weft rather than a vault folder: the vault is each person's own copy.

## Use it with Claude

Claude can read and edit your projects through MCP: board a script, rewrite VO to fit a length, make a cutdown, write image or video prompts, or attach a Blender render to a frame. It sees the frames' pictures and sketches. Its edits show up live for everyone, grouped into change sets that you keep or undo from the bar in the app.

**On the computer Weft runs on:**

1. In Weft, open your account menu, choose **Connect Claude**, then **Connect Claude on this computer**. Weft makes a key for Claude, saves it in your user folder (`~/.weft/connector.json`) and adds Weft to Claude Desktop's settings.
2. Quit Claude Desktop fully (from its icon by the clock) and open it again.
3. In a new chat, ask Claude "List my Weft projects". Weft's ready-made prompts are in Claude's attach menu.

This setup belongs to the computer (its Windows account), not to a Claude account: whoever is signed in to Claude here works in Weft as you. Claude Code sessions opened in this folder offer Weft too (from `.mcp.json`).

**On other computers** (a teammate's, or another of yours): each person connects their own Claude with their own key, so Claude's edits are theirs. Weft has to be open to the network first (see below). Then, on that computer, signed in to Weft as themselves: account menu, **Connect Claude**, **On another computer**. That downloads **Weft for Claude** (`Weft.mcpb`), an extension that Claude Desktop installs with a double-click and runs with its own Node, so there's nothing else to install. Claude asks for a key, which they create in the same dialog, and fills in Weft's address. Claude Code users get a one-line command there instead.

The connector is built by `npm run dev` (or `npm run build -w @weft/mcp`). Claude's changes can be undone from the app until the server restarts.

## Let your team in

Weft normally only answers on this computer. To let teammates on the same network use it (and connect their Claude):

1. Close Weft if it's running, then double-click **Start Weft for the team.cmd**. It builds the app and runs it for everyone on your network.
2. The first time, Windows may ask whether Node.js can use the network. Allow it on private networks.
3. The window shows the address teammates open (for example `http://10.0.0.5:8787`). The Connect Claude dialog shows it too.

Sign-in is still dev mode (a name and an email, no password), so anyone on your network who opens that address can sign in, as anyone. Only do this on a network you trust; Google and Microsoft sign-in will replace it. To set the address yourself (a fixed IP or a computer name), put `PUBLIC_URL` in `apps/server/.env`; see `.env.example`.

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
