import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { EmailType, SendEmailOptions } from './email.types';
import { EmailConfigService } from './config/email.config';
import { ServerClient } from 'postmark';
import * as fs from 'fs';
import * as path from 'path';
import Handlebars from 'handlebars';
import { Queue, Worker, JobsOptions } from 'bullmq';
import nodemailer from 'nodemailer';

@Injectable()
export class EmailService implements OnModuleInit {
  private readonly logger = new Logger(EmailService.name);
  private readonly client: ServerClient;
  private readonly templateCache = new Map<
    EmailType,
    Handlebars.TemplateDelegate
  >();
  private queue?: Queue;
  private worker?: Worker;

  constructor(private readonly config: EmailConfigService) {
    this.client = new ServerClient(this.config.postmarkApiKey);
  }

  async onModuleInit() {
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

  async sendEmail(options: SendEmailOptions) {
    if (this.queue) {
      const jobOptions: JobsOptions = {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: true,
        removeOnFail: false,
      };
      await this.queue.add('send', options, jobOptions);
      this.logger.log(`Queued email to=${options.to} type=${options.type}`);
      return { queued: true };
    }
    await this.sendEmailImmediate(options);
    return { queued: false };
  }

  private async sendEmailImmediate(options: SendEmailOptions) {
    const from = options.fromOverride || this.config.chooseSender(options.type);
    const html = await this.renderTemplate(options.type, options.payload);
    try {
      const res = await this.client.sendEmail({
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
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      this.logger.error(
        `Failed to send email to=${options.to} type=${options.type} error=${msg}`,
      );
      if (this.config.useSmtpFallback && /pending approval/i.test(msg)) {
        return await this.sendViaSMTP(from, options, html);
      }
      throw err;
    }
  }

  private async sendViaSMTP(
    from: string,
    options: SendEmailOptions,
    html: string,
  ) {
    try {
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

      const info = await transporter.sendMail({
        from,
        to: options.to,
        replyTo: options.replyTo,
        subject: options.subject,
        html,
      });
      const previewUrl = nodemailer.getTestMessageUrl(info);
      this.logger.log(
        `SMTP fallback sent to=${options.to} subject="${options.subject}" preview=${previewUrl ?? ''}`,
      );
      return info;
    } catch (smtpErr: any) {
      const msg = smtpErr?.message ?? String(smtpErr);
      this.logger.error(`SMTP fallback failed: ${msg}`);
      throw smtpErr;
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
