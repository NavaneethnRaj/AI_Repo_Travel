import { readConfig } from "./config.js";
import { buildServer } from "./server.js";

async function main() {
  const config = readConfig(process.env);
  // Load and validate the bundled catalogue and parser schema before listening.
  await import("./spike.js");
  const app = buildServer(config);

  let closing = false;
  async function close() {
    if (closing) return;
    closing = true;
    try {
      await app.close();
    } catch {
      app.log.error("Shutdown failed");
      process.exitCode = 1;
    }
  }

  process.once("SIGTERM", close);
  process.once("SIGINT", close);

  try {
    await app.listen({
      host: config.HOST,
      port: config.PORT,
      listenTextResolver: () => "Wayfarer is listening",
    });
  } catch (error) {
    await close();
    const code = error instanceof Error && "code" in error && typeof error.code === "string"
      ? error.code
      : "unknown error";
    throw new Error(`Could not start the HTTP listener (${code})`);
  }
}

try {
  await main();
} catch (error) {
  console.error("Startup failed:", error instanceof Error ? error.message : "Unknown error");
  process.exitCode = 1;
}
