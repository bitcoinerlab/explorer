declare module 'electrum-client' {
  //  import { Socket } from 'net';
  import * as net from 'net';
  import * as tls from 'tls';

  export default class ElectrumClient {
    constructor(
      //{ socket }: { Socket },
      netModule: typeof net,
      tlsModule: typeof tls | false,
      port: number,
      host: string,
      protocol: string
    );

    initElectrum(options: { client: string; version: string }): Promise<void>;

    subscribe: {
      on(eventName: string, callback: (data: any) => void): void;
    };

    blockchainHeaders_subscribe(): Promise<any>;

    close(): Promise<void>;
    server_ping(): Promise<null>;

    onError: (e: Error) => void;
    onClose: (hadError: boolean) => void;
    onData: (data: Buffer | string) => void;

    blockchainScripthash_listunspent(scriptHash: string): Promise<any[]>;

    blockchainTransaction_get(transactionHash: string): Promise<any>;

    blockchainScripthash_getBalance(scriptHash: string): Promise<any>;

    blockchainScripthash_getHistory(scriptHash: string): Promise<any[]>;

    blockchainEstimatefee(target: number): Promise<number>;
  }
}
