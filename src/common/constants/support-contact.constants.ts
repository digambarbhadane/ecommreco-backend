/** Canonical EcommReco customer support contact — use in API messages and emails. */
export const SUPPORT_CONTACT = {
  email: 'support@ecommreco.com',
  mobile: '8866503904',
} as const;

export const SUPPORT_CONTACT_LINE = `${SUPPORT_CONTACT.email} · ${SUPPORT_CONTACT.mobile}`;
