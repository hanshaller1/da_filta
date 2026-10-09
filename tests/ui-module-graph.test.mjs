import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// app.js loads the ui/ modules in setup order and every module runs its setup
// on import. That only stays deterministic while a module imports nothing that
// loads after it; calls in the other direction go through `hooks`.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => readFileSync(path.join(root, file), 'utf8');
const importsOf = source => [...source.matchAll(/^import\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"];?/gm)].map(match => match[1]);
const uiFiles = readdirSync(path.join(root, 'ui')).filter(name => name.endsWith('.js')).map(name => `ui/${name}`);
const setupOrder = importsOf(read('app.js')).filter(specifier => specifier.startsWith('./ui/')).map(specifier => specifier.slice(2));
const loadOrder = [...new Set(setupOrder)];

test('app.js loads every ui module exactly once before using it', () => {
  assert.deepEqual([...loadOrder].sort(), [...uiFiles].sort());
  const firstNamedImport = read('app.js').search(/^import\s*\{/m);
  const lastSetupImport = read('app.js').lastIndexOf("import './ui/");
  assert.ok(firstNamedImport === -1 || lastSetupImport < firstNamedImport, 'setup imports come first');
});

test('ui modules import only modules that load before them', () => {
  for (const file of loadOrder) {
    const position = loadOrder.indexOf(file);
    for (const specifier of importsOf(read(file))) {
      if (!specifier.startsWith('./')) continue;
      const target = `ui/${specifier.slice(2)}`;
      assert.ok(loadOrder.includes(target), `${file} imports unknown module ${specifier}`);
      assert.ok(loadOrder.indexOf(target) < position, `${file} imports ${specifier}, which loads later; use a hook instead`);
    }
  }
});

test('every hook is declared once and provided by exactly one later module', () => {
  const context = read('ui/app-context.js');
  const declared = [...context.match(/const hooks = \{([\s\S]*?)\n\};/)[1].matchAll(/^\s*(\w+): null/gm)].map(match => match[1]);
  assert.ok(declared.length > 0);
  const used = new Set();
  for (const file of loadOrder) {
    const source = read(file);
    for (const match of source.matchAll(/\bhooks\.(\w+)/g)) {
      assert.ok(declared.includes(match[1]), `${file} uses undeclared hook ${match[1]}`);
      used.add(match[1]);
    }
  }
  for (const name of declared) {
    const providers = loadOrder.filter(file => new RegExp(`^hooks\\.${name} = `, 'm').test(read(file)));
    assert.equal(providers.length, 1, `hook ${name} needs exactly one provider`);
    assert.ok(used.has(name), `hook ${name} is declared but unused`);
    const callers = loadOrder.filter(file => file !== providers[0] && new RegExp(`\\bhooks\\.${name}\\b`).test(read(file)));
    assert.ok(callers.length > 0, `hook ${name} has no caller outside its provider`);
    for (const caller of callers) {
      assert.ok(loadOrder.indexOf(caller) < loadOrder.indexOf(providers[0]),
        `${caller} loads after ${providers[0]} and can import ${name} directly`);
    }
  }
});
