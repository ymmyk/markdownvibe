import path from "node:path";
import {
  mediaPathToWebHref,
  notePathToWebHref,
  resolveVaultTarget,
} from "./vault-index.js";

const CALLOUT_TYPES = {
  note: { label: "Note", icon: "✏️" },
  abstract: { label: "Abstract", icon: "📋" },
  summary: { label: "Summary", icon: "📋" },
  tldr: { label: "TL;DR", icon: "📋" },
  info: { label: "Info", icon: "ℹ️" },
  todo: { label: "Todo", icon: "☑️" },
  tip: { label: "Tip", icon: "💡" },
  hint: { label: "Hint", icon: "💡" },
  important: { label: "Important", icon: "❗️" },
  success: { label: "Success", icon: "✅" },
  check: { label: "Check", icon: "✅" },
  done: { label: "Done", icon: "✅" },
  question: { label: "Question", icon: "❓" },
  help: { label: "Help", icon: "❓" },
  faq: { label: "FAQ", icon: "❓" },
  warning: { label: "Warning", icon: "⚠️" },
  caution: { label: "Caution", icon: "⚠️" },
  attention: { label: "Attention", icon: "⚠️" },
  failure: { label: "Failure", icon: "❌" },
  fail: { label: "Fail", icon: "❌" },
  missing: { label: "Missing", icon: "❌" },
  danger: { label: "Danger", icon: "⚡" },
  error: { label: "Error", icon: "⚡" },
  bug: { label: "Bug", icon: "🐛" },
  example: { label: "Example", icon: "📎" },
  quote: { label: "Quote", icon: "💬" },
  cite: { label: "Cite", icon: "💬" },
};

const WIKILINK_PATTERN = /^!?\[\[([^\]|#]+)(?:#([^\]|]+))?(?:\|([^\]]+))?\]\]/;
const CALLOUT_FIRST_LINE = /^\[!([^\]]+)\]([+-]?)\s*(.*)$/;
const BLOCK_ID_PATTERN = /\s+\^([a-zA-Z0-9-]+)\s*$/;
const TAG_PATTERN = /(^|[^#\w/])#([a-zA-Z][\w/-]*)/g;
const HIGHLIGHT_MARKER = "==";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function slugifyHeading(value) {
  const slug = String(value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
  return slug || "section";
}

/**
 * Strip Obsidian comments outside fenced/inline code.
 */
export function stripObsidianComments(source) {
  const parts = String(source).split(/(```[\s\S]*?```|`[^`\n]+`)/g);
  return parts
    .map((part, index) => {
      if (index % 2 === 1) {
        return part;
      }
      return part.replace(/%%[\s\S]*?%%/g, "");
    })
    .join("");
}

function parseWikilinkTarget(raw) {
  const match = raw.match(WIKILINK_PATTERN);
  if (!match) {
    return null;
  }

  const embed = raw.startsWith("!");
  const target = match[1].trim();
  const hash = match[2]?.trim() ?? "";
  const aliasOrSize = match[3]?.trim() ?? "";

  let width = null;
  let alias = aliasOrSize;
  if (embed && aliasOrSize && /^\d+$/.test(aliasOrSize)) {
    width = Number(aliasOrSize);
    alias = "";
  }

  let fragment = "";
  let blockId = "";
  if (hash.startsWith("^")) {
    blockId = hash.slice(1);
  } else if (hash) {
    fragment = hash;
  }

  return { embed, target, fragment, blockId, alias, width, raw: match[0] };
}

function createInlineToken(state, type, content, level) {
  const token = new state.Token(type, "", 0);
  token.content = content;
  token.level = level;
  token.block = false;
  return token;
}

async function resolveLinkContext(env, parsed) {
  const mount = env.mount;
  const markdownPath = env.markdownPath;
  if (!mount || !markdownPath) {
    return {
      href: null,
      kind: "unresolved",
      display: parsed.alias || parsed.target || parsed.fragment || "link",
      resolved: null,
    };
  }

  // Same-note heading/block: [[#Heading]] or [[#^block]]
  if (!parsed.target || parsed.target === "") {
    const fragment = parsed.blockId
      ? parsed.blockId
      : parsed.fragment
        ? slugifyHeading(parsed.fragment)
        : "";
    const href = fragment ? `#${encodeURIComponent(fragment)}` : "#";
    return {
      href,
      kind: "local",
      display: parsed.alias || parsed.fragment || parsed.blockId || "link",
      resolved: null,
    };
  }

  const prefer = parsed.embed ? "any" : "note";
  const resolved = await resolveVaultTarget({
    mountRoot: mount.fullPath,
    fromMarkdownPath: markdownPath,
    target: parsed.target,
    prefer,
  });

  if (!resolved) {
    return {
      href: null,
      kind: "unresolved",
      display: parsed.alias || parsed.target,
      resolved: null,
    };
  }

  if (resolved.kind === "media") {
    return {
      href: mediaPathToWebHref(mount, resolved.relativePath),
      kind: "media",
      display: parsed.alias || resolved.basename,
      resolved,
    };
  }

  let fragment = "";
  if (parsed.blockId) {
    // Element ids use bare block ids; keep href fragments in sync (no leading ^)
    fragment = parsed.blockId;
  } else if (parsed.fragment) {
    fragment = slugifyHeading(parsed.fragment);
  }

  return {
    href: notePathToWebHref(mount, resolved.relativePath, fragment),
    kind: "note",
    display: parsed.alias || resolved.basename,
    resolved,
  };
}

function renderUnresolvedLink(display, embed) {
  const text = escapeHtml(display);
  if (embed) {
    return `<div class="obsidian-embed is-unresolved" data-unresolved="${text}">Missing embed: ${text}</div>`;
  }
  return `<a class="wikilink is-unresolved" href="#" title="Unresolved note" data-unresolved="true">${text}</a>`;
}

function renderWikilinkHtml(resolved, parsed) {
  if (resolved.kind === "unresolved" || !resolved.href) {
    return renderUnresolvedLink(resolved.display, parsed.embed);
  }

  if (parsed.embed && resolved.kind === "media") {
    const widthAttr = parsed.width ? ` width="${parsed.width}"` : "";
    const styleAttr = parsed.width ? ` style="max-width:${parsed.width}px"` : "";
    return `<img class="obsidian-embed-image" src="${escapeHtml(resolved.href)}" alt="${escapeHtml(resolved.display)}"${widthAttr}${styleAttr} loading="lazy" />`;
  }

  if (parsed.embed && resolved.kind === "note") {
    return `<!--obsidian-embed:${escapeHtml(resolved.resolved.absolutePath)}|${escapeHtml(parsed.fragment || "")}|${escapeHtml(parsed.blockId || "")}-->`;
  }

  return `<a class="wikilink" href="${escapeHtml(resolved.href)}">${escapeHtml(resolved.display)}</a>`;
}

/**
 * markdown-it plugin: wikilinks, highlights, tags, block ids, callouts.
 * Resolution is synchronous against env._wikilinkCache populated before render.
 */
export function obsidianMarkdownPlugin(md) {
  md.inline.ruler.before("link", "obsidian_wikilink", (state, silent) => {
    const start = state.pos;
    const max = state.posMax;
    if (start + 3 >= max) {
      return false;
    }

    const isEmbed = state.src.charCodeAt(start) === 0x21; /* ! */
    const openOffset = isEmbed ? start + 1 : start;
    if (state.src.charCodeAt(openOffset) !== 0x5b || state.src.charCodeAt(openOffset + 1) !== 0x5b) {
      return false;
    }

    const closeIndex = state.src.indexOf("]]", openOffset + 2);
    if (closeIndex === -1 || closeIndex > max) {
      return false;
    }

    const raw = state.src.slice(start, closeIndex + 2);
    const parsed = parseWikilinkTarget(raw);
    if (!parsed) {
      return false;
    }

    if (!silent) {
      const cache = state.env._wikilinkCache ?? {};
      const resolved = cache[raw] ?? {
        href: null,
        kind: "unresolved",
        display: parsed.alias || parsed.target || "link",
        resolved: null,
      };
      const token = state.push("html_inline", "", 0);
      token.content = renderWikilinkHtml(resolved, parsed);
    }

    state.pos = closeIndex + 2;
    return true;
  });

  md.inline.ruler.after("emphasis", "obsidian_highlight", (state, silent) => {
    const start = state.pos;
    if (state.src.slice(start, start + 2) !== HIGHLIGHT_MARKER) {
      return false;
    }

    const closeIndex = state.src.indexOf(HIGHLIGHT_MARKER, start + 2);
    if (closeIndex === -1) {
      return false;
    }

    // Don't match empty or cross-newline highlights
    const inner = state.src.slice(start + 2, closeIndex);
    if (!inner || inner.includes("\n")) {
      return false;
    }

    if (!silent) {
      const open = state.push("mark_open", "mark", 1);
      open.markup = HIGHLIGHT_MARKER;
      const text = state.push("text", "", 0);
      text.content = inner;
      const close = state.push("mark_close", "mark", -1);
      close.markup = HIGHLIGHT_MARKER;
    }

    state.pos = closeIndex + 2;
    return true;
  });

  md.inline.ruler.push("obsidian_tags", (state, silent) => {
    // Tags are handled in a text post-pass below — this ruler is a no-op marker.
    return false;
  });

  // Transform text tokens to linkify #tags (after all inline rules)
  md.core.ruler.after("inline", "obsidian_tags_transform", (state) => {
    for (const blockToken of state.tokens) {
      if (blockToken.type !== "inline" || !blockToken.children) {
        continue;
      }

      const nextChildren = [];
      for (const child of blockToken.children) {
        if (child.type !== "text" || !child.content.includes("#")) {
          nextChildren.push(child);
          continue;
        }

        // Skip tag transforms inside code / links already parsed
        let lastIndex = 0;
        const text = child.content;
        TAG_PATTERN.lastIndex = 0;
        let match = TAG_PATTERN.exec(text);
        if (!match) {
          nextChildren.push(child);
          continue;
        }

        while (match) {
          const full = match[0];
          const prefix = match[1];
          const tag = match[2];
          const matchStart = match.index;
          const tagStart = matchStart + prefix.length;

          if (tagStart > lastIndex || prefix) {
            const before = text.slice(lastIndex, tagStart);
            if (before) {
              const textToken = createInlineToken(state, "text", before, child.level);
              nextChildren.push(textToken);
            }
          }

          const html = createInlineToken(
            state,
            "html_inline",
            `<span class="obsidian-tag" data-tag="${escapeHtml(tag)}">#${escapeHtml(tag)}</span>`,
            child.level,
          );
          nextChildren.push(html);
          lastIndex = tagStart + tag.length + 1;
          match = TAG_PATTERN.exec(text);
        }

        if (lastIndex < text.length) {
          nextChildren.push(createInlineToken(state, "text", text.slice(lastIndex), child.level));
        }
      }

      blockToken.children = nextChildren;
    }
  });

  // Block IDs: trailing ^id on paragraph/list item content
  md.core.ruler.after("inline", "obsidian_block_ids", (state) => {
    for (let index = 0; index < state.tokens.length; index += 1) {
      const token = state.tokens[index];
      if (token.type !== "inline" || !token.content) {
        continue;
      }

      const match = token.content.match(BLOCK_ID_PATTERN);
      if (!match) {
        continue;
      }

      const blockId = match[1];
      token.content = token.content.replace(BLOCK_ID_PATTERN, "");
      if (token.children) {
        // Strip from last text child
        for (let childIndex = token.children.length - 1; childIndex >= 0; childIndex -= 1) {
          const child = token.children[childIndex];
          if (child.type === "text" && BLOCK_ID_PATTERN.test(child.content)) {
            child.content = child.content.replace(BLOCK_ID_PATTERN, "");
            break;
          }
        }
      }

      // Attach id to preceding opening token (paragraph or list item context)
      for (let back = index - 1; back >= 0; back -= 1) {
        const open = state.tokens[back];
        if (open.type === "paragraph_open" || open.type === "list_item_open") {
          open.attrSet("id", `^${blockId}`);
          // Also set a clean HTML id without ^ for fragment compatibility
          open.attrSet("id", blockId);
          open.attrJoin("class", "obsidian-block");
          open.attrSet("data-block-id", blockId);
          break;
        }
        if (open.type.endsWith("_close")) {
          break;
        }
      }
    }
  });

  // Callouts: rewrite blockquotes that start with [!type]
  md.core.ruler.after("block", "obsidian_callouts", (state) => {
    const tokens = state.tokens;
    for (let index = 0; index < tokens.length; index += 1) {
      const open = tokens[index];
      if (open.type !== "blockquote_open") {
        continue;
      }

      let closeIndex = -1;
      for (let look = index + 1; look < tokens.length; look += 1) {
        if (tokens[look].type === "blockquote_close" && tokens[look].level === open.level) {
          closeIndex = look;
          break;
        }
      }
      if (closeIndex === -1) {
        continue;
      }

      // First paragraph inline inside blockquote
      let firstInline = null;
      let firstInlineIndex = -1;
      for (let look = index + 1; look < closeIndex; look += 1) {
        if (tokens[look].type === "inline") {
          firstInline = tokens[look];
          firstInlineIndex = look;
          break;
        }
      }
      if (!firstInline) {
        continue;
      }

      const firstLine = firstInline.content.split(/\n/, 1)[0] ?? "";
      const calloutMatch = firstLine.match(CALLOUT_FIRST_LINE);
      if (!calloutMatch) {
        continue;
      }

      const rawType = calloutMatch[1].trim().toLowerCase();
      const foldFlag = calloutMatch[2];
      const customTitle = calloutMatch[3].trim();
      const typeInfo = CALLOUT_TYPES[rawType] ?? {
        label: rawType.charAt(0).toUpperCase() + rawType.slice(1),
        icon: "📎",
      };
      const title = customTitle || typeInfo.label;
      const foldable = foldFlag === "-" || foldFlag === "+";
      const collapsed = foldFlag === "-";

      // Remove [!type] line marker from first paragraph; re-parse remainder as inline
      let remainder = firstInline.content.slice(calloutMatch[0].length);
      if (remainder.startsWith("\n")) {
        remainder = remainder.slice(1);
      } else {
        remainder = remainder.replace(/^\s*/, "");
      }
      firstInline.content = remainder;
      const rebuilt = [];
      if (remainder) {
        state.md.inline.parse(remainder, state.md, state.env, rebuilt);
      }
      firstInline.children = rebuilt;

      const emptyFirstParagraph =
        !remainder.trim() &&
        tokens[firstInlineIndex - 1]?.type === "paragraph_open" &&
        tokens[firstInlineIndex + 1]?.type === "paragraph_close";

      if (emptyFirstParagraph) {
        tokens.splice(firstInlineIndex - 1, 3);
        closeIndex -= 3;
      }

      const openClass = `callout callout-${rawType.replace(/[^a-z0-9_-]/g, "")}`;
      if (foldable) {
        open.type = "html_block";
        open.tag = "";
        open.nesting = 0;
        open.markup = "";
        open.content = `<details class="${openClass}"${collapsed ? "" : " open"} data-callout="${escapeHtml(rawType)}"><summary class="callout-title"><span class="callout-icon" aria-hidden="true">${typeInfo.icon}</span><span class="callout-title-text">${escapeHtml(title)}</span></summary><div class="callout-content">`;
        tokens[closeIndex].type = "html_block";
        tokens[closeIndex].tag = "";
        tokens[closeIndex].nesting = 0;
        tokens[closeIndex].content = "</div></details>\n";
      } else {
        open.type = "html_block";
        open.tag = "";
        open.nesting = 0;
        open.content = `<div class="${openClass}" data-callout="${escapeHtml(rawType)}"><div class="callout-title"><span class="callout-icon" aria-hidden="true">${typeInfo.icon}</span><span class="callout-title-text">${escapeHtml(title)}</span></div><div class="callout-content">`;
        tokens[closeIndex].type = "html_block";
        tokens[closeIndex].tag = "";
        tokens[closeIndex].nesting = 0;
        tokens[closeIndex].content = "</div></div>\n";
      }
    }
  });
}

/**
 * Pre-resolve all wikilinks in source content for sync markdown-it render.
 */
export async function buildWikilinkCache(content, env) {
  const cache = {};
  const pattern = /!?\[\[[^\]]+\]\]/g;
  let match = pattern.exec(content);
  while (match) {
    const raw = match[0];
    if (!cache[raw]) {
      const parsed = parseWikilinkTarget(raw);
      if (parsed) {
        cache[raw] = await resolveLinkContext(env, parsed);
      }
    }
    match = pattern.exec(content);
  }
  return cache;
}

export function buildPropertiesModel(data, { resolveMetaLink } = {}) {
  const hiddenKeys = new Set(["title", "summary", "description", "cssclasses", "cssclass"]);
  const cssclasses = []
    .concat(data.cssclasses ?? data.cssclass ?? [])
    .flatMap((value) => String(value).split(/\s+/))
    .map((value) => value.trim())
    .filter(Boolean);

  const rows = [];
  for (const [key, rawValue] of Object.entries(data ?? {})) {
    if (hiddenKeys.has(key)) {
      continue;
    }
    rows.push(formatPropertyRow(key, rawValue, resolveMetaLink));
  }

  return { rows, cssclasses };
}

function formatPropertyRow(key, value, resolveMetaLink) {
  if (value instanceof Date) {
    return {
      label: key,
      kind: "date",
      html: escapeHtml(value.toISOString().slice(0, 10)),
    };
  }

  if (typeof value === "boolean") {
    return {
      label: key,
      kind: "boolean",
      html: value ? "Yes" : "No",
    };
  }

  if (Array.isArray(value)) {
    const chips = value
      .map((item) => {
        const text = String(item);
        const wiki = text.match(/^\[\[(.+)\]\]$/);
        if (wiki && resolveMetaLink) {
          const href = resolveMetaLink(wiki[1]);
          if (href) {
            return `<a class="property-chip wikilink" href="${escapeHtml(href)}">${escapeHtml(wiki[1])}</a>`;
          }
        }
        if (key === "tags" || key === "tag") {
          const tag = text.replace(/^#/, "");
          return `<span class="property-chip property-tag" data-tag="${escapeHtml(tag)}">#${escapeHtml(tag)}</span>`;
        }
        return `<span class="property-chip">${escapeHtml(text)}</span>`;
      })
      .join("");
    return { label: key, kind: "list", html: chips || "—" };
  }

  if (value && typeof value === "object") {
    return {
      label: key,
      kind: "object",
      html: escapeHtml(JSON.stringify(value)),
    };
  }

  const text = String(value ?? "");
  if (key === "tags" || key === "tag") {
    const tags = text
      .split(/[,\s]+/)
      .map((part) => part.replace(/^#/, "").trim())
      .filter(Boolean);
    return {
      label: key,
      kind: "list",
      html: tags
        .map(
          (tag) =>
            `<span class="property-chip property-tag" data-tag="${escapeHtml(tag)}">#${escapeHtml(tag)}</span>`,
        )
        .join(""),
    };
  }

  const wiki = text.match(/^\[\[(.+)\]\]$/);
  if (wiki) {
    return {
      label: key,
      kind: "link",
      html: `<span class="property-chip">${escapeHtml(wiki[1])}</span>`,
    };
  }

  return {
    label: key,
    kind: "text",
    html: escapeHtml(text),
  };
}

/**
 * Extract a markdown section by heading text (first match).
 */
export function extractMarkdownSection(content, headingText) {
  if (!headingText) {
    return content;
  }

  const lines = content.split(/\r?\n/);
  const target = headingText.trim().toLowerCase();
  let start = -1;
  let startLevel = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^(#{1,6})\s+(.+?)\s*$/);
    if (!match) {
      continue;
    }
    const text = match[2].trim().toLowerCase();
    if (text === target || slugifyHeading(match[2]) === slugifyHeading(headingText)) {
      start = index + 1;
      startLevel = match[1].length;
      break;
    }
  }

  if (start === -1) {
    return content;
  }

  let end = lines.length;
  for (let index = start; index < lines.length; index += 1) {
    const match = lines[index].match(/^(#{1,6})\s+/);
    if (match && match[1].length <= startLevel) {
      end = index;
      break;
    }
  }

  return lines.slice(start, end).join("\n").trim();
}

export function extractBlockById(content, blockId) {
  if (!blockId) {
    return content;
  }

  const lines = content.split(/\r?\n/);
  const needle = `^${blockId}`;
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].includes(needle)) {
      // Return the paragraph/line without the block id marker
      return lines[index].replace(BLOCK_ID_PATTERN, "").replace(/\s+\^[\w-]+\s*$/, "").trim();
    }
  }

  return content;
}

export { escapeHtml as escapeObsidianHtml, slugifyHeading, CALLOUT_TYPES, path };
