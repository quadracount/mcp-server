# mcp-server

Convierte un gasto escrito en texto libre en un borrador. Por ejemplo:

> Compré mercadería y útiles de aseo por 45 lucas, Diego pone 5 lucas menos porque no come carne y el resto en partes iguales

No es un chat: recibe un texto y devuelve un borrador que el usuario revisa antes de guardar. Node.js + TypeScript, `@modelcontextprotocol/sdk` y el SDK de Anthropic.

## Endpoints (puerto 3001)

Todos menos `/health` piden el header `X-Internal-Key`.

`POST /automation/parse-expense`, lo llama el BFF:

```json
{ "groupId": "g-depto", "text": "...", "paidBy": "u-martin", "requesterId": "u-martin" }
```

Devuelve un `ExpenseDraft` igual al del schema del BFF. Si el texto no tiene un monto o no se entiende, responde `422` con `{ message }`.

`POST /mcp` es el servidor MCP (Streamable HTTP, sin sesión). Las tools que leen datos del grupo usan el usuario del header `X-Requester-Id`, no un argumento, para que el LLM no pueda elegirlo.

`GET /health` es para los probes de Kubernetes.

## Tools y resources

- `lookup_group_members`: miembros del grupo, pedidos al BFF (`/internal`).
- `resolve_monetary_slang`: "45 lucas" → 45000, "5 lucas menos" → 5000 con `direction: "menos"`. Reglas, sin LLM (`src/slang.ts`).
- `validate_split_consistency`: divide el total, aplica los ajustes y el redondeo de a $1, y verifica la suma (`src/split.ts`).
- Resources `group://{groupId}/members` y `group://{groupId}/balances`.

## Cómo funciona

`src/orchestrator.ts` se conecta como cliente MCP a su propio `/mcp` y:

1. Lee el resource de miembros.
2. Entiende el texto. Con `LLM_MODE=llm` lo hace Claude (`src/llm.ts`): pide las tools que quiera y termina con un JSON que solo tiene trozos del texto (el monto total, los ajustes, cómo se reparte). Con `LLM_MODE=fallback`, o si el LLM falla o no responde en 45 s, lo hace un parser por reglas (`src/rules.ts`).
3. Arma el borrador (`src/draft.ts`) llamando `resolve_monetary_slang` y `validate_split_consistency`. Este paso es igual en los dos modos: los montos nunca los calcula el LLM.

En el modo LLM se usa `claude-opus-5-5` con `fallbacks: "default"`: si el modelo rechaza un texto, la API lo reintenta sola con otro modelo.

## Variables de entorno

| Variable | Ejemplo |
|---|---|
| `PORT` | `3001` |
| `BFF_INTERNAL_URL` | `http://bff-gateway:3000` |
| `INTERNAL_API_KEY` | secreto |
| `LLM_MODE` | `fallback` (por defecto) o `llm` |
| `ANTHROPIC_API_KEY` | secreto, solo para `llm` |
| `LLM_MODEL` | `claude-opus-5-5` (por defecto) |

## Correr

```bash
pnpm install --frozen-lockfile
pnpm build && pnpm start
pnpm test
```

Los tests levantan un BFF y una API de Anthropic falsos, y prueban el texto de las "45 lucas" en los dos modos.

Para probar el modo LLM con la API real, desde `infra-k8s`:

```bash
LLM_MODE=llm ANTHROPIC_API_KEY=sk-ant-... docker compose up --build -d mcp-server
```
