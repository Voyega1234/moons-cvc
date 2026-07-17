export interface FacebookPageDetails {
  title: string | null;
  imageUrl: string | null;
  category: string | null;
}

export function normalizeFacebookPageDetails(
  payload: unknown
): FacebookPageDetails | null {
  const rows = Array.isArray(payload) ? payload : [payload];
  for (const value of rows) {
    if (!isRecord(value)) continue;
    const title = firstString(value.title, value.name);
    const imageUrl = validHttpUrl(
      firstString(value.image, value.profilePicture)
    );
    const category = firstString(
      Array.isArray(value.category) ? value.category[0] : value.category,
      Array.isArray(value.categories) ? value.categories[0] : value.categories
    );

    if (title || imageUrl || category) return { title, imageUrl, category };
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function validHttpUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? value : null;
  } catch {
    return null;
  }
}
