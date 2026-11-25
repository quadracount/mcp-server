import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { McpToolbox } from "./toolbox";
import type { Extraction, ParseExpenseRequest } from "./types";

const MAX_TURNS = 8;
const DEADLINE_MS = 45_000;

const SYSTEM = `Conviertes la descripción de un gasto compartido, escrita en español de Chile, en un borrador estructurado. No conversas con nadie: tu respuesta final es solo el JSON pedido.

Las tools vienen del servidor MCP de QuadraCount:
- lookup_group_members: los miembros del grupo y su userId.
- resolve_monetary_slang: convierte expresiones como "45 lucas" o "5 lucas menos" a pesos.
- validate_split_consistency: calcula la división y verifica que cuadre con el total.

Nunca calcules montos por tu cuenta; cualquier número sale de las tools.

En el JSON final:
- description: qué se compró o pagó, corto, sin el verbo ni el monto. Ej.: "Mercadería y útiles de aseo".
- totalPhrase: el trozo del texto con el monto total. Ej.: "45 lucas".
- adjustments: una entrada por cada persona que paga distinto al resto. phrase es el trozo con el nombre y el monto (ej.: "Diego pone 5 lucas menos") y userId el de esa persona.
- participants: los userId de quienes se reparten el gasto, solo si el texto deja a alguien fuera; si participan todos, lista vacía.
- equalSplitPhrase: el trozo que dice cómo se reparte (ej.: "el resto en partes iguales"), o null.

Los trozos se copian literalmente del texto, con las mismas mayúsculas y tildes.`;

const ExtractionSchema = z.object({
  description: z.string(),
  totalPhrase: z.string(),
  adjustments: z.array(z.object({ phrase: z.string(), userId: z.string() })),
  participants: z.array(z.string()),
  equalSplitPhrase: z.string().nullable(),
});

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    description: { type: "string" },
    totalPhrase: { type: "string" },
    adjustments: {
      type: "array",
      items: {
        type: "object",
        properties: { phrase: { type: "string" }, userId: { type: "string" } },
        required: ["phrase", "userId"],
        additionalProperties: false,
      },
    },
    participants: { type: "array", items: { type: "string" } },
    equalSplitPhrase: { anyOf: [{ type: "string" }, { type: "null" }] },
  },
  required: ["description", "totalPhrase", "adjustments", "participants", "equalSplitPhrase"],
  additionalProperties: false,
};

async function mcpToolsForClaude(toolbox: McpToolbox): Promise<Anthropic.Beta.BetaTool[]> {
  const { tools } = await toolbox.client.listTools();
  return tools.map((tool) => {
    const { $schema: _ignored, ...schema } = tool.inputSchema as Record<string, unknown>;
    return {
      name: tool.name,
      description: tool.description ?? "",
      input_schema: schema as Anthropic.Beta.BetaTool.InputSchema,
    };
  });
}

/**
 * Loop de tool use: Claude decide qué tools usar, el orquestador las ejecuta
 * contra el servidor MCP y le devuelve los resultados, hasta que Claude
 * entrega el JSON final.
 */
export async function extractWithClaude(
  anthropic: Anthropic,
  model: string,
  toolbox: McpToolbox,
  req: ParseExpenseRequest,
): Promise<Extraction> {
  const tools = await mcpToolsForClaude(toolbox);
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    {
      role: "user",
      content: `groupId: ${req.groupId}\nPagó (userId): ${req.paidBy}\nTexto: """${req.text}"""`,
    },
  ];
  const signal = AbortSignal.timeout(DEADLINE_MS);

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const response = await anthropic.beta.messages.create(
      {
        model,
        max_tokens: 16000,
        // Si el modelo rechaza el texto, la API reintenta sola con otro modelo
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: {
          effort: "medium",
          format: { type: "json_schema", schema: OUTPUT_SCHEMA },
        },
        cache_control: { type: "ephemeral" },
        system: SYSTEM,
        tools,
        messages,
      },
      { signal, maxRetries: 1 },
    );

    if (response.stop_reason === "refusal") throw new Error("El modelo rechazó el texto");
    if (response.stop_reason === "max_tokens") throw new Error("La respuesta del modelo quedó cortada");

    const toolUses = response.content.filter(
      (block): block is Anthropic.Beta.BetaToolUseBlock => block.type === "tool_use",
    );
    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason === "pause_turn") continue;

    if (toolUses.length === 0) {
      const text = response.content
        .filter((block): block is Anthropic.Beta.BetaTextBlock => block.type === "text")
        .map((block) => block.text)
        .join("");
      return ExtractionSchema.parse(JSON.parse(text));
    }

    const results = await Promise.all(
      toolUses.map(async (use): Promise<Anthropic.Beta.BetaToolResultBlockParam> => {
        const { text, isError } = await toolbox.callTool(use.name, use.input as Record<string, unknown>);
        return { type: "tool_result", tool_use_id: use.id, content: text, is_error: isError };
      }),
    );
    messages.push({ role: "user", content: results });
  }

  throw new Error(`El modelo no terminó en ${MAX_TURNS} turnos`);
}
