/**
 * Trilium Video Preview Widget — Combined Edition
 *
 * Storage format (inside note HTML):
 *   <a href="http://host/file.mp4#video-native">title</a>  → native <video> player
 *   <a href="https://youtu.be/xxx#video-iframe">title</a>  → <iframe> embed player
 *
 * Workflow:
 *   1. Paste a video URL into a text note
 *   2. Click the 🎬 toolbar button — converts URL(s) to storage format on the backend
 *   3. In read-only mode the widget auto-renders inline video players
 *   4. File notes (MIME video/*) and notes with #videoPlayer + video attachments
 *      get a dedicated panel player below the note content
 *
 * Native player controls:
 *   Overlay controls (auto-hide) · Seek bar with buffered + hover tooltip · Time display
 *   Loop · Speed · Volume (persisted) · Mute · PiP · Fullscreen
 *   Click-to-play · Double-click fullscreen · Download (info bar)
 *   Resume playback position per URL (persisted)
 *
 * Keyboard (focus player first): Space · ←/→ (±5s) · ↑/↓ (vol) · M (mute) · F (fs) · L (loop)
 *
 * Platforms: YouTube · Bilibili · Vimeo · Youku · Tencent Video · any direct URL
 *
 * Install: paste into a "JS frontend" code note, add label #widget, restart Trilium once.
 */

/* ── constants ─────────────────────────────────────────────────────────── */
const TVP_NATIVE    = '#video-native';
const TVP_IFRAME    = '#video-iframe';
const TVP_STYLE_ID  = 'tvp-global-styles';
const TVP_LS_VOL    = 'tvp-vol';
const TVP_LS_MUTED  = 'tvp-muted';
const TVP_LS_POS    = 'tvp-pos-';   /* + base64(url) */

const VIDEO_MIME_RE = /^video\//i;
const VIDEO_EXT_RE  = /\.(mp4|webm|ogg|ogv|mov|m4v|mkv|avi|flv|3gp|m3u8)(\?.*)?$/i;

const HIDE_DELAY = 3000; /* ms of inactivity before controls hide */

/* ── helpers ────────────────────────────────────────────────────────────── */
function fmtTime(s) {
    if (!isFinite(s) || s < 0) return '0:00';
    s = Math.floor(s);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return h
        ? `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`
        : `${m}:${String(sec).padStart(2,'0')}`;
}

function isVideoMime(mime)  { return !!mime  && VIDEO_MIME_RE.test(mime); }
function isVideoExt(title)  { return !!title && VIDEO_EXT_RE.test(title); }

function lsGet(key, fallback = null) {
    try { const v = localStorage.getItem(key); return v !== null ? v : fallback; } catch { return fallback; }
}
function lsSet(key, val) { try { localStorage.setItem(key, val); } catch {} }

function posKey(url) {
    try { return TVP_LS_POS + btoa(encodeURIComponent(url)).replace(/[^a-zA-Z0-9]/g, '_'); }
    catch { return TVP_LS_POS + url.length; }
}

/* ── platform registry ─────────────────────────────────────────────────── */
const PLATFORMS = [
    {
        name: 'YouTube', icon: '▶', cssClass: 'youtube',
        match: u => u.includes('youtube.com') || u.includes('youtu.be'),
        embed: u => { const m = u.match(/(?:v=|youtu\.be\/)([^&?#]+)/); return m ? `https://www.youtube.com/embed/${m[1]}?rel=0` : u; }
    },
    {
        name: 'Bilibili', icon: '📺', cssClass: 'bilibili',
        match: u => u.includes('bilibili.com'),
        embed: u => { const m = u.match(/(BV[\w]+)/i); return m ? `https://player.bilibili.com/player.html?bvid=${m[1]}&high_quality=1&autoplay=0` : u; }
    },
    {
        name: 'Vimeo', icon: '🎬', cssClass: 'vimeo',
        match: u => u.includes('vimeo.com'),
        embed: u => { const m = u.match(/vimeo\.com\/(\d+)/); return m ? `https://player.vimeo.com/video/${m[1]}` : u; }
    },
    {
        name: 'Youku', icon: '🎯', cssClass: 'youku',
        match: u => u.includes('youku.com'),
        embed: u => { const m = u.match(/id_([^.]+)/); return m ? `https://player.youku.com/embed/${m[1]}` : u; }
    },
    {
        name: 'Tencent', icon: '📹', cssClass: 'tencent',
        match: u => u.includes('v.qq.com') || u.includes('qq.com/x/cover'),
        embed: u => u
    },
    {
        name: 'TikTok', icon: '🎵', cssClass: 'tiktok',
        match: u => u.includes('tiktok.com') || u.includes('douyin.com'),
        embed: u => u
    },
    {
        name: 'Local', icon: '💾', cssClass: 'local',
        match: u => u.includes('localhost') || u.includes('127.0.0.1') || u.startsWith('/'),
        embed: u => u
    }
];

const DEFAULT_PLATFORM = { name: 'Video', icon: '🎬', cssClass: 'default', embed: u => u };

function detectPlatform(url) { return PLATFORMS.find(p => p.match(url)) ?? DEFAULT_PLATFORM; }

function getEmbedParent() {
    try { return encodeURIComponent(location.hostname || 'localhost'); }
    catch { return 'localhost'; }
}

function classifyVideoUrl(url, embedParent = getEmbedParent()) {
    url = (url || '').trim();
    if (!url || url.includes(TVP_NATIVE) || url.includes(TVP_IFRAME)) return null;

    if (VIDEO_EXT_RE.test(url) || url.includes('localhost') || url.includes('127.0.0.1')) {
        const fn = (() => { try { return decodeURIComponent(url.split('/').pop().split('?')[0].split('#')[0]); } catch { return 'Video'; } })();
        return { type: 'native', url, title: fn || 'Local Video' };
    }
    if (url.includes('youtube.com') || url.includes('youtu.be')) {
        const m = url.match(/(?:v=|youtu\.be\/)([^&?#]+)/);
        if (m) return { type: 'iframe', url: `https://www.youtube.com/embed/${m[1]}?rel=0`, title: `YouTube ${m[1]}` };
    }
    if (url.includes('bilibili.com')) {
        const m = url.match(/(BV[\w]+)/i);
        if (m) return { type: 'iframe', url: `https://player.bilibili.com/player.html?bvid=${m[1]}&high_quality=1&autoplay=0`, title: `Bilibili ${m[1]}` };
    }
    if (url.includes('vimeo.com')) {
        const m = url.match(/vimeo\.com\/(\d+)/);
        if (m) return { type: 'iframe', url: `https://player.vimeo.com/video/${m[1]}`, title: `Vimeo ${m[1]}` };
    }
    if (url.includes('youku.com')) {
        const m = url.match(/id_([^.]+)/);
        if (m) return { type: 'iframe', url: `https://player.youku.com/embed/${m[1]}`, title: 'Youku Video' };
    }
    if (url.includes('v.qq.com')) {
        const m = url.match(/vid=([^&]+)/) || url.match(/\/([a-z0-9]+)\.html$/i);
        if (m) return { type: 'iframe', url: `https://v.qq.com/txp/iframe/player.html?vid=${m[1]}`, title: 'Tencent Video' };
    }
    if (url.includes('tiktok.com') || url.includes('douyin.com')) {
        const m = url.match(/video\/(\d+)/);
        if (m) return { type: 'iframe', url: `https://www.tiktok.com/embed/v2/${m[1]}`, title: `TikTok ${m[1]}` };
    }
    if (url.includes('twitch.tv')) {
        const clip = url.match(/clips\.twitch\.tv\/([^/?#]+)/) || url.match(/clip\/([^/?#]+)/);
        if (clip) return { type: 'iframe', url: `https://clips.twitch.tv/embed?clip=${clip[1]}&parent=${embedParent}`, title: `Twitch Clip ${clip[1]}` };
        const vod = url.match(/twitch\.tv\/videos\/(\d+)/);
        if (vod) return { type: 'iframe', url: `https://player.twitch.tv/?video=${vod[1]}&parent=${embedParent}`, title: `Twitch VOD ${vod[1]}` };
        const ch = url.match(/twitch\.tv\/([^/?#]+)/);
        if (ch) return { type: 'iframe', url: `https://player.twitch.tv/?channel=${ch[1]}&parent=${embedParent}`, title: `Twitch: ${ch[1]}` };
    }
    if (url.includes('dailymotion.com') || url.includes('dai.ly')) {
        const m = url.match(/(?:video|dai\.ly)\/([a-z0-9]+)/i);
        if (m) return { type: 'iframe', url: `https://www.dailymotion.com/embed/video/${m[1]}`, title: `Dailymotion ${m[1]}` };
    }
    if (url.includes('rumble.com')) {
        const embed = url.match(/rumble\.com\/embed\/([^/?#]+)/);
        if (embed) return { type: 'iframe', url: `https://rumble.com/embed/${embed[1]}/`, title: 'Rumble Video' };
        const vid = url.match(/rumble\.com\/([^/?#]+)\.html/);
        if (vid) return { type: 'iframe', url: `https://rumble.com/embed/${vid[1]}/`, title: 'Rumble Video' };
    }
    if (url.includes('odysee.com')) {
        const m = url.match(/odysee\.com\/@[^/]+\/([^/?#]+)/);
        if (m) return { type: 'iframe', url: `https://odysee.com/$/embed/${m[1]}`, title: `Odysee: ${m[1]}` };
    }
    if (url.includes('nicovideo.jp')) {
        const m = url.match(/watch\/((?:sm|nm|so)\d+)/);
        if (m) return { type: 'iframe', url: `https://embed.nicovideo.jp/watch/${m[1]}?autoplay=0`, title: `Niconico ${m[1]}` };
    }
    if (url.includes('streamable.com')) {
        const m = url.match(/streamable\.com\/([a-z0-9]+)/i);
        if (m) return { type: 'iframe', url: `https://streamable.com/e/${m[1]}`, title: `Streamable ${m[1]}` };
    }
    if (url.includes('loom.com')) {
        const m = url.match(/loom\.com\/share\/([a-f0-9]+)/i);
        if (m) return { type: 'iframe', url: `https://www.loom.com/embed/${m[1]}`, title: `Loom ${m[1]}` };
    }
    if (url.includes('kick.com')) {
        const clip = url.match(/kick\.com\/[^/]+\?clip=([^&]+)/);
        if (clip) return { type: 'iframe', url: `https://kick.com/embed/clip/${clip[1]}`, title: `Kick Clip ${clip[1]}` };
        const ch = url.match(/kick\.com\/([^/?#]+)/);
        if (ch && ch[1] !== 'video') return { type: 'iframe', url: `https://player.kick.com/${ch[1]}`, title: `Kick: ${ch[1]}` };
    }
    if (url.includes('peertube') || url.match(/\/videos\/watch\/[a-f0-9-]{36}/)) {
        const m = url.match(/(https?:\/\/[^/]+)\/videos\/watch\/([a-f0-9-]{36})/);
        if (m) return { type: 'iframe', url: `${m[1]}/videos/embed/${m[2]}`, title: 'PeerTube Video' };
    }

    return { type: 'native', url, title: 'Video' };
}

/* ── global CSS ─────────────────────────────────────────────────────────── */
const GLOBAL_CSS = `
/* ── edit-mode: video links styled as pill buttons ── */
a[href*="#video-native"],
a[href*="#video-iframe"] {
    display: inline-flex !important;
    align-items: center; gap: 7px;
    padding: 9px 16px;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: #fff !important;
    text-decoration: none !important;
    border-radius: 20px;
    font-weight: 600; font-size: 13px;
    margin: 5px 0;
    box-shadow: 0 3px 12px rgba(102,126,234,.4);
    transition: transform .15s, box-shadow .15s, filter .15s;
    letter-spacing: .01em;
}
a[href*="#video-native"]:hover,
a[href*="#video-iframe"]:hover {
    transform: translateY(-2px);
    box-shadow: 0 6px 20px rgba(102,126,234,.55);
    filter: brightness(1.08);
}
a[href*="#video-native"]::before { content: "🎬\\00a0"; }
a[href*="#video-iframe"]::before { content: "📺\\00a0"; }

/* ── toolbar button ── */
.tvp-toolbar-btn.ribbon-tab-title-icon.bx::before { content: "\\e9a6"; }
.tvp-toolbar-btn.tvp-spin::before {
    content: "\\e9f4";
    animation: tvp-spin 1s linear infinite;
    display: inline-block;
}
.tvp-toolbar-btn.tvp-ok::before { content: "\\ea52"; color: #4ade80; }
@keyframes tvp-spin { to { transform: rotate(360deg); } }

/* ── player shell ── */
.tvp-player {
    position: relative;
    width: 100%;
    margin: 16px 0;
    border-radius: 14px;
    overflow: hidden;
    background: #000;
    box-shadow:
        0 2px 4px rgba(0,0,0,.3),
        0 8px 32px rgba(0,0,0,.5),
        0 0 0 1px rgba(255,255,255,.06);
    font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
    outline: none;
}
.tvp-player:focus-visible {
    box-shadow:
        0 2px 4px rgba(0,0,0,.3),
        0 8px 32px rgba(0,0,0,.5),
        0 0 0 2px #667eea;
}

/* ── media area ── */
.tvp-media-wrap {
    position: relative;
    width: 100%;
    aspect-ratio: 16 / 9;
    background: #080808;
    overflow: hidden;
    cursor: pointer;
}
.tvp-media-wrap video,
.tvp-media-wrap iframe {
    position: absolute; inset: 0;
    width: 100%; height: 100%;
    border: 0; outline: none;
}

/* ── big-play button ── */
.tvp-big-play {
    position: absolute; inset: 0;
    display: flex; align-items: center; justify-content: center;
    z-index: 5;
    transition: opacity .2s;
    pointer-events: none;
}
.tvp-big-play.tvp-gone { opacity: 0; }
.tvp-big-play-ring {
    width: 72px; height: 72px;
    border-radius: 50%;
    border: 2px solid rgba(255,255,255,.3);
    display: flex; align-items: center; justify-content: center;
    backdrop-filter: blur(6px);
    background: rgba(0,0,0,.45);
    transition: transform .18s, border-color .18s, background .18s;
}
.tvp-media-wrap:hover .tvp-big-play-ring {
    transform: scale(1.08);
    border-color: rgba(255,255,255,.6);
    background: rgba(0,0,0,.6);
}
.tvp-play-triangle {
    width: 0; height: 0;
    border-style: solid;
    border-width: 13px 0 13px 22px;
    border-color: transparent transparent transparent rgba(255,255,255,.95);
    margin-left: 4px;
}

/* ── loading ── */
.tvp-loading {
    position: absolute; inset: 0;
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    gap: 12px; color: rgba(255,255,255,.7); font-size: 13px;
    z-index: 6; pointer-events: none;
}
.tvp-spinner {
    width: 38px; height: 38px;
    border: 3px solid rgba(255,255,255,.12);
    border-top-color: #667eea;
    border-radius: 50%;
    animation: tvp-spin .9s linear infinite;
}
.tvp-player.tvp-loaded .tvp-loading { display: none; }

/* ── error overlay ── */
.tvp-error-overlay {
    position: absolute; inset: 0;
    display: none; flex-direction: column;
    align-items: center; justify-content: center;
    gap: 10px; background: rgba(0,0,0,.88);
    color: #f87171; font-size: 13px; z-index: 7;
}
.tvp-player.tvp-error .tvp-error-overlay { display: flex; }
.tvp-player.tvp-error .tvp-loading      { display: none; }
.tvp-err-icon { font-size: 36px; }
.tvp-retry-btn {
    margin-top: 4px; padding: 7px 18px;
    background: rgba(255,255,255,.1);
    border: 1px solid rgba(255,255,255,.18);
    color: #fff; border-radius: 8px; cursor: pointer;
    font-size: 12px; font-weight: 500;
    transition: background .15s;
}
.tvp-retry-btn:hover { background: rgba(255,255,255,.18); }

/* ── controls overlay ── */
.tvp-overlay {
    position: absolute; left: 0; right: 0; bottom: 0;
    padding: 48px 0 0;
    z-index: 10;
    transition: opacity .28s ease, transform .28s ease;
}
.tvp-overlay-grad {
    position: absolute; inset: 0;
    background: linear-gradient(to top,
        rgba(0,0,0,.88) 0%,
        rgba(0,0,0,.55) 55%,
        transparent 100%
    );
    pointer-events: none;
}
/* auto-hide */
.tvp-player.tvp-hide-ctrl .tvp-overlay {
    opacity: 0;
    pointer-events: none;
    transform: translateY(6px);
}
.tvp-player.tvp-hide-ctrl .tvp-big-play { opacity: 0; }

/* ── seek / progress bar ── */
.tvp-progress {
    position: relative;
    height: 22px;
    display: flex; align-items: flex-end;
    padding: 0 12px 4px;
    cursor: pointer;
}
.tvp-track {
    position: relative; width: 100%;
    height: 3px; border-radius: 3px;
    background: rgba(255,255,255,.22);
    transition: height .15s;
    overflow: visible;
}
.tvp-progress:hover .tvp-track { height: 5px; }
.tvp-buf, .tvp-pos {
    position: absolute; top: 0; left: 0; bottom: 0; border-radius: 3px;
    pointer-events: none;
}
.tvp-buf { background: rgba(255,255,255,.28); width: 0; }
.tvp-pos {
    background: linear-gradient(to right, #667eea, #a78bfa);
    width: 0;
    transition: width .08s linear;
}
.tvp-thumb {
    position: absolute;
    bottom: 50%; left: 0;
    transform: translate(-50%, 50%);
    width: 14px; height: 14px; border-radius: 50%;
    background: #fff;
    box-shadow: 0 0 0 3px rgba(167,139,250,.65), 0 2px 6px rgba(0,0,0,.4);
    opacity: 0; pointer-events: none;
    transition: opacity .15s, transform .15s;
}
.tvp-progress:hover .tvp-thumb { opacity: 1; }
.tvp-progress:hover .tvp-thumb:hover { transform: translate(-50%, 50%) scale(1.15); }

/* hover time tooltip */
.tvp-time-tip {
    position: absolute;
    bottom: calc(100% + 8px);
    transform: translateX(-50%);
    background: rgba(10,10,10,.9);
    border: 1px solid rgba(255,255,255,.12);
    color: #fff; font-size: 11px; font-weight: 500;
    padding: 4px 8px; border-radius: 6px;
    white-space: nowrap; pointer-events: none;
    opacity: 0;
    backdrop-filter: blur(8px);
    transition: opacity .1s;
}
.tvp-progress:hover .tvp-time-tip { opacity: 1; }

/* ── control bar ── */
.tvp-bar {
    display: flex; align-items: center;
    gap: 2px; padding: 4px 10px 8px;
    position: relative;
}
.tvp-btn {
    background: none; border: none; cursor: pointer;
    color: rgba(255,255,255,.82); padding: 5px 7px;
    border-radius: 6px; font-size: 15px; line-height: 1;
    display: flex; align-items: center; flex-shrink: 0;
    transition: background .12s, color .12s, transform .1s;
    position: relative;
}
.tvp-btn:hover {
    background: rgba(255,255,255,.14);
    color: #fff;
    transform: scale(1.08);
}
.tvp-btn.tvp-active { color: #a78bfa; }
.tvp-btn.tvp-active:hover { color: #c4b5fd; }

.tvp-time {
    font-size: 12px; font-weight: 500;
    color: rgba(255,255,255,.82);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    padding: 0 4px;
}
.tvp-spacer { flex: 1; min-width: 0; }

.tvp-speed {
    background: rgba(255,255,255,.1);
    color: rgba(255,255,255,.85);
    border: 1px solid rgba(255,255,255,.18);
    border-radius: 6px;
    padding: 3px 6px; font-size: 11px; font-weight: 600;
    cursor: pointer;
    backdrop-filter: blur(4px);
    transition: background .12s;
}
.tvp-speed:hover { background: rgba(255,255,255,.18); }
.tvp-speed option { background: #1a1a2e; color: #fff; }

/* volume */
.tvp-vol-row { display: flex; align-items: center; gap: 3px; }
.tvp-vol {
    -webkit-appearance: none; appearance: none;
    width: 68px; height: 3px; border-radius: 3px;
    background: rgba(255,255,255,.25);
    outline: none; cursor: pointer;
}
.tvp-vol::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 12px; height: 12px; border-radius: 50%;
    background: #fff;
    box-shadow: 0 1px 4px rgba(0,0,0,.4);
    cursor: pointer;
    transition: transform .1s;
}
.tvp-vol::-webkit-slider-thumb:hover { transform: scale(1.2); }

/* ── info bar ── */
.tvp-info {
    display: flex; align-items: center;
    gap: 10px; padding: 9px 14px;
    background: #0e0e1a;
    border-top: 1px solid rgba(255,255,255,.06);
    min-width: 0;
}
.tvp-badge {
    display: inline-flex; align-items: center; gap: 4px;
    padding: 3px 9px; border-radius: 20px;
    background: rgba(255,255,255,.08);
    font-size: 11px; font-weight: 600;
    color: rgba(255,255,255,.55); flex-shrink: 0;
    letter-spacing: .02em;
    border: 1px solid rgba(255,255,255,.08);
}
.tvp-badge.youtube  { color: #f87171; border-color: rgba(248,113,113,.25); background: rgba(248,113,113,.08); }
.tvp-badge.bilibili { color: #60d3f7; border-color: rgba(96,211,247,.25); background: rgba(96,211,247,.08); }
.tvp-badge.vimeo    { color: #5ec5e5; border-color: rgba(94,197,229,.25); background: rgba(94,197,229,.08); }
.tvp-badge.local    { color: #4ade80; border-color: rgba(74,222,128,.25); background: rgba(74,222,128,.08); }
.tvp-badge.tiktok   { color: #f472b6; border-color: rgba(244,114,182,.25); background: rgba(244,114,182,.08); }
.tvp-badge.default  { color: #a78bfa; border-color: rgba(167,139,250,.25); background: rgba(167,139,250,.08); }

.tvp-title {
    font-size: 12px; color: rgba(255,255,255,.55);
    overflow: hidden; text-overflow: ellipsis;
    white-space: nowrap; flex: 1; min-width: 0;
}
.tvp-actions { display: flex; gap: 5px; flex-shrink: 0; }
.tvp-act {
    padding: 4px 10px;
    background: rgba(255,255,255,.07);
    border: 1px solid rgba(255,255,255,.1);
    border-radius: 6px; color: rgba(255,255,255,.55);
    font-size: 11px; font-weight: 500; cursor: pointer;
    transition: background .15s, color .15s, border-color .15s;
    white-space: nowrap;
}
.tvp-act:hover {
    background: rgba(255,255,255,.14);
    border-color: rgba(255,255,255,.2);
    color: rgba(255,255,255,.9);
}
.tvp-act.tvp-dl { color: rgba(74,222,128,.7); border-color: rgba(74,222,128,.2); background: rgba(74,222,128,.06); }
.tvp-act.tvp-dl:hover { color: #4ade80; background: rgba(74,222,128,.12); border-color: rgba(74,222,128,.35); }

/* ── resume bar ── */
.tvp-resume-bar {
    display: none;
    align-items: center; gap: 10px;
    padding: 8px 14px;
    background: rgba(102,126,234,.12);
    border-top: 1px solid rgba(102,126,234,.2);
    font-size: 12px; color: rgba(255,255,255,.75);
}
.tvp-resume-bar.tvp-show { display: flex; }
.tvp-resume-yes, .tvp-resume-no {
    padding: 3px 10px;
    border-radius: 5px; border: none; cursor: pointer;
    font-size: 11px; font-weight: 600;
}
.tvp-resume-yes { background: #667eea; color: #fff; }
.tvp-resume-yes:hover { background: #7c8ef0; }
.tvp-resume-no  { background: rgba(255,255,255,.1); color: rgba(255,255,255,.6); }
.tvp-resume-no:hover  { background: rgba(255,255,255,.16); color: rgba(255,255,255,.9); }

/* ── attachment panel ── */
.tvp-attach-panel { display: none; }   /* always hidden — dummy mount point only */
.tvp-attach-hidden { display: none; }
[data-tvp-panel] { display: block; margin-top: 16px; }
.tvp-src-bar {
    display: flex; align-items: center; gap: 8px;
    padding: 8px 0 6px; flex-wrap: wrap;
    font-size: 13px; color: var(--main-text-color, #ccc);
}
.tvp-src-bar select {
    flex: 1; min-width: 0; padding: 5px 8px;
    border: 1px solid var(--main-border-color, #444);
    border-radius: 6px;
    background: var(--input-background-color, #1a1a2e);
    color: var(--input-text-color, #eee); font-size: 13px;
}
`;

/* ── widget class ───────────────────────────────────────────────────────── */
class VideoPreviewWidget extends api.NoteContextAwareWidget {
    get parentWidget() { return 'center-pane'; }
    get position() { return 90; }

    /* ── render ── */
    doRender() {
        if (!document.getElementById(TVP_STYLE_ID)) {
            const s = document.createElement('style');
            s.id = TVP_STYLE_ID;
            s.textContent = GLOBAL_CSS;
            document.head.appendChild(s);
        }
        this.$widget = $('<div class="tvp-attach-panel">');
        this._attachmentVideos = [];
        return this.$widget;
    }

    /* ── refresh ── */
    async refreshWithNote(note) {
        setTimeout(() => {
            this._addToolbarButton();
            this._renderInlineVideos();
            this._renderAttachmentVideos();
            this._startObserver();
        }, 250);
        await this._refreshAttachPanel(note);
    }

    /* ── DOM injection helpers ── */
    _cleanupInjectedPanel() {
        document.querySelectorAll('[data-tvp-panel]').forEach(el => el.remove());
    }

    _injectPanel(content) {
        const container = document.querySelector(
            '.note-detail-readonly-text-content, .note-detail-editable-text, ' +
            '.note-detail-file-content, .note-detail-printable-content, .note-detail'
        );
        if (!container) return;
        const wrapper = document.createElement('div');
        wrapper.setAttribute('data-tvp-panel', '1');
        if (content instanceof Element) wrapper.appendChild(content);
        else wrapper.appendChild($(content)[0]);
        container.appendChild(wrapper);
    }

    /* ── attachment / file-note panel ── */
    async _refreshAttachPanel(note) {
        this._cleanupInjectedPanel();
        this._attachmentVideos = [];

        if (note.type === 'file' && isVideoMime(note.mime)) {
            const url = `/api/notes/${note.noteId}/download`;
            this._injectPanel(this._buildNativePlayer(url, note.title, true));
            return;
        }

        const videoUrl = note.getLabelValue('videoUrl');
        if (videoUrl) {
            const classified = classifyVideoUrl(videoUrl);
            const title = classified.title === 'Video' ? note.title : classified.title;
            const player = classified.type === 'iframe'
                ? this._buildIframePlayer(classified.url, title, detectPlatform(classified.url))
                : this._buildNativePlayer(classified.url, title, false);
            this._injectPanel(player);
            return;
        }

        if (!note.hasLabel('videoPlayer')) return;

        const attachments = await note.getAttachments();
        const videos = attachments.filter(a => isVideoMime(a.mime) || isVideoExt(a.title));
        if (!videos.length) return;

        this._attachmentVideos = videos;
        // actual rendering deferred to refreshWithNote's 250ms timeout via _renderAttachmentVideos
    }

    /* ── attachment video in-place rendering ── */
    _renderAttachmentVideos() {
        const videos = this._attachmentVideos;
        if (!videos || !videos.length) return;

        // READ MODE — replace links in-place inside read-only containers
        const readContainers = Array.from(document.querySelectorAll(
            '.note-detail-readonly-text-content, .note-detail-book-content, .include-note-content'
        )).filter(c => !c.closest('.ck-editor__editable'));

        if (readContainers.length) {
            const allLinks = readContainers.flatMap(c => Array.from(c.querySelectorAll('a')));
            let anyRendered = false;
            videos.forEach(attachment => {
                allLinks.forEach(link => {
                    if (link.dataset.tvpRendered) return;
                    if (!this._matchesAttachmentLink(link, attachment)) return;
                    link.dataset.tvpRendered = '1';
                    const url = `/api/attachments/${attachment.attachmentId}/download`;
                    this._replaceLinkWithPlayer(link, this._buildNativePlayer(url, attachment.title, true));
                    anyRendered = true;
                });
            });
            if (anyRendered) return;
        }

        // EDIT MODE — read link order from CKEditor (don't modify), inject players below editor
        const editorEl = document.querySelector('.ck-editor__editable');
        if (editorEl) {
            const editorLinks = Array.from(editorEl.querySelectorAll('a'));
            // build ordered list: match each link → attachment, preserving DOM order
            const seen = new Set();
            const ordered = editorLinks
                .map(link => videos.find(a => !seen.has(a.attachmentId) && this._matchesAttachmentLink(link, a)))
                .filter(Boolean)
                .filter(a => { if (seen.has(a.attachmentId)) return false; seen.add(a.attachmentId); return true; });
            // append unmatched attachments at end
            videos.forEach(a => { if (!seen.has(a.attachmentId)) ordered.push(a); });
            ordered.forEach(attachment => {
                const url = `/api/attachments/${attachment.attachmentId}/download`;
                this._injectPanel(this._buildNativePlayer(url, attachment.title, true));
            });
            return;
        }

        // FALLBACK — no editor, no read containers
        videos.forEach(attachment => {
            const url = `/api/attachments/${attachment.attachmentId}/download`;
            this._injectPanel(this._buildNativePlayer(url, attachment.title, true));
        });
    }

    /* ── inline video rendering ── */
    _renderInlineVideos() {
        const containers = document.querySelectorAll(
            '.note-detail-readonly-text-content, .note-detail-book-content, .include-note-content'
        );
        containers.forEach(container => {
            if (container.closest('.ck-editor__editable')) return;
            this._renderInlineVideosInContainer(container);
        });
    }

    _renderInlineVideosInContainer(container) {
        container.querySelectorAll(`a[href*="${TVP_NATIVE}"], a[href*="${TVP_IFRAME}"]`).forEach(link => {
            if (link.dataset.tvpRendered) return;
            link.dataset.tvpRendered = '1';

            const href   = link.getAttribute('href');
            const native = href.includes(TVP_NATIVE);
            const url    = href.replace(/#video-(native|iframe)$/, '');
            const title  = link.textContent.trim() || this._titleFromUrl(url);
            const plat   = detectPlatform(url);

            const player = native
                ? this._buildNativePlayer(url, title, true)
                : this._buildIframePlayer(url, title, plat);

            link.style.display = 'none';
            link.parentNode.insertBefore(player, link.nextSibling);
        });

        (this._attachmentVideos || []).forEach(a => {
            const url = `/api/attachments/${a.attachmentId}/download`;
            container.querySelectorAll('a').forEach(link => {
                if (link.dataset.tvpRendered) return;
                if (!this._matchesAttachmentLink(link, a)) return;

                link.dataset.tvpRendered = '1';
                const player = this._buildNativePlayer(url, a.title, true);
                this._replaceLinkWithPlayer(link, player);
            });
        });
    }

    _findAttachmentLinks(videos) {
        return Array.from(document.querySelectorAll('a')).filter(link =>
            videos.some(a => this._matchesAttachmentLink(link, a))
        );
    }

    _matchesAttachmentLink(link, attachment) {
        const normalize = s => (s || '').replace(/[^\x20-\x7EÀ-ɏ]/g, '')
                                        .replace(/\s+/g, ' ').trim().toLowerCase();
        const href = decodeURIComponent(link.getAttribute('href') || '');
        const text = normalize(link.textContent);
        const title = normalize(attachment.title);
        if (!title) return false;
        return href.includes(attachment.attachmentId)
            || href.toLowerCase().includes(encodeURIComponent(attachment.title).toLowerCase())
            || href.toLowerCase().includes(title)
            || text === title
            || text.includes(title)
            || title.includes(text.replace(/^[\s\S]{0,4}/, '').trim()); // strip leading icon chars
    }

    _replaceLinkWithPlayer(link, player) {
        const block = link.closest('p, div, figure, li');
        if (block && block.textContent.trim() === link.textContent.trim()) {
            block.replaceWith(player);
            return;
        }

        link.replaceWith(player);
    }

    /* ── MutationObserver ── */
    _startObserver() {
        this._observer?.disconnect();
        const target = document.querySelector('.note-detail-printable-content');
        if (!target) return;
        this._observer = new MutationObserver(this._debounce(() => this._renderInlineVideos(), 300));
        this._observer.observe(target, { childList: true, subtree: true });
    }

    /* ── build native <video> player ── */
    _buildNativePlayer(url, title, isDownloadable) {
        const plat = detectPlatform(url);
        const el   = this._el('div', 'tvp-player');
        el.setAttribute('tabindex', '0');

        /* ── media wrap ── */
        const mediaWrap = this._el('div', 'tvp-media-wrap');
        const video     = this._el('video');
        video.src     = url;
        video.preload = 'metadata';
        video.setAttribute('playsinline', '');

        /* big-play */
        const bigPlay = this._el('div', 'tvp-big-play');
        const ring    = this._el('div', 'tvp-big-play-ring');
        ring.append(this._el('div', 'tvp-play-triangle'));
        bigPlay.appendChild(ring);

        /* loading */
        const loading = this._el('div', 'tvp-loading');
        const spinner = this._el('div', 'tvp-spinner');
        const loadTxt = this._el('span');
        loadTxt.textContent = 'Loading…';
        loading.append(spinner, loadTxt);

        /* error */
        const errWrap  = this._el('div', 'tvp-error-overlay');
        const errIcon  = this._el('div', 'tvp-err-icon');
        errIcon.textContent = '⚠️';
        const errMsg   = this._el('span');
        errMsg.textContent = 'Failed to load video';
        const retryBtn = this._el('button', 'tvp-retry-btn');
        retryBtn.textContent = 'Retry';
        errWrap.append(errIcon, errMsg, retryBtn);

        /* controls overlay */
        const overlay  = this._el('div', 'tvp-overlay');
        const overlayGrad = this._el('div', 'tvp-overlay-grad');
        const { progressEl, timeEl, syncProgress } = this._buildProgressBar(video, el);
        const { bar, syncPlay, syncMute, syncLoop }  = this._buildControlBar(video, el, timeEl, syncProgress);
        overlay.append(overlayGrad, progressEl, bar);

        mediaWrap.append(video, bigPlay, loading, errWrap, overlay);

        /* info bar */
        const info = this._buildInfoBar(title, plat, url, isDownloadable);

        /* resume bar */
        const resumeBar = this._buildResumeBar(video, url, el);

        el.append(mediaWrap, info, resumeBar);

        /* ── wire events ── */
        video.addEventListener('loadedmetadata', () => el.classList.add('tvp-loaded'));
        video.addEventListener('error',        () => {
            el.classList.add('tvp-error');
            errMsg.textContent = video.error?.message || 'Failed to load video';
        });
        video.addEventListener('play',  () => { bigPlay.classList.add('tvp-gone'); syncPlay(true); });
        video.addEventListener('pause', () => { bigPlay.classList.remove('tvp-gone'); syncPlay(false); });
        video.addEventListener('ended', () => { bigPlay.classList.remove('tvp-gone'); syncPlay(false); });
        retryBtn.addEventListener('click', () => {
            el.classList.remove('tvp-error', 'tvp-loaded');
            video.load();
        });

        /* click-to-play / double-click fullscreen */
        let clickTimer = null;
        mediaWrap.addEventListener('click', e => {
            if (e.target.closest('.tvp-overlay')) return;
            clearTimeout(clickTimer);
            clickTimer = setTimeout(() => { video.paused ? video.play() : video.pause(); }, 200);
        });
        mediaWrap.addEventListener('dblclick', e => {
            if (e.target.closest('.tvp-overlay')) return;
            clearTimeout(clickTimer);
            this._toggleFs(el);
        });

        /* auto-hide */
        this._setupAutoHide(video, el);

        /* volume persistence */
        this._setupVolumePersistence(video, el, syncMute);

        /* keyboard */
        el.addEventListener('keydown', e => {
            if (['SELECT','INPUT'].includes(e.target.tagName)) return;
            switch (e.code) {
                case 'Space':      e.preventDefault(); video.paused ? video.play() : video.pause(); break;
                case 'ArrowRight': e.preventDefault(); video.currentTime = Math.min(video.duration || 0, video.currentTime + 5); break;
                case 'ArrowLeft':  e.preventDefault(); video.currentTime = Math.max(0, video.currentTime - 5); break;
                case 'ArrowUp':    e.preventDefault(); video.volume = Math.min(1, +(video.volume + 0.1).toFixed(2)); syncMute(); break;
                case 'ArrowDown':  e.preventDefault(); video.volume = Math.max(0, +(video.volume - 0.1).toFixed(2)); syncMute(); break;
                case 'KeyM':       video.muted = !video.muted; syncMute(); break;
                case 'KeyF':       this._toggleFs(el); break;
                case 'KeyL':       video.loop = !video.loop; syncLoop(); break;
            }
        });

        document.addEventListener('fullscreenchange', () => {
            const fsBtn = el.querySelector('.tvp-fs-btn');
            if (fsBtn) fsBtn.innerHTML = document.fullscreenElement === el ? '&#x2715;' : '&#x26F6;';
        });

        return el;
    }

    /* ── progress bar ── */
    _buildProgressBar(video, playerEl) {
        const progressEl = this._el('div', 'tvp-progress');
        const track      = this._el('div', 'tvp-track');
        const buf        = this._el('div', 'tvp-buf');
        const pos        = this._el('div', 'tvp-pos');
        const thumb      = this._el('div', 'tvp-thumb');
        const timeTip    = this._el('div', 'tvp-time-tip');
        const timeEl     = this._el('span'); /* shared with control bar */
        track.append(buf, pos);
        progressEl.append(track, thumb, timeTip);

        const getX = e => {
            const r = progressEl.getBoundingClientRect();
            return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
        };
        const seekTo = e => {
            if (isFinite(video.duration)) video.currentTime = getX(e) * video.duration;
        };

        progressEl.addEventListener('mousemove', e => {
            const frac = getX(e);
            timeTip.textContent = fmtTime((video.duration || 0) * frac);
            timeTip.style.left  = (frac * 100) + '%';
        });
        progressEl.addEventListener('click', seekTo);
        progressEl.addEventListener('mousedown', e => {
            let down = true;
            const mv = ev => { if (down) seekTo(ev); };
            const up = ()  => { down = false; document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); };
            document.addEventListener('mousemove', mv);
            document.addEventListener('mouseup', up);
            seekTo(e);
        });

        const syncProgress = () => {
            const pct = video.duration ? (video.currentTime / video.duration) * 100 : 0;
            pos.style.width  = pct + '%';
            thumb.style.left = pct + '%';
            if (video.buffered.length) {
                buf.style.width = (video.buffered.end(video.buffered.length - 1) / video.duration * 100) + '%';
            }
        };

        video.addEventListener('timeupdate', syncProgress);
        video.addEventListener('progress',   syncProgress);
        video.addEventListener('timeupdate', () => {
            const t = `${fmtTime(video.currentTime)} / ${fmtTime(video.duration)}`;
            timeEl.textContent = t;
        });
        video.addEventListener('loadedmetadata', () => {
            timeEl.textContent = `0:00 / ${fmtTime(video.duration)}`;
        });

        return { progressEl, timeEl, syncProgress };
    }

    /* ── control bar ── */
    _buildControlBar(video, playerEl, timeEl, syncProgress) {
        const bar = this._el('div', 'tvp-bar');

        /* play/pause */
        const playBtn = this._el('button', 'tvp-btn tvp-play-btn');
        playBtn.title = 'Play / Pause (Space)';
        playBtn.innerHTML = '&#9654;';
        playBtn.addEventListener('click', () => video.paused ? video.play() : video.pause());
        const syncPlay = playing => { playBtn.innerHTML = playing ? '&#10074;&#10074;' : '&#9654;'; };

        /* time */
        timeEl.className = 'tvp-time';
        timeEl.textContent = '0:00 / 0:00';

        /* loop */
        const loopBtn = this._el('button', 'tvp-btn');
        loopBtn.title = 'Loop (L)';
        loopBtn.innerHTML = '&#8635;';
        const syncLoop = () => loopBtn.classList.toggle('tvp-active', video.loop);
        loopBtn.addEventListener('click', () => { video.loop = !video.loop; syncLoop(); });

        /* spacer */
        const spacer = this._el('div', 'tvp-spacer');

        /* speed */
        const speed = this._el('select', 'tvp-speed');
        speed.title = 'Playback speed';
        [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3].forEach(v => {
            const o = document.createElement('option');
            o.value = v; o.textContent = v + '×';
            if (v === 1) o.selected = true;
            speed.appendChild(o);
        });
        speed.addEventListener('change', () => { video.playbackRate = +speed.value; });

        /* volume */
        const volRow    = this._el('div', 'tvp-vol-row');
        const muteBtn   = this._el('button', 'tvp-btn');
        muteBtn.title   = 'Mute (M)';
        const volSlider = this._el('input', 'tvp-vol');
        volSlider.type  = 'range'; volSlider.min = 0; volSlider.max = 1;
        volSlider.step  = 0.02; volSlider.value = 1;
        volSlider.title = 'Volume (↑/↓)';

        const syncMute = () => {
            const muted = video.muted || video.volume === 0;
            muteBtn.innerHTML = muted ? '&#128263;' : video.volume < 0.5 ? '&#128264;' : '&#128266;';
            const pct = muted ? 0 : video.volume * 100;
            volSlider.value = muted ? 0 : video.volume;
            volSlider.style.background =
                `linear-gradient(to right, #a78bfa ${pct}%, rgba(255,255,255,.22) ${pct}%)`;
            lsSet(TVP_LS_VOL,   String(video.volume));
            lsSet(TVP_LS_MUTED, String(video.muted));
        };
        muteBtn.addEventListener('click', () => { video.muted = !video.muted; syncMute(); });
        volSlider.addEventListener('input', () => {
            video.volume = +volSlider.value;
            video.muted  = video.volume === 0;
            syncMute();
        });
        video.addEventListener('volumechange', syncMute);
        volRow.append(muteBtn, volSlider);

        /* PiP */
        const pipBtn = this._el('button', 'tvp-btn');
        pipBtn.title = 'Picture-in-Picture';
        pipBtn.innerHTML = '&#10697;';
        if (!document.pictureInPictureEnabled) pipBtn.style.display = 'none';
        pipBtn.addEventListener('click', () => {
            (document.pictureInPictureElement
                ? document.exitPictureInPicture()
                : video.requestPictureInPicture()
            ).catch(() => {});
        });

        /* fullscreen */
        const fsBtn = this._el('button', 'tvp-btn tvp-fs-btn');
        fsBtn.title = 'Fullscreen (F)';
        fsBtn.innerHTML = '&#x26F6;';
        fsBtn.addEventListener('click', () => this._toggleFs(playerEl));

        bar.append(playBtn, timeEl, loopBtn, spacer, speed, volRow, pipBtn, fsBtn);
        return { bar, syncPlay, syncMute, syncLoop };
    }

    /* ── resume bar ── */
    _buildResumeBar(video, url, playerEl) {
        const bar     = this._el('div', 'tvp-resume-bar');
        const msg     = this._el('span');
        const yesBtn  = this._el('button', 'tvp-resume-yes');
        const noBtn   = this._el('button', 'tvp-resume-no');
        yesBtn.textContent = 'Resume';
        noBtn.textContent  = 'Start over';
        bar.append(msg, yesBtn, noBtn);

        const hide = () => bar.classList.remove('tvp-show');

        video.addEventListener('loadedmetadata', () => {
            const saved = parseFloat(lsGet(posKey(url), '0'));
            if (saved > 10 && isFinite(video.duration) && saved < video.duration - 5) {
                msg.textContent = `Resume from ${fmtTime(saved)}?`;
                bar.classList.add('tvp-show');
            }
        });

        yesBtn.addEventListener('click', () => {
            const saved = parseFloat(lsGet(posKey(url), '0'));
            if (saved > 0) video.currentTime = saved;
            hide();
            video.play();
        });
        noBtn.addEventListener('click', () => { video.currentTime = 0; hide(); });

        /* save position on timeupdate (throttled) and pause */
        let saveTimer = null;
        video.addEventListener('timeupdate', () => {
            clearTimeout(saveTimer);
            saveTimer = setTimeout(() => {
                if (video.currentTime > 5) lsSet(posKey(url), String(video.currentTime));
            }, 5000);
        });
        video.addEventListener('pause', () => {
            if (video.currentTime > 5) lsSet(posKey(url), String(video.currentTime));
        });

        return bar;
    }

    /* ── auto-hide controls ── */
    _setupAutoHide(video, playerEl) {
        let timer = null;
        const show = () => {
            playerEl.classList.remove('tvp-hide-ctrl');
            clearTimeout(timer);
        };
        const schedHide = () => {
            clearTimeout(timer);
            if (!video.paused) timer = setTimeout(() => playerEl.classList.add('tvp-hide-ctrl'), HIDE_DELAY);
        };

        playerEl.addEventListener('mousemove',  () => { show(); schedHide(); });
        playerEl.addEventListener('mouseleave', () => schedHide());
        playerEl.addEventListener('mouseenter', () => show());
        video.addEventListener('play',  schedHide);
        video.addEventListener('pause', show);
    }

    /* ── volume persistence ── */
    _setupVolumePersistence(video, playerEl, syncMute) {
        video.addEventListener('loadedmetadata', () => {
            const savedVol   = parseFloat(lsGet(TVP_LS_VOL,   '1'));
            const savedMuted = lsGet(TVP_LS_MUTED, 'false') === 'true';
            video.volume = isFinite(savedVol) ? Math.max(0, Math.min(1, savedVol)) : 1;
            video.muted  = savedMuted;
            syncMute();
        }, { once: true });
    }

    /* ── info bar ── */
    _buildInfoBar(title, platform, url, isDownloadable) {
        const info    = this._el('div', 'tvp-info');
        const badge   = this._el('span', `tvp-badge ${platform.cssClass}`);
        badge.textContent = `${platform.icon} ${platform.name}`;

        const titleEl = this._el('span', 'tvp-title');
        titleEl.textContent = title;
        titleEl.title = title;

        const actions = this._el('div', 'tvp-actions');

        if (isDownloadable) {
            const dlBtn  = this._el('a', 'tvp-act tvp-dl');
            dlBtn.href     = url;
            dlBtn.download = '';
            dlBtn.textContent = '⬇ Download';
            dlBtn.addEventListener('click', e => e.stopPropagation());
            actions.appendChild(dlBtn);
        }

        const copyBtn = this._el('button', 'tvp-act');
        copyBtn.textContent = '📋 Copy';
        copyBtn.addEventListener('click', () => {
            navigator.clipboard.writeText(url).then(() => {
                copyBtn.textContent = '✅ Copied';
                setTimeout(() => { copyBtn.textContent = '📋 Copy'; }, 1500);
            }).catch(() => {});
        });

        const openBtn = this._el('button', 'tvp-act');
        openBtn.textContent = '↗ Open';
        openBtn.addEventListener('click', () => window.open(url, '_blank', 'noopener,noreferrer'));

        actions.append(copyBtn, openBtn);
        info.append(badge, titleEl, actions);
        return info;
    }

    /* ── iframe player ── */
    _buildIframePlayer(url, title, platform) {
        const el        = this._el('div', 'tvp-player');
        const mediaWrap = this._el('div', 'tvp-media-wrap');

        const loading = this._el('div', 'tvp-loading');
        loading.append(this._el('div', 'tvp-spinner'), (() => { const s = this._el('span'); s.textContent = 'Loading…'; return s; })());

        const errWrap  = this._el('div', 'tvp-error-overlay');
        const errIcon  = this._el('div', 'tvp-err-icon');
        errIcon.textContent = '⚠️';
        const errTxt   = this._el('span'); errTxt.textContent = 'Failed to load embed';
        const retryBtn = this._el('button', 'tvp-retry-btn');
        retryBtn.textContent = 'Retry';
        errWrap.append(errIcon, errTxt, retryBtn);

        const iframe = this._el('iframe');
        iframe.src           = url;
        iframe.allowFullscreen = true;
        iframe.allow         = 'autoplay; fullscreen; picture-in-picture; encrypted-media';

        iframe.addEventListener('load', () => el.classList.add('tvp-loaded'));
        setTimeout(() => { if (!el.classList.contains('tvp-loaded')) el.classList.add('tvp-loaded'); }, 4000);
        retryBtn.addEventListener('click', () => {
            el.classList.remove('tvp-error', 'tvp-loaded');
            iframe.src = url;
        });

        mediaWrap.append(loading, errWrap, iframe);
        const info = this._buildInfoBar(title, platform, url, false);
        el.append(mediaWrap, info);
        return el;
    }

    /* ── toolbar button ── */
    _addToolbarButton() {
        const $ribbon = $("div.component.note-split:not(.hidden-ext) div.ribbon-tab-title").parent();
        if (!$ribbon.length) return;

        if (!$ribbon.find('.tvp-toolbar-wrap').length) {
            const $last = $ribbon.find('.ribbon-tab-title:not(.backToHis)').last();
            const html  = `<div class="tvp-toolbar-wrap ribbon-tab-title">
                <span class="tvp-toolbar-btn ribbon-tab-title-icon bx" title="Embed video (🎬)"></span>
            </div>`;
            if ($last.length) $last.before(html); else $ribbon.append(html);
        }

        $ribbon.find('.tvp-toolbar-wrap')
            .off('click.tvp')
            .on('click.tvp', () => this._convertVideos());
    }

    /* ── backend URL-to-video conversion ── */
    async _convertVideos() {
        const note = api.getActiveContextNote();
        if (!note) return;

        const $icon = $('.tvp-toolbar-btn');
        $icon.addClass('tvp-spin');
        api.showMessage('🔄 Converting video links…');

        try {
            const result = await api.runAsyncOnBackendWithManualTransactionHandling(async (noteId, embedParent) => {
                const note = await api.getNote(noteId);
                if (!note) return { ok: false, error: 'Note not found' };

                let html = await note.getContent();
                const orig = html;
                let count  = 0;

                const makeLink = (url, title, type) => {
                    const hash  = type === 'native' ? '#video-native' : '#video-iframe';
                    const safeU = url.replace(/"/g, '%22');
                    const safeT = (title || 'Video').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                    return `<p><a href="${safeU}${hash}">${safeT}</a></p>`;
                };

                const classify = url => {
                    url = url.trim();
                    if (url.includes('#video-native') || url.includes('#video-iframe')) return null;

                    if (/\.(mp4|webm|ogg|ogv|mov|m4v|mkv|avi|flv|3gp|m3u8)(\?.*)?$/i.test(url)
                        || url.includes('localhost') || url.includes('127.0.0.1')) {
                        const fn = (() => { try { return decodeURIComponent(url.split('/').pop().split('?')[0].split('#')[0]); } catch { return 'Video'; } })();
                        return { type: 'native', url, title: fn || 'Local Video' };
                    }
                    if (url.includes('youtube.com') || url.includes('youtu.be')) {
                        const m = url.match(/(?:v=|youtu\.be\/)([^&?#]+)/);
                        if (m) return { type: 'iframe', url: `https://www.youtube.com/embed/${m[1]}?rel=0`, title: `YouTube ${m[1]}` };
                    }
                    if (url.includes('bilibili.com')) {
                        const m = url.match(/(BV[\w]+)/i);
                        if (m) return { type: 'iframe', url: `https://player.bilibili.com/player.html?bvid=${m[1]}&high_quality=1&autoplay=0`, title: `Bilibili ${m[1]}` };
                    }
                    if (url.includes('vimeo.com')) {
                        const m = url.match(/vimeo\.com\/(\d+)/);
                        if (m) return { type: 'iframe', url: `https://player.vimeo.com/video/${m[1]}`, title: `Vimeo ${m[1]}` };
                    }
                    if (url.includes('youku.com')) {
                        const m = url.match(/id_([^.]+)/);
                        if (m) return { type: 'iframe', url: `https://player.youku.com/embed/${m[1]}`, title: 'Youku Video' };
                    }
                    if (url.includes('v.qq.com')) {
                        const m = url.match(/vid=([^&]+)/) || url.match(/\/([a-z0-9]+)\.html$/i);
                        if (m) return { type: 'iframe', url: `https://v.qq.com/txp/iframe/player.html?vid=${m[1]}`, title: 'Tencent Video' };
                    }
                    if (url.includes('tiktok.com') || url.includes('douyin.com')) {
                        const m = url.match(/video\/(\d+)/);
                        if (m) return { type: 'iframe', url: `https://www.tiktok.com/embed/v2/${m[1]}`, title: `TikTok ${m[1]}` };
                    }
                    if (url.includes('twitch.tv')) {
                        embedParent = encodeURIComponent(embedParent || 'localhost');
                        const clip = url.match(/clips\.twitch\.tv\/([^/?#]+)/) || url.match(/clip\/([^/?#]+)/);
                        if (clip) return { type: 'iframe', url: `https://clips.twitch.tv/embed?clip=${clip[1]}&parent=${embedParent}`, title: `Twitch Clip ${clip[1]}` };
                        const vod = url.match(/twitch\.tv\/videos\/(\d+)/);
                        if (vod) return { type: 'iframe', url: `https://player.twitch.tv/?video=${vod[1]}&parent=${embedParent}`, title: `Twitch VOD ${vod[1]}` };
                        const ch = url.match(/twitch\.tv\/([^/?#]+)/);
                        if (ch) return { type: 'iframe', url: `https://player.twitch.tv/?channel=${ch[1]}&parent=${embedParent}`, title: `Twitch: ${ch[1]}` };
                    }
                    if (url.includes('dailymotion.com') || url.includes('dai.ly')) {
                        const m = url.match(/(?:video|dai\.ly)\/([a-z0-9]+)/i);
                        if (m) return { type: 'iframe', url: `https://www.dailymotion.com/embed/video/${m[1]}`, title: `Dailymotion ${m[1]}` };
                    }
                    if (url.includes('rumble.com')) {
                        const embed = url.match(/rumble\.com\/embed\/([^/?#]+)/);
                        if (embed) return { type: 'iframe', url: `https://rumble.com/embed/${embed[1]}/`, title: 'Rumble Video' };
                        const vid = url.match(/rumble\.com\/([^/?#]+)\.html/);
                        if (vid) return { type: 'iframe', url: `https://rumble.com/embed/${vid[1]}/`, title: 'Rumble Video' };
                    }
                    if (url.includes('odysee.com')) {
                        const m = url.match(/odysee\.com\/@[^/]+\/([^/?#]+)/);
                        if (m) return { type: 'iframe', url: `https://odysee.com/$/embed/${m[1]}`, title: `Odysee: ${m[1]}` };
                    }
                    if (url.includes('nicovideo.jp')) {
                        const m = url.match(/watch\/((?:sm|nm|so)\d+)/);
                        if (m) return { type: 'iframe', url: `https://embed.nicovideo.jp/watch/${m[1]}?autoplay=0`, title: `Niconico ${m[1]}` };
                    }
                    if (url.includes('streamable.com')) {
                        const m = url.match(/streamable\.com\/([a-z0-9]+)/i);
                        if (m) return { type: 'iframe', url: `https://streamable.com/e/${m[1]}`, title: `Streamable ${m[1]}` };
                    }
                    if (url.includes('loom.com')) {
                        const m = url.match(/loom\.com\/share\/([a-f0-9]+)/i);
                        if (m) return { type: 'iframe', url: `https://www.loom.com/embed/${m[1]}`, title: `Loom ${m[1]}` };
                    }
                    if (url.includes('kick.com')) {
                        const clip = url.match(/kick\.com\/[^/]+\?clip=([^&]+)/);
                        if (clip) return { type: 'iframe', url: `https://kick.com/embed/clip/${clip[1]}`, title: `Kick Clip ${clip[1]}` };
                        const ch = url.match(/kick\.com\/([^/?#]+)/);
                        if (ch && ch[1] !== 'video') return { type: 'iframe', url: `https://player.kick.com/${ch[1]}`, title: `Kick: ${ch[1]}` };
                    }
                    if (url.includes('peertube') || url.match(/\/videos\/watch\/[a-f0-9-]{36}/)) {
                        const m = url.match(/(https?:\/\/[^/]+)\/videos\/watch\/([a-f0-9-]{36})/);
                        if (m) return { type: 'iframe', url: `${m[1]}/videos/embed/${m[2]}`, title: 'PeerTube Video' };
                    }
                    return null;
                };

                html = html.replace(/<a\s+[^>]*href=["']([^"']+)["'][^>]*>[\s\S]*?<\/a>/gi, (match, url) => {
                    const r = classify(url);
                    if (r) { count++; return makeLink(r.url, r.title, r.type); }
                    return match;
                });

                html = html.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (match, inner) => {
                    const text = inner.replace(/&nbsp;/g, ' ').replace(/<br\s*\/?>/gi, '').trim();
                    if (/<[a-z]/i.test(text)) return match;
                    const m = text.match(/^(https?:\/\/[^\s<>"]+)$/i);
                    if (m) { const r = classify(m[1]); if (r) { count++; return makeLink(r.url, r.title, r.type); } }
                    return match;
                });

                if (html !== orig) { await note.setContent(html); return { ok: true, count }; }
                return { ok: false, count: 0 };
            }, [note.noteId, location.hostname || 'localhost']);

            $icon.removeClass('tvp-spin');
            if (result.ok) {
                $icon.addClass('tvp-ok');
                api.showMessage(`✅ Embedded ${result.count} video link${result.count !== 1 ? 's' : ''}`);
                setTimeout(() => { $icon.removeClass('tvp-ok'); api.activateNote(note.noteId); }, 1200);
            } else if (result.error) {
                api.showMessage('❌ ' + result.error);
            } else {
                api.showMessage('ℹ️ No convertible video links found');
            }
        } catch (e) {
            console.error('[VideoPreviewWidget]', e);
            api.showMessage('❌ Error: ' + e.message);
            $('.tvp-toolbar-btn').removeClass('tvp-spin');
        }
    }

    /* ── entity reload ── */
    async entitiesReloadedEvent({ loadResults }) {
        const rows = loadResults.getAttachmentRows?.() ?? [];
        if (
            loadResults.isNoteReloaded(this.noteId) ||
            loadResults.isNoteContentReloaded(this.noteId) ||
            rows.some(r => r.noteId === this.noteId)
        ) {
            setTimeout(() => this._renderInlineVideos(), 300);
            await this._refreshAttachPanel(this.note);
        }
    }

    /* ── utils ── */
    _el(tag, cls = '') {
        const el = document.createElement(tag);
        if (cls) el.className = cls;
        return el;
    }
    _titleFromUrl(url) {
        try { return decodeURIComponent(url.split('/').pop().split('?')[0].split('#')[0]) || 'Video'; }
        catch { return 'Video'; }
    }
    _toggleFs(el) {
        (document.fullscreenElement
            ? document.exitFullscreen()
            : el?.requestFullscreen()
        )?.catch(() => {});
    }
    _debounce(fn, delay) {
        let t;
        return (...args) => { clearTimeout(t); t = setTimeout(() => fn.apply(this, args), delay); };
    }
}

module.exports = new VideoPreviewWidget();
