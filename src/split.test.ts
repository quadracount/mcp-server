import assert from "node:assert/strict";
import { test } from "node:test";
import { computeSplit } from "./split";

const depto = [
  { userId: "u-martin", name: "Martín" },
  { userId: "u-camila", name: "Camila" },
  { userId: "u-sofia", name: "Sofía" },
  { userId: "u-diego", name: "Diego" },
];

test("45 lucas con Diego pagando 5 lucas menos", () => {
  const result = computeSplit({
    total: 45000,
    participants: depto,
    adjustments: [{ userId: "u-diego", delta: -5000 }],
  });
  assert.ok(result.ok);
  assert.deepEqual(
    result.shares.map((s) => s.amount),
    [12500, 12500, 12500, 7500],
  );
  assert.equal(result.perPerson, 12500);
  assert.equal(result.sumMatches, true);
});

test("el resto se reparte de a $1 en el orden de los miembros", () => {
  const result = computeSplit({ total: 10000, participants: depto.slice(0, 3), adjustments: [] });
  assert.ok(result.ok);
  assert.deepEqual(
    result.shares.map((s) => s.amount),
    [3334, 3333, 3333],
  );
  assert.equal(result.sumMatches, true);
});

test("rechaza totales y ajustes imposibles", () => {
  assert.equal(computeSplit({ total: 0, participants: depto, adjustments: [] }).ok, false);
  assert.equal(computeSplit({ total: 10.5, participants: depto, adjustments: [] }).ok, false);
  assert.equal(
    computeSplit({ total: 1000, participants: depto, adjustments: [{ userId: "u-diego", delta: -5000 }] }).ok,
    false,
  );
  assert.equal(
    computeSplit({ total: 1000, participants: depto, adjustments: [{ userId: "u-otro", delta: -100 }] }).ok,
    false,
  );
});
