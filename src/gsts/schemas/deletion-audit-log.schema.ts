import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type DeletionAuditLogDocument = HydratedDocument<DeletionAuditLog>;

@Schema({ timestamps: false, collection: 'deletion_audit_logs' })
export class DeletionAuditLog {
  @Prop({ required: true, index: true })
  sellerId: string;

  @Prop({ required: true, index: true })
  userId: string;

  @Prop({
    required: true,
    enum: ['delete_gst_permanently', 'disconnect_marketplace_permanently'],
    index: true,
  })
  action: 'delete_gst_permanently' | 'disconnect_marketplace_permanently';

  @Prop({ required: true, index: true })
  gstNumber: string;

  @Prop({ type: String, default: null, index: true })
  marketplace?: string;

  @Prop({
    type: [
      {
        _id: false,
        collection: String,
        deletedCount: Number,
      },
    ],
    default: [],
  })
  deletedCollections: Array<{ collection: string; deletedCount: number }>;

  @Prop({ required: true, default: 0 })
  totalRecordsDeleted: number;

  @Prop({
    type: String,
    enum: ['pending', 'completed', 'failed'],
    default: 'completed',
    index: true,
  })
  cleanupStatus?: 'pending' | 'completed' | 'failed';

  @Prop()
  cleanupError?: string;

  @Prop({ required: true, default: Date.now, index: true })
  deletedAt: Date;

  @Prop()
  ipAddress?: string;

  @Prop()
  userAgent?: string;
}

export const DeletionAuditLogSchema =
  SchemaFactory.createForClass(DeletionAuditLog);
