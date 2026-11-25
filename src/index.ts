import { startServer } from "./app";
import { loadConfig } from "./config";

async function main() {
  const cfg = loadConfig();
  const server = await startServer(cfg);
  console.log(`mcp-server en el puerto ${cfg.port} (LLM_MODE=${cfg.llmMode})`);

  process.on("SIGTERM", () => server.close(() => process.exit(0)));
}

void main();
