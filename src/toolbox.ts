import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Config } from "./config";
import { DraftError, type Member } from "./types";

export interface ToolResult {
  text: string;
  isError: boolean;
}

/**
 * Cliente MCP del orquestador contra el servidor MCP de este mismo proceso.
 * Todas las tools y resources pasan por aquí, igual que si las llamara otro
 * cliente MCP.
 */
export class McpToolbox {
  private constructor(readonly client: Client) {}

  static async connect(cfg: Config, requesterId: string): Promise<McpToolbox> {
    const client = new Client({ name: "quadracount-orquestador", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(cfg.mcpUrl), {
      requestInit: {
        headers: { "X-Internal-Key": cfg.internalApiKey, "X-Requester-Id": requesterId },
      },
    });
    await client.connect(transport);
    return new McpToolbox(client);
  }

  close(): Promise<void> {
    return this.client.close();
  }

  async readMembers(groupId: string): Promise<Member[]> {
    const result = await this.client.readResource({ uri: `group://${groupId}/members` });
    const [content] = result.contents;
    if (!content || !("text" in content)) throw new Error("Resource de miembros vacío");
    return JSON.parse(content.text) as Member[];
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    try {
      const result = await this.client.callTool({ name, arguments: args });
      const content = (result.content ?? []) as { type: string; text?: string }[];
      const text = content
        .filter((c) => c.type === "text")
        .map((c) => c.text ?? "")
        .join("\n");
      return { text, isError: Boolean(result.isError) };
    } catch (error) {
      return { text: error instanceof Error ? error.message : String(error), isError: true };
    }
  }

  /** Llama una tool y devuelve su JSON; si la tool responde con error, el texto no se pudo interpretar. */
  async callJson<T>(name: string, args: Record<string, unknown>): Promise<T> {
    const { text, isError } = await this.callTool(name, args);
    if (isError) throw new DraftError(text);
    return JSON.parse(text) as T;
  }
}
