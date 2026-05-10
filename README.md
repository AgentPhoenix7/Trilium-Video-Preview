# Trilium Video Preview Widget

Custom widget for [TriliumNext](https://github.com/TriliumNext/Trilium) that embeds styled video players inline inside notes.

---

## How it works

Videos are stored as annotated links in note HTML:

```
<a href="http://host/video.mp4#video-native">video.mp4</a>   → native <video> player
<a href="https://www.youtube.com/embed/xxx#video-iframe">…</a> → <iframe> embed
```

- **Edit mode** — links render as styled pill buttons (fully editable/deletable)
- **Read-only mode** — widget auto-replaces them with inline players

Data survives plugin removal — links stay clickable even without the widget.

---

## Installation

1. Create a new note → type **"JS frontend"**
2. Paste the full contents of `video_preview_widget.js`
3. Add label **`#widget`** to the note
4. Restart Trilium once (required for layout rebuild)

---

## Usage

### Method 1 — Toolbar button (recommended)

1. Paste a video URL as plain text into any note
2. Click the **🎬** button in the note toolbar
3. Switch to read-only to see the player

Converts:
- Direct video files (`.mp4`, `.webm`, `.mkv`, …) → native player
- YouTube / Bilibili / Vimeo / Youku links → iframe embed

### Method 2 — File note (automatic)

Open any Trilium note whose type is **"file"** with a `video/*` MIME type. Player appears automatically — no labels needed.

### Method 3 — Video attachments

1. Attach one or more video files to a text note
2. Add label **`#videoPlayer`** to the note
3. Player panel appears (with dropdown selector if multiple files)

### Method 4 — Remote URL label

Add label `#videoUrl=<url>` to any note — plays the URL directly.

---

## Controls (native video)

| Control | Action |
| --- | --- |
| Click video | Play / Pause |
| Double-click video | Toggle fullscreen |
| Play / Pause button | Play / Pause (**Space**) |
| Seek bar | Click or drag to seek |
| Seek bar hover | Shows timestamp tooltip at cursor |
| Buffered progress | Shown on seek bar (lighter fill) |
| Time display | Current / total |
| ±5 s skip | **← →** arrow keys |
| Loop | Button or **L** |
| Volume | Slider or **↑ ↓** keys |
| Mute | Button or **M** |
| Playback speed | Dropdown (0.25× – 3×) |
| Picture-in-Picture | Button (browser support required) |
| Fullscreen | Button or **F** |
| Download | Info bar button (native video only) |
| Copy URL | Info bar button |
| Open in new tab | Info bar button |

> Click the player to focus it before using keyboard shortcuts.

### Auto-hide controls

Controls overlay fades out after **3 seconds** of inactivity while playing. Move the mouse over the player to bring them back. Controls always stay visible while paused.

### Volume & position persistence

- **Volume level and mute state** are saved to `localStorage` and restored across all players.
- **Playback position** is saved per URL. If you left off more than 10 seconds in, a **Resume** bar appears on next load offering to jump back.

---

## Supported platforms

| Type | Details |
| --- | --- |
| **Direct video** | mp4, webm, ogg, mov, mkv, avi, flv, m3u8, 3gp |
| **YouTube** | Auto-converts to `/embed/` URL |
| **Bilibili** | Auto-converts to `player.bilibili.com` |
| **Vimeo** | Auto-converts to `player.vimeo.com` |
| **Youku** | Auto-converts to `player.youku.com` |
| **Tencent Video** | iframe passthrough |
| **TikTok / Douyin** | iframe passthrough |
| **Any direct-link URL** | native player |

---

## Credit

Inline rendering architecture and toolbar button approach adapted from *VideoEmbedButton* (Chinese, unknown author). All controls, persistence, auto-hide, resume, attachment support, and styling are original additions.
