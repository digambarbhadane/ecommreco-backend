import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import type { ImportJobPhase } from '../schemas/import-job.schema';

export type ImportProgressPayload = {
  jobId: string;
  uploadId?: string;
  sellerId: string;
  marketplace: string;
  reportType?: string;
  fileName?: string;
  status: string;
  phase?: ImportJobPhase;
  progressPercentage: number;
  rowsImported?: number;
  errorMessage?: string;
  message?: string;
  timings?: Record<string, number>;
  completedAt?: string;
};

@WebSocketGateway({
  namespace: '/import-progress',
  cors: {
    origin: true,
    credentials: true,
  },
})
export class ImportProgressGateway implements OnGatewayConnection {
  private readonly logger = new Logger(ImportProgressGateway.name);

  @WebSocketServer()
  server!: Server;

  handleConnection(client: Socket) {
    const sellerId = String(client.handshake.query.sellerId ?? '').trim();
    if (!sellerId) {
      client.disconnect(true);
      return;
    }
    void client.join(this.sellerRoom(sellerId));
    this.logger.debug(`Socket ${client.id} joined seller:${sellerId}`);
  }

  @SubscribeMessage('subscribe')
  handleSubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { sellerId?: string },
  ) {
    const sellerId = String(body?.sellerId ?? '').trim();
    if (sellerId) {
      void client.join(this.sellerRoom(sellerId));
    }
    return { ok: true };
  }

  emitProgress(payload: ImportProgressPayload) {
    this.server
      .to(this.sellerRoom(payload.sellerId))
      .emit('import:progress', payload);
  }

  emitCompleted(payload: ImportProgressPayload) {
    this.server
      .to(this.sellerRoom(payload.sellerId))
      .emit('import:completed', payload);
  }

  emitFailed(payload: ImportProgressPayload) {
    this.server
      .to(this.sellerRoom(payload.sellerId))
      .emit('import:failed', payload);
  }

  private sellerRoom(sellerId: string) {
    return `seller:${sellerId}`;
  }
}
