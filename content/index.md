---
title: OpenClaw Research Hub
summary: Markdown-authored research pages with on-demand HTML generation, responsive navigation, and cached output.
owner: OpenClaw
status: Draft theme
date: 2026-03-11
---

# OpenClaw Research Hub

This repo is set up so the bot can write **Markdown only** while the service handles HTML generation when someone requests a page.

## Request Flow

1. Non-Markdown assets are served directly.
2. Requests for `*.md` return the raw Markdown file.
3. Requests for `*.html` or extensionless paths look for a matching Markdown file.
4. If the Markdown is newer than the cached HTML, or the theme changed, the HTML is regenerated.

## Example Sections

### Market Scan

- Pull primary-source notes into Markdown files.
- Keep front matter for status, owner, and date.
- Let the server render a sidebar from headings automatically.

### Competitor Dossier

| Company | Focus | Notes |
| --- | --- | --- |
| Acme | Workflow AI | Markdown stays small for the model. |
| Beacon | Knowledge tools | HTML is cached on demand. |

### Sample Code

```js
export function ideaScore(signal, conviction) {
  return signal * conviction;
}
```

## Next Step

Create more files under `content/` and request them as `/path`, `/path.html`, or `/path.md`.
