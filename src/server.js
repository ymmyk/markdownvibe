import express from "express";
import { constants as fsConstants } from "node:fs";
import {
  access,
  mkdir,
  readFile,
  readdir,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.js";
import { renderMarkdownDocument } from "./markdown.js";
import { renderPage } from "./template.js";

const rendererDependencyPaths = [
  fileURLToPath(new URL(import.meta.url)),
  fileURLToPath(new URL("./markdown.js", import.meta.url)),
  fileURLToPath(new URL("./template.js", import.meta.url)),
];

function ensureInsideRoot(root, targetPath) {
  const relative = path.relative(root, targetPath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function statPath(targetPath) {
  try {
    return await stat(targetPath);
  } catch {
    return null;
  }
}

async function fileExists(targetPath) {
  try {
    await access(targetPath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function maxMtimeMs(targetPath) {
  const targetStat = await stat(targetPath);
  let latest = targetStat.mtimeMs;

  if (!targetStat.isDirectory()) {
    return latest;
  }

  const entries = await readdir(targetPath, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(targetPath, entry.name);
    latest = Math.max(latest, await maxMtimeMs(entryPath));
  }

  return latest;
}

async function maxFileMtimeMs(paths) {
  const stats = await Promise.all(paths.map((targetPath) => stat(targetPath)));
  return Math.max(...stats.map((entry) => entry.mtimeMs));
}

function decodeRequestPath(requestPath) {
  const decoded = decodeURIComponent(requestPath);
  if (decoded.includes("\0")) {
    const error = new Error("Invalid path");
    error.statusCode = 400;
    throw error;
  }

  return decoded;
}

function normalizeRequestPath(requestPath) {
  const normalized = path.posix.normalize(decodeRequestPath(requestPath));
  return normalized.startsWith("/") ? normalized : `/${normalized}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function joinMountedWebPath(mount, relativePath = "") {
  const cleaned = String(relativePath).replace(/^\/+/, "");
  if (mount.webPath === "/") {
    return cleaned ? `/${cleaned}` : "/";
  }

  return cleaned ? `${mount.webPath}/${cleaned}` : mount.webPath;
}

function buildChildRequestPath(basePath, childName, { trailingSlash = false } = {}) {
  const normalizedBase =
    basePath === "/" ? "/" : basePath.endsWith("/") ? basePath : `${basePath}/`;
  const href = `${normalizedBase}${encodeURIComponent(childName)}`;
  return trailingSlash ? `${href}/` : href;
}

function renderIndexToc(sections) {
  if (sections.length === 0) {
    return '<p class="toc-empty">No sections yet.</p>';
  }

  const items = sections
    .map(
      (section) => `
        <li class="toc-item level-2">
          <a href="#${section.id}" data-toc-link>${escapeHtml(section.title)}</a>
        </li>`,
    )
    .join("");

  return `<ul class="toc-list">${items}</ul>`;
}

function renderIndexSection(section) {
  const items = section.items
    .map(
      (item) => `
        <article class="index-card">
          <div class="index-card-top">
            <a class="index-primary" href="${item.href}">${escapeHtml(item.label)}</a>
            <span class="index-kind">${escapeHtml(item.kind)}</span>
          </div>
          <p class="index-meta">${escapeHtml(item.detail)}</p>
          ${
            item.rawHref
              ? `<a class="index-secondary" href="${item.rawHref}">Raw Markdown</a>`
              : ""
          }
        </article>`,
    )
    .join("");

  return `
    <section class="index-section">
      <h2 id="${section.id}">${escapeHtml(section.title)}</h2>
      <div class="index-grid">
        ${items}
      </div>
    </section>`;
}

async function renderIndexPage({
  themeDir,
  assetPrefix,
  title,
  summary,
  sourcePath,
  metadata,
  sections,
}) {
  const bodyHtml =
    sections.length === 0
      ? "<p>Nothing is published here yet.</p>"
      : sections.map((section) => renderIndexSection(section)).join("");

  return renderPage({
    themeDir,
    assetPrefix,
    document: {
      title,
      summary,
      metadata,
      tocHtml: renderIndexToc(sections),
      bodyHtml,
      sourcePath,
      escapeHtml,
    },
  });
}

async function renderDirectoryIndex({ directoryPath, mountedPath, themeDir, assetPrefix }) {
  const normalizedMountedPath =
    mountedPath === "/" ? "/" : mountedPath.endsWith("/") ? mountedPath : `${mountedPath}/`;
  const entries = (await readdir(directoryPath, { withFileTypes: true }))
    .filter((entry) => !entry.name.startsWith("."))
    .sort((left, right) =>
      left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" }),
    );
  const entryNames = new Set(entries.map((entry) => entry.name));
  const folders = [];
  const pages = [];
  const assets = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      folders.push({
        label: `${entry.name}/`,
        kind: "Folder",
        href: buildChildRequestPath(normalizedMountedPath, entry.name, { trailingSlash: true }),
        detail: "Open folder index",
      });
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const extension = path.extname(entry.name).toLowerCase();
    if (extension === ".md") {
      if (entry.name === "index.md") {
        continue;
      }

      const baseName = path.basename(entry.name, ".md");
      pages.push({
        label: baseName,
        kind: "Page",
        href: buildChildRequestPath(normalizedMountedPath, `${baseName}.html`),
        rawHref: buildChildRequestPath(normalizedMountedPath, entry.name),
        detail: `Rendered from ${entry.name}`,
      });
      continue;
    }

    if (extension === ".html" && entryNames.has(`${path.basename(entry.name, ".html")}.md`)) {
      continue;
    }

    assets.push({
      label: entry.name,
      kind: extension ? extension.slice(1).toUpperCase() : "File",
      href: buildChildRequestPath(normalizedMountedPath, entry.name),
      detail: "Direct asset passthrough",
    });
  }

  const sections = [
    { id: "folders", title: "Folders", items: folders },
    { id: "pages", title: "Pages", items: pages },
    { id: "assets", title: "Assets", items: assets },
  ].filter((section) => section.items.length > 0);

  return renderIndexPage({
    themeDir,
    assetPrefix,
    title:
      normalizedMountedPath === "/"
        ? "Content Index"
        : path.posix.basename(normalizedMountedPath.slice(0, -1)),
    summary: `Auto-generated directory index for ${normalizedMountedPath}`,
    sourcePath: normalizedMountedPath,
    metadata: [
      { label: "Mode", value: "Auto index" },
      { label: "Folders", value: String(folders.length) },
      { label: "Pages", value: String(pages.length) },
      { label: "Assets", value: String(assets.length) },
    ],
    sections,
  });
}

async function renderMountIndex({ mounts, themeDir, assetPrefix }) {
  const sections = [
    {
      id: "paths",
      title: "Configured Paths",
      items: mounts.map((mount) => ({
        label: mount.webPath === "/" ? "root" : mount.webPath,
        kind: "Mount",
        href: mount.webPath,
        detail: mount.fullPath,
      })),
    },
  ].filter((section) => section.items.length > 0);

  return renderIndexPage({
    themeDir,
    assetPrefix,
    title: "Published Content",
    summary: "Configured source paths available through markdownvibe.",
    sourcePath: "/",
    metadata: [{ label: "Mounts", value: String(mounts.length) }],
    sections,
  });
}

function resolveSourceFsPath(sourceRoot, requestPath) {
  const normalized = normalizeRequestPath(requestPath);
  const withDotPrefix = normalized === "/" ? "." : `.${normalized}`;
  const resolved = path.resolve(sourceRoot, withDotPrefix);

  if (!ensureInsideRoot(sourceRoot, resolved)) {
    const error = new Error("Not found");
    error.statusCode = 404;
    throw error;
  }

  return resolved;
}

function buildMarkdownCandidates(sourceRoot, requestPath) {
  const fsPath = resolveSourceFsPath(sourceRoot, requestPath);
  const extension = path.extname(fsPath).toLowerCase();

  if (requestPath.endsWith("/")) {
    return [{ markdownPath: path.join(fsPath, "index.md") }];
  }

  if (extension === ".html") {
    return [{ markdownPath: `${fsPath.slice(0, -".html".length)}.md` }];
  }

  return [
    { markdownPath: `${fsPath}.md` },
    { markdownPath: path.join(fsPath, "index.md") },
  ];
}

function buildMarkdownOutputPath(outputRoot, mount, markdownPath) {
  const relativePath = path.relative(mount.fullPath, markdownPath).replace(/\\/g, "/");
  const outputRelativePath = relativePath.replace(/\.md$/i, ".html");
  return path.join(outputRoot, mount.cacheKey, outputRelativePath);
}

function buildDirectoryOutputPath(outputRoot, mount, directoryPath) {
  const relativePath = path.relative(mount.fullPath, directoryPath);
  return relativePath
    ? path.join(outputRoot, mount.cacheKey, relativePath, "index.html")
    : path.join(outputRoot, mount.cacheKey, "index.html");
}

function buildSiteIndexOutputPath(outputRoot) {
  return path.join(outputRoot, "_site", "index.html");
}

async function writeAtomically(targetPath, contents) {
  const tempPath = `${targetPath}.tmp-${process.pid}-${Date.now()}`;
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(tempPath, contents, "utf8");
  await rename(tempPath, targetPath);
}

async function getRendererFreshness(themeDir, extraPaths = []) {
  const values = await Promise.all([
    maxMtimeMs(themeDir),
    maxFileMtimeMs([...rendererDependencyPaths, ...extraPaths]),
  ]);

  return Math.max(...values);
}

async function generateMarkdownHtmlIfNeeded({
  markdownPath,
  htmlPath,
  mount,
  themeDir,
  assetPrefix,
}) {
  const [markdownStat, htmlStat, freshness] = await Promise.all([
    statPath(markdownPath),
    statPath(htmlPath),
    getRendererFreshness(themeDir),
  ]);

  if (!markdownStat?.isFile()) {
    return null;
  }

  const shouldRender =
    !htmlStat?.isFile() ||
    markdownStat.mtimeMs > htmlStat.mtimeMs ||
    freshness > htmlStat.mtimeMs;

  if (shouldRender) {
    const relativeSourcePath = path.relative(mount.fullPath, markdownPath).replace(/\\/g, "/");
    const document = await renderMarkdownDocument({
      markdownPath,
      sourcePath: joinMountedWebPath(mount, relativeSourcePath),
    });
    const html = await renderPage({ themeDir, assetPrefix, document });
    await writeAtomically(htmlPath, html);
  }

  return htmlPath;
}

async function generateDirectoryIndexIfNeeded({
  directoryPath,
  htmlPath,
  mountedPath,
  config,
}) {
  const [directoryStat, htmlStat, freshness] = await Promise.all([
    maxMtimeMs(directoryPath),
    statPath(htmlPath),
    getRendererFreshness(config.themeDir),
  ]);

  const shouldRender =
    !htmlStat?.isFile() || directoryStat > htmlStat.mtimeMs || freshness > htmlStat.mtimeMs;

  if (shouldRender) {
    const html = await renderDirectoryIndex({
      directoryPath,
      mountedPath,
      themeDir: config.themeDir,
      assetPrefix: config.assetPrefix,
    });
    await writeAtomically(htmlPath, html);
  }

  return htmlPath;
}

async function generateMountIndexIfNeeded(config) {
  const htmlPath = buildSiteIndexOutputPath(config.outputRoot);
  const configFreshness = config.configPath ? await maxMtimeMs(config.configPath) : 0;
  const htmlStat = await statPath(htmlPath);
  const freshness = await getRendererFreshness(config.themeDir, config.configPath ? [config.configPath] : []);
  const shouldRender =
    !htmlStat?.isFile() ||
    configFreshness > htmlStat.mtimeMs ||
    freshness > htmlStat.mtimeMs;

  if (shouldRender) {
    const html = await renderMountIndex({
      mounts: config.mounts,
      themeDir: config.themeDir,
      assetPrefix: config.assetPrefix,
    });
    await writeAtomically(htmlPath, html);
  }

  return htmlPath;
}

async function serveRawMarkdown(res, markdownPath) {
  const markdown = await readFile(markdownPath, "utf8");
  res.type("text/markdown; charset=utf-8");
  res.send(markdown);
}

async function sendDirectoryResponse({ directoryPath, requestPath, mount, res, config }) {
  const indexMarkdownPath = path.join(directoryPath, "index.md");
  const indexHtmlSourcePath = path.join(directoryPath, "index.html");

  if (await fileExists(indexMarkdownPath)) {
    const htmlPath = buildMarkdownOutputPath(config.outputRoot, mount, indexMarkdownPath);
    const renderedHtmlPath = await generateMarkdownHtmlIfNeeded({
      markdownPath: indexMarkdownPath,
      htmlPath,
      mount,
      themeDir: config.themeDir,
      assetPrefix: config.assetPrefix,
    });
    return res.sendFile(renderedHtmlPath);
  }

  if (await fileExists(indexHtmlSourcePath)) {
    return res.sendFile(indexHtmlSourcePath);
  }

  const htmlPath = buildDirectoryOutputPath(config.outputRoot, mount, directoryPath);
  const mountedPath = joinMountedWebPath(
    mount,
    path.relative(mount.fullPath, directoryPath).replace(/\\/g, "/"),
  );
  const renderedHtmlPath = await generateDirectoryIndexIfNeeded({
    directoryPath,
    htmlPath,
    mountedPath: requestPath === "/" ? mountedPath : requestPath,
    config,
  });
  return res.sendFile(renderedHtmlPath);
}

function matchMount(mounts, requestPath) {
  const normalized = normalizeRequestPath(requestPath);

  for (const mount of mounts) {
    if (mount.webPath === "/") {
      return { mount, relativeRequestPath: normalized };
    }

    if (normalized === mount.webPath || normalized === `${mount.webPath}.html`) {
      return { mount, relativeRequestPath: "/" };
    }

    if (normalized.startsWith(`${mount.webPath}/`)) {
      return {
        mount,
        relativeRequestPath: normalized.slice(mount.webPath.length) || "/",
      };
    }
  }

  return null;
}

async function handleMountedRequest({ req, res, config, mount, relativeRequestPath }) {
  const fsPath = resolveSourceFsPath(mount.fullPath, relativeRequestPath);
  const extension = path.extname(fsPath).toLowerCase();
  const exactStat = await statPath(fsPath);

  if (extension && extension !== ".html" && extension !== ".md" && exactStat?.isFile()) {
    return res.sendFile(fsPath);
  }

  if (extension === ".md") {
    if (exactStat?.isFile()) {
      await serveRawMarkdown(res, fsPath);
      return;
    }

    res.status(404).send("Markdown file not found.");
    return;
  }

  if (extension === ".html") {
    const markdownCandidate = buildMarkdownCandidates(mount.fullPath, relativeRequestPath)[0];
    const markdownExists = await fileExists(markdownCandidate.markdownPath);

    if (!markdownExists && exactStat?.isFile()) {
      return res.sendFile(fsPath);
    }

    if (markdownExists) {
      const htmlPath = buildMarkdownOutputPath(
        config.outputRoot,
        mount,
        markdownCandidate.markdownPath,
      );
      const renderedHtmlPath = await generateMarkdownHtmlIfNeeded({
        markdownPath: markdownCandidate.markdownPath,
        htmlPath,
        mount,
        themeDir: config.themeDir,
        assetPrefix: config.assetPrefix,
      });

      if (renderedHtmlPath) {
        return res.sendFile(renderedHtmlPath);
      }
    }

    const directoryPath = fsPath.slice(0, -".html".length);
    const directoryStat = await statPath(directoryPath);
    if (directoryStat?.isDirectory()) {
      return sendDirectoryResponse({
        directoryPath,
        requestPath: joinMountedWebPath(
          mount,
          relativeRequestPath.slice(0, -".html".length).replace(/^\/+/, ""),
        ),
        mount,
        res,
        config,
      });
    }

    res.status(404).send("Document not found.");
    return;
  }

  if (exactStat?.isFile()) {
    const markdownSiblingPath = `${fsPath}.md`;
    if (!(await fileExists(markdownSiblingPath))) {
      return res.sendFile(fsPath);
    }
  }

  if (exactStat?.isDirectory()) {
    return sendDirectoryResponse({
      directoryPath: fsPath,
      requestPath: joinMountedWebPath(mount, relativeRequestPath.replace(/^\/+/, "")),
      mount,
      res,
      config,
    });
  }

  const candidates = buildMarkdownCandidates(mount.fullPath, relativeRequestPath);
  for (const candidate of candidates) {
    const htmlPath = buildMarkdownOutputPath(config.outputRoot, mount, candidate.markdownPath);
    const renderedHtmlPath = await generateMarkdownHtmlIfNeeded({
      markdownPath: candidate.markdownPath,
      htmlPath,
      mount,
      themeDir: config.themeDir,
      assetPrefix: config.assetPrefix,
    });

    if (renderedHtmlPath) {
      return res.sendFile(renderedHtmlPath);
    }
  }

  res.status(404).send("Document not found.");
}

export function createApp(overrides = {}) {
  const config = loadConfig(overrides);
  const app = express();

  app.disable("x-powered-by");
  app.set("trust proxy", true);
  app.get("/favicon.ico", (_req, res) => {
    res.sendFile(path.join(config.themeDir, "favicon.svg"));
  });
  app.use(
    config.assetPrefix,
    express.static(config.themeDir, {
      fallthrough: false,
      index: false,
      maxAge: "5m",
    }),
  );

  app.get(/.*/, async (req, res, next) => {
    try {
      const match = matchMount(config.mounts, req.path);
      if (match) {
        await handleMountedRequest({
          req,
          res,
          config,
          mount: match.mount,
          relativeRequestPath: match.relativeRequestPath,
        });
        return;
      }

      if (normalizeRequestPath(req.path) === "/") {
        const htmlPath = await generateMountIndexIfNeeded(config);
        res.sendFile(htmlPath);
        return;
      }

      res.status(404).send("Document not found.");
    } catch (error) {
      next(error);
    }
  });

  app.use((error, _req, res, _next) => {
    const statusCode = error.statusCode ?? 500;
    if (statusCode >= 500) {
      console.error(error);
    }

    res.status(statusCode).send(statusCode === 500 ? "Internal server error." : error.message);
  });

  return app;
}

export async function startServer(overrides = {}) {
  const config = loadConfig(overrides);
  await mkdir(config.outputRoot, { recursive: true });
  const app = createApp(config);

  return new Promise((resolve) => {
    const server = app.listen(config.port, config.host, () => {
      console.log(
        `markdownvibe listening on http://${config.host}:${config.port} using output cache ${config.outputRoot}`,
      );
      resolve(server);
    });
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startServer();
}
