export interface Member {
  userId: string;
  name: string;
}

export interface Share extends Member {
  amount: number;
}

export interface Interpretation {
  phrase: string;
  meaning: string;
}

/** Misma forma que el tipo ExpenseDraft del schema GraphQL del BFF. */
export interface ExpenseDraft {
  description: string;
  amount: number;
  paidBy: Member;
  shares: Share[];
  interpretations: Interpretation[];
  sumMatches: boolean;
}

export interface ParseExpenseRequest {
  groupId: string;
  text: string;
  paidBy: string;
  requesterId: string;
}

/**
 * Lo que se entiende del texto, sin ningún cálculo: solo frases copiadas del
 * texto y a quién se refieren. Los montos salen después de las tools.
 */
export interface Extraction {
  description: string;
  totalPhrase: string;
  adjustments: { phrase: string; userId: string }[];
  /** user_id de quienes participan; vacío significa todo el grupo. */
  participants: string[];
  equalSplitPhrase: string | null;
}

/** El texto no se pudo convertir en un borrador (el usuario puede reformularlo). */
export class DraftError extends Error {}
