import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type ImportRowErrorDocument = HydratedDocument<ImportRowError>;

@Schema({
  timestamps: { createdAt: true, updatedAt: false },
  collection: 'import_row_errors',
})
export class ImportRowError {
  @Prop({ required: true, index: true })
  uploadId: string;

  @Prop({ required: true })
  sheetName: string;

  @Prop({ required: true })
  rowNumber: number;

  @Prop({ required: true })
  error: string;
}

export const ImportRowErrorSchema =
  SchemaFactory.createForClass(ImportRowError);
ImportRowErrorSchema.index({ uploadId: 1, rowNumber: 1 });
