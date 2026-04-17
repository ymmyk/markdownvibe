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

const taskListMarkerPattern = /^\[([ xX])\]\s+/;

const defaultTableOpen =
  markdown.renderer.rules.table_open ??
  ((tokens, index, options, environment, self) =>
    self.renderToken(tokens, index, options, environment, self));
const defaultTableClose =
  markdown.renderer.rules.table_close ??
  ((tokens, index, options, environment, self) =>
    self.renderToken(tokens, index, options, environment, self));
const defaultListItemOpen =
  markdown.renderer.rules.list_item_open ??
  ((tokens, index, options, environment, self) =>
    self.renderToken(tokens, index, options, environment, self));

markdown.renderer.rules.table_open = (tokens, index, options, environment, self) =>
  `<div class="table-scroll">${defaultTableOpen(tokens, index, options, environment, self)}`;

markdown.renderer.rules.table_close = (tokens, index, options, environment, self) =>
  `${defaultTableClose(tokens, index, options, environment, self)}</div>`;

const defaultLinkOpen =
  markdown.renderer.rules.link_open ??
  ((tokens, index, options, environment, self) =>
    self.renderToken(tokens, index, options, environment, self));

markdown.renderer.rules.link_open = (tokens, index, options, environment, self) => {
  const token = tokens[index];
  const hrefIndex = token.attrIndex("href");
  if (hrefIndex >= 0) {
    const href = token.attrs[hrefIndex][1];
    const rewritten = rewriteMarkdownHref(href);
    if (rewritten !== href) {
      token.attrs[hrefIndex][1] = rewritten;
    }
  }
  return defaultLinkOpen(tokens, index, options, environment, self);
};

function rewriteMarkdownHref(href) {
  if (!href || /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("//") || href.startsWith("#")) {
    return href;
  }

  const hashIndex = href.indexOf("#");
  const queryIndex = href.indexOf("?");
  const splitIndex =
    hashIndex === -1 ? queryIndex : queryIndex === -1 ? hashIndex : Math.min(hashIndex, queryIndex);
  const pathPart = splitIndex === -1 ? href : href.slice(0, splitIndex);
  const suffix = splitIndex === -1 ? "" : href.slice(splitIndex);

  if (!/\.md$/i.test(pathPart)) {
    return href;
  }

  return `${pathPart.slice(0, -3)}.html${suffix}`;
}

markdown.renderer.rules.list_item_open = (tokens, index, options, environment, self) => {
  const task = tokens[index].meta?.taskListItem;
  if (task) {
    tokens[index].attrJoin("class", "task-list-item");
    tokens[index].attrSet("data-task-index", String(task.index));
  }

  return defaultListItemOpen(tokens, index, options, environment, self);
};

function stripTaskMarker(inlineToken, markerLength) {
  inlineToken.content = inlineToken.content.slice(markerLength);

  if (!Array.isArray(inlineToken.children)) {
    return;
  }

  let remaining = markerLength;
  const nextChildren = [];

  for (const child of inlineToken.children) {
    if (remaining === 0 || child.type !== "text") {
      nextChildren.push(child);
      continue;
    }

    if (child.content.length <= remaining) {
      remaining -= child.content.length;
      continue;
    }

    child.content = child.content.slice(remaining);
    remaining = 0;
    nextChildren.push(child);
  }

  inlineToken.children = nextChildren;
}

function createHtmlInlineToken(inlineToken, content) {
  const token = new inlineToken.constructor("html_inline", "", 0);
  token.content = content;
  token.level = inlineToken.level;
  token.block = false;
  return token;
}

function decorateTaskListInlineToken(inlineToken, task) {
  const checkedAttribute = task.checked ? " checked" : "";
  const openingToken = createHtmlInlineToken(
    inlineToken,
    `<span class="task-list-control"><input class="task-list-checkbox" type="checkbox" data-task-checkbox data-task-index="${task.index}"${checkedAttribute} /><span class="task-list-text">`,
  );
  const closingToken = createHtmlInlineToken(inlineToken, "</span></span>");
  inlineToken.children = [openingToken, ...(inlineToken.children ?? []), closingToken];
}

function collectTaskListItems(tokens, { decorate = false } = {}) {
  const tasks = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.type !== "list_item_open") {
      continue;
    }

    let inlineToken = null;
    for (let nestedIndex = index + 1; nestedIndex < tokens.length; nestedIndex += 1) {
      const nestedToken = tokens[nestedIndex];
      if (nestedToken.type === "list_item_close" && nestedToken.level === token.level) {
        break;
      }

      if (
        nestedToken.type === "inline" &&
        tokens[nestedIndex - 1]?.type === "paragraph_open"
      ) {
        inlineToken = nestedToken;
        break;
      }
    }

    if (!inlineToken) {
      continue;
    }

    const match = inlineToken.content.match(taskListMarkerPattern);
    if (!match) {
      continue;
    }

    const task = {
      index: tasks.length,
      checked: match[1].toLowerCase() === "x",
      contentLine: inlineToken.map?.[0] ?? token.map?.[0] ?? null,
    };
    tasks.push(task);

    if (!decorate) {
      continue;
    }

    stripTaskMarker(inlineToken, match[0].length);
    decorateTaskListInlineToken(inlineToken, task);
    token.meta = { ...token.meta, taskListItem: task };
  }

  return tasks;
}

function countLineBreaks(value) {
  return (value.match(/\r\n|\r|\n/g) ?? []).length;
}

function getContentStartIndex(source, content) {
  if (source.endsWith(content)) {
    return source.length - content.length;
  }

  return source.indexOf(content);
}

export function getTaskListItemsFromMarkdownSource(markdownSource) {
  const parsed = matter(markdownSource);
  const contentStartIndex = getContentStartIndex(markdownSource, parsed.content);
  const lineOffset =
    contentStartIndex >= 0 ? countLineBreaks(markdownSource.slice(0, contentStartIndex)) : 0;
  const tokens = markdown.parse(parsed.content, {});
  const tasks = collectTaskListItems(tokens);

  return tasks.map((task) => ({
    ...task,
    line: task.contentLine === null ? null : lineOffset + task.contentLine,
  }));
}

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

export async function renderMarkdownDocument({ markdownPath, sourcePath, markdownSource }) {
  const source = markdownSource ?? (await readFile(markdownPath, "utf8"));
  const parsed = matter(source);
  const tokens = markdown.parse(parsed.content, {});
  collectTaskListItems(tokens, { decorate: true });
  const headings = collectHeadings(tokens);
  const documentHeading = headings.find((heading) => heading.level === 1)?.text;
  const title =
    parsed.data.title ??
    documentHeading ??
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
    htmlTitle: documentHeading ?? title,
    summary,
    metadata,
    headings: visibleHeadings,
    tocHtml: renderTocItems(buildTocTree(visibleHeadings)),
    bodyHtml,
    sourcePath,
    escapeHtml,
  };
}
