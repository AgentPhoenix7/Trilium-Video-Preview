/**
 * Trilium Video Preview Widget — Combined Edition
 *
 * Storage format (inside note HTML):
 *   <a href="http://host/file.mp4#video-native">title</a>  → native <video> player
 *   <a href="https://youtu.be/xxx#video-iframe">title</a>  → <iframe> embed player
 *
 * Workflow:
 *   1. Paste a video URL into a text note
 *   2. Click the 🎬 toolbar button — converts the URL to the storage format
 *   3. In read-only mode the widget auto-renders inline video players
 *   4. For file notes (MIME video/*) or notes with #videoPlayer label +
 *      video attachments, a dedicated player panel is shown instead
 *
 * Controls (native video):
 *   Play/Pause · Seek bar with buffered · Time · Speed · Volume · Mute · PiP · Fullscreen
 * Keyboard (click widget first): Space · ← → (±5 s) · ↑ ↓ (volume) · M (mute) · F (fullscreen)
 *
 * Platforms: YouTube · Bilibili · Vimeo · Youku · Tencent Video · any direct URL
 *
 * Install: paste into a "JS frontend" code note, add label #widget, restart Trilium once.
 */

/* ── constants ─────────────────────────────────────────────────────────── */
const TVP_NATIVE = '#video-native';
const TVP_IFRAME = '#video-iframe';
const TVP_STYLE_ID = 'tvp-global-styles';

const VIDEO_MIME_RE = /^video\//i;
const VIDEO_EXT_RE  = /\.(mp4|webm|ogg|ogv|mov|m4v|mkv|avi|flv|3gp|m3u8)(\?.*)?$/i;

/* ── helpers ────────────────────────────────────────────────────────────── */
function esc(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function fmtTime(s) {
    if (!isFinite(s) || s < 0) return '0:00';
    s = Math.floor(s);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return h
        ? `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`
        : `${m}:${String(sec).padStart(2,'0')}`;
}

function isVideoMime(mime)  { return mime  && VIDEO_MIME_RE.test(mime); }
function isVideoExt(title)  { return title && VIDEO_EXT_RE.test(title); }

/* ── platform registry ─────────────────────────────────────────────────── */
const PLATFORMS = [
    {
        name: 'YouTube', icon: '▶', cssClass: 'youtube',
        match: u => u.includes('youtube.com') || u.includes('youtu.be'),
        embed: u => {
            const m = u.match(/(?:v=|youtu\.be\/)([^&?#]+)/);
            return m ? `https://www.youtube.com/embed/${m[1]}` : u;
        }
    },
    {
        name: 'Bilibili', icon: '📺', cssClass: 'bilibili',
        match: u => u.includes('bilibili.com'),
        embed: u => {
            const m = u.match(/(BV[\w]+)/i);
            return m ? `https://player.bilibili.com/player.html?bvid=${m[1]}&high_quality=1&autoplay=0` : u;
        }
    },
    {
        name: 'Vimeo', icon: '🎬', cssClass: 'vimeo',
        match: u => u.includes('vimeo.com'),
        embed: u => {
            const m = u.match(/vimeo\.com\/(\d+)/);
            return m ? `https://player.vimeo.com/video/${m[1]}` : u;
        }
    },
    {
        name: 'Youku', icon: '🎯', cssClass: 'youku',
        match: u => u.includes('youku.com'),
        embed: u => {
            const m = u.match(/id_([^.]+)/);
            return m ? `https://player.youku.com/embed/${m[1]}` : u;
        }
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

function detectPlatform(url) {
    return PLATFORMS.find(p => p.match(url)) ?? { name: 'Video', icon: '🎬', cssClass: 'default', embed: u => u };
}

/** Converts a user-facing URL to the appropriate storage format entry */
function processUrl(rawUrl) {
    const url = rawUrl.trim();
    if (url.includes(TVP_NATIVE) || url.includes(TVP_IFRAME)) return null;

    // Direct video file
    if (VIDEO_EXT_RE.test(url) || url.includes('localhost') || url.includes('127.0.0.1')) {
        const filename = (() => {
            try { return decodeURIComponent(url.split('/').pop().split('?')[0].split('#')[0]); }
            catch { return 'video'; }
        })();
        return { type: 'native', url, title: filename || 'Local Video' };
    }

    // Known embed platforms
    const platform = PLATFORMS.find(p => p.match(url) && p.cssClass !== 'local');
    if (platform) {
        const embedUrl = platform.embed(url);
        return { type: 'iframe', url: embedUrl, title: `${platform.name} Video` };
    }

    return null;
}

/* ── global CSS (injected into <head> once) ────────────────────────────── */
const GLOBAL_CSS = `
/* ── edit-mode: video links look like buttons ── */
a[href*="${TVP_NATIVE}"],
a[href*="${TVP_IFRAME}"] {
    display: inline-flex !important;
    align-items: center;
    gap: 6px;
    padding: 8px 14px;
    background: linear-gradient(135deg, #667eea, #764ba2);
    color: #fff !important;
    text-decoration: none !important;
    border-radius: 8px;
    font-weight: 500;
    font-size: 13px;
    margin: 4px 0;
    box-shadow: 0 2px 8px rgba(102,126,234,.35);
    transition: transform .15s, box-shadow .15s;
}
a[href*="${TVP_NATIVE}"]:hover,
a[href*="${TVP_IFRAME}"]:hover {
    transform: translateY(-1px);
    box-shadow: 0 4px 14px rgba(102,126,234,.5);
}
a[href*="${TVP_NATIVE}"]::before { content: "🎬 "; }
a[href*="${TVP_IFRAME}"]::before { content: "📺 "; }

/* ── toolbar button ── */
.tvp-toolbar-btn.ribbon-tab-title-icon.bx::before { content: "\\e9a6"; }
.tvp-toolbar-btn.tvp-loading::before { content: "\\e9f4"; animation: tvp-spin 1s linear infinite; display: inline-block; }
.tvp-toolbar-btn.tvp-success::before { content: "\\ea52"; color: #4ade80; }
@keyframes tvp-spin { to { transform: rotate(360deg); } }

/* ── player container ── */
.tvp-player {
    position: relative;
    width: 100%;
    margin: 14px 0;
    border-radius: 10px;
    overflow: hidden;
    background: #000;
    box-shadow: 0 4px 20px rgba(0,0,0,.35);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
}

/* ── video / iframe area ── */
.tvp-media-wrap {
    position: relative;
    width: 100%;
    aspect-ratio: 16 / 9;
    background: #0a0a0a;
    overflow: hidden;
}
.tvp-media-wrap video,
.tvp-media-wrap iframe {
    position: absolute; inset: 0;
    width: 100%; height: 100%;
    border: 0;
    outline: none;
}

/* big-play overlay */
.tvp-big-play {
    position: absolute; inset: 0;
    display: flex; align-items: center; justify-content: center;
    cursor: pointer;
    z-index: 2;
    transition: opacity .15s;
}
.tvp-big-play.tvp-gone { opacity: 0; pointer-events: none; }
.tvp-big-play-icon {
    width: 60px; height: 60px;
    border-radius: 50%;
    background: rgba(0,0,0,.55);
    display: flex; align-items: center; justify-content: center;
    color: #fff; font-size: 24px;
    backdrop-filter: blur(3px);
    transition: transform .12s;
}
.tvp-big-play:hover .tvp-big-play-icon { transform: scale(1.12); }

/* loading */
.tvp-loading {
    position: absolute; inset: 0;
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    gap: 10px; color: #fff; font-size: 13px;
    z-index: 3; pointer-events: none;
}
.tvp-spinner {
    width: 36px; height: 36px;
    border: 3px solid rgba(255,255,255,.2);
    border-top-color: #667eea;
    border-radius: 50%;
    animation: tvp-spin 1s linear infinite;
}
.tvp-player.tvp-loaded .tvp-loading { display: none; }

/* error */
.tvp-error-overlay {
    position: absolute; inset: 0;
    display: none; flex-direction: column;
    align-items: center; justify-content: center;
    gap: 8px; background: rgba(0,0,0,.88);
    color: #f87171; z-index: 4;
}
.tvp-player.tvp-error .tvp-error-overlay  { display: flex; }
.tvp-player.tvp-error .tvp-loading        { display: none; }
.tvp-retry-btn {
    margin-top: 6px; padding: 5px 14px;
    background: #333; border: 1px solid #555;
    color: #fff; border-radius: 6px; cursor: pointer; font-size: 12px;
}
.tvp-retry-btn:hover { background: #444; }

/* ── custom native controls ── */
.tvp-controls {
    background: linear-gradient(to bottom, rgba(0,0,0,.7), rgba(0,0,0,.9));
    padding: 6px 10px 8px;
    display: flex; flex-direction: column; gap: 5px;
}

/* seek/progress bar */
.tvp-progress {
    position: relative; height: 18px;
    display: flex; align-items: center; cursor: pointer;
}
.tvp-track {
    position: relative; width: 100%; height: 4px;
    background: rgba(255,255,255,.25); border-radius: 2px;
    overflow: hidden; transition: height .1s;
}
.tvp-progress:hover .tvp-track { height: 7px; }
.tvp-buf, .tvp-pos {
    position: absolute; top: 0; left: 0; bottom: 0; border-radius: 2px;
}
.tvp-buf { background: rgba(255,255,255,.3); width: 0; }
.tvp-pos { background: #667eea; width: 0; }
.tvp-thumb {
    position: absolute; top: 50%; left: 0;
    transform: translate(-50%, -50%);
    width: 13px; height: 13px; border-radius: 50%;
    background: #667eea; opacity: 0; pointer-events: none;
    transition: opacity .1s;
}
.tvp-progress:hover .tvp-thumb { opacity: 1; }

/* control bar row */
.tvp-bar {
    display: flex; align-items: center; gap: 5px;
}
.tvp-btn {
    background: none; border: none; cursor: pointer;
    color: rgba(255,255,255,.85); padding: 3px 6px;
    border-radius: 4px; font-size: 14px; line-height: 1;
    display: flex; align-items: center; flex-shrink: 0;
    transition: background .12s, color .12s;
}
.tvp-btn:hover { background: rgba(255,255,255,.15); color: #fff; }
.tvp-time {
    font-size: 11px; color: rgba(255,255,255,.75);
    font-variant-numeric: tabular-nums; white-space: nowrap;
}
.tvp-spacer { flex: 1; }
.tvp-speed {
    background: rgba(255,255,255,.1); color: rgba(255,255,255,.85);
    border: 1px solid rgba(255,255,255,.2); border-radius: 4px;
    padding: 2px 5px; font-size: 11px; cursor: pointer;
}
.tvp-volume-row { display: flex; align-items: center; gap: 4px; }
.tvp-vol {
    -webkit-appearance: none; appearance: none;
    width: 64px; height: 3px; border-radius: 2px;
    background: rgba(255,255,255,.3); outline: none; cursor: pointer;
    accent-color: #667eea;
}
.tvp-vol::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 11px; height: 11px; border-radius: 50%;
    background: #667eea; cursor: pointer;
}

/* ── info bar ── */
.tvp-info {
    display: flex; align-items: center;
    gap: 8px; padding: 7px 12px;
    background: linear-gradient(to right, #1a1a2e, #16213e);
    border-top: 1px solid rgba(255,255,255,.08);
    min-width: 0;
}
.tvp-badge {
    display: inline-flex; align-items: center; gap: 3px;
    padding: 2px 7px; border-radius: 4px;
    background: rgba(255,255,255,.1); font-size: 11px;
    color: #aaa; flex-shrink: 0;
}
.tvp-badge.youtube  { color: #ff4444; }
.tvp-badge.bilibili { color: #00b5e5; }
.tvp-badge.vimeo    { color: #1ab7ea; }
.tvp-badge.local    { color: #4ade80; }
.tvp-badge.tiktok   { color: #ee1d52; }
.tvp-title {
    font-size: 12px; color: #ccc;
    overflow: hidden; text-overflow: ellipsis;
    white-space: nowrap; flex: 1; min-width: 0;
}
.tvp-actions { display: flex; gap: 6px; flex-shrink: 0; }
.tvp-act {
    padding: 3px 9px; background: rgba(255,255,255,.1);
    border: none; border-radius: 4px; color: #aaa;
    font-size: 11px; cursor: pointer; transition: all .15s;
}
.tvp-act:hover { background: rgba(255,255,255,.2); color: #fff; }

/* ── attachment panel (file notes / #videoPlayer) ── */
.tvp-attach-panel { contain: none; }
.tvp-attach-hidden { display: none; }
.tvp-src-bar {
    display: flex; align-items: center; gap: 8px;
    padding: 6px 0 4px; flex-wrap: wrap;
    font-size: 13px; color: var(--main-text-color, #ccc);
}
.tvp-src-bar select {
    flex: 1; min-width: 0; padding: 4px 6px;
    border: 1px solid var(--main-border-color, #444);
    border-radius: 4px;
    background: var(--input-background-color, #222);
    color: var(--input-text-color, #eee); font-size: 13px;
}
`;

/* ── widget class ───────────────────────────────────────────────────────── */
class VideoPreviewWidget extends api.NoteContextAwareWidget {
    static get parentWidget() { return 'center-pane'; }
    get position() { return 90; }

    /* No isEnabled() override → runs on all notes for toolbar + inline rendering.
       The attachment panel is conditionally shown inside refreshWithNote. */

    /* ── render ── */
    doRender() {
        /* Inject global CSS into <head> once */
        if (!document.getElementById(TVP_STYLE_ID)) {
            const s = document.createElement('style');
            s.id = TVP_STYLE_ID;
            s.textContent = GLOBAL_CSS;
            document.head.appendChild(s);
        }

        this.$widget = $('<div class="tvp-attach-panel tvp-attach-hidden">');
        this._bindAttachKeys();
        return this.$widget;
    }

    _bindAttachKeys() {
        this.$widget[0].setAttribute('tabindex', '0');
        this.$widget[0].addEventListener('keydown', e => {
            const v = this.$widget.find('video')[0];
            if (!v || !v.src) return;
            if (['SELECT','INPUT'].includes(e.target.tagName)) return;
            switch (e.code) {
                case 'Space':      e.preventDefault(); v.paused ? v.play() : v.pause(); break;
                case 'ArrowRight': e.preventDefault(); v.currentTime = Math.min(v.duration, v.currentTime + 5); break;
                case 'ArrowLeft':  e.preventDefault(); v.currentTime = Math.max(0, v.currentTime - 5); break;
                case 'ArrowUp':    e.preventDefault(); v.volume = Math.min(1, v.volume + 0.1); break;
                case 'ArrowDown':  e.preventDefault(); v.volume = Math.max(0, v.volume - 0.1); break;
                case 'KeyM':       v.muted = !v.muted; break;
                case 'KeyF':       this._toggleFs(this.$widget.find('.tvp-player')[0]); break;
            }
        });
    }

    /* ── refresh ── */
    async refreshWithNote(note) {
        /* Inline rendering + toolbar run on a short delay to let Trilium's
           DOM settle after note switch */
        setTimeout(() => {
            this._addToolbarButton();
            this._renderInlineVideos();
            this._startObserver();
        }, 250);

        await this._refreshAttachPanel(note);
    }

    /* ── attachment / file-note panel ── */
    async _refreshAttachPanel(note) {
        this.$widget.empty().addClass('tvp-attach-hidden');

        if (note.type === 'file' && isVideoMime(note.mime)) {
            this.$widget.removeClass('tvp-attach-hidden').append(
                this._buildNativePlayer(`/api/notes/${note.noteId}/download`, note.title, 'local')
            );
            return;
        }

        if (!note.hasLabel('videoPlayer')) return;

        const attachments = await note.getAttachments();
        const videos = attachments.filter(a => isVideoMime(a.mime) || isVideoExt(a.title));
        if (!videos.length) return;

        this.$widget.removeClass('tvp-attach-hidden');

        if (videos.length > 1) {
            const $sel = $('<select>').append(
                videos.map(a => $('<option>').val(`/api/attachments/${a.attachmentId}/download`).text(a.title))
            );
            const $slot = $('<div>');
            this.$widget
                .append($('<div class="tvp-src-bar">').append('<label>Video: </label>', $sel))
                .append($slot);

            const load = () => {
                const opt = $sel.find(':selected');
                $slot.empty().append(this._buildNativePlayer($sel.val(), opt.text(), 'local'));
            };
            $sel.on('change', load);
            load();
        } else {
            const a = videos[0];
            this.$widget.append(
                this._buildNativePlayer(`/api/attachments/${a.attachmentId}/download`, a.title, 'local')
            );
        }
    }

    /* ── inline video rendering ── */
    _renderInlineVideos() {
        const container = document.querySelector(
            '.note-detail-readonly-text-content, .note-detail-book-content, .include-note-content'
        );
        if (!container || container.closest('.ck-editor__editable')) return;

        container.querySelectorAll(`a[href*="${TVP_NATIVE}"], a[href*="${TVP_IFRAME}"]`).forEach(link => {
            if (link.dataset.tvpRendered) return;
            link.dataset.tvpRendered = '1';

            const href   = link.getAttribute('href');
            const native = href.includes(TVP_NATIVE);
            const url    = href.replace(/#video-(native|iframe)$/, '');
            const title  = link.textContent.trim() || this._titleFromUrl(url);
            const plat   = detectPlatform(url);

            const player = native
                ? this._buildNativePlayer(url, title, plat.cssClass)
                : this._buildIframePlayer(url, title, plat);

            link.style.display = 'none';
            link.parentNode.insertBefore(player, link.nextSibling);
        });
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
    _buildNativePlayer(url, title, platClass) {
        const el = document.createElement('div');
        el.className = 'tvp-player';

        /* media wrap */
        const mediaWrap = this._el('div', 'tvp-media-wrap');
        const video = this._el('video');
        video.src = url;
        video.preload = 'metadata';
        video.setAttribute('playsinline', '');

        const bigPlay = this._el('div', 'tvp-big-play');
        bigPlay.innerHTML = '<div class="tvp-big-play-icon">&#9654;</div>';

        const loading = this._el('div', 'tvp-loading');
        loading.innerHTML = '<div class="tvp-spinner"></div><span>Loading…</span>';

        const errOverlay = this._el('div', 'tvp-error-overlay');
        const errMsg = this._el('span');
        errMsg.textContent = 'Failed to load video';
        const retryBtn = this._el('button', 'tvp-retry-btn');
        retryBtn.textContent = 'Retry';
        errOverlay.append('⚠️ ', errMsg, document.createElement('br'), retryBtn);

        mediaWrap.append(video, bigPlay, loading, errOverlay);

        /* custom controls */
        const controls = this._buildControls(video, el, url);

        /* info bar */
        const info = this._buildInfoBar(title, platClass, detectPlatform(url), url);

        el.append(mediaWrap, controls, info);

        /* events */
        video.addEventListener('loadeddata',  () => el.classList.add('tvp-loaded'));
        video.addEventListener('error',       () => { el.classList.add('tvp-error'); errMsg.textContent = video.error?.message || 'Failed to load video'; });
        bigPlay.addEventListener('click',     () => video.paused ? video.play() : video.pause());
        video.addEventListener('play',        () => { bigPlay.classList.add('tvp-gone'); el.querySelector('.tvp-play-btn').innerHTML = '&#10074;&#10074;'; });
        video.addEventListener('pause',       () => { bigPlay.classList.remove('tvp-gone'); el.querySelector('.tvp-play-btn').innerHTML = '&#9654;'; });
        video.addEventListener('ended',       () => bigPlay.classList.remove('tvp-gone'));
        video.addEventListener('dblclick',    () => this._toggleFs(el));
        retryBtn.addEventListener('click',    () => { el.classList.remove('tvp-error', 'tvp-loaded'); video.load(); });

        return el;
    }

    _buildControls(video, playerEl, url) {
        const controls = this._el('div', 'tvp-controls');

        /* seek row */
        const progress = this._el('div', 'tvp-progress');
        const track    = this._el('div', 'tvp-track');
        const buf      = this._el('div', 'tvp-buf');
        const pos      = this._el('div', 'tvp-pos');
        const thumb    = this._el('div', 'tvp-thumb');
        track.append(buf, pos);
        progress.append(track, thumb);

        const seekFrac = e => {
            const r = progress.getBoundingClientRect();
            return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
        };
        const seek = e => { if (isFinite(video.duration)) video.currentTime = seekFrac(e) * video.duration; };

        progress.addEventListener('click', seek);
        progress.addEventListener('mousedown', e => {
            let dragging = true;
            const mv = ev => { if (dragging) seek(ev); };
            const up = ()  => { dragging = false; document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); };
            document.addEventListener('mousemove', mv);
            document.addEventListener('mouseup', up);
            seek(e);
        });

        video.addEventListener('timeupdate', () => {
            const pct = video.duration ? (video.currentTime / video.duration) * 100 : 0;
            pos.style.width   = pct + '%';
            thumb.style.left  = pct + '%';
            timeEl.textContent = `${fmtTime(video.currentTime)} / ${fmtTime(video.duration)}`;
        });
        video.addEventListener('progress', () => {
            if (video.buffered.length) {
                buf.style.width = (video.buffered.end(video.buffered.length - 1) / video.duration * 100) + '%';
            }
        });

        /* control bar */
        const bar = this._el('div', 'tvp-bar');

        const playBtn = this._el('button', 'tvp-btn tvp-play-btn');
        playBtn.innerHTML = '&#9654;';
        playBtn.title = 'Play / Pause (Space)';
        playBtn.addEventListener('click', () => video.paused ? video.play() : video.pause());

        const timeEl = this._el('span', 'tvp-time');
        timeEl.textContent = '0:00 / 0:00';

        const spacer = this._el('div', 'tvp-spacer');

        const speed = this._el('select', 'tvp-speed');
        speed.title = 'Playback speed';
        [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3].forEach(v => {
            const o = document.createElement('option');
            o.value = v; o.textContent = v + '×';
            if (v === 1) o.selected = true;
            speed.appendChild(o);
        });
        speed.addEventListener('change', () => { video.playbackRate = +speed.value; });

        const volRow  = this._el('div', 'tvp-volume-row');
        const muteBtn = this._el('button', 'tvp-btn');
        muteBtn.innerHTML = '&#128266;';
        muteBtn.title = 'Mute (M)';
        const volSlider = this._el('input', 'tvp-vol');
        volSlider.type = 'range'; volSlider.min = 0; volSlider.max = 1;
        volSlider.step = 0.05; volSlider.value = 1; volSlider.title = 'Volume (↑/↓)';

        const syncMute = () => {
            const muted = video.muted || video.volume === 0;
            muteBtn.innerHTML = muted ? '&#128263;' : (video.volume < 0.5 ? '&#128264;' : '&#128266;');
            if (!video.muted) volSlider.value = video.volume;
        };
        muteBtn.addEventListener('click', () => { video.muted = !video.muted; syncMute(); });
        volSlider.addEventListener('input', () => { video.volume = +volSlider.value; video.muted = false; syncMute(); });
        video.addEventListener('volumechange', syncMute);

        volRow.append(muteBtn, volSlider);

        const pipBtn = this._el('button', 'tvp-btn');
        pipBtn.innerHTML = '&#10697;'; pipBtn.title = 'Picture-in-Picture';
        if (!document.pictureInPictureEnabled) pipBtn.style.display = 'none';
        pipBtn.addEventListener('click', () => {
            document.pictureInPictureElement
                ? document.exitPictureInPicture().catch(() => {})
                : video.requestPictureInPicture().catch(() => {});
        });

        const fsBtn = this._el('button', 'tvp-btn');
        fsBtn.innerHTML = '&#x26F6;'; fsBtn.title = 'Fullscreen (F)';
        fsBtn.addEventListener('click', () => this._toggleFs(playerEl));
        document.addEventListener('fullscreenchange', () => {
            fsBtn.innerHTML = document.fullscreenElement === playerEl ? '&#x2716;' : '&#x26F6;';
        });

        /* keyboard (on player element) */
        playerEl.setAttribute('tabindex', '0');
        playerEl.addEventListener('keydown', e => {
            if (['SELECT','INPUT'].includes(e.target.tagName)) return;
            switch (e.code) {
                case 'Space':      e.preventDefault(); video.paused ? video.play() : video.pause(); break;
                case 'ArrowRight': e.preventDefault(); video.currentTime = Math.min(video.duration||0, video.currentTime + 5); break;
                case 'ArrowLeft':  e.preventDefault(); video.currentTime = Math.max(0, video.currentTime - 5); break;
                case 'ArrowUp':    e.preventDefault(); video.volume = Math.min(1, video.volume + 0.1); syncMute(); break;
                case 'ArrowDown':  e.preventDefault(); video.volume = Math.max(0, video.volume - 0.1); syncMute(); break;
                case 'KeyM':       video.muted = !video.muted; syncMute(); break;
                case 'KeyF':       this._toggleFs(playerEl); break;
            }
        });

        bar.append(playBtn, timeEl, spacer, speed, volRow, pipBtn, fsBtn);
        controls.append(progress, bar);
        return controls;
    }

    /* ── build iframe player ── */
    _buildIframePlayer(url, title, platform) {
        const el = document.createElement('div');
        el.className = 'tvp-player';

        const mediaWrap = this._el('div', 'tvp-media-wrap');

        const loading = this._el('div', 'tvp-loading');
        loading.innerHTML = '<div class="tvp-spinner"></div><span>Loading…</span>';

        const errOverlay = this._el('div', 'tvp-error-overlay');
        errOverlay.innerHTML = '⚠️ <span>Failed to load embed</span>';
        const retryBtn = this._el('button', 'tvp-retry-btn');
        retryBtn.textContent = 'Retry';
        errOverlay.appendChild(retryBtn);

        const iframe = this._el('iframe');
        iframe.src = url;
        iframe.allowFullscreen = true;
        iframe.allow = 'autoplay; fullscreen; picture-in-picture; encrypted-media';

        iframe.addEventListener('load', () => el.classList.add('tvp-loaded'));
        /* iframes don't fire error reliably; timeout fallback */
        setTimeout(() => { if (!el.classList.contains('tvp-loaded')) el.classList.add('tvp-loaded'); }, 4000);

        retryBtn.addEventListener('click', () => {
            el.classList.remove('tvp-error', 'tvp-loaded');
            iframe.src = url;
        });

        mediaWrap.append(loading, errOverlay, iframe);

        const info = this._buildInfoBar(title, platform.cssClass, platform, url);
        el.append(mediaWrap, info);
        return el;
    }

    /* ── info bar ── */
    _buildInfoBar(title, platClass, platform, url) {
        const info  = this._el('div', 'tvp-info');
        const badge = this._el('span', `tvp-badge ${platClass}`);
        badge.textContent = `${platform.icon} ${platform.name}`;

        const titleEl = this._el('span', 'tvp-title');
        titleEl.textContent = title;        /* textContent = safe, no XSS */
        titleEl.title = title;

        const actions = this._el('div', 'tvp-actions');

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

    /* ── toolbar button ── */
    _addToolbarButton() {
        const $ribbon = $("div.component.note-split:not(.hidden-ext) div.ribbon-tab-title").parent();
        if (!$ribbon.length) return;

        if (!$ribbon.find('.tvp-toolbar-wrap').length) {
            const $last = $ribbon.find('.ribbon-tab-title:not(.backToHis)').last();
            const html = `<div class="tvp-toolbar-wrap ribbon-tab-title">
                <span class="tvp-toolbar-btn ribbon-tab-title-icon bx" title="Embed video links (🎬)"></span>
            </div>`;
            ($last.length ? $last : $ribbon).before ? $last.before(html) : $ribbon.append(html);
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
        $icon.addClass('tvp-loading');
        api.showMessage('🔄 Converting video links…');

        try {
            const result = await api.runAsyncOnBackendWithManualTransactionHandling(async (noteId) => {
                const note = await api.getNote(noteId);
                if (!note) return { ok: false, error: 'Note not found' };

                let html = await note.getContent();
                const orig = html;
                let count = 0;

                const makeLink = (url, title, type) => {
                    const hash   = type === 'native' ? '#video-native' : '#video-iframe';
                    const safeU  = url.replace(/"/g, '%22');
                    const safeT  = (title || 'Video').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                    return `<p><a href="${safeU}${hash}">${safeT}</a></p>`;
                };

                const classify = (url) => {
                    url = url.trim();
                    if (url.includes('#video-native') || url.includes('#video-iframe')) return null;

                    if (/\.(mp4|webm|ogg|ogv|mov|m4v|mkv|avi|flv|3gp|m3u8)(\?.*)?$/i.test(url)
                        || url.includes('localhost') || url.includes('127.0.0.1')) {
                        const fn = (() => { try { return decodeURIComponent(url.split('/').pop().split('?')[0].split('#')[0]); } catch { return 'Video'; } })();
                        return { type: 'native', url, title: fn || 'Local Video' };
                    }

                    if (url.includes('youtube.com') || url.includes('youtu.be')) {
                        const m = url.match(/(?:v=|youtu\.be\/)([^&?#]+)/);
                        if (m) return { type: 'iframe', url: `https://www.youtube.com/embed/${m[1]}`, title: `YouTube ${m[1]}` };
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
                    return null;
                };

                /* convert <a> tags */
                html = html.replace(/<a\s+[^>]*href=["']([^"']+)["'][^>]*>[\s\S]*?<\/a>/gi, (match, url) => {
                    const r = classify(url);
                    if (r) { count++; return makeLink(r.url, r.title, r.type); }
                    return match;
                });

                /* convert bare URL text in <p> */
                html = html.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (match, inner) => {
                    const text = inner.replace(/&nbsp;/g, ' ').replace(/<br\s*\/?>/gi, '').trim();
                    if (/<[a-z]/i.test(text)) return match;
                    const m = text.match(/^(https?:\/\/[^\s<>"]+)$/i);
                    if (m) { const r = classify(m[1]); if (r) { count++; return makeLink(r.url, r.title, r.type); } }
                    return match;
                });

                if (html !== orig) {
                    await note.setContent(html);
                    return { ok: true, count };
                }
                return { ok: false, count: 0 };
            }, [note.noteId]);

            $icon.removeClass('tvp-loading');
            if (result.ok) {
                $icon.addClass('tvp-success');
                api.showMessage(`✅ Embedded ${result.count} video link${result.count !== 1 ? 's' : ''}`);
                setTimeout(() => { $icon.removeClass('tvp-success'); api.activateNote(note.noteId); }, 1200);
            } else if (result.error) {
                api.showMessage('❌ ' + result.error);
            } else {
                api.showMessage('ℹ️ No convertible video links found');
            }
        } catch (e) {
            console.error('[VideoPreviewWidget]', e);
            api.showMessage('❌ Error: ' + e.message);
            $('.tvp-toolbar-btn').removeClass('tvp-loading');
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
        if (!document.fullscreenElement) {
            el?.requestFullscreen().catch(() => {});
        } else {
            document.exitFullscreen().catch(() => {});
        }
    }

    _debounce(fn, delay) {
        let t;
        return (...args) => { clearTimeout(t); t = setTimeout(() => fn.apply(this, args), delay); };
    }
}

module.exports = new VideoPreviewWidget();
