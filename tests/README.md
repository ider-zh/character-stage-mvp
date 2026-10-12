# Test coverage

Use Node.js 24 or newer.

```sh
npm run typecheck
npm test
npm run build
npm run test:e2e
```

`npm test` starts real loopback HTTP/WebSocket servers against isolated temporary SQLite databases. It uses real PNG/JPEG/WebP decoding and canonical encoding. The tests cover:

- anonymous sessions, cookie protections, HTTP/WS origin guards, request limits and security headers
- valid image upload, format spoofing, SVG rejection, corrupt/empty/oversized files, dimension and total-pixel limits, safe asset naming and no public deletion
- two-client character/position/bounce sync, lease conflicts and ownership, release, renewal, expiration and reconnection
- durable assets, positions and jobs across restart; queued and interrupted-job recovery
- malformed WebSocket messages and the honest unavailable generation endpoint

`npm run test:e2e` starts its own temporary server and serves the built `dist/` application. It uses the existing Chromium executable at `/usr/bin/chromium`; set `CHROMIUM_PATH` for another supported installation. It does not download browsers.

The browser suite covers desktop/mobile layout, uploads, live two-client synchronization, dragging/keyboard/bounce, reconnection, server error rendering and stale HTTP/WS upload-response races. Camera tests stub the camera permission, media tracks and worker, so they test permission denial, cancellation, late resolution and resource cleanup without using a real camera. They do not establish real-device tracking accuracy or MediaPipe runtime compatibility.

Screenshots and reports are written to `evidence/` by successful browser runs. All test data is temporary and removed afterward.

## Verification in the supplied execution environment

- Strict TypeScript check: passed.
- Backend integration suite: 18 passed, 0 failed.
- Camera lifecycle unit suite: 10 passed, 0 failed. These use a minimal hook harness and browser-resource doubles.
- Combined `npm test`: 28 passed, 0 failed.
- Production build and static HTTP asset/model serving smoke check: passed.
- Browser test discovery: 11 tests found.
- Browser execution: 1 launch failure, 10 not run; blocked before page creation. The supplied `/usr/bin/chromium` aborts with `process_singleton_posix.cc:297 socket() failed: Operation not permitted`; a separately approved escalation attempt encountered the same operating-system restriction. No successful visual or camera E2E run is claimed.

Run the browser suite in an environment that permits Chromium's normal process and local-socket startup before calling browser acceptance complete.
