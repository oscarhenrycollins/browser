# Browser

Read public web pages inside Wizard. A separate, disposable Reader context renders each page on the server; source scripts never run in the Wizard shell. The same app keeps its private DevTools/Puppeteer endpoint for agent web tasks.

The Reader is Phase 1. Live handover and original site designs are not included. Use **Open in your browser** for those pages. See [Reader design and release gates](docs/reader.md).

A [Wizard app](https://www.aiwizards.com/wizard-apps): install it from the Wizard Apps screen, or with the Wizard App Manager on any box running stock [Runtipi](https://runtipi.io).

- `wizard.md`: what the app is and what it gives the agent (spec: wizard.md v0.2).
- `runtipi/`: stock Runtipi `config.json` and `docker-compose.yml`.
- `mcp/`: the app's MCP front (`front.py` + `tools.py`), inlined into the compose file by `python3 mcp/inline.py`. It serves private `/mcp` and CDP interfaces and proxies only explicitly allowed Reader paths to `reader/`.
- `SKILL.md`: the skill the agent loads when this app is installed.
- `.github/workflows/publish.yml`: every push to `main` re-publishes to the index at apps.aiwizards.com.

