# mcp-server

Convierte un gasto escrito en texto libre en un borrador. Por ejemplo:

> Compré mercadería y útiles de aseo por 45 lucas, Diego pone 5 lucas menos porque no come carne y el resto en partes iguales

No es un chat: recibe un texto y devuelve un borrador que el usuario confirma antes de guardar.

## Endpoints (puerto 3001)

`POST /automation/parse-expense`, lo llama el BFF:

```json
{ "groupId": "g-depto", "text": "...", "paidBy": "u-martin" }
```

Devuelve un `ExpenseDraft` igual al del schema del BFF (`description`, `amount`, `paidBy`, `shares`, `interpretations`, `sumMatches`). En `interpretations`, `phrase` tiene que ser un trozo literal del texto, porque el frontend lo resalta.

`/mcp` es el servidor MCP (Streamable HTTP).

## Tools y resources

- `lookup_group_members`: pide los miembros al BFF.
- `resolve_monetary_slang`: "45 lucas" → 45000, con reglas.
- `validate_split_consistency`: revisa que las partes sumen el total.
- Resources: `group://{groupId}/members` y `group://{groupId}/balances`.

El LLM elige qué tools usar, pero los montos siempre los calcula el código.

Con `LLM_MODE=fallback` no se llama al LLM y se usa un parser por reglas, para que la demo funcione sin conexión.

## Variables de entorno

| Variable | Ejemplo |
|---|---|
| `PORT` | `3001` |
| `BFF_INTERNAL_URL` | `http://bff-gateway:3000` |
| `INTERNAL_API_KEY` | secreto |
| `LLM_MODE` | `llm` o `fallback` |
| `ANTHROPIC_API_KEY` | secreto |

## Correr

```bash
pnpm install --frozen-lockfile
pnpm build
```
