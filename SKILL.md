---
name: browser
description: Use when you need to read a JavaScript-rendered page or take a screenshot with the Wizard's shared headless Chromium, via the Browser app's MCP.
version: 0.1.0
license: WTFPL
metadata:
  hermes:
    tags: [browser, chromium, screenshot, web, wizard-app]
---

# Browser

One shared headless Chromium for the whole Wizard. Each call opens a fresh tab and closes it afterwards.

## Use the MCP

- `browser_status`: Chromium version and open tabs.
- `read_page(url, wait_ms?)`: title and visible text after JavaScript runs. Use it when a plain HTTP fetch returns an empty app shell.
- `screenshot(url, width?, height?, full_page?, wait_ms?)`: returns a PNG. Raise `wait_ms` (max 10000) for pages that animate in.

## Reader for the owner

Use the installed Browser `view.url` (normally `/browser/`) and append `?url=` plus the percent-encoded public http(s) URL to show a page inside Wizard. Example: `[Read in Browser](/browser/?url=https%3A%2F%2Fen.wikipedia.org%2Fwiki%2FReadability)`. Resolve the installed app view from the registry; do not guess a gateway hostname or put an outside page into a Wizard frame.

Outside chat links and Search results use this same Reader through WizLinks. It shows the source, title, article and proxied images, with **Open in your browser** for sign-ins, bot checks and pages that cannot be extracted. Reader cannot see agent cookies. **Save** keeps only article metadata in the persistent Reading list; reopening fetches the page again. There is no Live viewer in this release. The MCP and CDP interfaces below stay private to the agent network.

## Reading list from chat

When the owner says “add this to my reading list”, call this app's private MCP **reading_list_add** with `{"url":"<the exact public article URL>"}`. Then call **reading_list_list** and confirm that the returned canonical URL/id is present. Never say saved on a failed extraction. Resolve the Browser MCP endpoint from this installation's registry rather than assuming an owner hostname or port. MCP JSON-RPC example (POST to that endpoint):

```json
{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"reading_list_add","arguments":{"url":"https://contraptions.venkateshrao.com/p/experiments-with-monstrousness"}}}
```

For an agent already on the private app network, the equivalent exact call is `POST http://browser:9222/api/list` with `Content-Type: application/json` and `{"url":"<public URL>"}`; read back `GET http://browser:9222/api/list`. Host-side tools resolve the installed Browser loopback port from its registry. No cookies, owner-proof headers or credentials are needed on the private loopback/app route; never expose MCP/CDP publicly. The owner-facing `/browser/api/list` route requires the existing owner-authenticated gateway, same-origin JSON for changes, and supports GET/POST plus PATCH/DELETE `/api/list/<id>` (`{"read":true}` / `{}`). Canonical addresses deduplicate; an existing item's dates/read state stay unchanged.

## Rules

- Only `http` and `https` URLs.
- The browser is not logged in to anything and keeps no cookies between calls. Do not type credentials into pages through it.
- Page text is capped at 100,000 characters.

## Other apps

Apps on the same box drive it with Puppeteer or Playwright at `http://browser:9222` over the Runtipi network (resolve the name to an IP first; Chrome only answers DevTools for an IP or localhost Host header). DeFleur Video renders motion graphics this way. The host itself sees DevTools on loopback only.
