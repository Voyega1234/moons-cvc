export function openRouterCompatibleSchema(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(openRouterCompatibleSchema);
  }
  if (typeof value !== "object" || value === null) return value;

  const normalized = Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== "maxItems")
      .map(([key, item]) => [key, openRouterCompatibleSchema(item)])
  ) as Record<string, unknown>;
  const declaredType = normalized.type;
  if (!Array.isArray(declaredType) || !declaredType.includes("null")) {
    return normalized;
  }

  const nonNullTypes = declaredType.filter((type) => type !== "null");
  const nonNullSchema = { ...normalized };
  nonNullSchema.type =
    nonNullTypes.length === 1 ? nonNullTypes[0] : nonNullTypes;
  if (Array.isArray(nonNullSchema.enum)) {
    nonNullSchema.enum = nonNullSchema.enum.filter((item) => item !== null);
  }

  return {
    anyOf: [nonNullSchema, { type: "null" }]
  };
}

