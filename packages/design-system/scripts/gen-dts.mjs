/**
 * Generate .d.ts stubs for all design-system components.
 *
 * vite-plugin-dts fails on some components with TS2883 (TS 6 + react-jsx),
 * so this script produces minimal declaration files that satisfy TypeScript
 * type checking for monorepo consumers.
 *
 * Run: node scripts/gen-dts.mjs
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';

const SRC = join(import.meta.dirname, '..', 'src');
const DIST = join(import.meta.dirname, '..', 'dist', 'src');

const COMPONENTS = readdirSync(join(SRC, 'components'), { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name);

// Known exports per component — extracted from source index.tsx
function componentExports(name) {
  const srcFile = join(SRC, 'components', name, 'index.tsx');
  const srcFileTs = join(SRC, 'components', name, 'index.ts');
  const file = existsSync(srcFile) ? srcFile : srcFileTs;
  if (!existsSync(file)) return [];

  const content = readFileSync(file, 'utf8');
  const exports = [];

  // Match: export function Foo|export { Foo }
  for (const m of content.matchAll(
    /export\s+(?:default\s+)?(?:function|const|class|type|interface|enum)\s+(\w+)/g,
  )) {
    exports.push(m[1]);
  }
  // Match: export { Foo, Bar }
  for (const m of content.matchAll(/export\s+\{\s*([^}]+)\}/g)) {
    for (const name of m[1].split(',')) {
      const n = name.trim().split(' as ')[0].trim();
      if (n && !exports.includes(n)) exports.push(n);
    }
  }
  // Match: export * from ...
  for (const m of content.matchAll(/export\s+\*\s+from\s+['"](.+)['"]/g)) {
    exports.push(`__reexport_${m[1]}`);
  }

  return [...new Set(exports)];
}

// Generate per-component .d.ts
for (const name of COMPONENTS) {
  const exports = componentExports(name);
  const dir = join(DIST, 'components', name);
  mkdirSync(dir, { recursive: true });

  // Check if vite-plugin-dts already generated a file — if so, keep it
  if (existsSync(join(dir, 'index.d.ts'))) {
    const size = readFileSync(join(dir, 'index.d.ts'), 'utf8').length;
    if (size > 50) continue; // dts already generated, keep it
  }

  const dts = exports
    .filter((e) => !e.startsWith('__reexport_'))
    .map((e) => `export declare const ${e}: React.ComponentType<any>;`)
    .join('\n');

  if (dts) {
    writeFileSync(join(dir, 'index.d.ts'), `import type * as React from 'react';\n\n${dts}\n`);
    console.log(`  ✓ ${name} (${exports.length} exports)`);
  }
}

// Generate main index.d.ts — re-exports all components.
// vite-plugin-dts already emits the barrel from src/index.ts (which orders
// exports deliberately, e.g. the canonical `SidebarHeader` from ./sidebar is
// re-exported last so it wins over appshell's same-named export). Keep that
// output; only fall back to an alphabetical barrel if it is missing.
const mainDir = join(DIST);
mkdirSync(mainDir, { recursive: true });
const mainDtsPath = join(mainDir, 'index.d.ts');
const mainDts = [
  `import type * as React from 'react';`,
  ``,
  `export { ThemeProvider, useTheme } from './components/theme-provider';`,
  `export { cn } from './lib/utils/index';`,
  ...COMPONENTS.map((name) => `export * from './components/${name}';`),
].join('\n');

if (existsSync(mainDtsPath)) {
  const size = readFileSync(mainDtsPath, 'utf8').length;
  if (size > 50) {
    console.log(`✓ index.d.ts (kept vite-plugin-dts output)`);
  } else {
    writeFileSync(mainDtsPath, mainDts + '\n');
    console.log(`\n✓ index.d.ts (${COMPONENTS.length} components)`);
  }
} else {
  writeFileSync(mainDtsPath, mainDts + '\n');
  console.log(`\n✓ index.d.ts (${COMPONENTS.length} components)`);
}

// Also generate declaration files for lib/ modules
const libFiles = [
  ['utils', 'index.ts'],
  ['types', 'index.ts'],
];
for (const [dir, file] of libFiles) {
  const libDir = join(DIST, 'lib', dir);
  if (!existsSync(libDir)) {
    mkdirSync(libDir, { recursive: true });
    writeFileSync(join(libDir, 'index.d.ts'), `export { cn } from '../../../../src/lib/utils';\n`);
  }
}
