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
import { Explorer, UtxoId, UtxoInfo, IRREV_CONF_THRESH } from './interface';
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
  #client!: ElectrumClient | undefined;

  #host: string;
  #port: number;
  #protocol: string;
  #network: Network;

  constructor({
    host = ELECTRUM_BLOCKSTREAM_HOST,
    port = ELECTRUM_BLOCKSTREAM_PORT,
    protocol = ELECTRUM_BLOCKSTREAM_PROTOCOL,
    network = networks.bitcoin,
    irrevConfThresh = IRREV_CONF_THRESH
  }: {
    host?: string;
    port?: number;
    protocol?: 'ssl' | 'tcp';
    network?: Network;
    irrevConfThresh?: number;
  } = {}) {
    this.#irrevConfThresh = irrevConfThresh;
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

  #assertConnect() {
    if (typeof this.#client === 'undefined') {
      throw new Error('Client not connected.');
    }
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
    this.#assertConnect();
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
  }

  /**
   * Implements {@link Explorer#close}.
   */
  async close(): Promise<void> {
    this.#assertConnect();
    await this.#client!.close();
    this.#client = undefined;
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
    this.#assertConnect();

    if (!scriptHash && address)
      scriptHash = addressToScriptHash(address, this.#network);
    if (!scriptHash) throw new Error(`Please provide an address or scriptHash`);

    /**  The API call below returns, per each utxo:
     * tx_pos - the vout
     * value
     * tx_hash - the txid
     * height - the blockheight
     */
    const unspents = await this.#client!.blockchainScripthash_listunspent(
      scriptHash
    );

    const confirmedUtxoInfoMap: { [utxoId: UtxoId]: UtxoInfo } = {};
    const unconfirmedUtxoInfoMap: { [utxoId: UtxoId]: UtxoInfo } = {};

    for (const unspent of unspents) {
      this.#assertConnect();

      const txHex = await this.#client!.blockchainTransaction_get(
        unspent.tx_hash
      );
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
    this.#assertConnect();
    const balance = await this.#client!.blockchainScripthash_getBalance(
      scriptHash
    );
    this.#assertConnect();
    /** get_history returns:
     * height
     * txid
     */
    const history = await this.#client!.blockchainScripthash_getHistory(
      scriptHash
    );
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
    this.#assertConnect();
    //Same as in https://github.com/Blockstream/esplora/blob/master/API.md#get-fee-estimates
    //The available confirmation targets are 1-25, 144, 504 and 1008 blocks.
    const T = [...Array.from({ length: 25 }, (_, i) => i + 1), 144, 504, 1008];

    const feeEstimates: { [target: number]: number } = {};
    for (const target of T) {
      this.#assertConnect();
      //100000 = 10 ^ 8 sats/BTC / 10 ^3 bytes/kbyte
      const fee = await this.#client!.blockchainEstimatefee(target);
      feeEstimates[target] = 100000 * fee;
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

    const history = await this.#client!.blockchainScripthash_getHistory(
      scriptHash
    );

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
      const numConfirmations = this.#blockTipHeight - blockHeight + 1;
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
    return await this.#client!.blockchainTransaction_get(txId);
  }
}
