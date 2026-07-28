import { defineConfig } from "vitest/config";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Load the repo-root .env so DATABASE_URL is available to the integration tests.
// (Vitest doesn't auto-load .env.) Walk up from this package to find it.
function loadEnvFile(path: string): void {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return;
  }
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

loadEnvFile(resolve(__dirname, "../../.env"));

export default defineConfig({
  test: {
    // The integration tests hit a real DB; give them room.
    testTimeout: 15000,
    // Run serially — they share + truncate the same DB.
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
  },
});
