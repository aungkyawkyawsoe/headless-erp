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
var __toESM = (mod, isNodeMode, target2) => (target2 = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target2, "default", { value: mod, enumerable: true }) : target2,
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

// ../utils/src/time.ts
var MMT_OFFSET_MS = 6.5 * 60 * 60 * 1e3;

// ../utils/src/field-types.ts
var FIELD_TYPE_NAMES = [
  "text",
  "longtext",
  "slug",
  "password",
  "integer",
  "number",
  "bigint",
  "currency",
  "percent",
  "rating",
  "boolean",
  "timestamp",
  "date",
  "time",
  "json",
  "csv",
  "location",
  "color",
  "m2o",
  "o2m",
  "m2m",
  "m2a",
  "file",
  "image",
  "select",
  "uuid",
  "table",
  "formula",
  "text_editor",
  "code",
  "markdown",
  "signature",
  "duration",
  "barcode",
  "datetime",
  "phone",
  "email",
  "url",
  "icon",
  "tags",
  "progress"
];
var VALID_FIELD_TYPES = new Set(FIELD_TYPE_NAMES);

// ../utils/src/errors/codes.ts
var ERROR_CODES = [
  // ── 4xx — client / resource ──────────────────────────
  "VALIDATION_ERROR",
  // 400 — invalid input / failed declarative validation
  "INVALID_JSON",
  // 400 — malformed request body
  "UNAUTHORIZED",
  // 401 — missing/invalid credentials
  "FORBIDDEN",
  // 403 — authenticated but denied (role / row / field)
  "NOT_FOUND",
  // 404 — collection or item missing
  "CONFLICT",
  // 409 — duplicate / state conflict / optimistic-concurrency
  "PAYLOAD_TOO_LARGE",
  // 413 — body exceeds the upload/body limit
  "UNSUPPORTED_MEDIA_TYPE",
  // 415 — bad Content-Type
  "RATE_LIMIT_EXCEEDED",
  // 429 — per-role quota exhausted
  // ── 5xx — server ─────────────────────────────────────
  "NOT_CONFIGURED",
  // 501 — a required provider/integration is not configured
  "DATABASE_ERROR",
  // 502 — D1 failed (never leaks raw internals)
  "INTERNAL_ERROR",
  // 500 — unexpected failure
  // ── SDK-side (never emitted by the API) ──────────────
  "NETWORK_ERROR",
  // the request never reached the server
  "SDK_ERROR",
  // generic client-side failure
  "API_ERROR",
  // unclassified API failure
  "BAD_ENVELOPE"
  // the server responded but with an unrecognized envelope
];
var API_ERROR_CODES = ERROR_CODES.filter(
  (c) => c !== "NETWORK_ERROR" && c !== "SDK_ERROR" && c !== "API_ERROR" && c !== "BAD_ENVELOPE"
);

// ../utils/src/validation.ts
var RESERVED_SQL_WORDS = new Set(
  [
    // Core statement keywords
    "select",
    "from",
    "where",
    "insert",
    "into",
    "values",
    "update",
    "set",
    "delete",
    "create",
    "drop",
    "alter",
    "table",
    "index",
    "view",
    "trigger",
    // Clauses / operators (verified against sqlite3: these FAIL as unquoted column names)
    "in",
    "on",
    "as",
    "and",
    "or",
    "not",
    "null",
    "is",
    "between",
    "exists",
    "escape",
    "collate",
    "case",
    "when",
    "then",
    "else",
    "union",
    "all",
    "distinct",
    "group",
    "order",
    "having",
    "limit",
    "using",
    "join",
    "returning",
    "nothing",
    "add",
    // Constraint keywords
    "primary",
    "foreign",
    "references",
    "check",
    "unique",
    "default",
    "constraint",
    "autoincrement",
    // Transactions / misc
    "commit",
    "transaction",
    "to",
    "current_date",
    "current_time",
    "current_timestamp",
    "rowid",
    "oid"
    // usable unquoted, but shadowing rowid is never what you want
  ].map((w) => w.toLowerCase())
);

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
async function fetchErrorCodes(source) {
  if (!source.url || !source.token) return null;
  const fetchImpl = source.fetchImpl ?? fetch;
  const base = source.url.replace(/\/+$/, "");
  try {
    const res = await fetchImpl(`${base}/meta`, {
      headers: { Authorization: `Bearer ${source.token}` }
    });
    if (!res.ok) return null;
    const env = await res.json();
    const codes = env?.data?.error_codes;
    return Array.isArray(codes) ? codes.filter((c) => typeof c === "string") : null;
  } catch {
    return null;
  }
}

// src/typegen/generate.ts
var TS_KIND = {
  text: "string",
  longtext: "string",
  slug: "string",
  password: "string",
  integer: "number",
  number: "number",
  bigint: "number",
  currency: "number",
  percent: "number",
  rating: "number",
  boolean: "boolean",
  json: "string",
  csv: "string",
  location: "string",
  tags: "string",
  timestamp: "string",
  date: "string",
  datetime: "string",
  time: "string",
  duration: "number",
  progress: "number",
  color: "string",
  m2o: "string",
  m2a: "virtual",
  file: "string",
  image: "string",
  select: "string",
  // special-cased to an enum when options are declared
  uuid: "string",
  text_editor: "string",
  code: "string",
  markdown: "string",
  signature: "string",
  barcode: "string",
  phone: "string",
  email: "string",
  url: "string",
  icon: "string",
  o2m: "virtual",
  m2m: "virtual",
  table: "virtual",
  formula: "virtual"
  // special-cased by store/result_type
};
function fieldKind(field) {
  return TS_KIND[field.type] ?? "string";
}
var FORMULA_TS_TYPE = {
  number: "number",
  boolean: "boolean | number",
  // D1 stores booleans as INTEGER 0/1
  string: "string",
  json: "string"
  // D1 stores JSON columns as text
};
function formulaType(field) {
  if (field.store !== true) return "never";
  const rt = field.result_type ?? "number";
  return FORMULA_TS_TYPE[rt] ?? "number";
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
  switch (TS_KIND[field.type]) {
    case "number":
      return "number";
    case "boolean":
      return "boolean | number";
    // D1 stores booleans as INTEGER 0/1 — the wire value is a number
    case "virtual":
      return "never";
    // only present when expanded / not a plain column
    default:
      return "string";
  }
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
  switch (TS_KIND[field.type]) {
    case "number":
      return "z.number()";
    case "boolean":
      return "z.union([z.boolean(), z.number()])";
    // D1 returns raw 0/1 integers for boolean columns
    default:
      return "z.string()";
  }
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
  const ordered = [...collections].sort((a, b) => a.slug.localeCompare(b.slug));
  for (const collection of ordered) {
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
${ordered.map((c) => `	${c.slug}: ${pascalName(c.slug)}Schema,`).join("\n")}
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

// src/typegen/generate-dart.ts
var DART_TYPE = {
  string: { type: "String?", decode: (key) => `json[${key}] as String?` },
  number: { type: "num?", decode: (key) => `json[${key}] as num?` },
  boolean: { type: "bool?", decode: (key) => `_dbBool(json[${key}])` }
};
var FORMULA_KIND = {
  number: "number",
  boolean: "boolean",
  // decoded through `_dbBool` (D1 stores 0/1)
  string: "string",
  json: "string"
};
function dartKindOf(field) {
  if (field.type === "formula") {
    if (field.store !== true) return null;
    const rt = field.result_type ?? "number";
    return FORMULA_KIND[rt] ?? "number";
  }
  switch (fieldKind(field)) {
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "virtual":
      return null;
    default:
      return "string";
  }
}
var DART_KEYWORDS = /* @__PURE__ */ new Set([
  "abstract",
  "as",
  "assert",
  "async",
  "await",
  "base",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "covariant",
  "default",
  "deferred",
  "do",
  "dynamic",
  "else",
  "enum",
  "export",
  "extends",
  "extension",
  "external",
  "factory",
  "false",
  "final",
  "finally",
  "for",
  "get",
  "hide",
  "if",
  "implements",
  "import",
  "in",
  "interface",
  "is",
  "late",
  "library",
  "mixin",
  "new",
  "null",
  "of",
  "on",
  "operator",
  "part",
  "required",
  "rethrow",
  "return",
  "sealed",
  "set",
  "show",
  "static",
  "super",
  "switch",
  "sync",
  "this",
  "throw",
  "true",
  "try",
  "type",
  "typedef",
  "var",
  "void",
  "when",
  "while",
  "with",
  "yield"
]);
function camelMemberName(wire, slug) {
  const parts = wire.split("_").filter(Boolean).map((p) => p.toLowerCase());
  let name = parts.map((p, i) => i === 0 ? p : p.charAt(0).toUpperCase() + p.slice(1)).join("");
  if (!/^[a-z][a-zA-Z0-9]*$/.test(name)) {
    throw new Error(`Typegen(dart): field name "${wire}" in collection "${slug}" does not map to an identifier-safe Dart member name`);
  }
  if (DART_KEYWORDS.has(name)) name = `${name}_`;
  return name;
}
function assertSafeErrorCode(code) {
  if (!/^[A-Z][A-Z0-9_]*$/.test(code)) {
    throw new Error(`Typegen(dart): error code "${code}" is not identifier-safe (expected /^[A-Z][A-Z0-9_]*$/) \u2014 refusing to emit it`);
  }
}
function dartStringLiteral(value) {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\$/g, "\\$")}'`;
}
function headerFor2(meta) {
  const markers = meta?.sourceHash ? [`// source-hash: ${meta.sourceHash}`] : [];
  return [
    `// AUTO-GENERATED by @mmbix/sdk typegen (--target dart) \u2014 DO NOT EDIT.`,
    ...markers,
    `//`,
    `// Row models for the entity schema \u2014 one plain-Dart class per collection`,
    `// (fromJson/toJson, no build_runner), field-name constants for the F.* filter`,
    `// factories, and the canonical API error codes this deployment emits.`,
    `// Re-run the generator after any schema change; everything updates together.`
  ].join("\n");
}
var DB_BOOL_HELPER = [
  `/// D1 stores booleans as INTEGER 0/1 (JSON \`number\`) \u2014 normalize to \`bool\`.`,
  `bool? _dbBool(Object? value) {`,
  `	if (value is bool) return value;`,
  `	if (value is num) return value != 0;`,
  `	return null;`,
  `}`
].join("\n");
function generateDartModels(collections, options) {
  const ordered = [...collections].sort((a, b) => a.slug.localeCompare(b.slug));
  const models = [];
  const constants = [];
  const usedClassNames = /* @__PURE__ */ new Map();
  let fieldCount = 0;
  let usesDbBool = false;
  for (const collection of ordered) {
    assertSafeSlug(collection.slug);
    const name = pascalName(collection.slug);
    const fieldsName = `${name}Fields`;
    for (const candidate of [name, fieldsName]) {
      const previous = usedClassNames.get(candidate);
      if (previous !== void 0) {
        throw new Error(
          `Typegen(dart): collections "${previous}" and "${collection.slug}" both emit the class name "${candidate}" \u2014 rename one slug`
        );
      }
      usedClassNames.set(candidate, collection.slug);
    }
    const rows = [];
    const members = /* @__PURE__ */ new Map();
    for (const { field } of fieldList(collection)) {
      const kind = dartKindOf(field);
      if (kind === null || field.name === "id") continue;
      assertSafeFieldName(field.name, collection.slug);
      const member = camelMemberName(field.name, collection.slug);
      const clash = members.get(member);
      if (clash !== void 0) {
        throw new Error(
          `Typegen(dart): fields "${clash}" and "${field.name}" in collection "${collection.slug}" both map to member "${member}" \u2014 rename one field`
        );
      }
      members.set(member, field.name);
      rows.push({ member, wire: field.name, kind });
      fieldCount++;
    }
    if (rows.some((r) => r.kind === "boolean")) usesDbBool = true;
    const model = [];
    model.push(`/// Row model for the \`${collection.slug}\` collection.`);
    model.push(`class ${name} {`);
    model.push(`	const ${name}({`);
    model.push(`		required this.id,`);
    for (const r of rows) model.push(`		this.${r.member},`);
    model.push(`	});`);
    model.push(``);
    model.push(`	final String id;`);
    for (const r of rows) model.push(`	final ${DART_TYPE[r.kind].type} ${r.member};`);
    model.push(``);
    model.push(`	factory ${name}.fromJson(Map<String, Object?> json) => ${name}(`);
    model.push(`		id: json['id'] as String,`);
    for (const r of rows) model.push(`		${r.member}: ${DART_TYPE[r.kind].decode(dartStringLiteral(r.wire))},`);
    model.push(`	);`);
    model.push(``);
    model.push(`	/// PATCH-style payload \u2014 null fields are OMITTED (absent \u2260 explicit`);
    model.push(`	/// null), so a round-tripped row never silently clears a column.`);
    model.push(`	Map<String, Object?> toJson() => {`);
    model.push(`		'id': id,`);
    for (const r of rows) model.push(`		if (${r.member} != null) ${dartStringLiteral(r.wire)}: ${r.member},`);
    model.push(`	};`);
    model.push(`}`);
    models.push(model.join("\n"));
    const block = [];
    const exampleMember = rows.length > 0 ? rows[0].member : "id";
    block.push(`/// Field-name constants for the \`${collection.slug}\` collection \u2014 pass them to`);
    block.push(`/// the \`F.*\` filter factories (\`F.eq(${fieldsName}.${exampleMember}, \u2026)\`); a misspelled`);
    block.push(`/// field is a compile error.`);
    block.push(`abstract final class ${fieldsName} {`);
    block.push(`	static const id = 'id';`);
    for (const r of rows) block.push(`	static const ${r.member} = ${dartStringLiteral(r.wire)};`);
    block.push(`}`);
    constants.push(block.join("\n"));
  }
  let codesBlock = null;
  const errorCodes = options?.errorCodes ?? [];
  if (errorCodes.length > 0) {
    const seenCodes = /* @__PURE__ */ new Set();
    const seenMembers = /* @__PURE__ */ new Set();
    const codeRows = [];
    for (const code of errorCodes) {
      assertSafeErrorCode(code);
      if (seenCodes.has(code)) throw new Error(`Typegen(dart): duplicate error code "${code}"`);
      seenCodes.add(code);
      const member = camelMemberName(code, "error_codes");
      if (seenMembers.has(member)) throw new Error(`Typegen(dart): error codes collide on member "${member}" \u2014 refusing to emit`);
      seenMembers.add(member);
      codeRows.push({ member, code });
    }
    const lines = [];
    lines.push(`/// Canonical API error codes this deployment emits \u2014 \`GET /api/meta\` \u2192`);
    lines.push(`/// \`error_codes\`. Compare against \`ErpHttpException.apiCode\`.`);
    lines.push(`abstract final class ApiErrorCodes {`);
    for (const r of codeRows) lines.push(`	static const ${r.member} = ${dartStringLiteral(r.code)};`);
    lines.push(``);
    lines.push(`	/// Every code, in catalog order.`);
    lines.push(`	static const List<String> all = [`);
    for (const r of codeRows) lines.push(`		${r.member},`);
    lines.push(`	];`);
    lines.push(`}`);
    codesBlock = lines.join("\n");
  }
  const sections = [headerFor2(options?.meta)];
  if (models.length > 0) sections.push(``, `// \u2500\u2500 Row models \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500`, ``, models.join("\n\n"));
  if (constants.length > 0) {
    sections.push(``, `// \u2500\u2500 Field constants (F.* factories) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500`, ``, constants.join("\n\n"));
  }
  if (codesBlock) sections.push(``, `// \u2500\u2500 Canonical API error codes \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500`, ``, codesBlock);
  if (usesDbBool) sections.push(``, `// \u2500\u2500 Internals \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500`, ``, DB_BOOL_HELPER);
  sections.push(``);
  const codeSummary = codesBlock ? `, ${errorCodes.length} error codes` : "";
  return {
    content: sections.join("\n"),
    summary: `${collections.length} collections \u2192 ${fieldCount} fields${codeSummary}`
  };
}

// bin/typegen.ts
var { values } = parseArgs({
  options: {
    url: { type: "string" },
    token: { type: "string" },
    schema: { type: "string" },
    out: { type: "string", default: "./src/generated" },
    name: { type: "string" },
    target: { type: "string" },
    help: { type: "boolean", short: "h" }
  }
});
var target = (values.target ?? "ts").toLowerCase();
if (target !== "ts" && target !== "dart") {
  console.error(import_picocolors.default.red(`Unknown --target "${values.target}" \u2014 use "ts" (default) or "dart".`));
  process.exit(1);
}
var outName = values.name ?? (target === "dart" ? "schema.dart" : "schema.ts");
if (values.help) {
  console.log(`mmbix-typegen \u2014 generate typed client code from the Mmbix entity schema.

Usage:
  --schema <path>  Canonical schema JSON file (array of collections) \u2014 OFFLINE,
                   no API needed; records source-hash in the generated header
  --url <base>     API base URL, e.g. http://localhost:8788/api (live mode)
  --token <token>  Admin/dev token (prefer the MMBIX_TOKEN env var \u2014 it is not visible in process listings)
  --target <lang>  Output language: "ts" (default) | "dart"
                   ts   \u2192 schema.ts \u2014 TS types + Zod (single source of truth)
                   dart \u2192 schema.dart \u2014 plain-Dart models (fromJson/toJson) + field
                          constants for the F.* factories + ApiErrorCodes
                          (GET /api/meta in live mode; bundled catalog offline)
  --out <dir>      Output directory (default ./src/generated)
  --name <file>    Output file name (default schema.ts \u2014 schema.dart for dart)

Examples:
  mmbix-typegen --schema ./schema.source.json --out ./src/generated   # offline (CI-safe)
  mmbix-typegen --url http://localhost:8788/api --token dev-token
  MMBIX_TOKEN=\u2026 mmbix-typegen --url https://api.example.com/api
  mmbix-typegen --schema ./schema.json --out ./lib/generated --target dart`);
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
    meta = { source: values.schema, sourceHash: createHash("sha256").update(readFileSync(resolved)).digest("hex") };
  } else {
    meta = { source: values.url ?? "live API", sourceHash: createHash("sha256").update(JSON.stringify(collections)).digest("hex") };
  }
  if (collections.length === 0) {
    console.error(import_picocolors.default.red("No collections found \u2014 is the API reachable / schema file valid?"));
    process.exit(1);
  }
  let errorCodes;
  if (target === "dart") {
    const live = values.schema ? null : await fetchErrorCodes({ url: values.url, token });
    if (live && live.length > 0) {
      errorCodes = live;
      if (JSON.stringify(live) !== JSON.stringify([...API_ERROR_CODES])) {
        console.warn(
          import_picocolors.default.dim(`note: the server advertises a different error-code set than this CLI build \u2014 emitted the server's ${live.length}.`)
        );
      }
    } else {
      errorCodes = API_ERROR_CODES;
      if (!values.schema) console.warn(import_picocolors.default.dim("note: /api/meta was unreachable \u2014 emitted the bundled @mmbix/types error catalog."));
    }
  }
  const { content, summary } = target === "dart" ? generateDartModels(collections, { meta, errorCodes }) : generateTypes(collections, meta);
  const outDir = values.out;
  const outFile = path.join(outDir, outName);
  mkdirSync(outDir, { recursive: true });
  let unchanged = false;
  try {
    unchanged = readFileSync(outFile, "utf-8") === content;
  } catch {
  }
  if (unchanged) {
    console.log(import_picocolors.default.dim(`= ${summary} (unchanged, ${outFile})`));
  } else {
    writeFileSync(outFile, content, "utf-8");
    console.log(import_picocolors.default.green(`\u2713 ${summary}`));
    console.log(import_picocolors.default.dim(`  wrote ${outFile}`));
  }
} catch (err) {
  console.error(import_picocolors.default.red(`Typegen failed: ${err instanceof Error ? err.message : String(err)}`));
  process.exit(1);
}
