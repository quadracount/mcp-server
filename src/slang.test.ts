import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveMonetarySlang } from "./slang";

function amount(expression: string) {
  const result = resolveMonetarySlang(expression);
  assert.ok(result.ok, `no se resolvió "${expression}"`);
  return { amount: result.amount, direction: result.direction };
}

test("lucas, mil y pesos", () => {
  assert.deepEqual(amount("45 lucas"), { amount: 45000, direction: null });
  assert.deepEqual(amount("una luca"), { amount: 1000, direction: null });
  assert.deepEqual(amount("luca y media"), { amount: 1500, direction: null });
  assert.deepEqual(amount("dos lucas y media"), { amount: 2500, direction: null });
  assert.deepEqual(amount("media luca"), { amount: 500, direction: null });
  assert.deepEqual(amount("1,5 lucas"), { amount: 1500, direction: null });
  assert.deepEqual(amount("$18.000"), { amount: 18000, direction: null });
  assert.deepEqual(amount("24000"), { amount: 24000, direction: null });
  assert.deepEqual(amount("10 mil"), { amount: 10000, direction: null });
  assert.deepEqual(amount("un palo"), { amount: 1_000_000, direction: null });
});

test("ajustes con más o menos", () => {
  assert.deepEqual(amount("Diego pone 5 lucas menos"), { amount: 5000, direction: "menos" });
  assert.deepEqual(amount("Camila paga 2 lucas más"), { amount: 2000, direction: "mas" });
  // Sin unidad, un número chico se entiende en lucas
  assert.deepEqual(amount("Diego pone 5 menos"), { amount: 5000, direction: "menos" });
});

test("sin monto o con más de uno", () => {
  assert.equal(resolveMonetarySlang("partes iguales").ok, false);
  assert.equal(resolveMonetarySlang("45 lucas y 5 lucas menos").ok, false);
});
