// Flat config (ESLint 9). Legacy files are linted for real mistakes only; style is Prettier's job.
const node = { require: 'readonly', module: 'writable', process: 'readonly', __dirname: 'readonly', Buffer: 'readonly', console: 'readonly',
  setTimeout: 'readonly', clearTimeout: 'readonly', setInterval: 'readonly', clearInterval: 'readonly', setImmediate: 'readonly',
  performance: 'readonly', URL: 'readonly', URLSearchParams: 'readonly', TextDecoder: 'readonly', TextEncoder: 'readonly',
  AbortController: 'readonly', fetch: 'readonly', globalThis: 'readonly', queueMicrotask: 'readonly', structuredClone: 'readonly' };
const browser = { window: 'readonly', document: 'readonly', localStorage: 'readonly', navigator: 'readonly', console: 'readonly',
  setTimeout: 'readonly', clearTimeout: 'readonly', setInterval: 'readonly', clearInterval: 'readonly', requestAnimationFrame: 'readonly',
  requestIdleCallback: 'readonly', fetch: 'readonly', URL: 'readonly', Blob: 'readonly', FileReader: 'readonly', DataView: 'readonly',
  TextDecoder: 'readonly', TextEncoder: 'readonly', Terminal: 'readonly', FitAddon: 'readonly', MutationObserver: 'readonly',
  ResizeObserver: 'readonly', DOMParser: 'readonly', Image: 'readonly', Audio: 'readonly', AbortController: 'readonly',
  getComputedStyle: 'readonly', matchMedia: 'readonly', WebSocket: 'readonly', EventSource: 'readonly', crypto: 'readonly',
  atob: 'readonly', btoa: 'readonly', alert: 'readonly', confirm: 'readonly', prompt: 'readonly', performance: 'readonly' };

const rules = {
  'no-undef': 'error', 'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }],
  'no-redeclare': 'error', 'no-dupe-keys': 'error', 'no-unreachable': 'error', 'no-self-assign': 'error',
  'no-constant-condition': ['error', { checkLoops: false }], 'no-empty': ['warn', { allowEmptyCatch: true }],
  eqeqeq: ['warn', 'smart'], 'no-eval': 'error', 'no-implied-eval': 'error', 'no-new-func': 'error'
};

module.exports = [
  { ignores: ['node_modules/**', 'dist/**', 'scrcpy/**', 'cloudflared/**', 'mumble/**', 'coverage/**', 'test-results/**', 'playwright-report/**'] },
  { files: ['**/*.js'], languageOptions: { ecmaVersion: 2023, sourceType: 'script', globals: browser }, rules },
  {
    files: ['main.js', 'preload.js', '*-ipc.js', 'chat-core.js', 'chat-server.js', 'chat-tunnel.js', 'chat-remote.js', 'keystore.js', 'secure-store.js',
      'vendor-sources.js', 'ssh-sftp.js', 'adblock.js', 'logger.js', 'diagnostics.js', 'eslint.config.js', 'playwright.config.js', 'scripts/**/*.js', 'test/**/*.js', 'tests/**/*.js'],
    languageOptions: { globals: node }
  }
];
