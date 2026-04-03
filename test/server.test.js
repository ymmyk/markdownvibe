import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import {
  access,
  copyFile,
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import request from "supertest";
import { loadConfig } from "../src/config.js";
import { createApp } from "../src/server.js";

const themeDir = path.resolve("theme/default");

function extractMetaValue(html, name) {
  const match = html.match(
    new RegExp(`<meta[^>]+name=["']${name}["'][^>]+content=["']([^"']+)["']`, "i"),
  );
  return match?.[1] ?? null;
}

async function makeFixture(overrides = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "markdownvibe-"));
  const contentRoot = path.join(root, "content");
  const outputRoot = path.join(root, "output");
  await mkdir(contentRoot, { recursive: true });

  await writeFile(
    path.join(contentRoot, "alpha.md"),
    `---
title: Alpha Brief
status: active
---

# Alpha Brief

## Findings

The first version.
`,
    "utf8",
  );

  await mkdir(path.join(contentRoot, "reports"), { recursive: true });
  await writeFile(
    path.join(contentRoot, "reports", "index.md"),
    "# Reports\n\n## Weekly\n\nNested index.\n",
    "utf8",
  );

  await mkdir(path.join(contentRoot, "library", "archive"), { recursive: true });
  await writeFile(
    path.join(contentRoot, "library", "research.md"),
    "# Research\n\n## Notes\n\nFolder page.\n",
    "utf8",
  );
  await writeFile(path.join(contentRoot, "library", "sheet.csv"), "ticker,score\nABC,9\n", "utf8");

  await writeFile(
    path.join(contentRoot, "mixed.md"),
    "# Standalone Mixed\n\nThis should lose to the folder match.\n",
    "utf8",
  );
  await mkdir(path.join(contentRoot, "mixed"), { recursive: true });
  await writeFile(path.join(contentRoot, "mixed", "child.md"), "# Child\n\nFolder wins.\n", "utf8");

  await writeFile(path.join(contentRoot, "note.txt"), "passthrough", "utf8");
  await copyFile(path.resolve("content/screenshot.png"), path.join(contentRoot, "screenshot.png"));
  await writeFile(
    path.join(contentRoot, "title-source.md"),
    `---
title: Metadata Title
---

# Document Heading

## Notes

The browser title should use the H1.
`,
    "utf8",
  );
  await writeFile(
    path.join(contentRoot, "table-demo.md"),
    `# Table Demo

| Column A | Column B | Column C |
| --- | --- | --- |
| one | two | three |
| alpha | beta | gamma |
`,
    "utf8",
  );
  await writeFile(
    path.join(contentRoot, "tasks.md"),
    `---
title: Checklist
owner: ops
---

# Checklist

- [ ] Ship **draft**
- [x] Review results
`,
    "utf8",
  );

  return {
    app: createApp({
      appName: overrides.appName,
      themeDir,
      outputRoot,
      mounts: [{ full_path: contentRoot, web_path: "docs" }],
    }),
    contentRoot,
    outputRoot,
    root,
  };
}

test("extensionless routes generate and serve cached html under output", async () => {
  const { app, contentRoot, outputRoot } = await makeFixture();
  const response = await request(app).get("/docs/alpha");

  assert.equal(response.status, 200);
  assert.match(response.headers["content-type"], /text\/html/);
  assert.match(response.text, /Alpha Brief/);
  assert.doesNotMatch(response.text, /<article class="prose"><h1/);

  const generated = await readFile(path.join(outputRoot, "docs", "alpha.html"), "utf8");
  assert.match(generated, /Contents/);
  assert.ok(extractMetaValue(generated, "markdown-hash"));
  assert.ok(extractMetaValue(generated, "theme-hash"));
  await assert.rejects(access(path.join(contentRoot, "alpha.html")));
});

test("rendered pages use the configured app name and place the toc before the document", async () => {
  const { app } = await makeFixture({ appName: "Research Desk" });
  const response = await request(app).get("/docs/alpha");

  assert.equal(response.status, 200);
  assert.match(response.text, />Research Desk<\/a>/);
  assert.ok(response.text.indexOf('class="toc-toggle"') < response.text.indexOf('class="brand"'));
  assert.ok(response.text.indexOf('class="brand"') < response.text.indexOf('class="theme-switcher theme-switcher-desktop"'));
  assert.match(response.text, /data-theme-choice="auto"[\s\S]*<svg/);
  assert.match(response.text, /data-theme-choice="day"[\s\S]*<svg/);
  assert.match(response.text, /data-theme-choice="night"[\s\S]*<svg/);
  assert.ok(response.text.indexOf('class="toc-panel"') < response.text.indexOf('class="document"'));
});

test("raw markdown requests pass through unchanged from mounted paths", async () => {
  const { app } = await makeFixture();
  const response = await request(app).get("/docs/alpha.md");

  assert.equal(response.status, 200);
  assert.match(response.headers["content-type"], /text\/markdown/);
  assert.match(response.text, /^---/);
  assert.match(response.text, /## Findings/);
});

test("markdown task lists render as checkable inputs tied to the source path", async () => {
  const { app } = await makeFixture();
  const response = await request(app).get("/docs/tasks");

  assert.equal(response.status, 200);
  assert.match(response.text, /data-source-path="\/docs\/tasks\.md"/);
  assert.match(response.text, /class="task-list-item"/);
  assert.match(response.text, /data-task-checkbox/);
  assert.match(response.text, /data-task-index="0"/);
  assert.match(response.text, /data-task-index="1"/);
  assert.match(response.text, /data-task-index="1"[\s\S]*checked/);
  assert.match(response.text, /task-list-text">Ship <strong>draft<\/strong>/);
  assert.doesNotMatch(response.text, /\[ \] Ship/);
});

test("task toggle endpoint updates only the checklist marker in source markdown", async () => {
  const { app, contentRoot } = await makeFixture();
  const initialResponse = await request(app).get("/docs/tasks");
  const initialHash = extractMetaValue(initialResponse.text, "markdown-hash");

  const toggleResponse = await request(app)
    .post("/__markdownvibe/tasks/toggle")
    .send({
      sourcePath: "/docs/tasks.md",
      taskIndex: 0,
      checked: true,
      markdownHash: initialHash,
    });

  assert.equal(toggleResponse.status, 200);
  assert.ok(toggleResponse.body.markdownHash);

  const updatedMarkdown = await readFile(path.join(contentRoot, "tasks.md"), "utf8");
  assert.equal(
    updatedMarkdown,
    `---
title: Checklist
owner: ops
---

# Checklist

- [x] Ship **draft**
- [x] Review results
`,
  );

  const renderedResponse = await request(app).get("/docs/tasks");
  assert.equal(renderedResponse.status, 200);
  assert.match(renderedResponse.text, /data-task-index="0"[\s\S]*checked/);
});

test("stale cached task-list html is regenerated even when hashes still match", async () => {
  const { app, outputRoot } = await makeFixture();
  const htmlPath = path.join(outputRoot, "docs", "tasks.html");

  const initialResponse = await request(app).get("/docs/tasks");
  assert.equal(initialResponse.status, 200);

  const generated = await readFile(htmlPath, "utf8");
  const staleHtml = generated
    .replace(
      /<li class="task-list-item" data-task-index="0">[\s\S]*?<\/li>/,
      "<li>[ ] Ship <strong>draft</strong></li>",
    )
    .replace(
      /<li class="task-list-item" data-task-index="1">[\s\S]*?<\/li>/,
      "<li>[x] Review results</li>",
    );
  await writeFile(htmlPath, staleHtml, "utf8");

  const refreshedResponse = await request(app).get("/docs/tasks");
  assert.equal(refreshedResponse.status, 200);
  assert.match(refreshedResponse.text, /data-task-checkbox/);
  assert.doesNotMatch(refreshedResponse.text, /<li>\[ \] Ship <strong>draft<\/strong><\/li>/);
});

test("stale embedded theme hashes force html regeneration", async () => {
  const { app, outputRoot } = await makeFixture();
  const htmlPath = path.join(outputRoot, "docs", "alpha.html");

  await request(app).get("/docs/alpha");
  const generated = await readFile(htmlPath, "utf8");
  const originalThemeHash = extractMetaValue(generated, "theme-hash");
  assert.ok(originalThemeHash);

  await writeFile(
    htmlPath,
    generated
      .replace(originalThemeHash, "stale-theme-hash")
      .replace("The first version.", "Stale cached content."),
    "utf8",
  );

  const response = await request(app).get("/docs/alpha.html");
  const regenerated = await readFile(htmlPath, "utf8");

  assert.equal(response.status, 200);
  assert.match(response.text, /The first version/);
  assert.doesNotMatch(response.text, /Stale cached content/);
  assert.equal(extractMetaValue(regenerated, "theme-hash"), originalThemeHash);
});

test("static files are served directly from the source mount", async () => {
  const { app } = await makeFixture();
  const response = await request(app).get("/docs/note.txt");

  assert.equal(response.status, 200);
  assert.equal(response.text, "passthrough");
});

test("image assets from the content tree are served directly", async () => {
  const { app } = await makeFixture();
  const response = await request(app).get("/docs/screenshot.png");

  assert.equal(response.status, 200);
  assert.match(response.headers["content-type"], /image\/png/);
  assert.ok(response.body.length > 0);
});

test("directory routes resolve index markdown and cache in output", async () => {
  const { app, outputRoot } = await makeFixture();
  const response = await request(app).get("/docs/reports/");

  assert.equal(response.status, 200);
  assert.match(response.text, /Reports/);
  assert.match(response.text, /Weekly/);

  const generated = await readFile(path.join(outputRoot, "docs", "reports", "index.html"), "utf8");
  assert.match(generated, /Reports/);
});

test("exact folder matches render a generated directory index", async () => {
  const { app, outputRoot } = await makeFixture();
  const response = await request(app).get("/docs/library");

  assert.equal(response.status, 200);
  assert.match(response.text, /Auto-generated directory index for \/docs\/library\//);
  assert.match(response.text, />Folders</);
  assert.match(response.text, />Pages</);
  assert.match(response.text, />Assets</);
  assert.match(response.text, /href="\/docs\/">..<\/a>/);
  assert.match(response.text, /href="\/docs\/library\/archive\/"/);
  assert.match(response.text, /href="\/docs\/library\/research\.html"/);
  assert.match(response.text, /href="\/docs\/library\/research\.md"/);
  assert.match(response.text, /href="\/docs\/library\/sheet\.csv"/);

  const generated = await readFile(path.join(outputRoot, "docs", "library", "index.html"), "utf8");
  assert.match(generated, /Auto-generated directory index/);
});

test("mount root auto indexes include a parent link to the site root", async () => {
  const { app } = await makeFixture();
  const response = await request(app).get("/docs");

  assert.equal(response.status, 200);
  assert.match(response.text, /Auto-generated directory index for \/docs\//);
  assert.match(response.text, /href="\/">..<\/a>/);
});

test("root auto indexes expose configured sibling mounts", async () => {
  const { contentRoot, outputRoot } = await makeFixture();
  const app = createApp({
    themeDir,
    outputRoot,
    mounts: [
      { full_path: contentRoot, web_path: "" },
      { full_path: contentRoot, web_path: "docs" },
      { full_path: contentRoot, web_path: "notes" },
    ],
  });
  const response = await request(app).get("/");

  assert.equal(response.status, 200);
  assert.match(response.text, /Auto-generated directory index for \//);
  assert.match(response.text, />Configured Paths</);
  assert.match(response.text, /href="\/docs">\/docs<\/a>/);
  assert.match(response.text, /href="\/notes">\/notes<\/a>/);
});

test("html requests can target an exact folder match", async () => {
  const { app } = await makeFixture();
  const response = await request(app).get("/docs/library.html");

  assert.equal(response.status, 200);
  assert.match(response.text, /Auto-generated directory index for \/docs\/library\//);
  assert.match(response.text, /archive/);
});

test("exact folders win over sibling markdown files", async () => {
  const { app } = await makeFixture();
  const response = await request(app).get("/docs/mixed");

  assert.equal(response.status, 200);
  assert.match(response.text, /Auto-generated directory index for \/docs\/mixed\//);
  assert.doesNotMatch(response.text, /This should lose to the folder match/);
  assert.match(response.text, /href="\/docs\/mixed\/child\.html"/);
});

test("html requests still reach markdown pages when a same-name folder exists", async () => {
  const { app } = await makeFixture();
  const response = await request(app).get("/docs/mixed.html");

  assert.equal(response.status, 200);
  assert.match(response.text, /Standalone Mixed/);
  assert.doesNotMatch(response.text, /Auto-generated directory index for \/docs\/mixed\//);
});

test("root mount index is rendered when no root path is mounted", async () => {
  const { app, outputRoot } = await makeFixture();
  const response = await request(app).get("/");

  assert.equal(response.status, 200);
  assert.match(response.text, /Published Content/);
  assert.match(response.text, /href="\/docs"/);
  assert.match(response.text, /Directories In \/docs/);
  assert.match(response.text, /href="\/docs\/reports\/"/);
  assert.match(response.text, /href="\/docs\/library\/"/);
  assert.match(response.text, /href="\/docs\/library\/archive\/"/);
  assert.match(response.text, /href="\/docs\/mixed\/"/);

  const generated = await readFile(path.join(outputRoot, "_site", "index.html"), "utf8");
  assert.match(generated, /Configured Paths/);
  assert.match(generated, /Directories In \/docs/);
});

test("yaml config files define port, output root, and mounted paths", async () => {
  const { root, contentRoot } = await makeFixture();
  const configPath = path.join(root, "config.yml");
  await writeFile(
    configPath,
    `port: 5123
app_name: Research Desk
output_dir: ./cache
theme_dir: ${themeDir}
paths:
  - full_path: ${contentRoot}
    web_path: my-files
`,
    "utf8",
  );

  const config = loadConfig({ configPath });

  assert.equal(config.port, 5123);
  assert.equal(config.appName, "Research Desk");
  assert.equal(config.mounts[0].webPath, "/my-files");
  assert.equal(config.outputRoot, path.join(root, "cache"));
});

test("html is regenerated when markdown changes without touching the source tree", async () => {
  const { app, contentRoot, outputRoot } = await makeFixture();
  const htmlPath = path.join(outputRoot, "docs", "alpha.html");
  const markdownPath = path.join(contentRoot, "alpha.md");

  await request(app).get("/docs/alpha");
  const initialHtml = await readFile(htmlPath, "utf8");
  const initialMarkdownHash = extractMetaValue(initialHtml, "markdown-hash");

  await writeFile(
    markdownPath,
    `---
title: Alpha Brief
status: updated
---

# Alpha Brief

## Findings

The second version.
`,
    "utf8",
  );

  const response = await request(app).get("/docs/alpha.html");
  const updatedHtml = await readFile(htmlPath, "utf8");
  const updatedMarkdownHash = extractMetaValue(updatedHtml, "markdown-hash");

  assert.equal(response.status, 200);
  assert.match(response.text, /The second version/);
  assert.notEqual(updatedMarkdownHash, initialMarkdownHash);
  await assert.rejects(access(path.join(contentRoot, "alpha.html")));
});

test("html title follows the first document h1 when present", async () => {
  const { app } = await makeFixture();
  const response = await request(app).get("/docs/title-source");

  assert.equal(response.status, 200);
  assert.match(response.text, /<title>Document Heading<\/title>/);
  assert.match(response.text, /<h1>Metadata Title<\/h1>/);
});

test("markdown tables render inside their own horizontal scroll container", async () => {
  const { app } = await makeFixture();
  const response = await request(app).get("/docs/table-demo");

  assert.equal(response.status, 200);
  assert.match(response.text, /<div class="table-scroll"><table>/);
  assert.match(response.text, /<th>Column A<\/th>/);
});

test("highlight theme uses shared variables so day and night mode stay legible", async () => {
  const [highlightCss, themeCss] = await Promise.all([
    readFile(path.join(themeDir, "highlight.css"), "utf8"),
    readFile(path.join(themeDir, "theme.css"), "utf8"),
  ]);

  assert.match(highlightCss, /color:\s*var\(--hljs-plain\)/);
  assert.match(highlightCss, /color:\s*var\(--hljs-comment\)/);
  assert.match(themeCss, /--hljs-plain:/);
  assert.match(themeCss, /:root\[data-resolved-theme="night"\]/);
});

test("desktop theme uses a full-width split layout with text-only measure", async () => {
  const themeCss = await readFile(path.join(themeDir, "theme.css"), "utf8");

  assert.match(themeCss, /--sidebar-width:/);
  assert.match(themeCss, /--content-measure:/);
  assert.match(themeCss, /grid-template-columns:\s*var\(--sidebar-width\) minmax\(0, 1fr\)/);
  assert.match(themeCss, /\.document > :is\(\.eyebrow, h1, \.deck, \.meta-strip\),/);
  assert.match(themeCss, /\.prose > :not\(pre\):not\(table\):not\(\.table-scroll\)/);
  assert.match(themeCss, /\.table-scroll\s*\{/);
  assert.match(themeCss, /\.document\s*\{[^}]*overflow-x:\s*hidden;/s);
  assert.match(themeCss, /\.prose th,\s*\.prose td\s*\{[^}]*overflow-wrap:\s*anywhere;/s);
  assert.match(themeCss, /\.prose th code,\s*\.prose td code\s*\{[^}]*white-space:\s*normal;/s);
});
