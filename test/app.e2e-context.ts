import { Server } from 'http';
import { Observer } from 'rxjs';
import { AxiosResponse } from 'axios';
import { HttpService } from '@nestjs/axios';
import request from 'superwstest';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { WsAdapter } from '@nestjs/platform-ws';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { EventStreamReply, EventBatch } from '../src/event-stream/event-stream.interfaces';
import { EventStreamService } from '../src/event-stream/event-stream.service';
import { EventStreamProxyGateway } from '../src/eventstream-proxy/eventstream-proxy.gateway';
import { TokensService } from '../src/tokens/tokens.service';
import { BlockchainConnectorService, RetryConfiguration } from '../src/tokens/blockchain.service';
import { requestIDMiddleware } from '../src/request-context/request-id.middleware';

export const BASE_URL = 'http://eth';
export const INSTANCE_PATH = '/tokens';
export const TOPIC = 'tokentest';
export const CONTRACT_ADDRESS = '0x888';

export class TestContext {
  app: INestApplication;
  server: ReturnType<typeof request>;
  http: {
    get: ReturnType<typeof jest.fn>;
    post: ReturnType<typeof jest.fn>;
  };
  eventHandler: (events: EventBatch) => void;
  receiptHandler: (receipt: EventStreamReply) => void;

  eventstream = {
    connect: (
      url: string,
      topic: string,
      handleEvents: (events: EventBatch) => void,
      handleReceipt: (receipt: EventStreamReply) => void,
    ) => {
      this.eventHandler = handleEvents;
      this.receiptHandler = handleReceipt;
    },

    getStreams: jest.fn(),
    createOrUpdateStream: jest.fn(),
    getSubscription: jest.fn(),
    getOrCreateSubscription: jest.fn(),
  };

  async begin() {
    this.http = {
      get: jest.fn(),
      post: jest.fn(),
    };
    this.eventstream.getStreams.mockReset().mockReturnValue([]);
    this.eventstream.createOrUpdateStream.mockReset().mockReturnValue({ name: TOPIC });

    this.eventstream.getSubscription.mockReset();
    this.eventstream.getOrCreateSubscription.mockReset();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(HttpService)
      .useValue(this.http)
      .overrideProvider(EventStreamService)
      .useValue(this.eventstream)
      .compile();

    this.app = moduleFixture.createNestApplication();
    this.app.useWebSocketAdapter(new WsAdapter(this.app));
    this.app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    this.app.use(requestIDMiddleware);
    await this.app.init();

    const blockchainRetryCfg: RetryConfiguration = {
      retryBackOffFactor: 2,
      retryBackOffLimit: 500,
      retryBackOffInitial: 50,
      retryCondition: '.*ECONN.*',
      retriesMax: 15,
    };

    this.app.get(EventStreamProxyGateway).configure('url', TOPIC);
    this.app.get(TokensService).configure(BASE_URL, INSTANCE_PATH, TOPIC, CONTRACT_ADDRESS);
    this.app.get(BlockchainConnectorService).configure(BASE_URL, '', '', [], blockchainRetryCfg);

    (this.app.getHttpServer() as Server).listen();
    this.server = request(this.app.getHttpServer());
  }

  async end() {
    await this.app.close();
  }
}

export class FakeObservable<T> {
  constructor(public data: T) {}

  subscribe(observer?: Partial<Observer<AxiosResponse<T>>>) {
    observer?.next &&
      observer?.next({
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {},
        data: this.data,
      });
    observer?.complete && observer?.complete();
  }
}
