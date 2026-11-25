import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTechStack, serializeTechStack, technologyEditor, technologyTags } from '../public/js/tech-stack.js';

test('technology fields preserve legacy strings and serialize without changing the API shape', () => {
  assert.deepEqual(parseTechStack(' Java 17, Spring Boot\nReact (TypeScript) '), ['Java 17', 'Spring Boot', 'React (TypeScript)']);
  assert.deepEqual(parseTechStack('Backend Core: Java 17 Spring Boot'), ['Backend Core: Java 17 Spring Boot']);
  assert.equal(serializeTechStack([' Java 17 ', '', 'Spring Boot']), 'Java 17, Spring Boot');
  assert.throws(() => serializeTechStack([' ']), /at least one/);
  assert.throws(() => serializeTechStack(['Java, React']), /separate field/);
  assert.throws(() => serializeTechStack(['Java\nReact']), /separate field/);
  assert.equal(serializeTechStack(['x'.repeat(1000)]).length, 1000);
  assert.throws(() => serializeTechStack(['x'.repeat(999), 'JS']), /1,000/);
});

test('technology chips and editor values are escaped and showroom chips are bounded', () => {
  const malicious = '<img src=x onerror=alert(1)>';
  for (const markup of [technologyTags(malicious), technologyEditor(malicious)]) {
    assert.doesNotMatch(markup, /<img/);
    assert.match(markup, /&lt;img/);
  }
  const preview = technologyTags('Java, Spring Boot, React, H2, Tauri', 4);
  assert.match(preview, /\+1 more/);
  assert.doesNotMatch(preview, /Tauri/);
});
