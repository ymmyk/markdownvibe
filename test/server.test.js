import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import request from "supertest";
import { createApp } from "../src/server.js";

const themeDir = path.resolve("theme/default");

async function makeFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "markdownvibe-"));
  const contentRoot = path.join(root, "content");
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

  return {
    app: createApp({ contentRoot, themeDir }),
    contentRoot,
  };
}

test("extensionless routes generate and serve cached html", async () => {
  const { app, contentRoot } = await makeFixture();
  const response = await request(app).get("/alpha");

  assert.equal(response.status, 200);
  assert.match(response.headers["content-type"], /text\/html/);
  assert.match(response.text, /Alpha Brief/);
  assert.doesNotMatch(response.text, /<article class="prose"><h1/);

  const generated = await readFile(path.join(contentRoot, "alpha.html"), "utf8");
  assert.match(generated, /Contents/);
});

test("raw markdown requests pass through unchanged", async () => {
  const { app } = await makeFixture();
  const response = await request(app).get("/alpha.md");

  assert.equal(response.status, 200);
  assert.match(response.headers["content-type"], /text\/markdown/);
  assert.match(response.text, /^---/);
  assert.match(response.text, /## Findings/);
});

test("static files are served directly", async () => {
  const { app } = await makeFixture();
  const response = await request(app).get("/note.txt");

  assert.equal(response.status, 200);
  assert.equal(response.text, "passthrough");
});

test("directory routes resolve index markdown", async () => {
  const { app } = await makeFixture();
  const response = await request(app).get("/reports/");

  assert.equal(response.status, 200);
  assert.match(response.text, /Reports/);
  assert.match(response.text, /Weekly/);
});

test("exact folder matches render a generated directory index", async () => {
  const { app } = await makeFixture();
  const response = await request(app).get("/library");

  assert.equal(response.status, 200);
  assert.match(response.text, /Auto-generated directory index for \/library\//);
  assert.match(response.text, />Folders</);
  assert.match(response.text, />Pages</);
  assert.match(response.text, />Assets</);
  assert.match(response.text, /href="\/library\/archive\/"/);
  assert.match(response.text, /href="\/library\/research\.html"/);
  assert.match(response.text, /href="\/library\/research\.md"/);
  assert.match(response.text, /href="\/library\/sheet\.csv"/);
});

test("html requests can target an exact folder match", async () => {
  const { app } = await makeFixture();
  const response = await request(app).get("/library.html");

  assert.equal(response.status, 200);
  assert.match(response.text, /Auto-generated directory index for \/library\//);
  assert.match(response.text, /archive/);
});

test("exact folders win over sibling markdown files", async () => {
  const { app } = await makeFixture();
  const response = await request(app).get("/mixed");

  assert.equal(response.status, 200);
  assert.match(response.text, /Auto-generated directory index for \/mixed\//);
  assert.doesNotMatch(response.text, /This should lose to the folder match/);
  assert.match(response.text, /href="\/mixed\/child\.html"/);
});

test("html requests still reach markdown pages when a same-name folder exists", async () => {
  const { app } = await makeFixture();
  const response = await request(app).get("/mixed.html");

  assert.equal(response.status, 200);
  assert.match(response.text, /Standalone Mixed/);
  assert.doesNotMatch(response.text, /Auto-generated directory index for \/mixed\//);
});

test("html is regenerated when markdown changes", async () => {
  const { app, contentRoot } = await makeFixture();
  const htmlPath = path.join(contentRoot, "alpha.html");
  const markdownPath = path.join(contentRoot, "alpha.md");

  await request(app).get("/alpha");
  const initialStat = await stat(htmlPath);

  await new Promise((resolve) => setTimeout(resolve, 25));
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

  const response = await request(app).get("/alpha.html");
  const updatedStat = await stat(htmlPath);

  assert.equal(response.status, 200);
  assert.match(response.text, /The second version/);
  assert.ok(updatedStat.mtimeMs > initialStat.mtimeMs);
});
