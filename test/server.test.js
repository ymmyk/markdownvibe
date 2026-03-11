import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import {
  access,
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

  const generated = await readFile(path.join(outputRoot, "_site", "index.html"), "utf8");
  assert.match(generated, /Configured Paths/);
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
