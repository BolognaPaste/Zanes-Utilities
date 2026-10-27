# Third-party notices (DRAFT)

> Status: draft written in Phase 0 from general knowledge of each project. Licences below must be
> confirmed against the exact versions you ship (DST-4, Phase 6). The scrcpy, cloudflared and Mumble
> binaries were not in the review copy, so their versions are unknown here.

| Component                                                            | Used for                                             | Licence (to confirm)                                                                                                                        |
| -------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Electron and Chromium                                                | App shell                                            | MIT (Electron); Chromium bundles many BSD-style and other licences, shipped with Electron as `LICENSES.chromium.html`                       |
| ssh2                                                                 | SSH and SFTP                                         | MIT                                                                                                                                         |
| @xterm/xterm, @xterm/addon-fit                                       | Terminal view                                        | MIT                                                                                                                                         |
| @ghostery/adblocker-electron                                         | Ad blocking engine                                   | MPL-2.0                                                                                                                                     |
| ffmpeg-static (and the FFmpeg binary it downloads)                   | Audio fix and thumbnails                             | The npm wrapper and the FFmpeg build it fetches are published under GPL terms. Check the exact build and what that means for redistribution |
| scrcpy                                                               | Phone mirroring                                      | Apache-2.0                                                                                                                                  |
| cloudflared                                                          | Chat tunnel                                          | Apache-2.0                                                                                                                                  |
| Mumble                                                               | Optional voice                                       | BSD-3-Clause                                                                                                                                |
| uBlock Origin filter lists, EasyList, EasyPrivacy, Peter Lowe's list | Downloaded at runtime by the ad blocker, not bundled | Each list has its own licence (GPL, CC BY-SA and others); attribution belongs in the app's About page (WEB-2)                               |

Development-only tools (electron-builder, ESLint, Prettier, TypeScript, Playwright) are not shipped.

The CycloneDX SBOM produced by `npm run sbom` lists every shipped npm package with its licence.
