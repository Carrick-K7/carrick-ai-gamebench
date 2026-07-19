import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalJson,
  createUlid,
  sha256Canonical,
} from "../src/index.js";

test("canonical JSON orders object keys and has a stable SHA-256", () => {
  const input = { b: 2, a: 1 };
  assert.equal(canonicalJson(input), '{"a":1,"b":2}');
  assert.equal(
    sha256Canonical(input),
    "sha256:43258cff783fe7036d8a43033f830adfc60ec037382473548ac742b888292777",
  );
});

test("ULIDs are valid, time-sortable identifiers", () => {
  const earlier = createUlid(1_000);
  const later = createUlid(2_000);
  assert.match(earlier, /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/);
  assert.ok(earlier < later);
  assert.notEqual(createUlid(1_000), createUlid(1_000));
});
