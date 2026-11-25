import type { Member, Share } from "./types";

export interface SplitInput {
  total: number;
  /** En el orden de la lista de miembros: define a quién le toca el $1 de resto. */
  participants: Member[];
  /** Negativo: paga menos que el resto. Positivo: paga más. */
  adjustments: { userId: string; delta: number }[];
}

export type SplitResult =
  | {
      ok: true;
      shares: Share[];
      /** Monto que se reparte en partes iguales: total − suma de ajustes. */
      evenTotal: number;
      perPerson: number;
      remainder: number;
      adjustmentTotal: number;
      sumMatches: boolean;
    }
  | { ok: false; reason: string };

/**
 * Divide el total en partes iguales y aplica los ajustes. Si la división no
 * es exacta, el resto se reparte de a $1 en el orden de los participantes.
 */
export function computeSplit({ total, participants, adjustments }: SplitInput): SplitResult {
  if (!Number.isInteger(total) || total <= 0) {
    return { ok: false, reason: "El total tiene que ser un entero mayor que 0" };
  }
  if (participants.length === 0) {
    return { ok: false, reason: "No hay participantes" };
  }
  const ids = new Set(participants.map((p) => p.userId));
  if (ids.size !== participants.length) {
    return { ok: false, reason: "Hay participantes repetidos" };
  }

  const deltas = new Map<string, number>();
  for (const { userId, delta } of adjustments) {
    if (!ids.has(userId)) {
      return { ok: false, reason: `${userId} tiene un ajuste pero no participa` };
    }
    if (!Number.isInteger(delta)) {
      return { ok: false, reason: "Los ajustes tienen que ser enteros" };
    }
    deltas.set(userId, (deltas.get(userId) ?? 0) + delta);
  }

  const adjustmentTotal = [...deltas.values()].reduce((a, b) => a + b, 0);
  const evenTotal = total - adjustmentTotal;
  if (evenTotal <= 0) {
    return { ok: false, reason: "Los ajustes son mayores que el total" };
  }

  const perPerson = Math.floor(evenTotal / participants.length);
  const remainder = evenTotal - perPerson * participants.length;

  const shares = participants.map((p, i) => ({
    userId: p.userId,
    name: p.name,
    amount: perPerson + (i < remainder ? 1 : 0) + (deltas.get(p.userId) ?? 0),
  }));

  const negative = shares.find((s) => s.amount < 0);
  if (negative) {
    return { ok: false, reason: `La parte de ${negative.name} quedaría negativa` };
  }

  const sumMatches = shares.reduce((sum, s) => sum + s.amount, 0) === total;
  return { ok: true, shares, evenTotal, perPerson, remainder, adjustmentTotal, sumMatches };
}
