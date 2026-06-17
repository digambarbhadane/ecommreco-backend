<<<<<<< HEAD
import { Injectable, Logger } from '@nestjs/common';
=======
import {
  Injectable,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
>>>>>>> 86bbd8c0b784f5559b068c42e44fdc061bc3025a
import { EmailType, SendEmailOptions } from './email.types';
import { EmailConfigService } from './config/email.config';
import { ServerClient } from 'postmark';
import * as fs from 'fs';
import * as path from 'path';
import Handlebars from 'handlebars';
<<<<<<< HEAD
import nodemailer from 'nodemailer';
=======
import { Queue, Worker, JobsOptions } from 'bullmq';
import nodemailer, { Transporter } from 'nodemailer';
>>>>>>> 86bbd8c0b784f5559b068c42e44fdc061bc3025a

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private postmarkClient?: ServerClient;
  private smtpTransporter?: Transporter;
  private readonly templateCache = new Map<
    EmailType,
    Handlebars.TemplateDelegate
  >();

  constructor(private readonly config: EmailConfigService) {}

<<<<<<< HEAD
=======
  async onModuleInit() {
    if (this.config.emailProvider === 'smtp') {
      this.assertSmtpConfigured();
      this.smtpTransporter = nodemailer.createTransport({
        host: this.config.smtpHost,
        port: this.config.smtpPort ?? 587,
        secure: this.config.smtpSecure,
        auth: {
          user: this.config.smtpUser!,
          pass: this.config.smtpPass!,
        },
      });
      this.logger.log(
        `Email provider: SMTP (${this.config.smtpHost}:${this.config.smtpPort ?? 587})`,
      );
    } else if (this.config.emailProvider === 'postmark') {
      this.postmarkClient = new ServerClient(this.config.postmarkApiKey);
      this.logger.log('Email provider: Postmark');
    } else {
      throw new Error(
        `Unsupported EMAIL_PROVIDER "${this.config.emailProvider}". Use "smtp" or "postmark".`,
      );
    }

    if (this.config.useQueue && this.config.redisUrl) {
      this.queue = new Queue('email', {
        connection: { url: this.config.redisUrl },
      });
      this.worker = new Worker(
        'email',
        async (job) => {
          const opts = job.data as SendEmailOptions;
          await this.sendEmailImmediate(opts);
        },
        { connection: { url: this.config.redisUrl } },
      );
      this.worker.on('completed', (job) =>
        this.logger.log(
          `Email job completed id=${job.id} type=${(job.data as SendEmailOptions).type}`,
        ),
      );
      this.worker.on('failed', (job, err) =>
        this.logger.error(
          `Email job failed id=${job?.id} error=${err?.message}`,
        ),
      );
      this.logger.log('Email queue and worker initialized');
    }
  }

>>>>>>> 86bbd8c0b784f5559b068c42e44fdc061bc3025a
  async sendEmail(options: SendEmailOptions) {
    await this.sendEmailImmediate(options);
    return { queued: false };
  }

  private async sendEmailImmediate(options: SendEmailOptions) {
    const from = this.resolveFromAddress(options);
    const html = await this.renderTemplate(options.type, options.payload);

    if (this.config.emailProvider === 'smtp') {
      return await this.sendViaSMTP(from, options, html);
    }

    try {
      return await this.sendViaPostmark(from, options, html);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Failed to send email to=${options.to} type=${options.type} error=${msg}`,
      );
      if (this.shouldUseSmtpFallback(msg)) {
        this.logger.warn(
          `Falling back to SMTP for to=${options.to} type=${options.type}`,
        );
        return await this.sendViaSMTP(from, options, html);
      }
      throw err;
    }
  }

  private resolveFromAddress(options: SendEmailOptions) {
    const raw = options.fromOverride || this.config.chooseSender(options.type);
    return this.config.formatFromAddress(raw);
  }

  private async sendViaPostmark(
    from: string,
    options: SendEmailOptions,
    html: string,
  ) {
    if (!this.postmarkClient) {
      this.postmarkClient = new ServerClient(this.config.postmarkApiKey);
    }
    const res = await this.postmarkClient.sendEmail({
      From: from,
      To: options.to,
      ReplyTo: options.replyTo,
      Subject: options.subject,
      HtmlBody: html,
      MessageStream: 'outbound',
    });
    this.logger.log(
      `Sent email to=${options.to} type=${options.type} id=${res.MessageID}`,
    );
    return res;
  }

  private shouldUseSmtpFallback(errorMessage: string) {
    if (!this.config.useSmtpFallback || !this.config.hasSmtpCredentials) {
      return false;
    }
    const normalized = errorMessage.toLowerCase();
    return (
      /pending approval/i.test(normalized) ||
      /invalid api token/i.test(normalized) ||
      /inactive/i.test(normalized) ||
      /sender signature/i.test(normalized) ||
      /not authorized/i.test(normalized)
    );
  }

  private async sendViaSMTP(
    from: string,
    options: SendEmailOptions,
    html: string,
  ) {
    try {
<<<<<<< HEAD
      let transporter;
      if (
        this.config.smtpHost &&
        this.config.smtpUser &&
        this.config.smtpPass
      ) {
        transporter = nodemailer.createTransport({
          host: this.config.smtpHost,
          port: this.config.smtpPort ?? 587,
          secure: false,
          auth: {
            user: this.config.smtpUser,
            pass: this.config.smtpPass,
          },
        });
      } else {
        const account = await nodemailer.createTestAccount();
        transporter = nodemailer.createTransport({
          host: account.smtp.host,
          port: account.smtp.port,
          secure: account.smtp.secure,
          auth: {
            user: account.user,
            pass: account.pass,
          },
        });
      }

=======
      const transporter = await this.getSmtpTransporter();
>>>>>>> 86bbd8c0b784f5559b068c42e44fdc061bc3025a
      const info = await transporter.sendMail({
        from,
        to: options.to,
        replyTo: options.replyTo,
        subject: options.subject,
        html,
      });
      this.logger.log(
        `SMTP email sent to=${options.to} type=${options.type} messageId=${info.messageId ?? 'n/a'}`,
      );
      return info;
    } catch (smtpErr: unknown) {
      const msg = smtpErr instanceof Error ? smtpErr.message : String(smtpErr);
      this.logger.error(`SMTP send failed: ${msg}`);
      throw smtpErr;
    }
  }

  private async getSmtpTransporter() {
    if (this.smtpTransporter) {
      return this.smtpTransporter;
    }

    this.assertSmtpConfigured();
    this.smtpTransporter = nodemailer.createTransport({
      host: this.config.smtpHost,
      port: this.config.smtpPort ?? 587,
      secure: this.config.smtpSecure,
      auth: {
        user: this.config.smtpUser!,
        pass: this.config.smtpPass!,
      },
    });
    return this.smtpTransporter;
  }

  private assertSmtpConfigured() {
    const missing: string[] = [];
    if (!this.config.smtpHost?.trim()) missing.push('SMTP_HOST');
    if (!this.config.smtpUser?.trim()) missing.push('SMTP_USER');
    if (!this.config.smtpPass?.trim()) missing.push('SMTP_PASS');

    if (missing.length > 0) {
      throw new ServiceUnavailableException(
        `SMTP email is not configured. Set ${missing.join(', ')} in your environment file.`,
      );
    }
  }

  private async renderTemplate(type: EmailType, payload: Record<string, any>) {
    let compiled = this.templateCache.get(type);
    if (!compiled) {
      const fileName = this.config.templateFor(type);
      const filePath = path.resolve(__dirname, 'templates', fileName);
      const content = await fs.promises.readFile(filePath, 'utf-8');
      compiled = Handlebars.compile(content);
      this.templateCache.set(type, compiled);
    }
    return compiled(payload);
  }
}
