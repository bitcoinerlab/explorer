import net from 'net';
import tls from 'tls';
import ElectrumClient from '@bitcoinerlab/electrum-client';
import { checkFeeEstimates } from './checkFeeEstimates';
//API: https://electrumx.readthedocs.io/en/latest/protocol-methods.html

import { networks, Network, Block } from 'bitcoinjs-lib';
import {
  ELECTRUM_BLOCKSTREAM_HOST,
  ELECTRUM_BLOCKSTREAM_PORT,
  ELECTRUM_BLOCKSTREAM_PROTOCOL,
  ELECTRUM_BLOCKSTREAM_TESTNET_HOST,
  ELECTRUM_BLOCKSTREAM_TESTNET_PORT,
  ELECTRUM_BLOCKSTREAM_TESTNET_PROTOCOL,
  ELECTRUM_LOCAL_REGTEST_HOST,
  ELECTRUM_LOCAL_REGTEST_PORT,
  ELECTRUM_LOCAL_REGTEST_PROTOCOL
} from './constants';
import {
  Explorer,
  BlockStatus,
  IRREV_CONF_THRESH,
  MAX_TX_PER_SCRIPTPUBKEY
} from './interface';
import { addressToScriptHash } from './address';

// global.net && global.tls will be set in the entry points of any react-native
// project:
//   global.net = { Socket };
//   global.tls = { connect };
// where Socket and connect are these:
// https://github.com/BlueWallet/BlueWallet/blob/master/blue_modules/net.js
// https://github.com/BlueWallet/BlueWallet/blob/master/blue_modules/tls.js
// If they are set, then use them

declare global {
  // eslint-disable-next-line no-var
  var net: typeof import('net');
  // eslint-disable-next-line no-var
  var tls: typeof import('tls');
}
const netModule =
  typeof global !== 'undefined' && global.net ? global.net : net;
const tlsModule =
  typeof global !== 'undefined' && global.tls ? global.tls : tls;

function getErrorMsg(error: unknown): string {
  if (typeof error === 'string') {
    return error;
  } else {
    return (error as Error).message;
  }
}

function defaultElectrumServer(network: Network = networks.bitcoin): {
  host: string;
  port: number;
  protocol: 'ssl' | 'tcp';
} {
  if (network === networks.bitcoin) {
    return {
      host: ELECTRUM_BLOCKSTREAM_HOST,
      port: ELECTRUM_BLOCKSTREAM_PORT,
      protocol: ELECTRUM_BLOCKSTREAM_PROTOCOL
    };
  } else if (network === networks.testnet) {
    return {
      host: ELECTRUM_BLOCKSTREAM_TESTNET_HOST,
      port: ELECTRUM_BLOCKSTREAM_TESTNET_PORT,
      protocol: ELECTRUM_BLOCKSTREAM_TESTNET_PROTOCOL
    };
  } else if (network === networks.regtest) {
    return {
      host: ELECTRUM_LOCAL_REGTEST_HOST,
      port: ELECTRUM_LOCAL_REGTEST_PORT,
      protocol: ELECTRUM_LOCAL_REGTEST_PROTOCOL
    };
  } else throw new Error('Error: invalid network');
}

export class ElectrumExplorer implements Explorer {
  #timeout: number;
  #irrevConfThresh: number;
  #tipBlockHeight!: number;
  #maxTxPerScriptPubKey: number;
  #pingInterval!: ReturnType<typeof setTimeout> | undefined;
  #client!: ElectrumClient | undefined;
  #blockStatusMap: Map<number, BlockStatus> = new Map();

  #host: string;
  #port: number;
  #protocol: string;
  #network: Network;

  constructor({
    host,
    port,
    protocol,
    network = networks.bitcoin,
    irrevConfThresh = IRREV_CONF_THRESH,
    maxTxPerScriptPubKey = MAX_TX_PER_SCRIPTPUBKEY,
    timeout = 0
  }: {
    host?: string;
    port?: number;
    protocol?: 'ssl' | 'tcp';
    network?: Network;
    irrevConfThresh?: number;
    maxTxPerScriptPubKey?: number;
    timeout?: number;
  } = {}) {
    this.#timeout = timeout;
    this.#irrevConfThresh = irrevConfThresh;
    this.#maxTxPerScriptPubKey = maxTxPerScriptPubKey;
    if (
      typeof host === 'undefined' &&
      typeof port === 'undefined' &&
      typeof protocol === 'undefined'
    ) {
      const server = defaultElectrumServer(network);
      host = server.host;
      port = server.port;
      protocol = server.protocol;
    }
    if (
      typeof host !== 'string' ||
      !Number.isInteger(port) ||
      port === undefined ||
      port <= 0 ||
      (protocol !== 'ssl' && protocol !== 'tcp')
    ) {
      throw new Error(
        "Specify a host (string), port (integer), and protocol ('ssl' or 'tcp') for Electrum."
      );
    }
    this.#host = host;
    this.#port = port;
    this.#protocol = protocol;
    this.#network = network;
  }

  /**
   * Implements {@link Explorer#connect}.
   */
  async connect(): Promise<void> {
    if (this.#pingInterval)
      throw new Error(
        'Client was not successfully closed. Prev connection is still pinging.'
      );
    if (!this.isClosed())
      throw new Error('Client previously connected and never closed.');
    this.#client = new ElectrumClient(
      netModule,
      this.#protocol === 'ssl' ? tlsModule : false,
      this.#port,
      this.#host,
      this.#protocol
    );
    if (!this.#client)
      throw new Error(`Cannot create an ElectrumClient with current params`);
    try {
      await this.#client.initElectrum(
        {
          client: 'bitcoinerlab',
          version: '1.4'
        },
        { maxRetry: 1000, callback: null },
        this.#timeout
      );
      this.#client.subscribe.on(
        'blockchain.headers.subscribe',
        (headers: Array<{ height: number; hex: string }>) => {
          if (Array.isArray(headers)) {
            for (const header of headers) {
              this.#updateBlockTipHeight(header);
            }
          }
        }
      );
      const header = await this.#client.blockchainHeaders_subscribe();
      this.#updateBlockTipHeight(header);
    } catch (error: unknown) {
      //The socket is init in the constructor. The error catched is after the
      //socket has been init. Here we get an error if electrum server cannot
      //be found in that port, so close the socket
      try {
        if (!this.isClosed()) this.close();
      } catch (err) {
        void err;
        console.warn('Error while closing connection:', getErrorMsg(error));
      }
      throw new Error(
        `ElectrumClient failed to connect: ${getErrorMsg(error)}`
      );
    }
    if (!this.#client) throw new Error('Client should exist at this point');

    // Ping every few seconds to keep connection alive.
    // This function will never throw since it cannot be handled
    // In case of connection errors, users will get them on any next function
    // call
    this.#pingInterval = setInterval(async () => {
      const pingInterval = this.#pingInterval;
      this.#getClientOrThrow();
      let shouldReconnect = false;
      try {
        if (this.#client) await this.#client.server_ping();
      } catch (error: unknown) {
        shouldReconnect = true;
        console.warn(
          'Closing connection and reconnecting in 1s after ping error:',
          getErrorMsg(error)
        );
      }
      //Dont allow 2 instances of #pingInterval. #pingInterval is set on connection
      if (shouldReconnect && pingInterval === this.#pingInterval) {
        try {
          if (this.isClosed()) throw new Error('Pinging a closed connection');
          this.close();
          await new Promise(resolve => setTimeout(resolve, 1000));
          //connect may have been set externally while sleeping, check first
          if (this.isClosed() && pingInterval === this.#pingInterval)
            await this.connect();
        } catch (error) {
          console.warn(
            'Error while reconnecting during interval pinging:',
            getErrorMsg(error)
          );
        }
      }
    }, 14 * 1000); // 14 * 1000 ms = 14 seconds
  }

  /**
   * Implements {@link Explorer#fetchBlockStatus}.
   */
  async fetchBlockStatus(
    blockHeight: number
  ): Promise<BlockStatus | undefined> {
    let blockStatus = this.#blockStatusMap.get(blockHeight);
    if (blockStatus && blockStatus.irreversible) return blockStatus;
    if (blockHeight > this.#tipBlockHeight) return;

    const client = this.#getClientOrThrow();
    const headerHex = await client.blockchainBlock_header(blockHeight);
    //cache header info to skip queries in fetchBlockStatus
    blockStatus = this.#updateBlockStatusMap(blockHeight, headerHex);

    return blockStatus;
  }

  /**
   * Implements {@link Explorer#isConnected}.
   *  Checks server connectivity by sending a ping. Returns `true` if the ping
   * is successful, otherwise `false`.
   */
  async isConnected(): Promise<boolean> {
    if (!this.#client) return false;
    else {
      try {
        await this.#client.server_ping();
        return true;
      } catch {}
      return false;
    }
  }
  isClosed(): boolean {
    return !this.#client;
  }

  /**
   * Implements {@link Explorer#close}.
   */
  close(): void {
    if (this.#pingInterval) {
      clearInterval(this.#pingInterval);
      this.#pingInterval = undefined;
    }
    if (!this.#client) console.warn('Client was already closed');
    else {
      this.#client.close();
    }
    this.#client = undefined;
  }

  #getClientOrThrow(): ElectrumClient {
    if (this.#client) return this.#client;
    else throw new Error(`Electrum client not connected.`);
  }

  #updateBlockStatusMap(blockHeight: number, headerHex: string): BlockStatus {
    let blockStatus = this.#blockStatusMap.get(blockHeight);
    if (blockStatus && blockStatus.irreversible) return blockStatus;

    const headerBuffer = Buffer.from(headerHex, 'hex');
    const header = Block.fromBuffer(headerBuffer);

    const blockHash = header.getId();
    const blockTime = header.timestamp;
    const numConfirmations = this.#tipBlockHeight - blockHeight + 1;
    const irreversible = numConfirmations >= this.#irrevConfThresh;

    blockStatus = { blockHeight, blockHash, blockTime, irreversible };
    this.#blockStatusMap.set(blockHeight, blockStatus);

    return blockStatus;
  }

  #updateBlockTipHeight(header: { height: number; hex: string }) {
    if (
      header &&
      header.hex &&
      header.height &&
      (typeof this.#tipBlockHeight === 'undefined' ||
        header.height > this.#tipBlockHeight)
    ) {
      this.#tipBlockHeight = header.height;

      //cache header info to skip queries in fetchBlockStatus
      this.#updateBlockStatusMap(header.height, header.hex);
    }
  }

  /**
   * Implements {@link Explorer#fetchAddress}.
   * */
  async fetchAddress(address: string): Promise<{
    balance: number;
    txCount: number;
    unconfirmedBalance: number;
    unconfirmedTxCount: number;
  }> {
    const scriptHash = addressToScriptHash(address, this.#network);
    return this.fetchScriptHash(scriptHash);
  }

  /**
   * Implements {@link Explorer#fetchScriptHash}.
   * */
  async fetchScriptHash(scriptHash: string): Promise<{
    balance: number;
    txCount: number;
    unconfirmedBalance: number;
    unconfirmedTxCount: number;
  }> {
    let balance, history;
    try {
      let client = this.#getClientOrThrow();
      balance = await client.blockchainScripthash_getBalance(scriptHash);
      /** get_history returns:
       * height
       * txid
       */
      client = this.#getClientOrThrow();
      history = await client.blockchainScripthash_getHistory(scriptHash);
    } catch (error: unknown) {
      throw new Error(
        `Failed getting balance & history of ${scriptHash}: ${getErrorMsg(
          error
        )}`
      );
    }
    const _txCount = history.filter(tx => tx.height > 0).length;

    return {
      balance: balance.confirmed,
      txCount: _txCount,
      unconfirmedBalance: balance.unconfirmed,
      unconfirmedTxCount: history.length - _txCount
    };
  }

  /**
   * Implements {@link Explorer#fetchFeeEstimates}
   * */
  async fetchFeeEstimates(): Promise<Record<string, number>> {
    //Same as in https://github.com/Blockstream/esplora/blob/master/API.md#get-fee-estimates
    //The available confirmation targets are 1-25, 144, 504 and 1008 blocks.
    const T = [...Array.from({ length: 25 }, (_, i) => i + 1), 144, 504, 1008];

    const feeEstimates: { [target: number]: number } = {};
    for (const target of T) {
      //100000 = 10 ^ 8 sats/BTC / 10 ^3 bytes/kbyte
      //Don't throw. Instead try twice just in case the fist try was a spuripus error.
      //The reason for not throwing is blockchainEstimatefee throws
      //even if the call is successful but for some reason the electrum server
      //cannot provide the fee for a certain target time. This has been observed to
      //occur on electrs on testnet.
      let fee: number | undefined = undefined;
      try {
        const client = this.#getClientOrThrow();
        fee = await client.blockchainEstimatefee(target);
        feeEstimates[target] = 100000 * fee;
      } catch (error: unknown) {
        void error;
      }
      if (fee === undefined) {
        try {
          await new Promise(resolve => setTimeout(resolve, 100)); //sleep 0.1 sec
          const client = this.#getClientOrThrow();
          fee = await client.blockchainEstimatefee(target);
          feeEstimates[target] = 100000 * fee;
        } catch (error: unknown) {
          void error;
        }
      }
    }
    checkFeeEstimates(feeEstimates);
    return feeEstimates;
  }

  /**
   * Implements {@link Explorer#fetchBlockHeight}.
   * Get's current block height.
   * @async
   * @returns A number representing the current height.
   */
  async fetchBlockHeight(): Promise<number> {
    //Get's the client even if we don't need to use it. We call this so that it
    //throws if it's not connected (and this.#tipBlockHeight is erroneous)
    this.#getClientOrThrow();
    if (this.#tipBlockHeight === undefined)
      throw new Error(
        `Error: block tip height has not been retrieved yet. Probably not connected`
      );
    return this.#tipBlockHeight;
  }

  /**
   * Fetches the transaction history for a given address or script hash from an Esplora server.
   * See interface.ts
   */
  async fetchTxHistory({
    address,
    scriptHash
  }: {
    address?: string;
    scriptHash?: string;
  }): Promise<
    Array<{ txId: string; blockHeight: number; irreversible: boolean }>
  > {
    if (!scriptHash && address)
      scriptHash = addressToScriptHash(address, this.#network);
    if (!scriptHash) throw new Error(`Please provide an address or scriptHash`);

    //This line below may throw even with a #txs than #maxTxPerScriptPubKey:
    let history;
    try {
      const client = this.#getClientOrThrow();
      history = await client.blockchainScripthash_getHistory(scriptHash);
    } catch (error: unknown) {
      throw new Error(
        `Failed to fetch transaction history for address/scriptHash "${
          scriptHash || address
        }": ${getErrorMsg(error)}`
      );
    }
    if (history.length > this.#maxTxPerScriptPubKey)
      throw new Error(`Too many transactions per address`);

    const transactionHistory = history.map(({ tx_hash, height }) => {
      const txId = tx_hash;
      //Electrum returns -1 for mempool, however we use blockHeight = 0 to
      //denote mempool
      const blockHeight: number =
        parseInt(height) === -1 ? 0 : parseInt(height);
      if (blockHeight > this.#tipBlockHeight) {
        console.warn(
          `tx ${tx_hash} block height ${blockHeight} larger than the tip ${this.#tipBlockHeight}`
        );
        this.#tipBlockHeight = blockHeight;
      }
      const numConfirmations = blockHeight
        ? this.#tipBlockHeight - blockHeight + 1
        : 0;
      const irreversible = numConfirmations >= this.#irrevConfThresh;
      return { txId, blockHeight, irreversible };
    });

    return transactionHistory;
  }

  /**
   * Fetches raw transaction data for a given transaction ID from an Electrum server.
   *
   * @param {string} txId - The transaction ID to fetch data for.
   *
   * @returns {Promise<string>} A promise that resolves to the raw transaction data as a string.
   */
  async fetchTx(txId: string): Promise<string> {
    try {
      const client = this.#getClientOrThrow();
      return await client.blockchainTransaction_get(txId);
    } catch (error: unknown) {
      throw new Error(
        `Failed to fetch transaction tx for "${txId}": ${getErrorMsg(error)}`
      );
    }
  }

  /**
   * Push a raw Bitcoin transaction to the network.
   * @async
   * @param txHex A raw Bitcoin transaction in hexadecimal string format.
   * @returns The transaction ID (`txId`) if the transaction was broadcasted successfully.
   * @throws {Error} If the transaction is invalid or fails to be broadcasted.
   */
  async push(txHex: string): Promise<string> {
    try {
      const client = this.#getClientOrThrow();
      const txId = await client.blockchainTransaction_broadcast(txHex);

      if (!txId) {
        throw new Error(
          'Failed to get a transaction ID from the Electrum server.'
        );
      }

      return txId;
    } catch (error: unknown) {
      throw new Error(`Failed to broadcast transaction: ${getErrorMsg(error)}`);
    }
  }
}
