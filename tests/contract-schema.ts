import { readFileSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";

// Minimal OpenAPI 3.0 schema checker, enough for docs/api/openapi.yaml: $ref, allOf, type,
// enum, nullable, required, properties (unknown properties are rejected so responses match
// the contract exactly), items, pattern, minimum/maximum and the date / date-time formats.

type Schema = Record<string, unknown>;
const doc = yaml.load(readFileSync(join(__dirname, "../docs/api/openapi.yaml"), "utf8")) as {
  components: { schemas: Record<string, Schema> };
};

function resolve(s: Schema): Schema {
  const ref = s.$ref as string | undefined;
  if (!ref) return s;
  const name = ref.replace("#/components/schemas/", "");
  const target = doc.components.schemas[name];
  if (!target) throw new Error(`unknown $ref ${ref}`);
  return resolve(target);
}

function propsOf(s: Schema, acc: Record<string, Schema> = {}, req: string[] = []) {
  const r = resolve(s);
  if (Array.isArray(r.allOf)) for (const part of r.allOf as Schema[]) propsOf(part, acc, req);
  Object.assign(acc, (r.properties as Record<string, Schema>) ?? {});
  req.push(...((r.required as string[]) ?? []));
  return { props: acc, required: req };
}

export function validate(value: unknown, schema: Schema, path = "$"): string[] {
  const s = resolve(schema);
  const errs: string[] = [];
  if (value === null) return s.nullable ? [] : [`${path}: null not allowed`];
  if (Array.isArray(s.enum) && !s.enum.includes(value)) errs.push(`${path}: ${String(value)} not in enum`);
  const isObjectSchema = s.type === "object" || s.allOf || s.properties;
  if (isObjectSchema) {
    if (typeof value !== "object" || Array.isArray(value)) return [`${path}: expected object`];
    const { props, required } = propsOf(s);
    const obj = value as Record<string, unknown>;
    for (const k of required) if (!(k in obj)) errs.push(`${path}.${k}: required`);
    for (const [k, v] of Object.entries(obj)) {
      if (v === undefined) continue;
      if (props[k]) errs.push(...validate(v, props[k], `${path}.${k}`));
      else if (!s.additionalProperties) errs.push(`${path}.${k}: not in contract`);
    }
    return errs;
  }
  switch (s.type) {
    case "string":
      if (typeof value !== "string") return [...errs, `${path}: expected string`];
      if (s.format === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(value)) errs.push(`${path}: not a date`);
      if (s.format === "date-time" && !/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(value)) errs.push(`${path}: not a date-time`);
      if (typeof s.pattern === "string" && !new RegExp(s.pattern).test(value)) errs.push(`${path}: pattern`);
      break;
    case "integer":
    case "number":
      if (typeof value !== "number" || (s.type === "integer" && !Number.isInteger(value))) return [...errs, `${path}: expected ${s.type}`];
      if (typeof s.minimum === "number" && value < s.minimum) errs.push(`${path}: below minimum`);
      if (typeof s.maximum === "number" && value > s.maximum) errs.push(`${path}: above maximum`);
      break;
    case "boolean":
      if (typeof value !== "boolean") errs.push(`${path}: expected boolean`);
      break;
    case "array":
      if (!Array.isArray(value)) return [`${path}: expected array`];
      value.forEach((v, i) => errs.push(...validate(v, s.items as Schema, `${path}[${i}]`)));
      break;
  }
  return errs;
}

export function validateSchemaName(value: unknown, name: string): string[] {
  return validate(value, { $ref: `#/components/schemas/${name}` });
}
