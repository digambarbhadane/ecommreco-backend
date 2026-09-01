import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { GstService } from '../services/gst.service';
import { GstState, GstStateSchema } from './schemas/gst-state.schema';
import { GstStateService } from './gst-state.service';
import { GstStateController } from './gst-state.controller';

@Global()
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: GstState.name, schema: GstStateSchema },
    ]),
  ],
  controllers: [GstStateController],
  providers: [GstService, GstStateService],
  exports: [GstService, GstStateService],
})
export class GstModule {}
