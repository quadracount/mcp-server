import { formatPesos } from "./money";
import type { McpToolbox } from "./toolbox";
import {
  DraftError,
  type ExpenseDraft,
  type Extraction,
  type Interpretation,
  type Member,
  type ParseExpenseRequest,
  type Share,
} from "./types";

interface SlangOutput {
  amount: number;
  direction: "menos" | "mas" | null;
}

interface SplitOutput {
  shares: Share[];
  perPerson: number;
  remainder: number;
  adjustmentTotal: number;
  sumMatches: boolean;
}

/** Devuelve el trozo tal como está en el texto, para que el frontend lo pueda resaltar. */
function literal(text: string, phrase: string): string {
  const start = text.toLowerCase().indexOf(phrase.toLowerCase());
  return start >= 0 ? text.slice(start, start + phrase.length) : phrase;
}

function splitMeaning(total: number, split: SplitOutput, people: number): string {
  const { adjustmentTotal, perPerson, remainder } = split;
  const base =
    adjustmentTotal === 0
      ? formatPesos(total)
      : `(${formatPesos(total)} ${adjustmentTotal < 0 ? "+" : "−"} ${formatPesos(adjustmentTotal)})`;
  let meaning = `${base} ÷ ${people} = ${formatPesos(perPerson)} por persona`;
  if (remainder === 1) meaning += "; el primero pone $1 más";
  if (remainder > 1) meaning += `; los primeros ${remainder} ponen $1 más`;
  return meaning;
}

function capitalize(text: string): string {
  const trimmed = text.trim();
  return trimmed ? trimmed.charAt(0).toUpperCase() + trimmed.slice(1) : "Gasto";
}

/**
 * Arma el borrador a partir de lo que se entendió del texto. Es igual en los
 * dos modos (LLM y reglas): todos los montos salen de las tools MCP.
 */
export async function buildDraft(
  toolbox: McpToolbox,
  req: ParseExpenseRequest,
  members: Member[],
  extraction: Extraction,
): Promise<ExpenseDraft> {
  const byId = new Map(members.map((m) => [m.userId, m]));
  const paidBy = byId.get(req.paidBy);
  if (!paidBy) throw new DraftError("Quien pagó no es miembro del grupo");

  const participants = extraction.participants.length
    ? members.filter((m) => extraction.participants.includes(m.userId))
    : members;
  if (participants.length === 0) {
    throw new DraftError("No quedó nadie para repartir el gasto");
  }

  if (!extraction.totalPhrase.trim()) {
    throw new DraftError('No encontré el monto total. Prueba con algo como "45 lucas" o "$45.000".');
  }
  const total = await toolbox.callJson<SlangOutput>("resolve_monetary_slang", {
    expression: extraction.totalPhrase,
  });
  const interpretations: Interpretation[] = [
    { phrase: literal(req.text, extraction.totalPhrase), meaning: `Monto total: ${formatPesos(total.amount)}` },
  ];

  const adjustments: { userId: string; delta: number }[] = [];
  for (const { phrase, userId } of extraction.adjustments) {
    const member = byId.get(userId);
    if (!member) throw new DraftError(`No encontré en el grupo a la persona de "${phrase}"`);

    const adjustment = await toolbox.callJson<SlangOutput>("resolve_monetary_slang", { expression: phrase });
    if (!adjustment.direction) {
      throw new DraftError(`En "${phrase}" no queda claro si paga más o menos que el resto`);
    }
    adjustments.push({
      userId,
      delta: adjustment.direction === "menos" ? -adjustment.amount : adjustment.amount,
    });
    interpretations.push({
      phrase: literal(req.text, phrase),
      meaning: `${member.name} paga ${formatPesos(adjustment.amount)} ${
        adjustment.direction === "menos" ? "menos" : "más"
      } que el resto`,
    });
  }

  const split = await toolbox.callJson<SplitOutput>("validate_split_consistency", {
    total: total.amount,
    participants,
    adjustments,
  });

  if (extraction.equalSplitPhrase) {
    interpretations.push({
      phrase: literal(req.text, extraction.equalSplitPhrase),
      meaning: splitMeaning(total.amount, split, participants.length),
    });
  }

  return {
    description: capitalize(extraction.description),
    amount: total.amount,
    paidBy,
    shares: split.shares,
    interpretations,
    sumMatches: split.sumMatches,
  };
}
