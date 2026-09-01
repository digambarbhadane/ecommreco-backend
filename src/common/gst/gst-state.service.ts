import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { GstState, GstStateDocument } from './schemas/gst-state.schema';

const GST_STATE_SEED: Omit<GstState, 'aliases'>[] = [
  {
    stateCode: 1,
    shortName: 'JK',
    stateName: 'Jammu & Kashmir',
    gstName: '01-Jammu & Kashmir',
  },
  {
    stateCode: 2,
    shortName: 'HP',
    stateName: 'Himachal Pradesh',
    gstName: '02-Himachal Pradesh',
  },
  { stateCode: 3, shortName: 'PB', stateName: 'Punjab', gstName: '03-Punjab' },
  {
    stateCode: 4,
    shortName: 'CH',
    stateName: 'Chandigarh',
    gstName: '04-Chandigarh',
  },
  {
    stateCode: 5,
    shortName: 'UK',
    stateName: 'Uttarakhand',
    gstName: '05-Uttarakhand',
  },
  {
    stateCode: 6,
    shortName: 'HR',
    stateName: 'Haryana',
    gstName: '06-Haryana',
  },
  { stateCode: 7, shortName: 'DL', stateName: 'Delhi', gstName: '07-Delhi' },
  {
    stateCode: 8,
    shortName: 'RJ',
    stateName: 'Rajasthan',
    gstName: '08-Rajasthan',
  },
  {
    stateCode: 9,
    shortName: 'UP',
    stateName: 'Uttar Pradesh',
    gstName: '09-Uttar Pradesh',
  },
  { stateCode: 10, shortName: 'BR', stateName: 'Bihar', gstName: '10-Bihar' },
  { stateCode: 11, shortName: 'SK', stateName: 'Sikkim', gstName: '11-Sikkim' },
  {
    stateCode: 12,
    shortName: 'AR',
    stateName: 'Arunachal Pradesh',
    gstName: '12-Arunachal Pradesh',
  },
  {
    stateCode: 13,
    shortName: 'NL',
    stateName: 'Nagaland',
    gstName: '13-Nagaland',
  },
  {
    stateCode: 14,
    shortName: 'MN',
    stateName: 'Manipur',
    gstName: '14-Manipur',
  },
  {
    stateCode: 15,
    shortName: 'MZ',
    stateName: 'Mizoram',
    gstName: '15-Mizoram',
  },
  {
    stateCode: 16,
    shortName: 'TR',
    stateName: 'Tripura',
    gstName: '16-Tripura',
  },
  {
    stateCode: 17,
    shortName: 'ML',
    stateName: 'Meghalaya',
    gstName: '17-Meghalaya',
  },
  { stateCode: 18, shortName: 'AS', stateName: 'Assam', gstName: '18-Assam' },
  {
    stateCode: 19,
    shortName: 'WB',
    stateName: 'West Bengal',
    gstName: '19-West Bengal',
  },
  {
    stateCode: 20,
    shortName: 'JH',
    stateName: 'Jharkhand',
    gstName: '20-Jharkhand',
  },
  { stateCode: 21, shortName: 'OD', stateName: 'Odisha', gstName: '21-Odisha' },
  {
    stateCode: 22,
    shortName: 'CG',
    stateName: 'Chhattisgarh',
    gstName: '22-Chhattisgarh',
  },
  {
    stateCode: 23,
    shortName: 'MP',
    stateName: 'Madhya Pradesh',
    gstName: '23-Madhya Pradesh',
  },
  {
    stateCode: 24,
    shortName: 'GJ',
    stateName: 'Gujarat',
    gstName: '24-Gujarat',
  },
  {
    stateCode: 25,
    shortName: 'DD',
    stateName: 'Daman & Diu',
    gstName: '25-Daman & Diu',
  },
  {
    stateCode: 26,
    shortName: 'DNH',
    stateName: 'Dadra & Nagar Haveli & Daman & Diu',
    gstName: '26-Dadra & Nagar Haveli & Daman & Diu',
  },
  {
    stateCode: 27,
    shortName: 'MH',
    stateName: 'Maharashtra',
    gstName: '27-Maharashtra',
  },
  {
    stateCode: 29,
    shortName: 'KA',
    stateName: 'Karnataka',
    gstName: '29-Karnataka',
  },
  { stateCode: 30, shortName: 'GA', stateName: 'Goa', gstName: '30-Goa' },
  {
    stateCode: 31,
    shortName: 'LD',
    stateName: 'Lakshadweep',
    gstName: '31-Lakshdweep',
  },
  { stateCode: 32, shortName: 'KL', stateName: 'Kerala', gstName: '32-Kerala' },
  {
    stateCode: 33,
    shortName: 'TN',
    stateName: 'Tamil Nadu',
    gstName: '33-Tamil Nadu',
  },
  {
    stateCode: 34,
    shortName: 'PY',
    stateName: 'Puducherry',
    gstName: '34-Puducherry',
  },
  {
    stateCode: 35,
    shortName: 'AN',
    stateName: 'Andaman and Nicobar',
    gstName: '35-Andaman & Nicobar Islands',
  },
  {
    stateCode: 36,
    shortName: 'TS',
    stateName: 'Telangana',
    gstName: '36-Telangana',
  },
  {
    stateCode: 37,
    shortName: 'AD',
    stateName: 'Andhra Pradesh',
    gstName: '37-Andhra Pradesh',
  },
  { stateCode: 38, shortName: 'LA', stateName: 'Ladakh', gstName: '38-Ladakh' },
  {
    stateCode: 97,
    shortName: 'OT',
    stateName: 'Other Territory',
    gstName: '97-Other Territory',
  },
];

@Injectable()
export class GstStateService implements OnModuleInit {
  private readonly logger = new Logger(GstStateService.name);
  private byCode = new Map<number, GstStateDocument>();
  private byShort = new Map<string, GstStateDocument>();

  constructor(
    @InjectModel(GstState.name)
    private readonly model: Model<GstStateDocument>,
  ) {}

  async onModuleInit() {
    await this.seed();
    await this.loadCache();
  }

  private async seed() {
    const count = await this.model.countDocuments().exec();
    if (count >= GST_STATE_SEED.length) return;

    this.logger.log('Seeding gst_states collection...');
    const ops = GST_STATE_SEED.map((entry) => ({
      updateOne: {
        filter: { stateCode: entry.stateCode },
        update: { $setOnInsert: { ...entry, aliases: [] } },
        upsert: true,
      },
    }));
    await this.model.bulkWrite(ops);
    this.logger.log(`Seeded ${GST_STATE_SEED.length} GST states.`);
  }

  private async loadCache() {
    const docs = await this.model.find().lean<GstStateDocument[]>().exec();
    this.byCode.clear();
    this.byShort.clear();
    for (const doc of docs) {
      this.byCode.set(doc.stateCode, doc);
      this.byShort.set(doc.shortName.toUpperCase(), doc);
    }
    this.logger.log(`Loaded ${docs.length} GST states into cache.`);
  }

  async findAll(): Promise<GstStateDocument[]> {
    return this.model
      .find()
      .sort({ stateCode: 1 })
      .lean<GstStateDocument[]>()
      .exec();
  }

  async findByStateCode(code: number): Promise<GstStateDocument | null> {
    return (
      this.byCode.get(code) ??
      this.model.findOne({ stateCode: code }).lean<GstStateDocument>().exec()
    );
  }

  async findByShortName(short: string): Promise<GstStateDocument | null> {
    const key = short.trim().toUpperCase();
    return (
      this.byShort.get(key) ??
      this.model.findOne({ shortName: key }).lean<GstStateDocument>().exec()
    );
  }

  async findByGstinPrefix(gstin: string): Promise<GstStateDocument | null> {
    const prefix = gstin?.trim().slice(0, 2);
    const code = Number(prefix);
    if (!Number.isFinite(code) || code < 1) return null;
    return this.findByStateCode(code);
  }

  getByCodeSync(code: number): GstStateDocument | undefined {
    return this.byCode.get(code);
  }

  getByShortSync(short: string): GstStateDocument | undefined {
    return this.byShort.get(short.trim().toUpperCase());
  }

  getByGstinPrefixSync(gstin: string): GstStateDocument | undefined {
    const code = Number(gstin?.trim().slice(0, 2));
    return Number.isFinite(code) ? this.byCode.get(code) : undefined;
  }
}
