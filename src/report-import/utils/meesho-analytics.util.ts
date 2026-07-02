export type MeeshoReturnSubType = 'cancellation' | 'rto' | 'customer_return';

export function classifyMeeshoReturnSubType(
  typeOfReturn?: string | null,
  subType?: string | null,
): MeeshoReturnSubType | null {
  const typeUpper = String(typeOfReturn ?? '').trim().toUpperCase();
  const subUpper = String(subType ?? '').trim().toUpperCase();
  const combined = `${typeUpper} ${subUpper}`;

  if (combined.includes('CANCEL')) return 'cancellation';
  if (combined.includes('RTO')) return 'rto';
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
  const hasTcsReturn = Boolean(row.meeshoHasTcsReturn || row.returnInvoiceDate);
  let meeshoReturnSubType: MeeshoReturnSubType | undefined;

  if (hasTcsReturn) {
    if (isMeeshoCancellationStatus(row.meeshoOrderStatus)) {
      meeshoReturnSubType = 'cancellation';
    } else {
      meeshoReturnSubType =
        classifyMeeshoReturnSubType(row.typeOfReturn, row.subType) ?? undefined;
    }
  }

  return {
    meeshoIsGrossSale: true,
    meeshoIsPreviousMonthReturn: false,
    meeshoHasTcsReturn: hasTcsReturn,
    meeshoReturnSubType,
  };
}
