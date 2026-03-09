import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { GstsController } from './gsts.controller';
import { GstsService } from './gsts.service';
import { Gst, GstSchema } from './schemas/gst.schema';

@Module({
  imports: [MongooseModule.forFeature([{ name: Gst.name, schema: GstSchema }])],
  controllers: [GstsController],
  providers: [GstsService],
})
export class GstsModule {}
