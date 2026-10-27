// Flat config (ESLint 9). Legacy files are linted for real mistakes only; style is Prettier's job.
const node = {
  require: 'readonly',
  module: 'writable',
  process: 'readonly',
  __dirname: 'readonly',
  Buffer: 'readonly',
  console: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  setImmediate: 'readonly',
  performance: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  TextDecoder: 'readonly',
  TextEncoder: 'readonly',
  AbortController: 'readonly',
  AbortSignal: 'readonly',
  fetch: 'readonly',
  Response: 'readonly',
  globalThis: 'readonly',
  queueMicrotask: 'readonly',
  structuredClone: 'readonly'
};
const browser = {
  window: 'readonly',
  document: 'readonly',
  localStorage: 'readonly',
  navigator: 'readonly',
  console: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  requestAnimationFrame: 'readonly',
  requestIdleCallback: 'readonly',
  fetch: 'readonly',
  URL: 'readonly',
  Blob: 'readonly',
  FileReader: 'readonly',
  DataView: 'readonly',
  TextDecoder: 'readonly',
  TextEncoder: 'readonly',
  Terminal: 'readonly',
  FitAddon: 'readonly',
  MutationObserver: 'readonly',
  ResizeObserver: 'readonly',
  DOMParser: 'readonly',
  Image: 'readonly',
  Audio: 'readonly',
  AbortController: 'readonly',
  getComputedStyle: 'readonly',
  matchMedia: 'readonly',
  WebSocket: 'readonly',
  EventSource: 'readonly',
  crypto: 'readonly',
  atob: 'readonly',
  btoa: 'readonly',
  alert: 'readonly',
  confirm: 'readonly',
  prompt: 'readonly',
  performance: 'readonly',
  location: 'readonly',
  sessionStorage: 'readonly',
  indexedDB: 'readonly',
  innerWidth: 'readonly',
  innerHeight: 'readonly',
  cancelAnimationFrame: 'readonly',
  IntersectionObserver: 'readonly',
  Event: 'readonly',
  DOMException: 'readonly',
  HTMLImageElement: 'readonly'
};
// The preload bridge (preload.js exposeInMainWorld) and the window properties one renderer script sets for another.
const page = Object.fromEntries(
  [
    'appTools',
    'appDiag',
    'efs',
    'drivers',
    'shredder',
    'vault',
    'webGames',
    'appData',
    'fmhy',
    'phone',
    'sshTerm',
    'localVideos',
    'optimizer',
    'chat',
    'mumble',
    'secureStore',
    'appLock',
    'ChatUI',
    'fmEnter',
    'fmPause',
    'lvEnter',
    'lvPause',
    'gmEnter',
    'gmPause',
    'phEnter',
    'phPause'
  ].map(n => [n, 'readonly'])
);
// Top-level names app.js declares. Scripts loaded after it share them through the page's global scope.
const fromApp = Object.fromEntries(
  ['$', 'esc', 'toast', 'closeMenu', 'closeDlg', 'base', 'anText', 'E', 'M', 'T'].map(n => [n, 'readonly'])
);
const nodeFiles = [
  'main.js',
  'preload.js',
  '*-ipc.js',
  'chat-core.js',
  'chat-server.js',
  'chat-tunnel.js',
  'chat-remote.js',
  'keystore.js',
  'secure-store.js',
  'vendor-sources.js',
  'ssh-sftp.js',
  'adblock.js',
  'logger.js',
  'diagnostics.js',
  'eslint.config.js',
  'playwright.config.js',
  'scripts/**/*.js',
  'test/**/*.js',
  'tests/**/*.js'
];

const rules = {
  'no-undef': 'error',
  'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }],
  'no-redeclare': 'error',
  'no-dupe-keys': 'error',
  'no-unreachable': 'error',
  'no-self-assign': 'error',
  'no-constant-condition': ['error', { checkLoops: false }],
  'no-empty': ['warn', { allowEmptyCatch: true }],
  eqeqeq: ['warn', 'smart'],
  'no-eval': 'error',
  'no-implied-eval': 'error',
  'no-new-func': 'error'
};

module.exports = [
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'scrcpy/**',
      'cloudflared/**',
      'mumble/**',
      'coverage/**',
      'test-results/**',
      'playwright-report/**'
    ]
  },
  { files: ['**/*.js'], languageOptions: { ecmaVersion: 2023, sourceType: 'script' }, rules },
  // Globals merge across matching blocks, so browser names stay out of Node files (where `const crypto = require('crypto')`
  // would otherwise count as a redeclaration), and app.js does not get its own names as globals.
  { files: ['**/*.js'], ignores: nodeFiles, languageOptions: { globals: { ...browser, ...page } } },
  { files: ['**/*.js'], ignores: [...nodeFiles, 'app.js'], languageOptions: { globals: fromApp } },
  { files: nodeFiles, languageOptions: { globals: node } },
  // Callbacks passed to page.evaluate run in the app window.
  { files: ['tests/e2e/**/*.js'], languageOptions: { globals: browser } }
];
