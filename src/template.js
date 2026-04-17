import path from "node:path";
import { readFile } from "node:fs/promises";

function renderMeta(metadata, escapeHtml) {
  if (metadata.length === 0) {
    return "";
  }

  const items = metadata
    .map(
      ({ label, value }) => `
        <div class="meta-item">
          <span class="meta-label">${escapeHtml(label)}</span>
          <span class="meta-value">${escapeHtml(value)}</span>
        </div>`,
    )
    .join("");

  return `<section class="meta-strip">${items}</section>`;
}

function renderSummary(summary, escapeHtml) {
  if (!summary) {
    return "";
  }

  return `<p class="deck">${escapeHtml(summary)}</p>`;
}

export async function renderPage({ themeDir, assetPrefix, appName, hashes, document }) {
  const templatePath = path.join(themeDir, "template.html");
  const template = await readFile(templatePath, "utf8");
  const rawDownloadPath = document.rawDownloadPath ?? "";

  return template
    .replaceAll("{{HTML_TITLE}}", document.escapeHtml(document.htmlTitle ?? document.title))
    .replaceAll("{{MARKDOWN_HASH}}", document.escapeHtml(hashes.markdownHash))
    .replaceAll("{{THEME_HASH}}", document.escapeHtml(hashes.themeHash))
    .replaceAll("{{TITLE}}", document.escapeHtml(document.title))
    .replaceAll("{{APP_NAME}}", document.escapeHtml(appName))
    .replaceAll("{{SOURCE_PATH}}", document.escapeHtml(document.sourcePath))
    .replaceAll("{{SUMMARY}}", renderSummary(document.summary, document.escapeHtml))
    .replaceAll("{{META}}", renderMeta(document.metadata, document.escapeHtml))
    .replaceAll("{{TOC}}", document.tocHtml)
    .replaceAll("{{CONTENT}}", document.bodyHtml)
    .replaceAll("{{RAW_DOWNLOAD_PATH}}", document.escapeHtml(rawDownloadPath))
    .replaceAll("{{ASSET_PREFIX}}", assetPrefix);
}
