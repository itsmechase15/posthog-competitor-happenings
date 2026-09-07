#!/usr/bin/env node
import { loadConfig } from "./config.js";
import { createLogger } from "./log.js";
import { runCycle } from "./pipeline.js";

const log = createLogger("run");

async function main(): Promise<void> {
  const config = loadConfig();
  const startedAt = Date.now();

  log.info(
    `starting run (dryRun=${config.dryRun}, database=${config.databaseUrl ? "postgres" : "memory"}, analyzer=${
      config.cursorApiKey ? `${config.cursorModel} via ${config.cursorRuntime}` : "heuristic fallback"
    })`,
  );

  const summary = await runCycle(config);
  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);

  log.info(
    `done in ${seconds}s — ${summary.candidates} candidates, ${summary.newItems} new (${summary.seeded} seeded), ${summary.analyzed} analyzed, ${summary.posted} posted`,
  );
  for (const note of summary.notes) log.info(`note: ${note}`);
}

main().catch((error: unknown) => {
  log.error("run failed", error instanceof Error ? (error.stack ?? error.message) : error);
  process.exitCode = 1;
});
