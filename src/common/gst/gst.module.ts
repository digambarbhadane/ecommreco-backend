import { Global, Module } from '@nestjs/common';
import { GstService } from '../services/gst.service';

@Global()
@Module({
  providers: [GstService],
  exports: [GstService],
})
export class GstModule {}
