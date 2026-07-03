export type FlipkartReturnSubType = 'customer_return' | 'courier_return' | 'na';

export function isFlipkartNaTypeOfReturn(typeOfReturn?: string | null): boolean {
  const normalized = String(typeOfReturn ?? '')
    .trim()
    .toUpperCase()
    .replace(/^#+/, '');
  return normalized === 'N/A' || normalized === 'NA' || normalized === '-';
}

/**
 * Classify Flipkart return rows for summary breakdown.
 * Missing or unrecognized Return Type → NA.
 */
export function classifyFlipkartReturnSubType(
  typeOfReturn?: string | null,
): FlipkartReturnSubType {
  if (isFlipkartNaTypeOfReturn(typeOfReturn)) {
    return 'na';
  }

  const upper = String(typeOfReturn ?? '').trim().toUpperCase();
  if (!upper) {
    return 'na';
  }

  if (upper.includes('COURIER') || /\bRTO\b/.test(upper)) {
    return 'courier_return';
  }
  if (upper.includes('CUSTOMER')) {
    return 'customer_return';
  }

  return 'na';
}

/** @deprecated Use classifyFlipkartReturnSubType */
export function classifyFlipkartReturnType(
  typeOfReturn?: string | null,
): 'customer_return' | 'courier_return' | null {
  const subType = classifyFlipkartReturnSubType(typeOfReturn);
  return subType === 'na' ? null : subType;
}
