# markdownvibe

`markdownvibe` is a small file-backed web service for AI-authored research docs. The bot writes Markdown. The service handles mounted content paths, extensionless routes, raw Markdown passthrough, and cached HTML generation under `output/`.

## Behavior

- `GET /mount/foo.md` returns the raw Markdown file from the configured source path.
- `GET /mount/foo.html` renders from `foo.md` if it exists, regenerating cached HTML in `output/` when needed.
- `GET /mount/foo` behaves like `GET /mount/foo.html`.
- Non-Markdown assets are served directly.
- Exact folder matches win over sibling `foo.md` documents on extensionless routes.
- Directory routes use `index.md` / `index.html`, or a generated folder index if neither exists.
- Cached HTML is refreshed when embedded `markdown-hash` or `theme-hash` metadata no longer matches the current source/render inputs.

## Run

```bash
npm install
npm start
```

Then open [http://localhost:5123](http://localhost:5123).

Minimal Caddy config:

```caddyfile
research.internal {
  reverse_proxy 127.0.0.1:5123
}
```

## Config

`markdownvibe` reads `config.yml`, `config.yaml`, or `config.json` from the repo root by default. `config.example.yml` is the committed sample; local config files are ignored. You can also point at another file with `MARKDOWNVIBE_CONFIG`.

If no config file is present, the server falls back to hard-coded defaults:

- port `5123`
- app name `markdownvibe`
- output dir `./output`
- theme dir `./theme/default`
- a root mount for `./content` when that folder exists

```yaml
port: 5123
app_name: markdownvibe
output_dir: ./output
theme_dir: ./theme/default
paths:
  - full_path: /full/path/my files
    web_path: my-files
```

- `port` defaults to `5123`.
- `app_name` defaults to `markdownvibe` and controls the top-right app label.
- `output_dir` defaults to `./output`.
- `theme_dir` defaults to `./theme/default`.
- `paths[].full_path` may be absolute or relative to the config file.
- `paths[].web_path` becomes the URL prefix. Use `""` or `/` to mount at the site root.

The default theme also includes an `Auto` / `Day` / `Night` switcher. On desktop it stays in the top-right bar; on mobile it moves into the top-right menu.

If you configure only non-root mounts, `/` shows an index of the published mount paths.

## Content And Output

Source content is read in place and left unchanged. Generated HTML is written under `output/`, mirroring mount names and document paths.

Generated HTML includes embedded `markdown-hash` and `theme-hash` metadata so cache validation is based on source/render fingerprints instead of filesystem mtimes.

- Example: `content/alpha.md` mounted at root becomes `output/_root/alpha.html`.
- Example: `/full/path/research` mounted at `my-files` writes cache files under `output/my-files/`.
- Static source files such as PDFs, CSVs, images, and existing `.html` files are still served directly from the source path.

## Theme contract

A theme directory should contain:

- `template.html`
- `theme.css`
- `theme.js`
- any other static assets the template references

Theme assets are served under `/_markdownvibe/`.
