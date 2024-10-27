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
    maxTxPerScriptPubKey = MAX_TX_PER_SCRIPTPUBKEY
  }: {
    host?: string;
    port?: number;
    protocol?: 'ssl' | 'tcp';
    network?: Network;
    irrevConfThresh?: number;
    maxTxPerScriptPubKey?: number;
  } = {}) {
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
    if (this.#client) {
      throw new Error('Client already connected.');
    }
    this.#client = new ElectrumClient(
      netModule,
      this.#protocol === 'ssl' ? tlsModule : false,
      this.#port,
      this.#host,
      this.#protocol
    );
    if (!this.#client)
      throw new Error(`Cannot create an ElectrumClient with current params`);
    this.#client.onError = e => {
      console.warn('Electrum error:', e.message);
    };
    this.#client.onClose = hadError => {
      if (hadError) console.warn('Electrum closed with error.');
      this.#client = undefined;
    };
    try {
      await this.#client.initElectrum({
        client: 'bitcoinerlab',
        version: '1.4'
      });
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
      throw new Error(`Failed to init Electrum: ${getErrorMsg(error)}`);
    }

    // Ping every minute to keep connection alive. Reconnect on error.
    this.#pingInterval = setInterval(async () => {
      if (!this.#client) {
        await this.connect();
        if (!this.#client)
          throw new Error(`Unrecoverable connection to Electrum`);
      }
      try {
        await this.#client.server_ping();
      } catch (error: unknown) {
        // Ping failed, stop pinging and reconnect
        await this.close();
        console.warn(
          'Reconnecting in 0.5s after ping error:',
          getErrorMsg(error)
        );
        await new Promise(resolve => setTimeout(resolve, 500));
        await this.connect();
      }
    }, 60 * 1000); // 60 * 1000 ms = 1 minute
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

    const client = await this.#getClient();
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
    if (this.#client === undefined) return false;
    try {
      await this.#client.server_ping();
      return true;
    } catch {}
    return false;
  }

  /**
   * Implements {@link Explorer#close}.
   */
  async close(): Promise<void> {
    if (this.#client) {
      clearInterval(this.#pingInterval);
      this.#pingInterval = undefined;
      await this.#client.close();
    }
    this.#client = undefined;
  }

  async #getClient(): Promise<ElectrumClient> {
    if (this.#client) return this.#client;
    else {
      //Give it one more change in case we're trying to recover from an error
      //during ping...
      await new Promise(resolve => setTimeout(resolve, 1000));
      if (this.#client) return this.#client;
      else throw new Error(`Electrum client not connected.`);
    }
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

  //async #getBlockHeight() {
  //  return this.#tipBlockHeight;
  //}

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
      let client = await this.#getClient();
      balance = await client.blockchainScripthash_getBalance(scriptHash);
      /** get_history returns:
       * height
       * txid
       */
      client = await this.#getClient();
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
      try {
        const client = await this.#getClient();
        const fee = await client.blockchainEstimatefee(target);
        feeEstimates[target] = 100000 * fee;
      } catch (error: unknown) {
        throw new Error(`Failed to fetch fee estimates: ${getErrorMsg(error)}`);
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
    await this.#getClient();
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
      const client = await this.#getClient();
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
      const client = await this.#getClient();
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
      const client = await this.#getClient();
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
