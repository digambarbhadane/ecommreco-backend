export enum EmailType {
  OTP = 'OTP',
  PASSWORD_RESET = 'PASSWORD_RESET',
  INVOICE = 'INVOICE',
  SUBSCRIPTION = 'SUBSCRIPTION',
  NOTIFICATION = 'NOTIFICATION',
}

export type EmailPayload = Record<string, any>;

export interface SendEmailOptions {
  to: string;
  type: EmailType;
  subject: string;
  payload: EmailPayload;
  fromOverride?: string;
  replyTo?: string;
}
