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

export async function renderPage({ themeDir, assetPrefix, document }) {
  const templatePath = path.join(themeDir, "template.html");
  const template = await readFile(templatePath, "utf8");

  return template
    .replaceAll("{{TITLE}}", document.escapeHtml(document.title))
    .replaceAll("{{SOURCE_PATH}}", document.escapeHtml(document.sourcePath))
    .replaceAll("{{SUMMARY}}", renderSummary(document.summary, document.escapeHtml))
    .replaceAll("{{META}}", renderMeta(document.metadata, document.escapeHtml))
    .replaceAll("{{TOC}}", document.tocHtml)
    .replaceAll("{{CONTENT}}", document.bodyHtml)
    .replaceAll("{{ASSET_PREFIX}}", assetPrefix);
}
