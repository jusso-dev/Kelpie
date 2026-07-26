export const MAX_INDICATOR_VALUE_BYTES = 2048;

export function normaliseIndicatorValue(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (Buffer.byteLength(trimmed, "utf8") > MAX_INDICATOR_VALUE_BYTES) {
    return null;
  }
  return trimmed;
}
