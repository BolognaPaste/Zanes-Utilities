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
      this.fsPath = fsPath;
      this.efsHandle = 1;
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
      return { name: this.name, size: s.size, text: () => efs.text(p) };
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
    async getDirectoryHandle(name) {
      const p = join(this.fsPath, name), s = await efs.stat(p);
      if (!s) throw fail('NotFoundError', 'A directory with that name could not be found.');
      if (s.kind !== 'directory') throw fail('TypeMismatchError', 'That entry is not a directory.');
      return new DirHandle(p);
    }
  }

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
      const p = await efs.pickDir(opts && opts.id);
      if (!p) throw fail('AbortError', 'The user aborted a request.');
      return new DirHandle(p);
    }
  });
})();
