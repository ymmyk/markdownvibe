import express from "express";
import { createHash } from "node:crypto";
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

function buildParentRequestPath(basePath) {
  if (basePath === "/") {
    return null;
  }

  const currentPath = basePath.endsWith("/") ? basePath.slice(0, -1) : basePath;
  const parentPath = path.posix.dirname(currentPath);
  if (parentPath === "/" || parentPath === ".") {
    return "/";
  }

  return `${parentPath}/`;
}

function hashString(value) {
  return createHash("sha256").update(value).digest("hex");
}

function hashJson(value) {
  return hashString(JSON.stringify(value));
}

async function listFilesRecursively(rootPath, currentPath = rootPath) {
  const entries = await readdir(currentPath, { withFileTypes: true });
  const sortedEntries = entries.sort((left, right) => left.name.localeCompare(right.name));
  const files = [];

  for (const entry of sortedEntries) {
    const entryPath = path.join(currentPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFilesRecursively(rootPath, entryPath)));
      continue;
    }

    if (entry.isFile()) {
      files.push({
        relativePath: path.relative(rootPath, entryPath).replace(/\\/g, "/"),
        absolutePath: entryPath,
      });
    }
  }

  return files;
}

async function getThemeHash({ themeDir, appName, assetPrefix }) {
  const hash = createHash("sha256");
  hash.update(`app-name:${appName}\n`);
  hash.update(`asset-prefix:${assetPrefix}\n`);

  const themeFiles = await listFilesRecursively(themeDir);
  for (const file of themeFiles) {
    hash.update(`theme:${file.relativePath}\n`);
    hash.update(await readFile(file.absolutePath));
    hash.update("\n");
  }

  const dependencyFiles = [...rendererDependencyPaths].sort();
  for (const dependencyPath of dependencyFiles) {
    hash.update(`renderer:${path.basename(dependencyPath)}\n`);
    hash.update(await readFile(dependencyPath));
    hash.update("\n");
  }

  return hash.digest("hex");
}

function extractMetaValue(html, name) {
  const metaTags = html.match(/<meta\b[^>]*>/gi) ?? [];
  for (const tag of metaTags) {
    const nameMatch = tag.match(/\bname=["']([^"']+)["']/i);
    if (nameMatch?.[1] !== name) {
      continue;
    }

    return tag.match(/\bcontent=["']([^"']*)["']/i)?.[1] ?? null;
  }

  return null;
}

async function readEmbeddedHashes(htmlPath) {
  try {
    const html = await readFile(htmlPath, "utf8");
    return {
      markdownHash: extractMetaValue(html, "markdown-hash"),
      themeHash: extractMetaValue(html, "theme-hash"),
    };
  } catch {
    return null;
  }
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
  appName,
  themeDir,
  assetPrefix,
  contentHash,
  themeHash,
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
    appName,
    hashes: {
      markdownHash: contentHash,
      themeHash,
    },
    document: {
      title,
      htmlTitle: title,
      summary,
      metadata,
      tocHtml: renderIndexToc(sections),
      bodyHtml,
      sourcePath,
      escapeHtml,
    },
  });
}

async function buildDirectoryIndexDocument({ directoryPath, mountedPath }) {
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
  const parentPath = buildParentRequestPath(normalizedMountedPath);

  if (parentPath) {
    folders.push({
      label: "..",
      kind: "Up",
      href: parentPath,
      detail: "Parent directory",
    });
  }

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

  const document = {
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
  };

  return {
    ...document,
    contentHash: hashJson(document),
  };
}

function buildMountIndexDocument({ mounts, appName }) {
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

  const document = {
    title: "Published Content",
    summary: `Configured source paths available through ${appName}.`,
    sourcePath: "/",
    metadata: [{ label: "Mounts", value: String(mounts.length) }],
    sections,
  };

  return {
    ...document,
    contentHash: hashJson(document),
  };
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

async function generateMarkdownHtmlIfNeeded({
  markdownPath,
  htmlPath,
  mount,
  themeDir,
  assetPrefix,
  appName,
}) {
  const markdownStat = await statPath(markdownPath);

  if (!markdownStat?.isFile()) {
    return null;
  }

  const [markdownSource, themeHash, existingHashes] = await Promise.all([
    readFile(markdownPath, "utf8"),
    getThemeHash({ themeDir, appName, assetPrefix }),
    readEmbeddedHashes(htmlPath),
  ]);
  const markdownHash = hashString(markdownSource);
  const shouldRender =
    !existingHashes ||
    existingHashes.markdownHash !== markdownHash ||
    existingHashes.themeHash !== themeHash;

  if (shouldRender) {
    const relativeSourcePath = path.relative(mount.fullPath, markdownPath).replace(/\\/g, "/");
    const document = await renderMarkdownDocument({
      markdownPath,
      sourcePath: joinMountedWebPath(mount, relativeSourcePath),
      markdownSource,
    });
    const html = await renderPage({
      themeDir,
      assetPrefix,
      appName,
      hashes: {
        markdownHash,
        themeHash,
      },
      document,
    });
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
  const [document, themeHash, existingHashes] = await Promise.all([
    buildDirectoryIndexDocument({ directoryPath, mountedPath }),
    getThemeHash({
      themeDir: config.themeDir,
      appName: config.appName,
      assetPrefix: config.assetPrefix,
    }),
    readEmbeddedHashes(htmlPath),
  ]);
  const shouldRender =
    !existingHashes ||
    existingHashes.markdownHash !== document.contentHash ||
    existingHashes.themeHash !== themeHash;

  if (shouldRender) {
    const html = await renderIndexPage({
      appName: config.appName,
      themeDir: config.themeDir,
      assetPrefix: config.assetPrefix,
      contentHash: document.contentHash,
      themeHash,
      title: document.title,
      summary: document.summary,
      sourcePath: document.sourcePath,
      metadata: document.metadata,
      sections: document.sections,
    });
    await writeAtomically(htmlPath, html);
  }

  return htmlPath;
}

async function generateMountIndexIfNeeded(config) {
  const htmlPath = buildSiteIndexOutputPath(config.outputRoot);
  const [document, themeHash, existingHashes] = await Promise.all([
    Promise.resolve(buildMountIndexDocument({ mounts: config.mounts, appName: config.appName })),
    getThemeHash({
      themeDir: config.themeDir,
      appName: config.appName,
      assetPrefix: config.assetPrefix,
    }),
    readEmbeddedHashes(htmlPath),
  ]);
  const shouldRender =
    !existingHashes ||
    existingHashes.markdownHash !== document.contentHash ||
    existingHashes.themeHash !== themeHash;

  if (shouldRender) {
    const html = await renderIndexPage({
      appName: config.appName,
      themeDir: config.themeDir,
      assetPrefix: config.assetPrefix,
      contentHash: document.contentHash,
      themeHash,
      title: document.title,
      summary: document.summary,
      sourcePath: document.sourcePath,
      metadata: document.metadata,
      sections: document.sections,
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
      appName: config.appName,
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
        appName: config.appName,
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
      appName: config.appName,
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
        `${config.appName} listening on http://${config.host}:${config.port} using output cache ${config.outputRoot}`,
      );
      resolve(server);
    });
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startServer();
}
