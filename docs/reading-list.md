# Reading list (Browser-owned)

REUSE: `WizardApp` theme/back/update APIs and shipped Appearance v1 `--wz-*` tokens; safe Reader extraction/network path; existing owner-only gateway and Browser MCP front. No shell/core changes.
EXTEND: Reader toolbar with an immediate optimistic bookmark; Browser home under the address box with saved metadata, canonical dedupe, fresh-read reopen, per-row menu, collapsed Read section. Browser app-owned skill/MCP routes.
NEW (domain data only): single-writer atomic JSON metadata store at `/data/list.json`; no bodies/cookies; UUID identifiers, serialized writes + fsync + rename + directory fsync. At most 10,000 entries. Corrupt data fails closed; retain bytes and restore from backup rather than silently reset. One Reader instance per install; never share the volume between active writers.

## API/security

- `GET /api/list` → `{items:[...]}` (newest first).
- `POST /api/list` with JSON `{url}` → `{item}`. Fetch metadata via safe Reader; validate the initial and canonical destination with the existing network guard even on duplicate adds. A duplicate preserves its id/saved/read dates.
- `PATCH /api/list/<id>` JSON `{read:true|false}` → `{item}`.
- `DELETE /api/list/<id>` JSON `{}` → `{ok:true}` (idempotent).
- Store only `id,url,canonical_url,title,site,byline,published,favicon,saved_at,read_at`. `favicon` is a guarded same-app proxy path; all strings are rendered with textContent. HTML from Reader is sanitized as before, not persisted.
- Mutations require application/json (16 KiB maximum), exact Origin vs Host+forwarded scheme when Origin is present, and refuse cross-site/same-site Fetch Metadata. Origin-free private agent JSON is allowed; browser requests with Fetch Metadata must supply the same origin. Forms cannot send JSON. No CORS headers. Reader's CSP/connect-src stays self.
- Front allows GET/HEAD/POST on collection, PATCH/DELETE only on UUID item paths. Upgrade, transfer encoding, duplicate/invalid Content-Length and excess bodies are refused. MCP/CDP/devtools remain forbidden on every identity-forwarded connection. Never make `/browser/*` a general write or agent-tool proxy.
- Private MCP `reading_list_add` / `reading_list_list` use exactly the same API, with no metadata supplied by the caller.

## Persistence and backup

The portable named `reading-list` volume mounts `/data` while root stays read-only and `/tmp` remains tmpfs. Plain Docker copies `/data` ownership from the image (1000:1000). WAM `WizardStorage.rewriteVolumes` turns this named volume into `${APP_DATA_DIR}/volumes/reading-list:/data`, initializing a fresh directory's ownership from the sole Reader user (1000:1000). `BackupManager.createBackupArchive` copies appDataDir recursively, excluding only the root backups directory. Thus `volumes/reading-list/list.json` is included, not a host-global Docker volume that backups miss. An update retains the same source directory and volume key. Before claiming live release, inspect compiled source/mount ownership and inspect a real post-seed WAM backup archive for those bytes; restore/restart acceptance remains a release gate, not a source-only assertion.

## Gate transport and navigation regressions

The isolated shell harness forwards the browser's exact Origin/Fetch Metadata and Host via Node `http.request`, not Node fetch (which replaces Host with the backend authority). Its focused regression exercises the real `mutationGuard`: the old transport gets 403, the authority-preserving transport succeeds for POST/PATCH/DELETE, and hostile/opaque origins still get 403. No CSRF policy is relaxed.

Phone acceptance dismisses the real first-use Review mode coach through **Got it**, waits for its removal, then taps Save with touch input; the first-frame proof is collected before dismissal. A tap that only dismisses onboarding is not a Save action. The gate records Reader request/response metadata, warning/error consoles and frame state on failures.

Reader home/read/Back replace the app-domain `url` parameter to match the displayed state without adding history entries. The desktop shell intentionally skips navigation when a deep link matches a frame's live URL; retaining an article URL while showing Reading list made reopening that same Search result a no-op. Focused UI tests cover home, typed navigation, article links and Back, including history length.

## Acceptance

Focused unit tests: atomic dedupe/write serialization, restart via new store, corruption refusal, metadata projection, unsafe URL/canonical refusal, JSON/origin/size/method guards, front method/identity isolation, UI optimistic first paint and rollback, reopen refetch, menu outside/Back, read/remove.

Parent-admitted Forum composed gate: exact immutable image + live shell `fc998242` (or a freshly recorded serving head if changed), desktop/phone × nebula/grove, Save held past a paint → list → reopen → Back to list → Mark read → collapsed Read → Remove; screenshots each, real backend calls, live skin changes, opaque menus. Standalone dark fallback is tested separately. Restart uses the same mounted volume; compiled-WAM-style backup rehearsal validates archived metadata after restart/recreate. No screenshots/native simulations constitute physical phone acceptance. Phone release is only the in-app web update, never an APK.
