# Obsidian vault support plan

**Goal:** “Webify your Obsidian vaults” — render vault Markdown with the extensions people actually use, without becoming a full Obsidian clone.

## Scope (ship)

| # | Feature | Behavior |
|---|---|---|
| 1 | **Properties** | YAML frontmatter as collapsible panel (default **closed**); typed chips for tags/lists; hide `title`/`summary`/`description` from rows; apply `cssclasses` to article |
| 2 | **Comments** | Strip `%%…%%` (inline + block) outside code |
| 3 | **Highlight** | `==text==` → `<mark>` |
| 4 | **Wikilinks** | `[[Note]]`, `[[Note\|alias]]`, `[[Note#Heading]]`, `[[Note#^block]]`, same-note `[[#H]]` |
| 5 | **Image embeds** | `![[img.png]]`, `![[img\|300]]` → `<img>` |
| 6 | **Callouts** | `> [!type]`, custom title, fold `-`/`+` via `<details>` |
| 7 | **Inline tags** | `#tag` / `#nested/tag` → styled chips (not inside code) |
| 8 | **Block IDs** | Trailing `^block-id` → element `id`, strip from visible text |
| 9 | **Note embeds** | `![[Note]]` / `![[Note#Section]]` inline, depth ≤ 2, cycle-safe |

## Out of scope (later)

- Dataview / Bases / Canvas / plugins
- Live graph / backlinks panel
- Full PDF page embeds, audio scrubbers
- Math (KaTeX) — easy follow-up if vaults need it

## Architecture

```
renderMarkdownDocument({ markdownPath, sourcePath, markdownSource, mount, resolveContext })
  → strip comments
  → gray-matter
  → markdown-it + Obsidian rules (wikilink, highlight, tags, callouts, blocks)
  → resolve wikilinks/embeds via vault index (cached per mount root)
  → properties model for template
```

**Vault index** (`src/vault-index.js`): recursive scan of mount; maps basename → paths, relative path → absolute. Prefer same-directory match, then unique basename, then shortest path.

**Link targets:** web paths under the mount (`/web/path/Note` style), fragments for headings/blocks. Missing notes → `class="wikilink is-unresolved"`.

## Files

- `src/vault-index.js` — index + resolve
- `src/obsidian.js` — preprocess, plugins, callout/embed helpers
- `src/markdown.js` — wire plugins + properties model
- `src/template.js` — collapsed properties HTML
- `src/server.js` — pass `mount` into renderer
- `theme/default/theme.css` — properties, callouts, marks, tags, embeds
- `test/server.test.js` — fixture vault coverage
- `README.md` — tagline + feature list

## Test plan (local vaults)

1. Mount a real vault under `paths` in `config.yml`
2. Spot-check: note with many properties, `[[links]]`, callouts, image embeds
3. Missing wikilink should render unresolved, not 500
4. Nested `![[Note]]` should not infinite-loop

## Implementation order

1. Properties collapse + cssclasses  
2. Comments / highlight / tags / block IDs  
3. Vault index + wikilinks + image embeds  
4. Callouts  
5. Note embeds  
6. Tests + README  
