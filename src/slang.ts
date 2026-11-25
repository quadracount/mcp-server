import { normalize } from "./money";

export type SlangResult =
  | {
      ok: true;
      amount: number;
      direction: "menos" | "mas" | null;
      /** Trozo reconocido, por ejemplo "5 lucas". */
      matched: string;
    }
  | { ok: false; reason: string };

const WORD_NUMBERS: Record<string, number> = {
  un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6,
  siete: 7, ocho: 8, nueve: 9, diez: 10, quince: 15, veinte: 20,
  treinta: 30, cuarenta: 40, cincuenta: 50, cien: 100,
};

const UNIT_SCALE: Record<string, number> = {
  luca: 1000, lucas: 1000, mil: 1000, k: 1000,
  palo: 1_000_000, palos: 1_000_000,
  peso: 1, pesos: 1,
};

const UNITS = "lucas|luca|mil|k|palos|palo|pesos|peso";
const DIGITS = new RegExp(
  `(\\$\\s?)?(\\d{1,3}(?:\\.\\d{3})+|\\d+(?:,\\d+)?)\\s*(${UNITS})?\\b(\\s+y\\s+media)?`,
  "g",
);
const WORDS = new RegExp(
  `\\b(${Object.keys(WORD_NUMBERS).join("|")})\\s+(${UNITS})\\b(\\s+y\\s+media)?`,
  "g",
);
const HALF_LUCA = /\bmedia\s+luca\b/g;
const LUCA_AND_HALF = /(?<!\b(?:un|una|uno)\s+)\bluca\s+y\s+media\b/g;

interface Candidate {
  amount: number;
  matched: string;
}

function fromDigits(match: RegExpMatchArray): Candidate {
  const [matched, dollar, rawQty, unit, half] = match;
  const qty = rawQty.includes(".")
    ? Number(rawQty.replaceAll(".", ""))
    : Number(rawQty.replace(",", "."));

  let scale: number;
  if (unit) scale = UNIT_SCALE[unit];
  else if (dollar) scale = 1;
  // "Diego pone 5 menos": un número chico sin unidad se entiende en lucas
  else scale = qty >= 1000 ? 1 : 1000;

  const extra = half && unit ? scale / 2 : 0;
  return { amount: Math.round(qty * scale + extra), matched: matched.trim() };
}

function fromWords(match: RegExpMatchArray): Candidate {
  const [matched, word, unit, half] = match;
  const scale = UNIT_SCALE[unit];
  const extra = half ? scale / 2 : 0;
  return { amount: WORD_NUMBERS[word] * scale + extra, matched: matched.trim() };
}

/**
 * Convierte una expresión con un monto en pesos chilenos ("45 lucas",
 * "una luca", "5 lucas menos", "$45.000") a pesos enteros. Determinista, sin LLM.
 */
export function resolveMonetarySlang(expression: string): SlangResult {
  const text = normalize(expression);

  const candidates: Candidate[] = [
    ...[...text.matchAll(DIGITS)].map(fromDigits),
    ...[...text.matchAll(WORDS)].map(fromWords),
    ...[...text.matchAll(HALF_LUCA)].map((m) => ({ amount: 500, matched: m[0] })),
    ...[...text.matchAll(LUCA_AND_HALF)].map((m) => ({ amount: 1500, matched: m[0] })),
  ];

  if (candidates.length === 0) {
    return { ok: false, reason: `No encontré un monto en "${expression}"` };
  }
  if (candidates.length > 1) {
    return {
      ok: false,
      reason: `"${expression}" tiene más de un monto (${candidates
        .map((c) => c.matched)
        .join(", ")}); pásalos por separado`,
    };
  }

  const [{ amount, matched }] = candidates;
  if (!Number.isInteger(amount) || amount <= 0) {
    return { ok: false, reason: `"${matched}" no es un monto válido en pesos` };
  }

  const less = /\bmenos\b/.test(text);
  const more = /\bmas\b/.test(text);
  if (less && more) {
    return { ok: false, reason: `"${expression}" dice "más" y "menos" a la vez` };
  }

  return { ok: true, amount, direction: less ? "menos" : more ? "mas" : null, matched };
}
