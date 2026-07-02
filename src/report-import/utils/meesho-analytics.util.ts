export type MeeshoReturnSubType =
  | 'cancellation'
  | 'rto'
  | 'customer_return'
  | 'na';

/** TCS Sales Return rows where Type of Return is Excel #N/A (return type not yet known). */
export function isMeeshoNaTypeOfReturn(typeOfReturn?: string | null): boolean {
  const normalized = String(typeOfReturn ?? '')
    .trim()
    .toUpperCase()
    .replace(/^#+/, '');
  return normalized === 'N/A' || normalized === 'NA' || normalized === '-';
}

export function classifyMeeshoReturnSubType(
  typeOfReturn?: string | null,
  subType?: string | null,
): MeeshoReturnSubType | null {
  if (isMeeshoNaTypeOfReturn(typeOfReturn)) return 'na';

  const typeUpper = String(typeOfReturn ?? '').trim().toUpperCase();
  const subUpper = String(subType ?? '').trim().toUpperCase();
  const combined = `${typeUpper} ${subUpper}`;

  if (combined.includes('CANCEL')) return 'cancellation';
  if (combined.includes('RTO')) return 'rto';
  if (combined.includes('COURIER')) return 'rto';
  if (combined.includes('CUSTOMER')) return 'customer_return';

  return null;
}

export function isMeeshoCancellationStatus(status?: string | null): boolean {
  const upper = String(status ?? '').trim().toUpperCase();
  return upper.includes('CANCEL');
}

export type MeeshoRowClassificationInput = {
  typeOfReturn?: string;
  subType?: string;
  meeshoHasTcsReturn?: boolean;
  meeshoOrderStatus?: string;
  returnInvoiceDate?: string;
  meeshoReturnSubType?: MeeshoReturnSubType;
};

export type MeeshoRowClassification = {
  meeshoIsGrossSale: boolean;
  meeshoIsPreviousMonthReturn: boolean;
  meeshoHasTcsReturn: boolean;
  meeshoReturnSubType?: MeeshoReturnSubType;
};

/** All TCS Sales rows count as sales; TCS Return marks a return; sub-types from order status + lifecycle reports. */
export function classifyMeeshoImportRow(
  row: MeeshoRowClassificationInput,
): MeeshoRowClassification {
  const lifecycleSubType =
    row.meeshoReturnSubType ??
    classifyMeeshoReturnSubType(row.typeOfReturn, row.subType) ??
    undefined;
  const cancellationFromOrder = isMeeshoCancellationStatus(row.meeshoOrderStatus);
  const hasTcsReturn = Boolean(
    row.meeshoHasTcsReturn ||
      row.returnInvoiceDate ||
      lifecycleSubType ||
      cancellationFromOrder,
  );
  let meeshoReturnSubType: MeeshoReturnSubType | undefined;

  if (hasTcsReturn) {
    // Prefer lifecycle-derived subtype first (RTO/Customer Return), then order cancellation fallback.
    meeshoReturnSubType = lifecycleSubType;
    if (!meeshoReturnSubType && cancellationFromOrder) {
      meeshoReturnSubType = 'cancellation';
    }
  }

  return {
    meeshoIsGrossSale: true,
    meeshoIsPreviousMonthReturn: meeshoReturnSubType === 'na',
    meeshoHasTcsReturn: hasTcsReturn,
    meeshoReturnSubType,
  };
}

/** Resolve return subtype — TCS Sales Return Type of Return first (matches Excel), then lifecycle, then NA. */
export function resolveMeeshoReturnSubType(
  input: MeeshoRowClassificationInput & {
    meeshoHasTcsReturn?: boolean;
    isReturnDocument?: boolean;
    /** Original Type of Return from TCS Sales Return file (before lifecycle may overwrite). */
    tcsReturnTypeOfReturn?: string;
    tcsReturnSubType?: string;
  },
): MeeshoReturnSubType | undefined {
  const tcsType = input.tcsReturnTypeOfReturn ?? input.typeOfReturn;
  const tcsSub = input.tcsReturnSubType ?? input.subType;
  const fromTcsReturn = classifyMeeshoReturnSubType(tcsType, tcsSub);
  if (fromTcsReturn) return fromTcsReturn;

  const lifecycleSubType = input.meeshoReturnSubType;
  if (lifecycleSubType && lifecycleSubType !== 'na') {
    return lifecycleSubType;
  }

  if (isMeeshoCancellationStatus(input.meeshoOrderStatus)) {
    return 'cancellation';
  }

  if (
    input.isReturnDocument ||
    input.meeshoHasTcsReturn ||
    input.returnInvoiceDate
  ) {
    return 'na';
  }

  return undefined;
}
