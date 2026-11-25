import type Anthropic from "@anthropic-ai/sdk";

export type LlmMode = "llm" | "fallback";

export interface Config {
  port: number;
  bffInternalUrl: string;
  internalApiKey: string;
  llmMode: LlmMode;
  llmModel: string;
  /** URL del propio servidor MCP; se completa al empezar a escuchar. */
  mcpUrl: string;
  /** Solo para los tests: un cliente apuntando a una API falsa. */
  anthropic?: Anthropic;
}

const DEV_INTERNAL_KEY = "dev-internal-key";

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  let internalApiKey = env.INTERNAL_API_KEY ?? "";
  if (!internalApiKey) {
    if (env.NODE_ENV === "production") {
      throw new Error("Falta la variable de entorno INTERNAL_API_KEY");
    }
    console.warn("INTERNAL_API_KEY no definida: se usa la de desarrollo");
    internalApiKey = DEV_INTERNAL_KEY;
  }

  const port = Number(env.PORT ?? 3001);
  return {
    port,
    bffInternalUrl: env.BFF_INTERNAL_URL ?? "http://localhost:3000",
    internalApiKey,
    llmMode: env.LLM_MODE === "llm" ? "llm" : "fallback",
    llmModel: env.LLM_MODEL ?? "claude-opus-5-5",
    mcpUrl: `http://127.0.0.1:${port}/mcp`,
  };
}
