import vinext from "vinext";
import { defineConfig } from "vite";
import hostingConfig from "./.openai/hosting.json";
import { readExecutionProfile } from "./scripts/execution-profile.mjs";
import { configureToolEnvironment } from "./scripts/tool-environment.mjs";
import { sites } from "./scripts/vite/sites-vite-plugin";
import { connectorPreview } from "./scripts/vite/connector-preview-plugin.mjs";

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  "00000000-0000-4000-8000-000000000000";

const { d1, r2 } = hostingConfig;

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";
const managedLinux = readExecutionProfile() === "managed-linux";

const localBindingConfig = {
  main: "./worker/index.ts",
  compatibility_flags: ["nodejs_compat"],
  // Local Wrangler delivery is simulated unless a remote email binding is
  // explicitly requested. Never add `remote: true` to the default config.
  send_email: [{ name: "EMAIL" }],
  vars: {
    HARNESS_MAIL_MODE: process.env.HARNESS_MAIL_MODE || "local",
    ...(process.env.HARNESS_GOOGLE_CLIENT_ID ? { HARNESS_GOOGLE_CLIENT_ID: process.env.HARNESS_GOOGLE_CLIENT_ID } : {}),
    ...(process.env.FIREBASE_API_KEY ? { FIREBASE_API_KEY: process.env.FIREBASE_API_KEY } : {}),
    ...(process.env.FIREBASE_PROJECT_ID ? { FIREBASE_PROJECT_ID: process.env.FIREBASE_PROJECT_ID } : {}),
    ...(process.env.HARNESS_S3_BUCKET ? { HARNESS_S3_BUCKET: process.env.HARNESS_S3_BUCKET } : {}),
    ...(process.env.HARNESS_S3_REGION ? { HARNESS_S3_REGION: process.env.HARNESS_S3_REGION } : {}),
    ...(process.env.HARNESS_S3_ACCESS_KEY_ID ? { HARNESS_S3_ACCESS_KEY_ID: process.env.HARNESS_S3_ACCESS_KEY_ID } : {}),
    ...(process.env.HARNESS_S3_SECRET_ACCESS_KEY ? { HARNESS_S3_SECRET_ACCESS_KEY: process.env.HARNESS_S3_SECRET_ACCESS_KEY } : {}),
    ...(process.env.HARNESS_S3_SESSION_TOKEN ? { HARNESS_S3_SESSION_TOKEN: process.env.HARNESS_S3_SESSION_TOKEN } : {}),
    ...(process.env.HARNESS_TURNSTILE_SITE_KEY ? { HARNESS_TURNSTILE_SITE_KEY: process.env.HARNESS_TURNSTILE_SITE_KEY } : {}),
    ...(process.env.HARNESS_TURNSTILE_SECRET_KEY ? { HARNESS_TURNSTILE_SECRET_KEY: process.env.HARNESS_TURNSTILE_SECRET_KEY } : {}),
    ...(process.env.HARNESS_TERMS_VERSION ? { HARNESS_TERMS_VERSION: process.env.HARNESS_TERMS_VERSION } : {}),
    ...(process.env.HARNESS_PRIVACY_VERSION ? { HARNESS_PRIVACY_VERSION: process.env.HARNESS_PRIVACY_VERSION } : {}),
    ...(process.env.HARNESS_MAIL_FROM ? { HARNESS_MAIL_FROM: process.env.HARNESS_MAIL_FROM } : {}),
    ...(process.env.HARNESS_MAIL_API_URL ? { HARNESS_MAIL_API_URL: process.env.HARNESS_MAIL_API_URL } : {}),
    ...(process.env.HARNESS_MAIL_API_KEY ? { HARNESS_MAIL_API_KEY: process.env.HARNESS_MAIL_API_KEY } : {}),
    ...(process.env.OPENAI_API_KEY ? { OPENAI_API_KEY: process.env.OPENAI_API_KEY } : {}),
    ...(process.env.HARNESS_MODEL ? { HARNESS_MODEL: process.env.HARNESS_MODEL } : {}),
    ...(process.env.HARNESS_WORKER_SECRET ? { HARNESS_WORKER_SECRET: process.env.HARNESS_WORKER_SECRET } : {}),
  },
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: "site-creator-d1",
          database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
        },
      ]
    : [],
  r2_buckets: r2
    ? [
        {
          binding: r2,
          bucket_name: "site-creator-r2",
        },
      ]
    : [],
};

export default defineConfig(async ({ command }) => {
  configureToolEnvironment(process.cwd());

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    server: {
      ...(managedLinux
        ? { host: "0.0.0.0", allowedHosts: ["terminal.local"] }
        : {}),
      ...(isCodexSeatbeltSandbox
        ? { watch: { useFsEvents: false, usePolling: true } }
        : {}),
    },
    plugins: [
      vinext(),
      sites({ mockAuth: !managedLinux }),
      connectorPreview(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        inspectorPort: false,
        config: {
          ...localBindingConfig,
          ...(command === "serve"
            ? {
                services: [
                  {
                    binding: "CONNECTORS",
                    service: "sites-connector-preview",
                    entrypoint: "ConnectorPreview",
                  },
                ],
              }
            : {}),
        },
        ...(command === "serve"
          ? {
              auxiliaryWorkers: [
                {
                  config: {
                    name: "sites-connector-preview",
                    main: "./scripts/connector-preview/worker.mjs",
                    compatibility_date: "2026-05-15",
                  },
                },
              ],
            }
          : {}),
      }),
    ],
  };
});
