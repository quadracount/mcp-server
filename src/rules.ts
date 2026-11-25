import { normalize } from "./money";
import { DraftError, type Extraction, type Member } from "./types";

interface Found {
  phrase: string;
  start: number;
  end: number;
}

const TOTAL_PATTERNS = [
  /\b(?:\d[\d.,]*|una|un)\s*lucas?(?:\s+y\s+media)?\b/giu,
  /\b\d[\d.,]*\s*(?:mil|k)\b/giu,
  /\$\s?\d[\d.]*/gu,
  /\b\d{4,}\b/gu,
];

const ADJUSTMENT =
  /(\p{L}+)\s+(?:pone|paga|aporta|ponen|pagan)\s+(?:\d[\d.,]*|una|un)\s*(?:lucas?|mil|k|pesos)?\s*(?:menos|m[aá]s)\b/giu;

const EQUAL_SPLIT = /(?:el resto )?(?:en |a )?partes iguales|mitad y mitad|entre todos/iu;

const VERBS = ["compre", "compramos", "pague", "pagamos", "puse", "pusimos", "gaste", "gastamos"];

function findAdjustments(text: string, members: Member[]): (Found & { userId: string })[] {
  const found: (Found & { userId: string })[] = [];
  for (const match of text.matchAll(ADJUSTMENT)) {
    const name = normalize(match[1]);
    const member = members.find((m) => normalize(m.name).split(/\s+/)[0] === name);
    if (!member) continue;
    const start = match.index;
    found.push({ phrase: match[0], start, end: start + match[0].length, userId: member.userId });
  }
  return found;
}

/** El primer monto del texto que no sea parte de un ajuste ("Diego pone 5 lucas menos"). */
function findTotal(text: string, taken: Found[]): Found | null {
  const candidates: Found[] = [];
  for (const pattern of TOTAL_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      const start = match.index;
      const end = start + match[0].length;
      if (taken.some((t) => start < t.end && end > t.start)) continue;
      candidates.push({ phrase: match[0].trim(), start, end });
    }
  }
  candidates.sort((a, b) => a.start - b.start);
  return candidates[0] ?? null;
}

/** Lo que va antes del monto, sin el verbo: "Compré mercadería por 45 lucas" -> "mercadería". */
function findDescription(text: string, total: Found): string {
  let head = text.slice(0, total.start);
  head = head
    .replace(/[,;.].*$/s, "")
    .replace(/\s+(?:por|de|en)\s*$/i, "")
    .trim();

  const words = head.split(/\s+/).filter(Boolean);
  if (words.length > 0 && VERBS.includes(normalize(words[0]))) words.shift();
  return words.join(" ");
}

/**
 * Parser por reglas para LLM_MODE=fallback (y para cuando el LLM no responde).
 * Resuelve los textos de la demo: monto total, "X pone N lucas menos/más" y
 * "partes iguales".
 */
export function extractWithRules(text: string, members: Member[]): Extraction {
  const adjustments = findAdjustments(text, members);
  const total = findTotal(text, adjustments);
  if (!total) {
    throw new DraftError('No encontré el monto total. Prueba con algo como "45 lucas" o "$45.000".');
  }

  return {
    description: findDescription(text, total),
    totalPhrase: total.phrase,
    adjustments: adjustments.map(({ phrase, userId }) => ({ phrase, userId })),
    participants: [],
    equalSplitPhrase: EQUAL_SPLIT.exec(text)?.[0] ?? null,
  };
}
