import fs from "node:fs";
import path from "node:path";

// Shared defaults for Vite and standalone Wrangler commands. Managed Linux
// supplies its own checkout-local paths before these defaults are applied.
export function configureToolEnvironment(projectRoot) {
  const runtimeRoot =
    process.env.SITES_RUNTIME_ROOT || path.join(projectRoot, ".sites-runtime");
  const defaults = {
    CLOUDFLARE_CF_FETCH_ENABLED: "false",
    WRANGLER_SEND_METRICS: "false",
    WRANGLER_WRITE_LOGS: "false",
    WRANGLER_LOG_PATH: path.join(runtimeRoot, "wrangler/logs"),
    WRANGLER_REGISTRY_PATH: path.join(runtimeRoot, "wrangler/dev-registry"),
    MINIFLARE_REGISTRY_PATH: path.join(runtimeRoot, "wrangler/registry"),
  };
  for (const [name, value] of Object.entries(defaults)) {
    process.env[name] ??= value;
  }

  const devVarsPath = path.join(projectRoot, ".dev.vars");
  if (fs.existsSync(devVarsPath)) {
    try {
      const content = fs.readFileSync(devVarsPath, "utf8");
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx !== -1) {
          const key = trimmed.slice(0, eqIdx).trim();
          const val = trimmed.slice(eqIdx + 1).trim();
          process.env[key] = val;
        }
      }
    } catch {}
  }
}
