import net from 'net';
import tls from 'tls';
import ElectrumClient from 'electrum-client';
import { checkFeeEstimates } from './checkFeeEstimates';
//API: https://electrumx.readthedocs.io/en/latest/protocol-methods.html

import { networks, Network, Transaction } from 'bitcoinjs-lib';
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
  UtxoId,
  UtxoInfo,
  IRREV_CONF_THRESH,
  MAX_TX_PER_SCRIPTPUBKEY
} from './interface';
import { addressToScriptHash } from './address';

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
  #blockTipHeight!: number;
  #maxTxPerScriptPubKey: number;
  #pingInterval!: ReturnType<typeof setTimeout> | undefined;
  #client!: ElectrumClient | undefined;

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
      net,
      this.#protocol === 'ssl' ? tls : false,
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
        (headers: { height: number }[]) => {
          if (Array.isArray(headers)) {
            for (const header of headers) {
              this.#updateBlockTipHeight(header);
            }
          }
        }
      );
      const header = await this.#client.blockchainHeaders_subscribe();
      this.#updateBlockTipHeight(header);
    } catch (_error: unknown) {
      const error = _error as Error;
      throw new Error(`Failed to init Electrum: ${error.message}`);
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
        console.log('Electrum ping');
      } catch (_error: unknown) {
        const error = _error as Error;
        // Ping failed, stop pinging and reconnect
        await this.close();
        console.warn('Reconnecting in 0.5s after ping error:', error.message);
        await new Promise(resolve => setTimeout(resolve, 500));
        await this.connect();
      }
    }, 60 * 1000); // 60 * 1000 ms = 1 minute
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

  #updateBlockTipHeight(header: { height: number }) {
    if (
      header &&
      header.height &&
      (typeof this.#blockTipHeight === 'undefined' ||
        header.height > this.#blockTipHeight)
    ) {
      this.#blockTipHeight = header.height;
      //this.#blockTime = Math.floor(+new Date() / 1000);
    }
  }

  /**
   * Implements {@link Explorer#fetchUtxos}.
   */
  async fetchUtxos({
    address,
    scriptHash
  }: {
    address?: string;
    scriptHash?: string;
  }): Promise<{
    confirmed?: { [utxoId: UtxoId]: UtxoInfo };
    unconfirmed?: { [utxoId: UtxoId]: UtxoInfo };
  }> {
    if (!scriptHash && address)
      scriptHash = addressToScriptHash(address, this.#network);
    if (!scriptHash) throw new Error(`Please provide an address or scriptHash`);

    /**  The API call below returns, per each utxo:
     * tx_pos - the vout
     * value
     * tx_hash - the txid
     * height - the blockheight
     */
    let unspents;
    try {
      const client = await this.#getClient();
      unspents = await client.blockchainScripthash_listunspent(scriptHash);
    } catch (_error: unknown) {
      const error = _error as Error;
      throw new Error(
        `Failed fetching utxos for ${scriptHash || address}: ${error.message}`
      );
    }

    const confirmedUtxoInfoMap: { [utxoId: UtxoId]: UtxoInfo } = {};
    const unconfirmedUtxoInfoMap: { [utxoId: UtxoId]: UtxoInfo } = {};

    for (const unspent of unspents) {
      let txHex;
      try {
        const client = await this.#getClient();
        txHex = await client.blockchainTransaction_get(unspent.tx_hash);
      } catch (_error: unknown) {
        const error = _error as Error;
        throw new Error(
          `Failed fetching tx for ${unspent.tx_hash}: ${error.message}`
        );
      }
      const vout = unspent.tx_pos;
      const txId = Transaction.fromHex(txHex).getId();
      const utxoId = txId + ':' + vout;
      const blockHeight = unspent.height;

      if (unspent.height !== 0) {
        confirmedUtxoInfoMap[utxoId] = { utxoId, txHex, vout, blockHeight };
      } else {
        unconfirmedUtxoInfoMap[utxoId] = { utxoId, txHex, vout, blockHeight };
      }
    }

    const result: {
      confirmed?: { [utxoId: UtxoId]: UtxoInfo };
      unconfirmed?: { [utxoId: UtxoId]: UtxoInfo };
    } = {};

    if (Object.keys(confirmedUtxoInfoMap).length > 0) {
      result.confirmed = confirmedUtxoInfoMap;
    }
    if (Object.keys(unconfirmedUtxoInfoMap).length > 0) {
      result.unconfirmed = unconfirmedUtxoInfoMap;
    }

    return result;
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
      let client = await this.#getClient();
      balance = await client.blockchainScripthash_getBalance(scriptHash);
      /** get_history returns:
       * height
       * txid
       */
      client = await this.#getClient();
      history = await client.blockchainScripthash_getHistory(scriptHash);
    } catch (_error: unknown) {
      const error = _error as Error;
      throw new Error(
        `Failed getting balance & history of ${scriptHash}: ${error.message}`
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
      } catch (_error: unknown) {
        const error = _error as Error;
        throw new Error(`Failed to fetch fee estimates: ${error.message}`);
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
    return this.#blockTipHeight;
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
    } catch (_error: unknown) {
      const error = _error as Error;
      throw new Error(
        `Failed to fetch transaction history for address/scriptHash "${
          scriptHash || address
        }": ${error.message}`
      );
    }
    if (history.length > this.#maxTxPerScriptPubKey)
      throw new Error(`Too many transactions per address`);

    const transactionHistory = history.map(({ tx_hash, height }) => {
      const txId = tx_hash;
      const blockHeight: number = height || 0;
      if (blockHeight > this.#blockTipHeight) {
        console.warn(
          `tx ${tx_hash} block height ${blockHeight} larger than the tip ${
            this.#blockTipHeight
          }`
        );
        this.#blockTipHeight = blockHeight;
      }
      const numConfirmations = blockHeight
        ? this.#blockTipHeight - blockHeight + 1
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
    } catch (_error: unknown) {
      const error = _error as Error;
      throw new Error(
        `Failed to fetch transaction tx for "${txId}": ${error.message}`
      );
    }
  }
}
