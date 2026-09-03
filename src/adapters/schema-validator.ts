export interface SchemaValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

type Schema = Readonly<Record<string, unknown>>;

export function validateJsonSchema(value: unknown, schemaValue: unknown): SchemaValidationResult {
  const schema = requireSchema(schemaValue, "schema");
  const errors: string[] = [];
  validate(value, schema, schema, "$", errors);
  return { valid: errors.length === 0, errors };
}

export function assertJsonSchema(value: unknown, schema: unknown): void {
  const result = validateJsonSchema(value, schema);
  if (!result.valid) throw new Error(`JSON Schema validation failed: ${result.errors.join("; ")}`);
}

function validate(
  value: unknown,
  schema: Schema,
  root: Schema,
  path: string,
  errors: string[]
): void {
  const reference = schema["$ref"];
  if (reference !== undefined) {
    if (typeof reference !== "string" || !reference.startsWith("#/")) {
      throw new Error(`Remote or unsupported schema reference: ${String(reference)}.`);
    }
    validate(value, resolveReference(root, reference), root, path, errors);
  }

  const anyOf = schema["anyOf"];
  if (Array.isArray(anyOf)) {
    const matches = anyOf.some((candidate) => {
      const candidateErrors: string[] = [];
      validate(value, requireSchema(candidate, "anyOf item"), root, path, candidateErrors);
      return candidateErrors.length === 0;
    });
    if (!matches) errors.push(`${path}: value does not match any allowed schema.`);
    return;
  }

  const allOf = schema["allOf"];
  if (Array.isArray(allOf)) {
    for (const candidate of allOf) {
      validate(value, requireSchema(candidate, "allOf item"), root, path, errors);
    }
  }

  const conditional = schema["if"];
  if (conditional !== undefined) {
    const conditionalErrors: string[] = [];
    validate(value, requireSchema(conditional, "if"), root, path, conditionalErrors);
    if (conditionalErrors.length === 0 && schema["then"] !== undefined) {
      validate(value, requireSchema(schema["then"], "then"), root, path, errors);
    }
  }

  if (schema["const"] !== undefined && !deepEqual(value, schema["const"])) {
    errors.push(`${path}: value does not match const.`);
  }
  const enumValues = schema["enum"];
  if (Array.isArray(enumValues) && !enumValues.some((candidate) => deepEqual(value, candidate))) {
    errors.push(`${path}: value is not in enum.`);
  }

  const types = normalizedTypes(schema["type"]);
  if (types.length > 0 && !types.some((type) => matchesType(value, type))) {
    errors.push(`${path}: expected type ${types.join("|")}.`);
    return;
  }

  if (typeof value === "string") validateString(value, schema, path, errors);
  if (typeof value === "number" || typeof value === "bigint") {
    validateNumber(value, schema, path, errors);
  }
  if (Array.isArray(value)) validateArray(value, schema, root, path, errors);
  if (isObject(value)) validateObject(value, schema, root, path, errors);
}

function validateString(value: string, schema: Schema, path: string, errors: string[]): void {
  const minLength = integerKeyword(schema, "minLength");
  const maxLength = integerKeyword(schema, "maxLength");
  if (minLength !== null && value.length < minLength) errors.push(`${path}: string is too short.`);
  if (maxLength !== null && value.length > maxLength) errors.push(`${path}: string is too long.`);
  const pattern = schema["pattern"];
  if (typeof pattern === "string" && !new RegExp(pattern, "u").test(value)) {
    errors.push(`${path}: string does not match ${pattern}.`);
  }
  if (schema["format"] === "date-time" && Number.isNaN(Date.parse(value))) {
    errors.push(`${path}: string is not a date-time.`);
  }
}

function validateNumber(
  value: number | bigint,
  schema: Schema,
  path: string,
  errors: string[]
): void {
  const minimum = integerKeyword(schema, "minimum");
  const maximum = integerKeyword(schema, "maximum");
  if (minimum !== null && (typeof value === "bigint" ? value < BigInt(minimum) : value < minimum)) {
    errors.push(`${path}: number is below minimum.`);
  }
  if (maximum !== null && (typeof value === "bigint" ? value > BigInt(maximum) : value > maximum)) {
    errors.push(`${path}: number is above maximum.`);
  }
}

function validateArray(
  value: readonly unknown[],
  schema: Schema,
  root: Schema,
  path: string,
  errors: string[]
): void {
  const minItems = integerKeyword(schema, "minItems");
  const maxItems = integerKeyword(schema, "maxItems");
  if (minItems !== null && value.length < minItems) errors.push(`${path}: array is too short.`);
  if (maxItems !== null && value.length > maxItems) errors.push(`${path}: array is too long.`);
  if (schema["uniqueItems"] === true) {
    for (let left = 0; left < value.length; left++) {
      for (let right = left + 1; right < value.length; right++) {
        if (deepEqual(value[left], value[right])) {
          errors.push(`${path}: array items must be unique.`);
          left = value.length;
          break;
        }
      }
    }
  }
  const itemSchema = schema["items"];
  if (itemSchema !== undefined) {
    const typed = requireSchema(itemSchema, "items");
    for (const [index, item] of value.entries()) {
      validate(item, typed, root, `${path}[${index}]`, errors);
    }
  }
}

function validateObject(
  value: Readonly<Record<string, unknown>>,
  schema: Schema,
  root: Schema,
  path: string,
  errors: string[]
): void {
  const required = schema["required"];
  if (Array.isArray(required)) {
    for (const name of required) {
      if (typeof name === "string" && !Object.hasOwn(value, name)) {
        errors.push(`${path}.${name}: required property is missing.`);
      }
    }
  }
  const propertiesValue = schema["properties"];
  const properties = isObject(propertiesValue) ? propertiesValue : {};
  if (schema["additionalProperties"] === false) {
    for (const name of Object.keys(value)) {
      if (!Object.hasOwn(properties, name)) errors.push(`${path}.${name}: unexpected property.`);
    }
  }
  const minProperties = integerKeyword(schema, "minProperties");
  if (minProperties !== null && Object.keys(value).length < minProperties) {
    errors.push(`${path}: object has too few properties.`);
  }
  for (const [name, propertySchema] of Object.entries(properties)) {
    if (Object.hasOwn(value, name)) {
      validate(
        value[name],
        requireSchema(propertySchema, `property ${name}`),
        root,
        `${path}.${name}`,
        errors
      );
    }
  }
}

function resolveReference(root: Schema, reference: string): Schema {
  let current: unknown = root;
  for (const encoded of reference.slice(2).split("/")) {
    const segment = encoded.replaceAll("~1", "/").replaceAll("~0", "~");
    if (!isObject(current) || !Object.hasOwn(current, segment)) {
      throw new Error(`Schema reference was not found: ${reference}.`);
    }
    current = current[segment];
  }
  return requireSchema(current, reference);
}

function normalizedTypes(value: unknown): readonly string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
    return value as string[];
  }
  return [];
}

function matchesType(value: unknown, type: string): boolean {
  switch (type) {
    case "null":
      return value === null;
    case "boolean":
      return typeof value === "boolean";
    case "string":
      return typeof value === "string";
    case "integer":
      return (
        typeof value === "bigint" || (typeof value === "number" && Number.isSafeInteger(value))
      );
    case "number":
      return typeof value === "bigint" || (typeof value === "number" && Number.isFinite(value));
    case "array":
      return Array.isArray(value);
    case "object":
      return isObject(value);
    default:
      throw new Error(`Unsupported JSON Schema type: ${type}.`);
  }
}

function integerKeyword(schema: Schema, name: string): number | null {
  const value = schema[name];
  if (value === undefined) return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new Error(`Schema keyword ${name} must be an integer.`);
  }
  return value;
}

function deepEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length && left.every((item, index) => deepEqual(item, right[index]))
    );
  }
  if (isObject(left) && isObject(right)) {
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    return (
      leftKeys.length === rightKeys.length &&
      leftKeys.every((key, index) => key === rightKeys[index] && deepEqual(left[key], right[key]))
    );
  }
  return false;
}

function requireSchema(value: unknown, name: string): Schema {
  if (!isObject(value)) throw new Error(`${name} must be a schema object.`);
  return value;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
