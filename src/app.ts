import { timingSafeEqual } from "node:crypto";
import type { Server } from "node:http";
import { McpError } from "@modelcontextprotocol/sdk/types.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express, { type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { BffClient, BffError } from "./bff";
import type { Config } from "./config";
import { createMcpServer } from "./mcp-server";
import { parseExpense } from "./orchestrator";
import { DraftError } from "./types";

const ParseBody = z.object({
  groupId: z.string().min(1),
  text: z.string().trim().min(1).max(1000),
  paidBy: z.string().min(1),
  requesterId: z.string().min(1),
});

function sameKey(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * /automation y /mcp solo los usa el BFF (y el propio orquestador). Sin la clave
 * cualquiera dentro del cluster podría pedir datos a nombre de otro usuario.
 */
function requireInternalKey(key: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (sameKey(req.header("x-internal-key") ?? "", key)) return next();
    res.status(401).json({ message: "Falta o no es válida la clave interna (X-Internal-Key)" });
  };
}

export function createApp(cfg: Config) {
  const bff = new BffClient(cfg.bffInternalUrl, cfg.internalApiKey);
  const app = express();
  app.use(express.json({ limit: "64kb" }));

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", llmMode: cfg.llmMode });
  });

  app.use(["/automation", "/mcp"], requireInternalKey(cfg.internalApiKey));

  app.post("/automation/parse-expense", async (req, res) => {
    const body = ParseBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ message: "Faltan groupId, text, paidBy o requesterId" });
      return;
    }
    try {
      res.json(await parseExpense(cfg, body.data));
    } catch (error) {
      if (error instanceof DraftError) {
        res.status(422).json({ message: error.message });
      } else if (error instanceof BffError) {
        res.status(error.status).json({ message: error.message });
      } else if (error instanceof McpError) {
        // El resource deja en data el estado y el mensaje que respondió el BFF
        const data = (error.data ?? {}) as { status?: number; message?: string };
        res.status(data.status ?? 502).json({ message: data.message ?? error.message });
      } else {
        throw error;
      }
    }
  });

  // Modo sin sesión: un servidor MCP nuevo por petición
  app.post("/mcp", async (req, res) => {
    const server = createMcpServer(bff);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  app.all("/mcp", (_req, res) => {
    res.status(405).json({ message: "El servidor MCP funciona sin sesión: solo POST" });
  });

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const status = (error as { status?: number }).status;
    if (status === 400 || status === 413) {
      res.status(status).json({ message: "Cuerpo de la petición inválido" });
      return;
    }
    console.error(error);
    res.status(500).json({ message: "Error interno del mcp-server" });
  });

  return app;
}

/** Empieza a escuchar y deja en cfg.mcpUrl la dirección real (en los tests el puerto es 0). */
export function startServer(cfg: Config): Promise<Server> {
  return new Promise((resolve) => {
    const server = createApp(cfg).listen(cfg.port, () => {
      const address = server.address();
      if (address && typeof address === "object") {
        cfg.mcpUrl = `http://127.0.0.1:${address.port}/mcp`;
      }
      resolve(server);
    });
  });
}
