// File System Access shim for the desktop app.
//
// index.html scans game folders with the browser's File System Access API (showDirectoryPicker,
// directory handles, entries(), getFile()). Chromium blocks system folders such as Program Files and
// will not keep permission between launches, so inside Electron this file replaces the picker with one
// that goes through the main process (see the efs:* handlers in main.js and window.efs in preload.js).
//
// It provides:
//   window.showDirectoryPicker(opts)  native folder dialog, resolves to a directory handle
//   window.efsRe(value)               turns handles that came back from IndexedDB into live handles again
//
// Handles hold only plain data (kind, name, fsPath) so they survive IndexedDB's structured clone, which
// is how the page remembers your folders. The methods live on the prototype and are restored by efsRe.
// In a normal browser window.efs does not exist, so this file does nothing and the browser's own picker is used.
(function () {
  'use strict';
  const efs = window.efs;
  if (!efs || typeof efs.pickDir !== 'function') return;

  const fail = (name, msg) => new DOMException(msg, name);
  const trim = p => p.replace(/[\\/]+$/, '');
  const sepOf = p => (/^[A-Za-z]:|^\\\\/.test(p) || p.includes('\\') ? '\\' : '/');
  const join = (p, n) => trim(p) + sepOf(p) + n;
  const base = p => p.split(/[\\/]/).filter(Boolean).pop() || p;
  const norm = p => trim(p).replace(/\//g, '\\').toLowerCase();

  class Handle {
    constructor(kind, fsPath) {
      this.kind = kind;
      this.name = base(fsPath);
      this.fsPath = fsPath;   // real path on disk, which the browser API never reveals
      this.efsHandle = 1;     // marker so efsRe can recognise a stored handle
    }
    async queryPermission() { return 'granted'; }
    async requestPermission() { return 'granted'; }
    async isSameEntry(other) {
      return !!other && other.kind === this.kind && typeof other.fsPath === 'string' && norm(other.fsPath) === norm(this.fsPath);
    }
  }

  class FileHandle extends Handle {
    constructor(fsPath) { super('file', fsPath); }
    async getFile() {
      const p = this.fsPath, s = await efs.stat(p);
      if (!s) throw fail('NotFoundError', 'A file with that name could not be found.');
      if (s.kind !== 'file') throw fail('TypeMismatchError', 'That entry is not a file.');
      // The page only reads name, size, lastModified and text(), so this is not a full File object.
      return { name: this.name, size: s.size, lastModified: Math.round(s.mtimeMs), type: '', text: () => efs.text(p) };
    }
  }

  class DirHandle extends Handle {
    constructor(fsPath) { super('directory', fsPath); }
    async *entries() {
      for (const e of await efs.list(this.fsPath)) {
        const p = join(this.fsPath, e.name);
        yield [e.name, e.kind === 'directory' ? new DirHandle(p) : new FileHandle(p)];
      }
    }
    async *keys() { for await (const [n] of this.entries()) yield n; }
    async *values() { for await (const [, h] of this.entries()) yield h; }
    [Symbol.asyncIterator]() { return this.entries(); }
    async getDirectoryHandle(name) {
      const p = join(this.fsPath, name), s = await efs.stat(p);
      if (!s) throw fail('NotFoundError', 'A directory with that name could not be found.');
      if (s.kind !== 'directory') throw fail('TypeMismatchError', 'That entry is not a directory.');
      return new DirHandle(p);
    }
    async getFileHandle(name) {
      const p = join(this.fsPath, name), s = await efs.stat(p);
      if (!s) throw fail('NotFoundError', 'A file with that name could not be found.');
      if (s.kind !== 'file') throw fail('TypeMismatchError', 'That entry is not a file.');
      return new FileHandle(p);
    }
  }

  // Walks whatever the page stored (an array of handles, or an array of { h, path }) and rebuilds the handles.
  // Objects that are not plain data, such as real browser handles, are left alone.
  function revive(v) {
    if (Array.isArray(v)) return v.map(revive);
    if (v && typeof v === 'object') {
      if (v.efsHandle === 1 && typeof v.fsPath === 'string') return v.kind === 'file' ? new FileHandle(v.fsPath) : new DirHandle(v.fsPath);
      if (Object.getPrototypeOf(v) === Object.prototype) {
        const o = {};
        for (const k of Object.keys(v)) o[k] = revive(v[k]);
        return o;
      }
    }
    return v;
  }

  Object.defineProperty(window, 'efsRe', { value: revive, configurable: true, writable: true });
  Object.defineProperty(window, 'showDirectoryPicker', {
    configurable: true,
    writable: true,
    value: async function showDirectoryPicker(opts) {
      const p = await efs.pickDir(opts && opts.id);   // the id picks the starting folder, see START in main.js
      if (!p) throw fail('AbortError', 'The user aborted a request.');
      return new DirHandle(p);
    }
  });
})();
