export type SmsSendResult = {
  sent: boolean;
  provider: string;
  messageId?: string;
};

export interface SmsProvider {
  readonly name: string;
  sendOtp(mobile: string, otp: string): Promise<SmsSendResult>;
  sendSms(mobile: string, message: string): Promise<SmsSendResult>;
}

export const SMS_PROVIDER_TOKEN = Symbol('SMS_PROVIDER');
