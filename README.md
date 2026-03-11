# markdownvibe

`markdownvibe` is a small file-backed web service for AI-authored research docs. The bot writes Markdown. The service handles extensionless routes, raw Markdown passthrough, and cached HTML generation.

## Behavior

- `GET /foo.md` returns the raw Markdown file.
- `GET /foo.html` renders from `foo.md` if it exists, regenerating `foo.html` when needed.
- `GET /foo` behaves like `GET /foo.html`.
- Non-Markdown assets are served directly.
- Exact folder matches win over sibling `foo.md` documents on extensionless routes.
- Directory routes use `index.md` / `index.html`, or a generated folder index if neither exists.
- Cached HTML is refreshed when the Markdown source or active theme changes.

## Run

```bash
npm install
npm start
```

Then open [http://localhost:3000](http://localhost:3000).

For an intranet deployment behind Caddy, bind this service to localhost instead:

```bash
HOST=127.0.0.1 PORT=3000 npm start
```

Minimal Caddy config:

```caddyfile
research.internal {
  reverse_proxy 127.0.0.1:3000
}
```

## Content

By default, content lives in `content/` and the default theme lives in `theme/default/`.

- `MARKDOWNVIBE_CONTENT_DIR` overrides the content root.
- `MARKDOWNVIBE_THEME_DIR` overrides the theme directory.
- `PORT` and `HOST` control the listener.

## Theme contract

A theme directory should contain:

- `template.html`
- `theme.css`
- `theme.js`
- any other static assets the template references

Theme assets are served under `/_markdownvibe/`.
