---
wizard: 0.2
id: browser
name: Browser
type: view
category: system
tags: [research, automation]
version: 155.0.8059.44
summary: Read web pages inside Wizard, with a private Chrome for agent web tasks.
view:
  path: /
  port: 9222
icon: icon.png
license: WTFPL
source: https://github.com/humanitylabs-org/browser
runtime:
  kind: runtipi
  config: runtipi/config.json
  compose: runtipi/docker-compose.yml
mcp:
  path: /mcp
  port: 9222
  transport: streamable-http
skill: SKILL.md
provides:
- browser
---

# Browser

A clean public-page Reader and metadata-only Reading list, with private Chrome tools for agent tasks.

For “add this to my reading list”, use this app's private MCP `reading_list_add` with `{"url":"<public URL>"}`, then verify it with `reading_list_list`. Resolve this installation's Browser MCP endpoint from the app registry. `SKILL.md` ships the exact JSON-RPC and private HTTP calls. Owner UI and agents use the same safe metadata path; article bodies and cookies are never saved. The portable named `reading-list` volume survives updates; WAM rewrites it to the app's backup-covered `volumes/reading-list` directory.
