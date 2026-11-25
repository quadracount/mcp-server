import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  type CallToolResult,
  ErrorCode,
  McpError,
  type ReadResourceResult,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { BffError, type BffClient } from "./bff";
import { resolveMonetarySlang } from "./slang";
import { computeSplit } from "./split";

interface RequestExtra {
  requestInfo?: { headers: Record<string, string | string[] | undefined> };
}

/**
 * Usuario a cuyo nombre se piden los datos. Viene en un header de la petición
 * MCP y no en los argumentos, para que el LLM no pueda elegirlo.
 */
function requesterFrom(extra: RequestExtra): string {
  const value = extra.requestInfo?.headers["x-requester-id"];
  const requester = Array.isArray(value) ? value[0] : value;
  if (!requester) throw new BffError(400, "Falta el header X-Requester-Id");
  return requester;
}

function json(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
}

function toolError(message: string): CallToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

function variable(value: string | string[]): string {
  return Array.isArray(value) ? value[0] : value;
}

/** Lee un resource del BFF; el estado HTTP (403, 404...) viaja en el error MCP. */
async function readJson(uri: URL, load: () => Promise<unknown>): Promise<ReadResourceResult> {
  try {
    const data = await load();
    return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(data) }] };
  } catch (error) {
    if (error instanceof BffError) {
      throw new McpError(ErrorCode.InvalidRequest, error.message, {
        status: error.status,
        message: error.message,
      });
    }
    throw error;
  }
}

export function createMcpServer(bff: BffClient): McpServer {
  const server = new McpServer({ name: "quadracount", version: "1.0.0" });

  server.registerTool(
    "lookup_group_members",
    {
      title: "Miembros del grupo",
      description:
        "Devuelve los miembros del grupo, en orden, como [{ userId, name }]. Úsala para saber a quién se refiere cada nombre del texto.",
      inputSchema: { groupId: z.string() },
      annotations: { readOnlyHint: true },
    },
    async ({ groupId }, extra) => {
      try {
        return json(await bff.getMembers(groupId, requesterFrom(extra)));
      } catch (error) {
        if (error instanceof BffError) return toolError(error.message);
        throw error;
      }
    },
  );

  server.registerTool(
    "resolve_monetary_slang",
    {
      title: "Monto en pesos",
      description:
        'Convierte una expresión con un solo monto a pesos chilenos enteros: "45 lucas" -> 45000, "una luca" -> 1000, "5 lucas menos" -> 5000 con direction "menos", "$18.000" -> 18000. Pásale el trozo de texto tal cual aparece.',
      inputSchema: { expression: z.string() },
      annotations: { readOnlyHint: true },
    },
    ({ expression }) => {
      const result = resolveMonetarySlang(expression);
      if (!result.ok) return toolError(result.reason);
      const { amount, direction, matched } = result;
      return json({ amount, direction, matched });
    },
  );

  server.registerTool(
    "validate_split_consistency",
    {
      title: "Dividir y verificar",
      description:
        "Divide el total en partes iguales entre los participantes y aplica los ajustes (delta negativo: paga menos que el resto). El resto de una división no exacta se reparte de a $1 en el orden de los participantes. Devuelve la parte de cada uno y si la suma cuadra con el total.",
      inputSchema: {
        total: z.number().int(),
        participants: z.array(z.object({ userId: z.string(), name: z.string().optional() })),
        adjustments: z
          .array(z.object({ userId: z.string(), delta: z.number().int() }))
          .optional(),
      },
      annotations: { readOnlyHint: true },
    },
    ({ total, participants, adjustments }) => {
      const result = computeSplit({
        total,
        participants: participants.map((p) => ({ userId: p.userId, name: p.name ?? p.userId })),
        adjustments: adjustments ?? [],
      });
      if (!result.ok) return toolError(result.reason);
      const { ok: _ok, ...data } = result;
      return json(data);
    },
  );

  server.registerResource(
    "group-members",
    new ResourceTemplate("group://{groupId}/members", { list: undefined }),
    {
      title: "Miembros del grupo",
      description: "Miembros del grupo como [{ userId, name }]",
      mimeType: "application/json",
    },
    (uri, { groupId }, extra) =>
      readJson(uri, () => bff.getMembers(variable(groupId), requesterFrom(extra))),
  );

  server.registerResource(
    "group-balances",
    new ResourceTemplate("group://{groupId}/balances", { list: undefined }),
    {
      title: "Saldos del grupo",
      description: "Saldo neto de cada miembro como [{ userId, name, net }]",
      mimeType: "application/json",
    },
    (uri, { groupId }, extra) =>
      readJson(uri, () => bff.getBalances(variable(groupId), requesterFrom(extra))),
  );

  return server;
}
