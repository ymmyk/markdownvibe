import { readdir, stat } from "node:fs/promises";
import path from "node:path";

const MEDIA_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".svg",
  ".bmp",
  ".avif",
  ".mp3",
  ".wav",
  ".ogg",
  ".m4a",
  ".mp4",
  ".webm",
  ".pdf",
]);

const indexCache = new Map();
const INDEX_TTL_MS = 2500;

function isHiddenName(name) {
  return name.startsWith(".");
}

async function walkVault(rootDir, currentDir = rootDir, relativeDir = "") {
  const notesByBasename = new Map();
  const mediaByBasename = new Map();
  const notesByRelative = new Map();
  const mediaByRelative = new Map();

  let entries;
  try {
    entries = await readdir(currentDir, { withFileTypes: true });
  } catch {
    return { notesByBasename, mediaByBasename, notesByRelative, mediaByRelative };
  }

  for (const entry of entries) {
    if (isHiddenName(entry.name)) {
      continue;
    }

    const absolutePath = path.join(currentDir, entry.name);
    const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      const nested = await walkVault(rootDir, absolutePath, relativePath);
      for (const [key, value] of nested.notesByBasename) {
        const list = notesByBasename.get(key) ?? [];
        list.push(...value);
        notesByBasename.set(key, list);
      }
      for (const [key, value] of nested.mediaByBasename) {
        const list = mediaByBasename.get(key) ?? [];
        list.push(...value);
        mediaByBasename.set(key, list);
      }
      for (const [key, value] of nested.notesByRelative) {
        notesByRelative.set(key, value);
      }
      for (const [key, value] of nested.mediaByRelative) {
        mediaByRelative.set(key, value);
      }
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const extension = path.extname(entry.name).toLowerCase();
    const posixRelative = relativePath.replace(/\\/g, "/");

    if (extension === ".md") {
      const basename = path.basename(entry.name, extension);
      const key = basename.toLowerCase();
      const list = notesByBasename.get(key) ?? [];
      list.push({ absolutePath, relativePath: posixRelative, basename });
      notesByBasename.set(key, list);
      notesByRelative.set(posixRelative.toLowerCase(), {
        absolutePath,
        relativePath: posixRelative,
        basename,
      });
      const withoutExt = posixRelative.slice(0, -3).toLowerCase();
      notesByRelative.set(withoutExt, {
        absolutePath,
        relativePath: posixRelative,
        basename,
      });
      continue;
    }

    if (MEDIA_EXTENSIONS.has(extension)) {
      const basename = path.basename(entry.name, extension);
      const key = basename.toLowerCase();
      const list = mediaByBasename.get(key) ?? [];
      list.push({ absolutePath, relativePath: posixRelative, basename, extension });
      mediaByBasename.set(key, list);
      mediaByRelative.set(posixRelative.toLowerCase(), {
        absolutePath,
        relativePath: posixRelative,
        basename,
        extension,
      });
      const withoutExt = posixRelative.slice(0, -extension.length).toLowerCase();
      mediaByRelative.set(withoutExt, {
        absolutePath,
        relativePath: posixRelative,
        basename,
        extension,
      });
    }
  }

  return { notesByBasename, mediaByBasename, notesByRelative, mediaByRelative };
}

export async function getVaultIndex(mountRoot) {
  const root = path.resolve(mountRoot);
  const cached = indexCache.get(root);
  if (cached && Date.now() - cached.builtAt < INDEX_TTL_MS) {
    return cached;
  }

  try {
    await stat(root);
  } catch {
    return {
      root,
      builtAt: Date.now(),
      notesByBasename: new Map(),
      mediaByBasename: new Map(),
      notesByRelative: new Map(),
      mediaByRelative: new Map(),
    };
  }

  const walked = await walkVault(root);
  const index = {
    root,
    builtAt: Date.now(),
    ...walked,
  };
  indexCache.set(root, index);
  return index;
}

export function clearVaultIndexCache() {
  indexCache.clear();
}

function preferClosest(candidates, fromDir) {
  if (candidates.length === 1) {
    return candidates[0];
  }

  const fromResolved = path.resolve(fromDir);
  let best = candidates[0];
  let bestScore = Number.POSITIVE_INFINITY;

  for (const candidate of candidates) {
    const candidateDir = path.dirname(candidate.absolutePath);
    const relative = path.relative(fromResolved, candidateDir);
    const depth = relative === "" ? 0 : relative.split(path.sep).length;
    const pathLength = candidate.relativePath.length;
    const score = depth * 1000 + pathLength;
    if (score < bestScore) {
      best = candidate;
      bestScore = score;
    }
  }

  return best;
}

function normalizeTargetPath(targetPath) {
  return String(targetPath ?? "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\//, "");
}

/**
 * Resolve an Obsidian-style link target (no leading !) within a mount.
 */
export async function resolveVaultTarget({
  mountRoot,
  fromMarkdownPath,
  target,
  prefer = "any",
}) {
  const index = await getVaultIndex(mountRoot);
  const cleaned = normalizeTargetPath(target);
  if (!cleaned) {
    return null;
  }

  const fromDir = path.dirname(fromMarkdownPath);
  const hasSlash = cleaned.includes("/");
  const extension = path.extname(cleaned).toLowerCase();
  const isExplicitMedia = MEDIA_EXTENSIONS.has(extension);
  const isExplicitMarkdown = extension === ".md";

  if (hasSlash || isExplicitMedia || isExplicitMarkdown) {
    const relativeKey = cleaned.toLowerCase();
    const relativeKeyNoDot = relativeKey.replace(/^\//, "");

    if (prefer !== "note") {
      const media =
        index.mediaByRelative.get(relativeKeyNoDot) ??
        index.mediaByRelative.get(relativeKey);
      if (media) {
        return { kind: "media", ...media };
      }
    }

    if (prefer !== "media") {
      const note =
        index.notesByRelative.get(relativeKeyNoDot) ??
        index.notesByRelative.get(relativeKey);
      if (note) {
        return { kind: "note", ...note };
      }
    }

    // Relative to current note directory
    const fromRelative = path
      .relative(mountRoot, path.resolve(fromDir, cleaned))
      .replace(/\\/g, "/");
    if (fromRelative && !fromRelative.startsWith("..")) {
      const key = fromRelative.toLowerCase();
      if (prefer !== "note") {
        const media = index.mediaByRelative.get(key);
        if (media) {
          return { kind: "media", ...media };
        }
      }
      if (prefer !== "media") {
        const note =
          index.notesByRelative.get(key) ??
          index.notesByRelative.get(key.endsWith(".md") ? key : `${key}.md`);
        if (note) {
          return { kind: "note", ...note };
        }
        const withMd = index.notesByRelative.get(`${key}.md`);
        if (withMd) {
          return { kind: "note", ...withMd };
        }
      }
    }
  }

  const basename = path.basename(cleaned, path.extname(cleaned)).toLowerCase();

  if (prefer !== "note") {
    const mediaHits = index.mediaByBasename.get(basename) ?? [];
    if (mediaHits.length > 0 && (isExplicitMedia || prefer === "media" || mediaHits.length)) {
      if (isExplicitMedia || prefer === "media") {
        return { kind: "media", ...preferClosest(mediaHits, fromDir) };
      }
    }
  }

  if (prefer !== "media") {
    const noteHits = index.notesByBasename.get(basename) ?? [];
    if (noteHits.length > 0) {
      return { kind: "note", ...preferClosest(noteHits, fromDir) };
    }
  }

  if (prefer !== "note") {
    const mediaHits = index.mediaByBasename.get(basename) ?? [];
    if (mediaHits.length > 0) {
      return { kind: "media", ...preferClosest(mediaHits, fromDir) };
    }
  }

  return null;
}

export function joinMountedWebPath(mount, relativePath = "") {
  const cleaned = String(relativePath).replace(/^\/+/, "");
  if (mount.webPath === "/") {
    return cleaned ? `/${cleaned}` : "/";
  }

  return cleaned ? `${mount.webPath}/${cleaned}` : mount.webPath;
}

export function encodeWebPath(webPath) {
  if (!webPath || webPath === "/") {
    return webPath || "/";
  }

  const hashIndex = webPath.indexOf("#");
  const pathPart = hashIndex === -1 ? webPath : webPath.slice(0, hashIndex);
  const fragment = hashIndex === -1 ? "" : webPath.slice(hashIndex);
  const leadingSlash = pathPart.startsWith("/");
  const encoded = pathPart
    .split("/")
    .map((segment, index) => {
      if (segment === "" && index === 0) {
        return "";
      }
      return encodeURIComponent(segment);
    })
    .join("/");

  return `${leadingSlash ? encoded || "/" : encoded}${fragment}`;
}

export function notePathToWebHref(mount, relativeMarkdownPath, fragment = "") {
  const withoutExt = relativeMarkdownPath.replace(/\.md$/i, "");
  const href = joinMountedWebPath(mount, withoutExt);
  const encoded = encodeWebPath(href);
  if (!fragment) {
    return encoded;
  }

  const normalizedFragment = fragment.startsWith("#") ? fragment.slice(1) : fragment;
  return `${encoded}#${encodeURIComponent(normalizedFragment)}`;
}

export function mediaPathToWebHref(mount, relativeMediaPath) {
  return encodeWebPath(joinMountedWebPath(mount, relativeMediaPath));
}
