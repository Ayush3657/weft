# Weft: product spec

Weft is a working name · Draft v0.2 · 2026-09-30

## 1. What it is

A storyboarding tool for ads and films where people direct and AI assists.

- **Write**: notes, script, project bible, moodboard.
- **Board**: a node graph of frames, with variations.
- **Play**: an animatic player with a timeline, like Google Vids.
- **Library**: a panel available in every workspace, holding every asset in the project.
- **Claude** can read and edit projects through MCP.

Who it's for: our team first (30s ads, with or without VO, often motion graphics), then a public release.
Scale: from a 6-second bumper to a ~30-minute short film (20–40 scenes, 200–500 shots).

## 2. Principles

1. **You direct, AI assists.** AI proposes. Nothing changes without a clear undo.
2. **Linear by default.** A new board is a left-to-right strip. The graph appears when you add a variation.
3. **Structure for machines, free text for people.** Timing, shot size, transitions, and who's in the shot are fields. Descriptions and VO are text.
4. **One project, many views.** Write, Board, Play, and the Library all show the same live data.
5. **Your data is yours.** Local vault with readable files; everything exports.
6. **Easy first, powerful later.** Frames start minimal; details open on demand.

## 3. Concepts

| Concept | What it is |
|---|---|
| Space | Where projects live: your personal space (only you) or a team's (its members). Holds folders, projects and libraries |
| Folder | Nested inside a space, e.g. one per real-estate project, client or campaign |
| Project | One ad or film (a storyboard). Has a type (ad, film, other), a format (aspect ratio, fps), and a storage mode. Lives in a space, maybe in a folder |
| Frame | One shot. Media (image or video, with versions), references, sketch layer, description, audio lines, on-screen text, camera, duration, tags |
| Link | A straight connection from one frame to the next, with a transition (type and duration) and an optional note |
| Variation | An alternative frame at the same point in the story. Created at a fork; can merge back into the main path |
| Cut | One playable version: a path through the graph (one choice at each fork), plus hidden frames and duration overrides. E.g. "30s TV", "15s cutdown" |
| Scene | A group of frames, with number, heading (INT/EXT, location, time of day), and color. Scenes can be grouped into sequences or acts |
| Asset | Any image, video, audio file, or link in the project. Every asset appears in the Library |
| Moodboard | A curated freeform canvas of assets, notes, and color swatches |
| Bible entry | A character, location, product, or style, with a description and reference assets. Tagged in frames with @ |
| Snapshot | A named, restorable version of the whole project ("Client v1") |

Rules:
- The graph has no loops (a frame can't link back to an earlier one), so every cut is a clean sequence.
- Every project has a Main cut.
- Shot numbers come from scene and order until numbering is locked. After that, inserted shots get letter suffixes (12A, 12B).

New projects start from a template (Ad 15/30/60s, Short film, Blank), which sets aspect ratio, fps, target length, and script mode.

## 4. Write

A sidebar of pages: Notes, Script, Bible, Moodboard, plus any custom pages.

**Notes.** Rich text with headings, lists, images, video, and link cards (YouTube, Instagram, Vimeo, Pinterest, any page). Paste anything.

**Script.** Two modes, set by the project type and switchable:
- **AV script (ads).** The standard two-column table: Video | Audio, plus duration. Each row is a frame in the current cut, so adding a row adds a frame and editing a cell edits that frame. Writing the script builds the board. Rows with variations get a swap control.
- **Screenplay (films).** Plain-text screenplay, compatible with the Fountain format. Scene headings become scenes. Select action lines and choose "Make frames". Each frame remembers its source lines, and the script highlights what's already boarded.

**Bible.** Project format and tone; style references; cast, locations, and products, each with a description and reference images. Tag them in frames with @ (@Priya, @Lobby). AI uses the bible as context for every action.

**Moodboard.** A freeform canvas:
- Drop in images, videos, links, notes, and color swatches, and group them into sections.
- Auto-arrange; videos play on hover.
- Pop it out into its own window (useful on a second monitor).
- Send items to a frame's references or to a bible entry.

## 5. Board

**Canvas.** Frames and straight links flowing left to right. Auto-layout ("Tidy") is available, and manual positions are allowed.

**Creating frames:**
- Enter adds the next frame.
- Drag from a frame's edge into empty space for a connected frame.
- Paste or drop an image on the canvas for a new frame.
- "Add variation" creates an alternative at the same point.

**Frame card.** The hero media is on top; that's what plays. A reference strip sits at the bottom, with the shot number, the first line of description or VO, and the duration. Expand the card to see every field.

**Frame fields:**

| Field | Details |
|---|---|
| Media | Image or video, with version history (sketch → concept → render → final). One version is the hero |
| References | Assets used as guides. They don't play |
| Sketch layer | See §8 |
| Description | Visual action |
| Audio lines | VO or dialogue, each with speaker and language |
| On-screen text | Supers, taglines, CTA, legal. Shown in Play |
| Camera | Shot size, angle, movement, lens. Optional one-click chips |
| Motion notes | For motion graphics |
| Duration | See §7 |
| Tags | @cast, @location, @product |
| Status | Idea, draft, or approved |
| Notes | Free text |

**Scenes.** Colored containers. Collapse a scene into a single card with a thumbnail strip. Zoomed out, frames show only thumbnails and numbers.

**Link labels** are computed: the start time in the selected cut plus the transition ("0:14 · Dissolve"). You can add a custom note.

**Long projects:** scene overview, search, filters (character, location, status, missing media), and a minimap.

## 6. Play

**Layout:**
- Left: the frame list in cut order, with editable description and VO.
- Right: the preview.
- Bottom: the timeline.
- Top: a cut picker and a target meter ("28.5s / 30s").

**Tracks:** Picture (frames), VO (from frames), Music, SFX, and Text (on-screen text and captions). No other tracks.

**Edits in Play go back to the board.** You can:
- drag a clip edge to change its duration
- edit text in the list
- hide a frame in this cut
- swap a variation in place

**Picture.** Plays each frame's hero media. Stills can get camera moves from the camera field (push in → slow zoom, pan → slide). Transitions: cut, dissolve, fade.

**Audio:**
- Record a scratch VO per frame with the mic.
- Import music and SFX.
- Tap to add beat markers while the music plays, and snap cuts to them.

**Playback.** Space, J/K/L, frame step, loop, play a scene, and play from the selection. Safe-area guides and an aspect mask. Present mode (fullscreen).

**Time display.** Seconds, timecode, or frames (at the project fps).

**Versions.** Play the cut with either the hero or the latest version of each frame's media, so you can see how far production has got.

## 7. Timing

Every frame has a duration, set in one of three modes:
- **Manual.** The default for motion graphics.
- **From VO.** Word count ÷ speaking rate (default 2.5 words per second for English, adjustable per project).
- **From audio.** The length of the recorded or generated VO clip, plus padding.

Cuts can override durations and hide frames. That's how a 30s ad becomes a 15s or 6s cutdown without copying anything.

Start times, timecodes, and totals are always calculated per cut, never typed.

## 8. Import, capture, and sketch

**Paste (Ctrl+V) works anywhere:**
- on a selected frame, it becomes a new media version
- on the canvas, it becomes a new frame
- anywhere else, it becomes a new asset

**Other ways in:**
- Drag in files (images, videos, audio), or images from web pages.
- Paste links to get preview cards.
- Grab a still from any video asset at the playhead.

**Watch folders (v1.5, needs the desktop companion).** Watch a folder such as Blender's render output or Photoshop's exports. Files named after a shot (`3.2A.png`, `sc03_sh02.png`) attach to that frame as a new version automatically, and re-exporting updates the frame.

**Sketch layer (v1, kept minimal).** Drawing with a mouse or a pen, with pen pressure on tablets: a pen, arrows for camera and subject movement, boxes for framing, an eraser that rubs out just what it passes over (or whole strokes, with Shift), six colors and three sizes. Lines are smoothed as they're drawn. You draw on a separate layer over the frame's picture (full or faded) or on paper when there's no picture yet, and each stroke is one undo step. The sketch shows on board cards, in the inspector, in Play (with a toggle) and on thumbnails. Claude sees it with the picture. The vault keeps each sketch as an SVG, and exports flatten it over the picture.

## 9. Library

- Collects every asset added anywhere in the project, automatically.
- Opens as a side panel in every workspace, toggled with a shortcut. Drag assets onto frames, notes, or the moodboard.
- Filter by type, tag, scene, or used/unused, and search. Each asset shows where it's used (frames, notes, moodboard, bible).

**Spaces, folders and their libraries.** Projects live in spaces (yours, or a team's) and nested folders, browsed from a sidebar with search, sorting and drag-to-move. A space and each folder has a library of its own: notes (facts, highlights, the tone, lines every ad must include such as a RERA number) and tagged pictures, clips and sound (renders, walkthroughs, drone shots, floor plans, logos). A project draws on the libraries of its folder and every folder above it, and on nothing from anywhere else, so a film's work never mixes with the ads'. The project's Library panel shows them under Folders; drag from there onto frames. Claude reads the same libraries, searches them by tag, and suggests tags that people keep or drop.

## 10. Storage, sync, and the local vault

**Sync engine.** Each project is a CRDT document (Yjs). Every copy is a live replica: the browser cache, the team server, the local vault, and Claude via MCP. Edits merge automatically, including after offline work. Media (images, video, audio) syncs separately by content hash, so big files never slow down typing.

**Storage modes.** Set per project, and changeable:

| Mode | Where it lives | Works offline | Share and collaborate |
|---|---|---|---|
| Local only | Your vault | Yes | No |
| Cloud only | Team server (+ browser cache) | Cached | Yes |
| Both (default) | Team server + live vault mirror | Yes | Yes |

**Vault layout.** A normal folder you can back up anywhere, laid out like Weft: a folder per space, its folders inside, a folder per storyboard, and each space's and folder's library.

```
Vault/
  Space/
    About.md          the library's notes
    Library/          its media, and library.json (tags, captions)
    Folder/
      Storyboard/
        project.json  readable snapshot, with where it lives in Weft
        project.sync  sync state (don't edit)
        script.md, notes/
        media/        original images, videos, audio, with readable names
        sketches/     each frame's sketch layer, as SVG
        exports/      PDFs, MP4s
        inbox/        drop files here to import (v1.5)
```

The vault keeps every storyboard in the spaces you choose, not just the ones you open, and follows renames and moves. It never deletes: a storyboard deleted in Weft stays in the vault and can be brought back. In a cloud drive (OneDrive, Google Drive), conflict copies of project.sync are merged back in.

**How the vault gets written:**
- **v1.** In Chrome or Edge, the web app writes directly to a folder you choose, with no install. It syncs while the app is open and catches up when you reopen it.
- **v1.5.** A desktop companion app keeps the vault synced in the background. It also adds watch folders, lets Claude reach local-only projects through MCP, and in v2 bridges to ComfyUI.

**Security:**
- Team sign-in with Google or Microsoft (Outlook) accounts, limited to allowed email addresses or domains. Project roles are enforced on the server.
- Space membership is enforced on the server: only a space's members can list, open, sync, or let Claude touch what's in it. Owners add people by email (they join when they first sign in) and take them out.
- Data encrypted at rest.
- Local only mode for confidential work.
- The vault doubles as your own backup, and snapshots let you restore.

## 11. Collaboration (v2)

Two people can already edit the same project live in v1, because of the sync engine. v2 adds:

- **Roles.** Owner, Editor, Commenter, Viewer. Invite by email or share a link with a role. Commenter is for clients and directors.
- **Presence.** Avatars, live cursors on the board, selection outlines, and who's in which workspace.
- **Comments.** On frames, links, moments on the timeline, and moodboard items, with threads, @mentions, and resolve.
- **Follow mode.** For review meetings: everyone follows the presenter's view.
- **Version history.** Snapshots, restore, and compare.
- **Claude.** Claude via MCP acts with the connecting user's role, appears in presence, and its edits are attributed to it.

## 12. AI

### Rules

- AI never overwrites anything on its own. In-app AI returns suggestions (ghost frames, alternatives) for you to accept.
- Every AI change is one undo step and is labeled with who made it.
- Alternatives arrive as variations.
- Claude's MCP edits arrive as one change set, with a bar in the app: "Claude made 12 changes · Keep · Review · Undo all".

### v1: Claude via MCP (Claude Desktop, Claude Code)

**Read tools:**
- `list_projects`
- `get_overview`: bible, scenes, cuts, stats
- `get_cut`: frames in order, with timing
- `get_frames`
- `get_script`
- `get_media`: returns images, so Claude can see the frames
- `search`

**Write tools:**
- `create_frames`: batch, with links and scenes
- `update_frames`
- `add_variation`
- `link_frames`
- `set_timing`
- `create_scene`
- `create_cut`
- `set_cut`
- `upsert_bible_entry`
- `attach_media`: from a file path or URL
- `add_note`

**Ready-made prompts** in Claude's menu: "Board this script as a 30s ad", "Write image prompts for scene N", "Write video prompts", "Fit this cut to 15s".

**With the Blender MCP.** In the same chat, Claude can render a Blender camera view and attach it to a frame.

In v1, MCP reaches Cloud and Both projects through the team server. Local-only projects need the desktop companion (v1.5).

### v1: video prompts

A frame already holds what a video model needs, so Weft writes the prompt for one frame or a whole cut, to copy into the tool:
- **Google Flow (Veo):** camera, action, who's in the shot (from the bible), the camera move, the brief's tone, dialogue in quotes, the sound, and "no subtitles". Voice-over only when asked, since it's usually recorded separately.
- **Higgsfield:** the same without the camera sentence, plus the camera-move preset to choose (push in → Dolly In, orbit → Arc Right).
- **Other tools** (Kling, Runway, local models): adds the length, aspect and a negative prompt.
- The frame's picture downloads as the start frame. Prompts can be edited before copying. Nothing is sent anywhere.

### v2: in-app AI (Claude API; optional local LLM)

| Scope | Actions |
|---|---|
| Frame | Rewrite, shorten VO to fit, suggest shot and camera, write image prompt |
| Scene or cut | Fit to target length, pacing check, continuity check |
| Project | Script → draft board |

### v2: generation

**Images.** Qwen Image and Flux, run through ComfyUI on your machine (via the desktop companion) or through cloud APIs.
- The prompt is built from the description, camera, @tagged bible entries, style, and reference images.
- You can edit the prompt and generate several options.
- The option you pick becomes a new media version.

**Video.** MiniMax, through its cloud API.
- Image-to-video, starting from the frame's hero image.
- The prompt comes from the same builder as the v1 video prompts; the length comes from the frame's duration.
- The clip becomes a new version of the frame, so the animatic turns into previz.

**Voice.** Text-to-speech for scratch VO.

**Costs and licenses:**
- Track spend per project for cloud generations.
- Before a public release, check the license of every model the app bundles or hosts.

## 13. Export

| Export | Phase |
|---|---|
| PDF storyboard: 1, 2, 3, or 6 frames per page, chosen fields, header with project name and version (no branding for now) | v1 |
| Shot list (CSV) | v1 |
| Project (JSON + media, same as the vault format) | v1 |
| Video prompts for Google Flow, Higgsfield and other video tools, per shot or per cut | v1 |
| Animatic MP4 | v1.5 |
| Timeline XML/EDL for Premiere and Resolve | v2 |

## 14. Roadmap

### v1: team core

- Sync engine, team server, sign-in, browser cache, autosave, snapshots
- Write: Notes, AV script, Bible, Moodboard, and the Library panel
- Board: frames, links, variations, cuts (with overrides and hidden frames), scenes, auto-layout, numbering, sketch layer (with pen pressure)
- Play: player, timeline, tracks, scratch VO, beat markers, on-screen text, transitions, camera moves
- Import: paste, drag and drop, link previews, stills from video
- Storage modes, with the vault written by the browser (Chrome/Edge)
- Claude via a local MCP server
- Export: PDF, shot list, project JSON, video prompts

### v1.5: film and pipeline

- Screenplay mode, scene breakdown, locked numbering
- Desktop companion: background vault sync, watch folders, auto-attach by filename
- MP4 export
- Performance and navigation polish for 300+ shot projects

### v2: collaboration and AI

- Roles, presence, comments, share links, follow mode, version compare
- In-app AI actions
- Image and video generation (Qwen Image, Flux, MiniMax), text-to-speech
- Automatic beat detection; XML/EDL export

### v3: public release

- Remote MCP with sign-in, so Claude works on web and mobile
- Onboarding, templates gallery, external review links, usage limits and billing, security review

## 15. Proposed tech

| Area | Choice |
|---|---|
| App | React + TypeScript + Vite |
| Board | React Flow, with ELK for auto-layout |
| Rich text | TipTap (ProseMirror) |
| Sync | Yjs, with a Hocuspocus server (Node) |
| Storage | Postgres or SQLite for data; S3-compatible storage (R2 or MinIO) for media |
| Player | Custom (Canvas + Web Audio); ffmpeg for MP4 export |
| MCP | TypeScript MCP SDK, packaged as a Claude Desktop Extension |
| Desktop companion | Electron or Tauri (decide in v1.5) |

Remotion would speed up the player and export, but companies need a paid license for it, so start with a custom player.

## 16. Not building (for now)

- A full video editor: export to Premiere or Resolve instead
- A painting app: the sketch layer stays minimal
- 3D previs
- One-click "AI makes the whole film"
- Editing on mobile (viewing and commenting may come later)

## 17. Decisions

| Question | Decision (2026-09-30) |
|---|---|
| Sign-in | Google or Microsoft (Outlook) accounts |
| Hosting | The team server runs on the main dev PC during testing, then moves to AWS |
| VO language | English (2.5 words per second default) |
| PDF branding | None for now |
| Name | Weft (working name) |
| UI design | Designed in code and reviewed in the browser; Figma later for the public launch |
| Sketch layer | Mouse and pen drawing in v1, with pen pressure (moved up from v2 on 2026-10-07) |

Hosting note: Google and Microsoft sign-in need an HTTPS address. Google won't redirect to a plain LAN IP address. While the server runs on the dev PC, teammates will reach it through a tunnel with an HTTPS domain, or use dev sign-in on the local network until we move to AWS.
