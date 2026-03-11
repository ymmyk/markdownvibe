import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const defaultProjectRoot = path.resolve(__dirname, "..");
const defaultConfigCandidates = ["config.yml", "config.yaml", "config.json"];

function findConfigPath(projectRoot, explicitPath) {
  if (explicitPath) {
    return path.resolve(explicitPath);
  }

  for (const candidate of defaultConfigCandidates) {
    const candidatePath = path.join(projectRoot, candidate);
    if (existsSync(candidatePath)) {
      return candidatePath;
    }
  }

  return null;
}

function parseConfigFile(configPath) {
  const raw = readFileSync(configPath, "utf8");

  if (configPath.endsWith(".json")) {
    return JSON.parse(raw);
  }

  return YAML.parse(raw) ?? {};
}

function normalizeWebPath(value) {
  const raw = String(value ?? "").trim();
  if (raw === "" || raw === "/") {
    return "/";
  }

  const cleaned = raw.replace(/^\/+|\/+$/g, "");
  return `/${cleaned}`;
}

function toCacheKey(webPath) {
  if (webPath === "/") {
    return "_root";
  }

  return webPath
    .slice(1)
    .split("/")
    .map((segment) => segment.replace(/[^a-zA-Z0-9._-]/g, "_"))
    .join(path.sep);
}

function normalizeMounts(rawPaths, baseDir) {
  const mounts = rawPaths.map((entry) => {
    const fullPath = entry.full_path ?? entry.fullPath;
    const webPath = entry.web_path ?? entry.webPath ?? "";

    if (!fullPath) {
      throw new Error("Each configured path requires full_path.");
    }

    const normalizedWebPath = normalizeWebPath(webPath);
    return {
      fullPath: path.resolve(baseDir, fullPath),
      webPath: normalizedWebPath,
      cacheKey: toCacheKey(normalizedWebPath),
    };
  });

  mounts.sort((left, right) => right.webPath.length - left.webPath.length);

  const duplicates = new Set();
  for (const mount of mounts) {
    if (duplicates.has(mount.webPath)) {
      throw new Error(`Duplicate web_path configured: ${mount.webPath}`);
    }

    duplicates.add(mount.webPath);
  }

  return mounts;
}

export function loadConfig(overrides = {}) {
  const projectRoot = path.resolve(overrides.projectRoot ?? defaultProjectRoot);
  const configPath = findConfigPath(
    projectRoot,
    overrides.configPath ?? process.env.MARKDOWNVIBE_CONFIG,
  );
  const fileConfig = overrides.fileConfig ?? (configPath ? parseConfigFile(configPath) : {});
  const configBaseDir = configPath ? path.dirname(configPath) : projectRoot;

  const configuredPaths =
    overrides.mounts ??
    overrides.paths ??
    fileConfig.paths ??
    (overrides.contentRoot || process.env.MARKDOWNVIBE_CONTENT_DIR || existsSync(path.join(projectRoot, "content"))
      ? [
          {
            full_path: overrides.contentRoot ?? process.env.MARKDOWNVIBE_CONTENT_DIR ?? "./content",
            web_path: "",
          },
        ]
      : []);

  return {
    projectRoot,
    configPath,
    host: overrides.host ?? fileConfig.host ?? process.env.HOST ?? "0.0.0.0",
    port: Number(overrides.port ?? fileConfig.port ?? process.env.PORT ?? 5123),
    appName:
      overrides.appName ??
      fileConfig.app_name ??
      fileConfig.appName ??
      process.env.MARKDOWNVIBE_APP_NAME ??
      "markdownvibe",
    assetPrefix: overrides.assetPrefix ?? fileConfig.asset_prefix ?? fileConfig.assetPrefix ?? "/_markdownvibe",
    themeDir: path.resolve(
      configBaseDir,
      overrides.themeDir ??
        fileConfig.theme_dir ??
        fileConfig.themeDir ??
        process.env.MARKDOWNVIBE_THEME_DIR ??
        "./theme/default",
    ),
    outputRoot: path.resolve(
      configBaseDir,
      overrides.outputRoot ??
        fileConfig.output_dir ??
        fileConfig.outputDir ??
        process.env.MARKDOWNVIBE_OUTPUT_DIR ??
        "./output",
    ),
    mounts: normalizeMounts(configuredPaths, configBaseDir),
  };
}
