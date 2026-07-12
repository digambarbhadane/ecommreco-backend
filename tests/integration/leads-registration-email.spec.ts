import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { LeadsService } from '../../src/leads/leads.service';
import { Lead } from '../../src/leads/schemas/lead.schema';
import { Seller } from '../../src/sellers/schemas/seller.schema';
import { User } from '../../src/users/schemas/user.schema';
import { Counter } from '../../src/leads/schemas/counter.schema';
import { NotificationsService } from '../../src/notifications/notifications.service';
import { EmailService } from '../../src/email/email.service';
import { EmailConfigService } from '../../src/email/config/email.config';
import { EmailType } from '../../src/email/email.types';
import { CreateLeadDto } from '../../src/leads/dto/create-lead.dto';

const execMock = <T>(value: T) => ({
  exec: jest.fn().mockResolvedValue(value),
});

describe('LeadsService registration welcome email', () => {
  const sendEmail = jest.fn().mockResolvedValue({ queued: false });

  const leadModel = {
    create: jest.fn(),
    findOne: jest.fn(),
    countDocuments: jest.fn(),
  };
  const sellerModel = {
    findOne: jest.fn(),
  };
  const userModel = {
    findOne: jest.fn(),
    find: jest.fn(),
  };
  const counterModel = {
    findOneAndUpdate: jest.fn(),
  };

  let leadsService: LeadsService;

  beforeEach(async () => {
    jest.clearAllMocks();

    leadModel.create.mockResolvedValue({
      fullName: 'Ravi Patel',
      email: 'ravi@example.com',
      leadId: 'LEAD2026010001',
    });
    leadModel.findOne.mockReturnValue(execMock(null));
    leadModel.countDocuments.mockResolvedValue(0);
    sellerModel.findOne.mockReturnValue(execMock(null));
    userModel.findOne.mockReturnValue(execMock(null));
    userModel.find.mockReturnValue({
      select: jest.fn().mockReturnValue({
        sort: jest.fn().mockReturnValue({
          lean: jest.fn().mockReturnValue(execMock([])),
        }),
      }),
    });
    counterModel.findOneAndUpdate.mockResolvedValue({ seq: 1 });

    const moduleRef = await Test.createTestingModule({
      providers: [
        LeadsService,
        {
          provide: getModelToken(Lead.name),
          useValue: leadModel,
        },
        {
          provide: getModelToken(Seller.name),
          useValue: sellerModel,
        },
        {
          provide: getModelToken(User.name),
          useValue: userModel,
        },
        {
          provide: getModelToken(Counter.name),
          useValue: counterModel,
        },
        {
          provide: NotificationsService,
          useValue: {
            createNotification: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: EmailService,
          useValue: { sendEmail },
        },
        {
          provide: EmailConfigService,
          useValue: {
            defaultFrom: 'no-reply@ecommreco.com',
            supportEmail: 'info@ecommreco.com',
            frontendUrl: 'https://ecommreco.com',
            formatFromAddress: (email: string) => `EcommReco <${email}>`,
          },
        },
      ],
    }).compile();

    leadsService = moduleRef.get(LeadsService);
  });

  it('queues welcome email after successful public registration', async () => {
    const dto: CreateLeadDto = {
      fullName: 'Ravi Patel',
      email: 'ravi@example.com',
      contactNumber: '9876543210',
      marketplaces: ['amazon', 'flipkart'],
      servicesNeeded: 'both',
      ordersPerMonth: '1000-2000',
      termsAccepted: true,
      source: 'website',
    };

    const result = await leadsService.createLead(dto, 'website', '127.0.0.1', 'jest');
    await new Promise((resolve) => setImmediate(resolve));

    expect(result.success).toBe(true);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'ravi@example.com',
        type: EmailType.REGISTRATION_WELCOME,
        replyTo: 'info@ecommreco.com',
        subject: 'Welcome to EcommReco — we will connect within 24 hours',
        payload: expect.objectContaining({
          fullName: 'Ravi Patel',
          email: 'ravi@example.com',
          contactNumber: '9876543210',
          servicesLabel: 'Ecommerce Accounting & Reconciliation',
          marketplacesLabel: 'Amazon, Flipkart',
          ordersPerMonth: '1000-2000',
          websiteUrl: 'https://ecommreco.com',
          supportEmail: 'info@ecommreco.com',
        }),
      }),
    );
  });
});
