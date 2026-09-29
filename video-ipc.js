// Local videos backend: lets the user pick a folder, lists the video files inside it (with
// subfolders), and can hand a file to the default player when the app cannot play it itself.
// The page plays files directly from disk, so nothing is copied or uploaded.
//
// Movie art: while scanning, artwork that sits next to a video is picked up too (Jellyfin, Kodi and
// Plex naming: poster.jpg, banner.jpg, fanart.jpg, clearlogo.png, "Movie (2020)-poster.jpg", ...).
// Videos without artwork get a thumbnail from Windows (the same one File Explorer shows), which is
// cached in the app's data folder so it is only made once per file.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

const VIDEO = /\.(mp4|m4v|mkv|webm|mov|avi|wmv|flv|mpg|mpeg|ts|m2ts|ogv|3gp)$/i;
const IMAGE = /\.(jpe?g|png|webp)$/i;
const SKIP = /^(\$recycle\.bin|system volume information|node_modules)$/i;
const MAX_FILES = 5000, MAX_DEPTH = 8;

const EXT = ['jpg', 'jpeg', 'png', 'webp'];
// Which file names count as which kind of art. Earlier names win.
const ART = {
  wide: ['landscape', 'banner', 'thumb', 'fanart', 'backdrop', 'background'], // header image
  poster: ['poster', 'folder', 'cover', 'movie', 'default'],
  logo: ['clearlogo', 'logo']
};

// images: lower-case file name -> real file name, for one folder.
// A bare "poster.jpg" only belongs to a video when it is the only video in its folder.
function findArt(images, base, single) {
  const out = {};
  for (const [kind, words] of Object.entries(ART)) {
    const names = words.map(w => base + '-' + w);
    if (kind === 'poster') names.push(base);
    if (single) names.push(...words);
    search: for (const n of names) {
      for (const x of EXT) {
        const hit = images.get(n.toLowerCase() + '.' + x);
        if (hit) { out[kind] = hit; break search; }
      }
    }
  }
  return out;
}

async function walk(root) {
  const files = [];
  let truncated = false;
  async function rec(dir, depth) {
    let ents;
    try { ents = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
    const images = new Map();
    let videos = 0;
    for (const e of ents) {
      if (!e.isFile()) continue;
      if (IMAGE.test(e.name)) images.set(e.name.toLowerCase(), e.name);
      else if (VIDEO.test(e.name)) videos++;
    }
    for (const e of ents) {
      if (files.length >= MAX_FILES) { truncated = true; return; }
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (depth < MAX_DEPTH && e.name[0] !== '.' && !SKIP.test(e.name)) await rec(p, depth + 1);
      } else if (e.isFile() && VIDEO.test(e.name)) {
        let size = 0, mtime = 0;
        try { const st = await fsp.stat(p); size = st.size; mtime = st.mtimeMs; } catch {}
        const item = { path: p, rel: path.relative(root, p), size, mtime };
        const found = findArt(images, e.name.replace(/\.[^.]+$/, ''), videos === 1);
        const kinds = Object.keys(found);
        if (kinds.length) {
          item.art = {};
          for (const k of kinds) item.art[k] = path.join(dir, found[k]);
        }
        files.push(item);
      }
    }
  }
  await rec(root, 0);
  return { files, truncated };
}

function register(ipcMain, getWin, { dialog, shell, app, nativeImage }) {
  // Only files from the last scan can be thumbnailed, so the page cannot ask for arbitrary files.
  let known = new Set();
  const failed = new Set();
  const cacheDir = () => path.join(app.getPath('userData'), 'video-thumbs');

  ipcMain.handle('vid:pick', async () => {
    const r = await dialog.showOpenDialog(getWin(), { title: 'Choose a folder of videos', properties: ['openDirectory'] });
    return r.canceled || !r.filePaths[0] ? null : r.filePaths[0];
  });

  ipcMain.handle('vid:scan', async (_e, dir) => {
    if (typeof dir !== 'string' || !path.isAbsolute(dir)) return { ok: false, error: 'That is not a folder path.' };
    try {
      if (!(await fsp.stat(dir)).isDirectory()) return { ok: false, error: 'That path is not a folder.' };
    } catch { return { ok: false, error: 'The folder could not be found. It may have been moved, renamed or disconnected.' }; }
    try {
      const data = await walk(dir);
      known = new Set(data.files.map(f => f.path));
      failed.clear();
      return { ok: true, data };
    }
    catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
  });

  // Makes (or reuses) a JPEG thumbnail for one video and returns the path of that JPEG.
  ipcMain.handle('vid:thumb', async (_e, file) => {
    if (typeof file !== 'string' || !known.has(file)) return { ok: false, error: 'That file was not in the last scan.' };
    if (failed.has(file)) return { ok: false, error: 'No thumbnail is available.' };
    try {
      if (!nativeImage || typeof nativeImage.createThumbnailFromPath !== 'function') throw new Error('Thumbnails are not supported here.');
      const st = await fsp.stat(file);
      const key = crypto.createHash('sha1').update(file.toLowerCase() + '|' + st.size + '|' + Math.round(st.mtimeMs)).digest('hex');
      const out = path.join(cacheDir(), key + '.jpg');
      if (fs.existsSync(out)) return { ok: true, data: out };
      const img = await nativeImage.createThumbnailFromPath(file, { width: 480, height: 270 });
      if (!img || img.isEmpty()) throw new Error('Windows has no thumbnail for this file.');
      await fsp.mkdir(cacheDir(), { recursive: true });
      await fsp.writeFile(out, img.toJPEG(80));
      return { ok: true, data: out };
    } catch (e) {
      failed.add(file);
      return { ok: false, error: String((e && e.message) || e) };
    }
  });

  // Opens one video in the default player. Only video file types are allowed, never programs.
  ipcMain.handle('vid:open', async (_e, file) => {
    if (typeof file !== 'string' || !path.isAbsolute(file) || !VIDEO.test(file) || !fs.existsSync(file)) return 'That file cannot be opened.';
    return shell.openPath(file);
  });
}

module.exports = { register, walk, VIDEO };
