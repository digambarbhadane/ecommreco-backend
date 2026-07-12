import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type ReconAuditLogDocument = HydratedDocument<ReconAuditLog>;

@Schema({ timestamps: true, collection: 'recon_audit_logs' })
export class ReconAuditLog {
  @Prop({ required: true, index: true })
  sellerId!: string;

  @Prop({ required: true, index: true })
  marketplace!: string;

  @Prop({ required: true, index: true })
  uploadId!: string;

  @Prop()
  reportMonth?: string;

  @Prop({ default: 0 })
  rowsProcessed!: number;

  @Prop({ default: 0 })
  keysMatched!: number;

  @Prop({ default: 0 })
  transactionsUpdated!: number;

  @Prop({ default: 0 })
  eventsCreated!: number;

  @Prop({ default: 'system' })
  updatedBy!: string;

  @Prop({ default: 'upload_reconciliation' })
  reason!: string;

  @Prop({ type: Object })
  metadata?: Record<string, unknown>;
}

export const ReconAuditLogSchema = SchemaFactory.createForClass(ReconAuditLog);

ReconAuditLogSchema.index(
  { sellerId: 1, marketplace: 1, createdAt: -1 },
  { name: 'recon_audit_recent_idx' },
);
