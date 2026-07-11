import path from "node:path";
import { readFile } from "node:fs/promises";

function renderMeta(metadata, escapeHtml) {
  if (!metadata || metadata.length === 0) {
    return "";
  }

  const items = metadata
    .map((item) => {
      const valueHtml =
        item.html ??
        escapeHtml(
          item.value instanceof Date
            ? item.value.toISOString().slice(0, 10)
            : String(item.value ?? ""),
        );
      return `
        <div class="meta-item property-row" data-kind="${escapeHtml(item.kind ?? "text")}">
          <dt class="meta-label">${escapeHtml(item.label)}</dt>
          <dd class="meta-value">${valueHtml}</dd>
        </div>`;
    })
    .join("");

  return `<details class="meta-strip properties">
  <summary class="properties-summary">
    <span class="properties-label">Properties</span>
    <span class="properties-count">${metadata.length}</span>
  </summary>
  <dl class="properties-list">${items}</dl>
</details>`;
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
  const articleClass = document.articleClass ?? "prose";

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
    .replaceAll("{{ASSET_PREFIX}}", assetPrefix)
    .replaceAll("{{ARTICLE_CLASS}}", document.escapeHtml(articleClass));
}
