export function isQuotaExceededError(err: unknown): boolean {
  if (!err) return false;

  const anyErr = err as {
    status?: number | string;
    code?: number | string;
    name?: string;
    message?: string;
  };

  if (anyErr.status === 429 || anyErr.code === 429) return true;
  if (
    anyErr.status === "RESOURCE_EXHAUSTED" ||
    anyErr.status === "OVER_QUERY_LIMIT" ||
    anyErr.code === "RESOURCE_EXHAUSTED" ||
    anyErr.code === "OVER_QUERY_LIMIT"
  ) {
    return true;
  }

  const msg =
    typeof err === "string"
      ? err
      : `${anyErr.name || ""} ${anyErr.message || ""}`;

  return (
    msg.includes("OverQuotaMapError") ||
    msg.includes("QuotaExceededError") ||
    msg.includes("RESOURCE_EXHAUSTED") ||
    msg.includes("OVER_QUERY_LIMIT") ||
    /\b429\b/.test(msg) ||
    /quota\s*(exceeded|limit|reached)/i.test(msg)
  );
}

export function reportMapsQuotaIfError(err: unknown): boolean {
  if (isQuotaExceededError(err)) {
    window.dispatchEvent(new CustomEvent("gmp-quota-exceeded"));
    return true;
  }
  return false;
}
