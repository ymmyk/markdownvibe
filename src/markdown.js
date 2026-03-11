import matter from "gray-matter";
import hljs from "highlight.js";
import MarkdownIt from "markdown-it";
import { readFile } from "node:fs/promises";
import path from "node:path";

const markdown = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true,
  highlight(code, language) {
    if (language && hljs.getLanguage(language)) {
      const highlighted = hljs.highlight(code, { language }).value;
      return `<pre class="hljs"><code>${highlighted}</code></pre>`;
    }

    const escaped = markdown.utils.escapeHtml(code);
    return `<pre class="hljs"><code>${escaped}</code></pre>`;
  },
});

function slugify(value) {
  const slug = value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");

  return slug || "section";
}

function collectHeadings(tokens) {
  const counts = new Map();
  const headings = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.type !== "heading_open") {
      continue;
    }

    const inlineToken = tokens[index + 1];
    const text = inlineToken?.content?.trim() ?? "";
    const baseId = slugify(text);
    const seen = counts.get(baseId) ?? 0;
    counts.set(baseId, seen + 1);
    const id = seen === 0 ? baseId : `${baseId}-${seen + 1}`;

    token.attrSet("id", id);
    headings.push({
      level: Number(token.tag.slice(1)),
      text,
      id,
    });
  }

  return headings;
}

function buildTocTree(headings) {
  const root = [];
  const stack = [{ level: 0, children: root }];

  for (const heading of headings) {
    const node = { ...heading, children: [] };

    while (stack.length > 1 && heading.level <= stack[stack.length - 1].level) {
      stack.pop();
    }

    stack[stack.length - 1].children.push(node);
    stack.push(node);
  }

  return root;
}

function renderTocItems(items) {
  if (items.length === 0) {
    return '<p class="toc-empty">No headings yet.</p>';
  }

  const list = items
    .map(
      (item) => `
        <li class="toc-item level-${item.level}">
          <a href="#${item.id}" data-toc-link>${escapeHtml(item.text)}</a>
          ${item.children.length > 0 ? renderTocItems(item.children) : ""}
        </li>`,
    )
    .join("");

  return `<ul class="toc-list">${list}</ul>`;
}

function escapeHtml(value) {
  return markdown.utils.escapeHtml(String(value ?? ""));
}

function formatMetaValue(value) {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  if (Array.isArray(value)) {
    return value.join(", ");
  }

  return String(value);
}

function stripLeadingTitleHeading(tokens, title, headings) {
  const firstHeading = headings[0];
  if (!firstHeading || firstHeading.level !== 1 || firstHeading.text !== title) {
    return { bodyTokens: tokens, headings };
  }

  const bodyTokens = [...tokens];
  const headingIndex = bodyTokens.findIndex(
    (token, index) =>
      token.type === "heading_open" &&
      token.tag === "h1" &&
      bodyTokens[index + 1]?.type === "inline" &&
      bodyTokens[index + 1]?.content?.trim() === title,
  );

  if (headingIndex >= 0) {
    bodyTokens.splice(headingIndex, 3);
  }

  return {
    bodyTokens,
    headings: headings.slice(1),
  };
}

export async function renderMarkdownDocument({ markdownPath, sourcePath }) {
  const source = await readFile(markdownPath, "utf8");
  const parsed = matter(source);
  const tokens = markdown.parse(parsed.content, {});
  const headings = collectHeadings(tokens);
  const title =
    parsed.data.title ??
    headings.find((heading) => heading.level === 1)?.text ??
    path.basename(markdownPath, ".md");
  const { bodyTokens, headings: visibleHeadings } = stripLeadingTitleHeading(tokens, title, headings);
  const bodyHtml = markdown.renderer.render(bodyTokens, markdown.options, {});

  const summary = parsed.data.summary ?? parsed.data.description ?? "";
  const metadata = Object.entries(parsed.data)
    .filter(([key]) => !["title", "summary", "description"].includes(key))
    .map(([key, value]) => ({
      label: key,
      value: formatMetaValue(value),
    }));

  return {
    title,
    summary,
    metadata,
    headings: visibleHeadings,
    tocHtml: renderTocItems(buildTocTree(visibleHeadings)),
    bodyHtml,
    sourcePath,
    escapeHtml,
  };
}
