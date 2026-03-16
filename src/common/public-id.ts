import crypto from 'crypto';

export type PublicIdType =
  | 'seller'
  | 'user'
  | 'lead'
  | 'account_manager'
  | 'sales_manager'
  | 'training_manager'
  | 'training_and_support_manager'
  | 'super_admin';

const prefixByType: Record<PublicIdType, string> = {
  seller: 'SEL',
  user: 'USR',
  lead: 'LED',
  account_manager: 'AM',
  sales_manager: 'SM',
  training_manager: 'TOM',
  training_and_support_manager: 'TOM',
  super_admin: 'ADM',
};

const pad2 = (value: number) => value.toString().padStart(2, '0');

export const generatePublicId = (
  type: PublicIdType,
  extraInfo: string = '',
) => {
  void extraInfo;
  const prefix = prefixByType[type];
  const d = new Date();
  const yyyy = d.getUTCFullYear().toString();
  const mm = pad2(d.getUTCMonth() + 1);
  const yyyymm = `${yyyy}${mm}`;

  const max = 36 ** 4;
  const code = crypto
    .randomInt(0, max)
    .toString(36)
    .toUpperCase()
    .padStart(4, '0')
    .slice(-4);

  return `${prefix}-${yyyymm}-${code}`;
};
