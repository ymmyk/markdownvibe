import express from "express";
import path from "node:path";
import {
  access,
  mkdir,
  readFile,
  readdir,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
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

async function maxMtimeMs(dirPath) {
  const entries = await readdir(dirPath, { withFileTypes: true });
  let latest = 0;

  for (const entry of entries) {
    const entryPath = path.join(dirPath, entry.name);
    const entryStat = await stat(entryPath);
    latest = Math.max(latest, entryStat.mtimeMs);

    if (entry.isDirectory()) {
      latest = Math.max(latest, await maxMtimeMs(entryPath));
    }
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

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function buildChildRequestPath(basePath, childName, { trailingSlash = false } = {}) {
  const normalizedBase = basePath === "/" ? "/" : basePath.endsWith("/") ? basePath : `${basePath}/`;
  const href = `${normalizedBase}${encodeURIComponent(childName)}`;
  return trailingSlash ? `${href}/` : href;
}

function renderDirectoryToc(sections) {
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

function renderDirectorySection(section) {
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

async function renderDirectoryIndex({ directoryPath, requestPath, themeDir, assetPrefix }) {
  const normalizedRequestPath =
    requestPath === "/" ? "/" : requestPath.endsWith("/") ? requestPath : `${requestPath}/`;
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
        href: buildChildRequestPath(normalizedRequestPath, entry.name, { trailingSlash: true }),
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
        href: buildChildRequestPath(normalizedRequestPath, `${baseName}.html`),
        rawHref: buildChildRequestPath(normalizedRequestPath, entry.name),
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
      href: buildChildRequestPath(normalizedRequestPath, entry.name),
      detail: "Direct asset passthrough",
    });
  }

  const sections = [
    { id: "folders", title: "Folders", items: folders },
    { id: "pages", title: "Pages", items: pages },
    { id: "assets", title: "Assets", items: assets },
  ].filter((section) => section.items.length > 0);

  const title = normalizedRequestPath === "/" ? "Content Index" : path.posix.basename(normalizedRequestPath.slice(0, -1));
  const bodyHtml =
    sections.length === 0
      ? "<p>This folder is empty.</p>"
      : sections.map((section) => renderDirectorySection(section)).join("");

  return renderPage({
    themeDir,
    assetPrefix,
    document: {
      title,
      summary: `Auto-generated directory index for ${normalizedRequestPath}`,
      metadata: [
        { label: "Mode", value: "Auto index" },
        { label: "Folders", value: String(folders.length) },
        { label: "Pages", value: String(pages.length) },
        { label: "Assets", value: String(assets.length) },
      ],
      tocHtml: renderDirectoryToc(sections),
      bodyHtml,
      sourcePath: normalizedRequestPath,
      escapeHtml,
    },
  });
}

function resolveRequestFsPath(contentRoot, requestPath) {
  const decoded = decodeRequestPath(requestPath);
  const normalized = path.posix.normalize(decoded);
  const withDotPrefix = normalized.startsWith("/") ? `.${normalized}` : `./${normalized}`;
  const resolved = path.resolve(contentRoot, withDotPrefix);

  if (!ensureInsideRoot(contentRoot, resolved)) {
    const error = new Error("Not found");
    error.statusCode = 404;
    throw error;
  }

  return resolved;
}

function buildMarkdownCandidates(contentRoot, requestPath) {
  const fsPath = resolveRequestFsPath(contentRoot, requestPath);
  const extension = path.extname(fsPath).toLowerCase();

  if (requestPath.endsWith("/")) {
    return [
      {
        markdownPath: path.join(fsPath, "index.md"),
        htmlPath: path.join(fsPath, "index.html"),
      },
    ];
  }

  if (extension === ".html") {
    const basePath = fsPath.slice(0, -".html".length);
    return [
      {
        markdownPath: `${basePath}.md`,
        htmlPath: `${basePath}.html`,
      },
    ];
  }

  return [
    {
      markdownPath: `${fsPath}.md`,
      htmlPath: `${fsPath}.html`,
    },
    {
      markdownPath: path.join(fsPath, "index.md"),
      htmlPath: path.join(fsPath, "index.html"),
    },
  ];
}

async function writeAtomically(targetPath, contents) {
  const tempPath = `${targetPath}.tmp-${process.pid}-${Date.now()}`;
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(tempPath, contents, "utf8");
  await rename(tempPath, targetPath);
}

async function generateHtmlIfNeeded({
  markdownPath,
  htmlPath,
  themeDir,
  assetPrefix,
  contentRoot,
}) {
  const [markdownStat, htmlStat, themeMtime] = await Promise.all([
    statPath(markdownPath),
    statPath(htmlPath),
    Promise.all([maxMtimeMs(themeDir), maxFileMtimeMs(rendererDependencyPaths)]).then((values) =>
      Math.max(...values),
    ),
  ]);

  if (!markdownStat?.isFile()) {
    return null;
  }

  const shouldRender =
    !htmlStat?.isFile() ||
    markdownStat.mtimeMs > htmlStat.mtimeMs ||
    themeMtime > htmlStat.mtimeMs;

  if (shouldRender) {
    const relativeSourcePath = path.relative(contentRoot, markdownPath).replace(/\\/g, "/");
    const document = await renderMarkdownDocument({
      markdownPath,
      sourcePath: `/${relativeSourcePath}`,
    });
    const html = await renderPage({ themeDir, assetPrefix, document });
    await writeAtomically(htmlPath, html);
  }

  return htmlPath;
}

async function serveRawMarkdown(res, markdownPath) {
  const markdown = await readFile(markdownPath, "utf8");
  res.type("text/markdown; charset=utf-8");
  res.send(markdown);
}

async function sendDirectoryResponse({ directoryPath, requestPath, res, config }) {
  const indexHtmlPath = path.join(directoryPath, "index.html");
  const indexMarkdownPath = path.join(directoryPath, "index.md");

  if (await fileExists(indexMarkdownPath)) {
    const htmlPath = await generateHtmlIfNeeded({
      markdownPath: indexMarkdownPath,
      htmlPath: indexHtmlPath,
      themeDir: config.themeDir,
      assetPrefix: config.assetPrefix,
      contentRoot: config.contentRoot,
    });

    return res.sendFile(htmlPath);
  }

  if (await fileExists(indexHtmlPath)) {
    return res.sendFile(indexHtmlPath);
  }

  const html = await renderDirectoryIndex({
    directoryPath,
    requestPath,
    themeDir: config.themeDir,
    assetPrefix: config.assetPrefix,
  });

  res.type("text/html; charset=utf-8");
  res.send(html);
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
      const requestPath = req.path;
      const fsPath = resolveRequestFsPath(config.contentRoot, requestPath);
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
        const markdownCandidate = buildMarkdownCandidates(config.contentRoot, requestPath)[0];
        const markdownExists = await fileExists(markdownCandidate.markdownPath);

        if (!markdownExists && exactStat?.isFile()) {
          return res.sendFile(fsPath);
        }

        if (markdownExists) {
          const htmlPath = await generateHtmlIfNeeded({
            ...markdownCandidate,
            themeDir: config.themeDir,
            assetPrefix: config.assetPrefix,
            contentRoot: config.contentRoot,
          });

          if (htmlPath) {
            return res.sendFile(htmlPath);
          }
        }

        const directoryPath = fsPath.slice(0, -".html".length);
        const directoryStat = await statPath(directoryPath);
        if (directoryStat?.isDirectory()) {
          return sendDirectoryResponse({
            directoryPath,
            requestPath: requestPath.slice(0, -".html".length),
            res,
            config,
          });
        }

        res.status(404).send("Document not found.");
        return;
      }

      if (exactStat?.isFile()) {
        return res.sendFile(fsPath);
      }

      if (exactStat?.isDirectory()) {
        return sendDirectoryResponse({
          directoryPath: fsPath,
          requestPath,
          res,
          config,
        });
      }

      const candidates = buildMarkdownCandidates(config.contentRoot, requestPath);
      for (const candidate of candidates) {
        const htmlPath = await generateHtmlIfNeeded({
          ...candidate,
          themeDir: config.themeDir,
          assetPrefix: config.assetPrefix,
          contentRoot: config.contentRoot,
        });

        if (htmlPath) {
          return res.sendFile(htmlPath);
        }
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
  await mkdir(config.contentRoot, { recursive: true });
  const app = createApp(config);

  return new Promise((resolve) => {
    const server = app.listen(config.port, config.host, () => {
      console.log(
        `markdownvibe listening on http://${config.host}:${config.port} with content root ${config.contentRoot}`,
      );
      resolve(server);
    });
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startServer();
}
