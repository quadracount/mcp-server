import type { Member } from "./types";

export interface MemberBalance extends Member {
  net: number;
}

/** Respuesta de error del BFF (403 si no es miembro, 404 si el grupo no existe...). */
export class BffError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const TIMEOUT_MS = 5000;

/**
 * Cliente de los endpoints /internal del BFF. Cada llamada va a nombre de un
 * usuario (X-Requester-Id): el BFF se lo pasa a groups-service, que verifica
 * que sea miembro del grupo.
 */
export class BffClient {
  constructor(
    private readonly baseUrl: string,
    private readonly internalApiKey: string,
  ) {}

  getMembers(groupId: string, requesterId: string): Promise<Member[]> {
    return this.get(`/internal/groups/${encodeURIComponent(groupId)}/members`, requesterId);
  }

  getBalances(groupId: string, requesterId: string): Promise<MemberBalance[]> {
    return this.get(`/internal/groups/${encodeURIComponent(groupId)}/balances`, requesterId);
  }

  private async get<T>(path: string, requesterId: string): Promise<T> {
    let res: Response;
    try {
      res = await fetch(new URL(path, this.baseUrl), {
        headers: { "X-Internal-Key": this.internalApiKey, "X-Requester-Id": requesterId },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new BffError(503, "El BFF no está disponible");
    }
    if (!res.ok) throw new BffError(res.status, await errorMessage(res));
    return (await res.json()) as T;
  }
}

async function errorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { message?: string | string[] };
    if (Array.isArray(body.message)) return body.message.join(". ");
    if (body.message) return body.message;
  } catch {
    // cuerpo vacío o que no es JSON
  }
  return `El BFF respondió ${res.status}`;
}
