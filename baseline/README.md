# Baselines

`baseline-<platform>.json` files are produced by `npm run baseline`.

- `baseline-linux.json` was produced in the review sandbox. It only proves the script works; the numbers say nothing about Windows.
- The numbers that matter come from `windows-latest` CI (artifact `e2e-results`) and from your own PC: cold start, idle memory
  (`test-results/perf-win32.json`) and PowerShell spawn cost (`baseline-win32.json`).
- Once a Windows baseline exists, copy its numbers into this file and use them as the performance budget for Phase 1.
