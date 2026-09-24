#!/usr/bin/env node
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// ../../node_modules/.pnpm/picocolors@1.1.1/node_modules/picocolors/picocolors.js
var require_picocolors = __commonJS({
  "../../node_modules/.pnpm/picocolors@1.1.1/node_modules/picocolors/picocolors.js"(exports, module) {
    var p = process || {};
    var argv = p.argv || [];
    var env = p.env || {};
    var isColorSupported = !(!!env.NO_COLOR || argv.includes("--no-color")) && (!!env.FORCE_COLOR || argv.includes("--color") || p.platform === "win32" || (p.stdout || {}).isTTY && env.TERM !== "dumb" || !!env.CI);
    var formatter = (open, close, replace = open) => (input) => {
      let string = "" + input, index = string.indexOf(close, open.length);
      return ~index ? open + replaceClose(string, close, replace, index) + close : open + string + close;
    };
    var replaceClose = (string, close, replace, index) => {
      let result = "", cursor = 0;
      do {
        result += string.substring(cursor, index) + replace;
        cursor = index + close.length;
        index = string.indexOf(close, cursor);
      } while (~index);
      return result + string.substring(cursor);
    };
    var createColors = (enabled = isColorSupported) => {
      let f = enabled ? formatter : () => String;
      return {
        isColorSupported: enabled,
        reset: f("\x1B[0m", "\x1B[0m"),
        bold: f("\x1B[1m", "\x1B[22m", "\x1B[22m\x1B[1m"),
        dim: f("\x1B[2m", "\x1B[22m", "\x1B[22m\x1B[2m"),
        italic: f("\x1B[3m", "\x1B[23m"),
        underline: f("\x1B[4m", "\x1B[24m"),
        inverse: f("\x1B[7m", "\x1B[27m"),
        hidden: f("\x1B[8m", "\x1B[28m"),
        strikethrough: f("\x1B[9m", "\x1B[29m"),
        black: f("\x1B[30m", "\x1B[39m"),
        red: f("\x1B[31m", "\x1B[39m"),
        green: f("\x1B[32m", "\x1B[39m"),
        yellow: f("\x1B[33m", "\x1B[39m"),
        blue: f("\x1B[34m", "\x1B[39m"),
        magenta: f("\x1B[35m", "\x1B[39m"),
        cyan: f("\x1B[36m", "\x1B[39m"),
        white: f("\x1B[37m", "\x1B[39m"),
        gray: f("\x1B[90m", "\x1B[39m"),
        bgBlack: f("\x1B[40m", "\x1B[49m"),
        bgRed: f("\x1B[41m", "\x1B[49m"),
        bgGreen: f("\x1B[42m", "\x1B[49m"),
        bgYellow: f("\x1B[43m", "\x1B[49m"),
        bgBlue: f("\x1B[44m", "\x1B[49m"),
        bgMagenta: f("\x1B[45m", "\x1B[49m"),
        bgCyan: f("\x1B[46m", "\x1B[49m"),
        bgWhite: f("\x1B[47m", "\x1B[49m"),
        blackBright: f("\x1B[90m", "\x1B[39m"),
        redBright: f("\x1B[91m", "\x1B[39m"),
        greenBright: f("\x1B[92m", "\x1B[39m"),
        yellowBright: f("\x1B[93m", "\x1B[39m"),
        blueBright: f("\x1B[94m", "\x1B[39m"),
        magentaBright: f("\x1B[95m", "\x1B[39m"),
        cyanBright: f("\x1B[96m", "\x1B[39m"),
        whiteBright: f("\x1B[97m", "\x1B[39m"),
        bgBlackBright: f("\x1B[100m", "\x1B[49m"),
        bgRedBright: f("\x1B[101m", "\x1B[49m"),
        bgGreenBright: f("\x1B[102m", "\x1B[49m"),
        bgYellowBright: f("\x1B[103m", "\x1B[49m"),
        bgBlueBright: f("\x1B[104m", "\x1B[49m"),
        bgMagentaBright: f("\x1B[105m", "\x1B[49m"),
        bgCyanBright: f("\x1B[106m", "\x1B[49m"),
        bgWhiteBright: f("\x1B[107m", "\x1B[49m")
      };
    };
    module.exports = createColors();
    module.exports.createColors = createColors;
  }
});

// bin/typegen.ts
var import_picocolors = __toESM(require_picocolors(), 1);
import { parseArgs } from "node:util";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

// src/typegen/schema.ts
function normalizeCollection(raw) {
  const schemaJson = typeof raw.schema_json === "string" ? safeParse(raw.schema_json) : raw.schema_json;
  const sysOptions = typeof raw.system_field_options === "string" ? safeParse(raw.system_field_options) : raw.system_field_options;
  return { ...raw, schema_json: schemaJson ?? {}, system_field_options: sysOptions ?? {} };
}
function safeParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
async function fetchCollections(source) {
  if (source.schemaFile) {
    const { readFileSync: readFileSync2 } = await import("node:fs");
    const raw = readFileSync2(source.schemaFile, "utf-8");
    const parsed = JSON.parse(raw);
    const list2 = Array.isArray(parsed) ? parsed : parsed.collections ?? [];
    return list2.map(normalizeCollection);
  }
  if (!source.url || !source.token) {
    throw new Error("Typegen needs either --schema <file> or --url + --token");
  }
  const fetchImpl = source.fetchImpl ?? fetch;
  const base = source.url.replace(/\/+$/, "");
  const list = (await fetchImpl(`${base}/collections`, {
    headers: { Authorization: `Bearer ${source.token}` }
  }).then((r) => {
    if (!r.ok) throw new Error(`Failed to list collections (${r.status}) \u2014 is the token admin/dev-token?`);
    return r.json();
  })).data;
  const detailed = await Promise.all(
    list.map(async (c) => {
      const res = await fetchImpl(`${base}/collections/${encodeURIComponent(c.slug)}`, {
        headers: { Authorization: `Bearer ${source.token}` }
      });
      if (!res.ok) return normalizeCollection(c);
      const env = await res.json().catch(() => null);
      return normalizeCollection(env?.data ?? c);
    })
  );
  return detailed;
}

// src/typegen/generate.ts
var STRING_TYPES = /* @__PURE__ */ new Set([
  "text",
  "longtext",
  "text_editor",
  "markdown",
  "code",
  "slug",
  "phone",
  "email",
  "url",
  "icon",
  "barcode",
  "csv",
  "tags",
  "uuid",
  "color",
  "time",
  "password",
  "rich_text",
  "m2o"
]);
var NUMBER_TYPES = /* @__PURE__ */ new Set(["integer", "number", "decimal", "float"]);
var VIRTUAL_TYPES = /* @__PURE__ */ new Set(["o2m", "m2m", "table"]);
function formulaType(field) {
  if (field.store !== true) return "never";
  switch (field.result_type ?? "number") {
    case "boolean":
      return "boolean | number";
    // D1 stores booleans as INTEGER 0/1
    case "string":
      return "string";
    case "json":
      return "string";
    // D1 stores JSON columns as text
    default:
      return "number";
  }
}
function selectOptions(field) {
  if (typeof field.options === "string") {
    return field.options.split(",").map((s) => s.trim()).filter(Boolean);
  }
  if (Array.isArray(field.options)) return field.options.filter((o) => typeof o === "string");
  return null;
}
function stringLiteral(value) {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}
var PRINT_WIDTH = 140;
function stringWidth(value) {
  return [...value].length;
}
function zodEnumOneLine(options) {
  return `z.enum([${options.map((o) => stringLiteral(o)).join(", ")}])`;
}
function zodFieldValue(options, optional, indent) {
  const suffix = `${optional ? ".optional()" : ""}.nullable()`;
  const oneLineValue = zodEnumOneLine(options);
  if (`${indent}PLACEHOLDER: ${oneLineValue}${suffix},`.length <= PRINT_WIDTH) return `${oneLineValue}${suffix},`;
  const chainIndent = `${indent}	`;
  const argsIndent = `${chainIndent}	`;
  const inlineArgs = `${chainIndent}.enum([${options.map((o) => stringLiteral(o)).join(", ")}])`;
  if (stringWidth(`${inlineArgs},`) < PRINT_WIDTH) {
    return ["z", inlineArgs, `${chainIndent}.optional()`, `${chainIndent}.nullable(),`].join("\n");
  }
  return [
    "z",
    `${chainIndent}.enum([`,
    ...options.map((o) => `${argsIndent}${stringLiteral(o)},`),
    `${chainIndent}])`,
    `${chainIndent}.optional()`,
    `${chainIndent}.nullable(),`
  ].join("\n");
}
function tsTypeFor(field) {
  if (field.type === "formula") return formulaType(field);
  if (field.type === "select") {
    const options = selectOptions(field);
    if (options && options.length > 0) return options.map((o) => stringLiteral(o)).join(" | ");
    return "string";
  }
  if (field.type === "boolean") return "boolean | number";
  if (NUMBER_TYPES.has(field.type)) return "number";
  if (field.type === "json") return "string";
  if (STRING_TYPES.has(field.type) || field.type === "datetime" || field.type === "timestamp" || field.type === "date") {
    return "string";
  }
  if (VIRTUAL_TYPES.has(field.type)) return "never";
  return "string";
}
function pascalName(slug) {
  const base = slug.split(/[^a-zA-Z0-9]+/).filter(Boolean).map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join("");
  const name = base || "Collection";
  return /^\d/.test(name) ? `C${name}` : name;
}
var SLUG_RE = /^[a-zA-Z0-9_-]+$/;
var FIELD_NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
var TS_IDENT_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
function assertSafeSlug(slug) {
  if (!SLUG_RE.test(slug)) {
    throw new Error(
      `Typegen: collection slug "${slug}" is not a safe identifier (expected /^[a-zA-Z0-9_-]+$/) \u2014 refusing to generate code for it`
    );
  }
}
function assertSafeFieldName(name, slug) {
  if (!FIELD_NAME_RE.test(name)) {
    throw new Error(
      `Typegen: field name "${name}" in collection "${slug}" is not a safe identifier (expected /^[a-zA-Z_][a-zA-Z0-9_]*$/) \u2014 refusing to generate code for it`
    );
  }
}
function assertSafeTypeName(name, slug) {
  if (!TS_IDENT_RE.test(name)) {
    throw new Error(`Typegen: collection slug "${slug}" produces invalid type name "${name}" \u2014 refusing to generate code for it`);
  }
}
function fieldList(collection) {
  const declared = typeof collection.schema_json === "object" ? collection.schema_json?.fields ?? [] : [];
  const system = typeof collection.system_field_options === "object" ? collection.system_field_options?.fields ?? [] : [];
  return [...declared.map((field) => ({ field, system: false })), ...system.map((field) => ({ field, system: true }))];
}
function isOptional(field, system) {
  return system ? true : field.required === false;
}
function zodTypeFor(field, optional, indent) {
  const suffix = `${optional ? ".optional()" : ""}.nullable(),`;
  if (field.type === "formula") {
    switch (field.result_type ?? "number") {
      case "boolean":
        return `z.union([z.boolean(), z.number()])${suffix}`;
      case "string":
      case "json":
        return `z.string()${suffix}`;
      default:
        return `z.number()${suffix}`;
    }
  }
  if (field.type === "select") {
    const options = selectOptions(field);
    if (options && options.length > 0) return zodFieldValue(options, optional, indent);
  }
  return `${zodScalarTypeFor(field)}${suffix}`;
}
function zodScalarTypeFor(field) {
  if (field.type === "boolean") return "z.union([z.boolean(), z.number()])";
  if (NUMBER_TYPES.has(field.type)) return "z.number()";
  if (field.type === "json") return "z.string()";
  if (field.type === "datetime" || field.type === "timestamp" || field.type === "date") return "z.string()";
  return "z.string()";
}
function headerFor(meta) {
  const markers = meta?.sourceHash ? [`// generated from ${meta.source ?? "<unknown source>"}`, `// source-hash: ${meta.sourceHash}`] : [];
  return [
    `/* eslint-disable */`,
    ...markers,
    `/**
 * AUTO-GENERATED by @mmbix/sdk typegen \u2014 DO NOT EDIT.
 *
 * Single source of truth for the entity schema: TypeScript types (compile-time)
 * AND Zod schemas (runtime validation). Re-run the generator after any schema
 * change; both sides update together \u2014 no drift.
 *
 * Usage:
 *   import type { Schema } from './generated/schema';
 *   import { Schemas } from './generated/schema';
 *   createClient<Schema>({ ... });
 *   Schemas.records.parse(response); // runtime purification
 */`
  ].join("\n");
}
function indentFirstLine(entry) {
  return `	${entry}`;
}
function generateTypes(collections, meta) {
  const schemas = [];
  const mapEntries = [];
  for (const collection of collections) {
    assertSafeSlug(collection.slug);
    const name = pascalName(collection.slug);
    assertSafeTypeName(name, collection.slug);
    const fields = fieldList(collection);
    const zodFields = ["id: z.string(),"];
    for (const { field: f, system } of fields) {
      if (f.name === "id") continue;
      assertSafeFieldName(f.name, collection.slug);
      if (tsTypeFor(f) === "never") continue;
      const optional = isOptional(f, system);
      const zodValue = zodTypeFor(f, optional, "	");
      zodFields.push(`${f.name}: ${zodValue}`);
    }
    schemas.push(`export const ${name}Schema = z.object({
${zodFields.map(indentFirstLine).join("\n")}
});`);
    mapEntries.push(`	${collection.slug}: z.infer<typeof ${name}Schema>;`);
  }
  const schemaType = `export type Schema = {
${mapEntries.join("\n")}
};`;
  const schemasMap = `export const Schemas = {
${collections.map((c) => `	${c.slug}: ${pascalName(c.slug)}Schema,`).join("\n")}
};`;
  const content = [
    headerFor(meta),
    `import { z } from 'zod';`,
    "",
    "// \u2500\u2500 Runtime validation (Zod) \u2014 the SINGLE source of truth \u2500\u2500",
    ...schemas,
    "",
    "// \u2500\u2500 Schema map \u2014 feeds createClient<Schema>() \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500",
    schemaType,
    "",
    schemasMap,
    ""
  ].join("\n");
  return {
    content,
    summary: `${collections.length} collections \u2192 ${collections.reduce((n, c) => n + fieldList(c).length, 0)} fields`
  };
}

// bin/typegen.ts
var { values } = parseArgs({
  options: {
    url: { type: "string" },
    token: { type: "string" },
    schema: { type: "string" },
    out: { type: "string", default: "./src/generated" },
    name: { type: "string", default: "schema.ts" },
    help: { type: "boolean", short: "h" }
  }
});
if (values.help) {
  console.log(`mmbix-typegen \u2014 generate typed schema (TS types + Zod) from the Mmbix entity schema.

Usage:
  --schema <path>  Canonical schema JSON file (array of collections) \u2014 OFFLINE,
                   no API needed; records source-hash in the generated header
  --url <base>     API base URL, e.g. http://localhost:8788/api (live mode)
  --token <token>  Admin/dev token (prefer the MMBIX_TOKEN env var \u2014 it is not visible in process listings)
  --out <dir>      Output directory (default ./src/generated)
  --name <file>    Output file name (default schema.ts)

Examples:
  mmbix-typegen --schema ./schema.source.json --out ./src/generated   # offline (CI-safe)
  mmbix-typegen --url http://localhost:8788/api --token dev-token
  MMBIX_TOKEN=\u2026 mmbix-typegen --url https://api.example.com/api
  mmbix-typegen --schema ./schema.json --out ./src/generated`);
  process.exit(0);
}
var token = values.token ?? process.env.MMBIX_TOKEN;
if (values.token) {
  console.warn(import_picocolors.default.yellow("Warning: --token is visible in process listings (e.g. `ps aux`) \u2014 prefer the MMBIX_TOKEN environment variable."));
}
try {
  const collections = await fetchCollections({ url: values.url, token, schemaFile: values.schema });
  let meta;
  if (values.schema) {
    const resolved = path.resolve(values.schema);
    meta = {
      source: values.schema,
      sourceHash: createHash("sha256").update(readFileSync(resolved)).digest("hex")
    };
  }
  if (collections.length === 0) {
    console.error(import_picocolors.default.red("No collections found \u2014 is the API reachable / schema file valid?"));
    process.exit(1);
  }
  const { content, summary } = generateTypes(collections, meta);
  const outDir = values.out;
  const outFile = path.join(outDir, values.name);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(outFile, content, "utf-8");
  console.log(import_picocolors.default.green(`\u2713 ${summary}`));
  console.log(import_picocolors.default.dim(`  wrote ${outFile}`));
} catch (err) {
  console.error(import_picocolors.default.red(`Typegen failed: ${err instanceof Error ? err.message : String(err)}`));
  process.exit(1);
}
