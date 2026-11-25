import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import Anthropic from "@anthropic-ai/sdk";
import { startServer } from "./app";
import type { Config } from "./config";

const KEY = "test-key";
const TEXT =
  "Compré mercadería y útiles de aseo por 45 lucas, Diego pone 5 lucas menos porque no come carne y el resto en partes iguales";
const MEMBERS = [
  { userId: "u-martin", name: "Martín" },
  { userId: "u-camila", name: "Camila" },
  { userId: "u-sofia", name: "Sofía" },
  { userId: "u-diego", name: "Diego" },
];

const EXPECTED = {
  description: "Mercadería y útiles de aseo",
  amount: 45000,
  paidBy: { userId: "u-martin", name: "Martín" },
  shares: [
    { userId: "u-martin", name: "Martín", amount: 12500 },
    { userId: "u-camila", name: "Camila", amount: 12500 },
    { userId: "u-sofia", name: "Sofía", amount: 12500 },
    { userId: "u-diego", name: "Diego", amount: 7500 },
  ],
  interpretations: [
    { phrase: "45 lucas", meaning: "Monto total: $45.000" },
    { phrase: "Diego pone 5 lucas menos", meaning: "Diego paga $5.000 menos que el resto" },
    { phrase: "el resto en partes iguales", meaning: "($45.000 + $5.000) ÷ 4 = $12.500 por persona" },
  ],
  sumMatches: true,
};

function listen(server: Server): Promise<string> {
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)),
  );
}

async function readBody(req: IncomingMessage): Promise<string> {
  let body = "";
  for await (const chunk of req) body += chunk;
  return body;
}

// BFF falso: solo Martín es miembro de g-depto
const bffRequests: { url: string; requester?: string; key?: string }[] = [];
const fakeBff = createServer((req, res) => {
  const requester = req.headers["x-requester-id"] as string | undefined;
  bffRequests.push({ url: req.url ?? "", requester, key: req.headers["x-internal-key"] as string });
  res.setHeader("Content-Type", "application/json");
  if (req.headers["x-internal-key"] !== KEY) return void res.writeHead(401).end("{}");
  if (requester !== "u-martin") {
    return void res.writeHead(403).end(JSON.stringify({ message: "No eres miembro de este grupo" }));
  }
  if (req.url === "/internal/groups/g-depto/members") return void res.end(JSON.stringify(MEMBERS));
  res.writeHead(404).end(JSON.stringify({ message: "No existe" }));
});

// API de Anthropic falsa: responde lo que diga la lista, en orden
let scripted: object[] = [];
const claudeRequests: { messages: { role: string; content: unknown }[] }[] = [];
const fakeClaude = createServer(async (req, res) => {
  claudeRequests.push(JSON.parse(await readBody(req)));
  const next = scripted.shift();
  res.setHeader("Content-Type", "application/json");
  if (!next) return void res.writeHead(500).end(JSON.stringify({ type: "error", error: { type: "api_error", message: "sin guion" } }));
  res.end(JSON.stringify(next));
});

function claudeMessage(content: object[], stopReason: string) {
  return {
    id: `msg_${Math.random()}`,
    type: "message",
    role: "assistant",
    model: "claude-opus-5-5",
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 10 },
  };
}

let mcpServer: Server;
let baseUrl: string;
let claudeUrl: string;
const cfg: Config = {
  port: 0,
  bffInternalUrl: "",
  internalApiKey: KEY,
  llmMode: "fallback",
  llmModel: "claude-opus-5-5",
  mcpUrl: "",
};

before(async () => {
  cfg.bffInternalUrl = await listen(fakeBff);
  claudeUrl = await listen(fakeClaude);
  mcpServer = await startServer(cfg);
  baseUrl = cfg.mcpUrl.replace(/\/mcp$/, "");
});

after(() => {
  mcpServer.close();
  fakeBff.close();
  fakeClaude.close();
});

function parse(body: object, key = KEY) {
  return fetch(`${baseUrl}/automation/parse-expense`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Internal-Key": key },
    body: JSON.stringify(body),
  });
}

const DEMO_REQUEST = { groupId: "g-depto", text: TEXT, paidBy: "u-martin", requesterId: "u-martin" };

test("modo fallback: el texto de la demo da el borrador esperado", async () => {
  cfg.llmMode = "fallback";
  bffRequests.length = 0;
  const res = await parse(DEMO_REQUEST);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), EXPECTED);
  // El usuario viaja al BFF en X-Requester-Id, con la clave interna
  assert.ok(bffRequests.length > 0);
  assert.ok(bffRequests.every((r) => r.requester === "u-martin" && r.key === KEY));
});

test("modo llm: Claude pide las tools MCP y el borrador sale de ellas", async () => {
  cfg.llmMode = "llm";
  cfg.anthropic = new Anthropic({ apiKey: "test", baseURL: claudeUrl, maxRetries: 0 });
  claudeRequests.length = 0;
  scripted = [
    claudeMessage(
      [{ type: "tool_use", id: "t1", name: "lookup_group_members", input: { groupId: "g-depto" } }],
      "tool_use",
    ),
    claudeMessage(
      [
        { type: "tool_use", id: "t2", name: "resolve_monetary_slang", input: { expression: "45 lucas" } },
        { type: "tool_use", id: "t3", name: "resolve_monetary_slang", input: { expression: "Diego pone 5 lucas menos" } },
      ],
      "tool_use",
    ),
    claudeMessage(
      [
        {
          type: "text",
          text: JSON.stringify({
            description: "Mercadería y útiles de aseo",
            totalPhrase: "45 lucas",
            adjustments: [{ phrase: "Diego pone 5 lucas menos", userId: "u-diego" }],
            participants: [],
            equalSplitPhrase: "el resto en partes iguales",
          }),
        },
      ],
      "end_turn",
    ),
  ];

  const res = await parse(DEMO_REQUEST);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), EXPECTED);

  assert.equal(claudeRequests.length, 3);
  const second = JSON.stringify(claudeRequests[1].messages.at(-1));
  assert.match(second, /u-diego/, "el resultado de lookup_group_members vuelve a Claude");
  const third = JSON.stringify(claudeRequests[2].messages.at(-1));
  assert.match(third, /45000/);
  assert.match(third, /menos/);
});

test("modo llm: si la API no responde, usa las reglas", async () => {
  cfg.llmMode = "llm";
  cfg.anthropic = new Anthropic({ apiKey: "test", baseURL: "http://127.0.0.1:9", maxRetries: 0 });
  const res = await parse(DEMO_REQUEST);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), EXPECTED);
});

test("sin la clave interna responde 401", async () => {
  const res = await parse(DEMO_REQUEST, "otra");
  assert.equal(res.status, 401);
});

test("un texto sin monto responde 422 con un mensaje claro", async () => {
  cfg.llmMode = "fallback";
  const res = await parse({ ...DEMO_REQUEST, text: "compré pan" });
  assert.equal(res.status, 422);
  assert.match(((await res.json()) as { message: string }).message, /monto total/);
});

test("quien no es miembro recibe el 403 del BFF", async () => {
  cfg.llmMode = "fallback";
  const res = await parse({ ...DEMO_REQUEST, requesterId: "u-intruso" });
  assert.equal(res.status, 403);
  assert.equal(((await res.json()) as { message: string }).message, "No eres miembro de este grupo");
});
