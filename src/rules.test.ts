import assert from "node:assert/strict";
import { test } from "node:test";
import { extractWithRules } from "./rules";

const members = [
  { userId: "u-martin", name: "Martín" },
  { userId: "u-camila", name: "Camila" },
  { userId: "u-sofia", name: "Sofía" },
  { userId: "u-diego", name: "Diego" },
];

test("texto de la demo", () => {
  const text =
    "Compré mercadería y útiles de aseo por 45 lucas, Diego pone 5 lucas menos porque no come carne y el resto en partes iguales";
  assert.deepEqual(extractWithRules(text, members), {
    description: "mercadería y útiles de aseo",
    totalPhrase: "45 lucas",
    adjustments: [{ phrase: "Diego pone 5 lucas menos", userId: "u-diego" }],
    participants: [],
    equalSplitPhrase: "el resto en partes iguales",
  });
});

test("el total no se confunde con el ajuste aunque venga después", () => {
  const extraction = extractWithRules("Sofía paga 2 lucas menos, gas por $18.000", members);
  assert.equal(extraction.totalPhrase, "$18.000");
  assert.deepEqual(extraction.adjustments, [{ phrase: "Sofía paga 2 lucas menos", userId: "u-sofia" }]);
});

test("sin monto", () => {
  assert.throws(() => extractWithRules("compré pan", members), /monto total/);
});
