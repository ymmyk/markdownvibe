import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

export function loadConfig(overrides = {}) {
  const contentRoot = path.resolve(
    overrides.contentRoot ??
      process.env.MARKDOWNVIBE_CONTENT_DIR ??
      path.join(projectRoot, "content"),
  );
  const themeDir = path.resolve(
    overrides.themeDir ??
      process.env.MARKDOWNVIBE_THEME_DIR ??
      path.join(projectRoot, "theme", "default"),
  );

  return {
    projectRoot,
    contentRoot,
    themeDir,
    host: overrides.host ?? process.env.HOST ?? "0.0.0.0",
    port: Number(overrides.port ?? process.env.PORT ?? 3000),
    assetPrefix: overrides.assetPrefix ?? "/_markdownvibe",
  };
}
