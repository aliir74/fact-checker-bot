import path from "path";
import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    coverage: {
      provider: "istanbul",
      include: ["src/**/*.ts"],
      thresholds: {
        lines: 95,
        branches: 95,
        functions: 95,
        statements: 95,
      },
    },
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.toml" },
        miniflare: {
          d1Databases: ["DB"],
          bindings: {
            TELEGRAM_BOT_TOKEN: "test-bot-token",
            OPENROUTER_API_KEY: "test-openrouter-key",
            GOOGLE_FACT_CHECK_API_KEY: "test-google-key",
            TELEGRAM_WEBHOOK_SECRET: "test-webhook-secret",
          },
        },
      },
    },
  },
  resolve: {
    alias: {
      "@sentry/cloudflare": path.resolve(__dirname, "test/__mocks__/sentry.ts"),
    },
  },
});
