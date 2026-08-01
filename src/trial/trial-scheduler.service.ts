import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { TrialService } from './trial.service';

@Injectable()
export class TrialSchedulerService {
  private readonly logger = new Logger(TrialSchedulerService.name);

  constructor(private readonly trialService: TrialService) {}

  @Cron(CronExpression.EVERY_DAY_AT_1AM)
  async handleDailyTrialJobs() {
    try {
      const expired = await this.trialService.expireDueTrials();
      const reminders = await this.trialService.sendExpiryReminders();
      const cleaned = await this.trialService.cleanupDueTrials();
      this.logger.log(
        `Trial daily job: expired=${expired.expired} reminders=${reminders.sent} cleaned=${cleaned.cleaned}`,
      );
    } catch (error) {
      this.logger.error(
        `Trial daily job failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
