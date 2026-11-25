import Anthropic from "@anthropic-ai/sdk";
import type { Config } from "./config";
import { buildDraft } from "./draft";
import { extractWithClaude } from "./llm";
import { extractWithRules } from "./rules";
import { McpToolbox } from "./toolbox";
import type { ExpenseDraft, Member, ParseExpenseRequest } from "./types";

let anthropic: Anthropic | undefined;

function claudeClient(cfg: Config): Anthropic {
  if (cfg.anthropic) return cfg.anthropic;
  // Toma ANTHROPIC_API_KEY del entorno
  anthropic ??= new Anthropic();
  return anthropic;
}

async function draftWithClaude(
  cfg: Config,
  toolbox: McpToolbox,
  req: ParseExpenseRequest,
  members: Member[],
): Promise<ExpenseDraft | null> {
  try {
    const extraction = await extractWithClaude(claudeClient(cfg), cfg.llmModel, toolbox, req);
    return await buildDraft(toolbox, req, members, extraction);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.warn(`El LLM no resolvió el texto (${reason}); se usa el parser por reglas`);
    return null;
  }
}

/**
 * Convierte el texto en un borrador. Con LLM_MODE=llm lo interpreta Claude;
 * si el LLM falla, o con LLM_MODE=fallback, lo interpretan las reglas.
 * En los dos casos los montos los calculan las tools MCP.
 */
export async function parseExpense(cfg: Config, req: ParseExpenseRequest): Promise<ExpenseDraft> {
  const toolbox = await McpToolbox.connect(cfg, req.requesterId);
  try {
    const members = await toolbox.readMembers(req.groupId);

    if (cfg.llmMode === "llm") {
      const draft = await draftWithClaude(cfg, toolbox, req, members);
      if (draft) return draft;
    }

    const extraction = extractWithRules(req.text, members);
    return await buildDraft(toolbox, req, members, extraction);
  } finally {
    await toolbox.close();
  }
}
