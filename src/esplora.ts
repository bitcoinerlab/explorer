import { checkFeeEstimates } from './checkFeeEstimates';

import { ESPLORA_BLOCKSTREAM_URL } from './constants';
import { reverseScriptHash } from './address';

import {
  Explorer,
  UtxoId,
  UtxoInfo,
  IRREV_CONF_THRESH,
  MAX_TX_PER_SCRIPTPUBKEY
} from './interface';
import { Transaction } from 'bitcoinjs-lib';

import { RequestQueue } from './requestQueue';
const requestQueue = new RequestQueue();

interface EsploraUtxoStatus {
  confirmed: boolean;
  block_height: number | null;
  block_hash: string | null;
  block_time: number | null;
}

interface EsploraUtxo {
  txid: string;
  vout: number;
  value: number;
  status: EsploraUtxoStatus;
  block_height: number | null;

  // Optional fields for Elements-based chains
  valuecommitment?: string;
  asset?: string;
  assetcommitment?: string;
  nonce?: string;
  noncecommitment?: string;
  surjection_proof?: string;
  range_proof?: string;
}

type EsploraUtxosResponse = EsploraUtxo[];

async function esploraFetch(
  ...args: Parameters<typeof fetch>
): Promise<Response> {
  const response = await requestQueue.fetch(...args);
  if (!response.ok) {
    const errorDetails = await response.text();
    throw new Error(
      `Network request failed! Status code: ${response.status} (${response.statusText}). URL: ${response.url}. Server response: ${errorDetails}`
    );
  }
  return response;
}

async function esploraFetchJson(
  ...args: Parameters<typeof fetch>
): Promise<unknown> {
  const response = await esploraFetch(...args);
  try {
    const json = await response.json();
    return json;
  } catch (error) {
    throw new Error('Failed to parse server response as JSON!');
  }
}

async function esploraFetchText(
  ...args: Parameters<typeof fetch>
): Promise<string> {
  const response = await esploraFetch(...args);
  return await response.text();
}

function isValidHttpUrl(string: string): boolean {
  let url;
  try {
    url = new URL(string);
  } catch (_) {
    return false;
  }
  return url.protocol === 'http:' || url.protocol === 'https:';
}

/**
 * Implements an {@link Explorer} Interface for an Esplora server.
 */
export class EsploraExplorer implements Explorer {
  #irrevConfThresh: number;
  #BLOCK_HEIGHT_CACHE_TIME: number = 60; //cache for 60 seconds at most
  #TXS_PER_PAGE: number = 25;
  #cachedBlockTipHeight: number = 0;
  #blockTipHeightCacheTime: number = 0;
  #url: string;
  #maxTxPerScriptPubKey: number;

  /**
   * @param {object} params
   * @param {string} params.url Esplora's API url. Defaults to blockstream.info if `service = ESPLORA`.
   */
  constructor({
    url = ESPLORA_BLOCKSTREAM_URL,
    irrevConfThresh = IRREV_CONF_THRESH,
    maxTxPerScriptPubKey = MAX_TX_PER_SCRIPTPUBKEY
  }: {
    url?: string;
    irrevConfThresh?: number;
    maxTxPerScriptPubKey?: number;
  } = {}) {
    if (typeof url !== 'string' || !isValidHttpUrl(url)) {
      throw new Error(
        'Specify a valid URL for Esplora and nothing else. Note that the url can include the port: http://api.example.com:8080/api'
      );
    }
    this.#url = url;
    this.#irrevConfThresh = irrevConfThresh;
    this.#maxTxPerScriptPubKey = maxTxPerScriptPubKey;
  }

  async connect() {
    return;
  }
  async close() {
    return;
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
    const confirmedUtxoInfoMap: { [utxoId: UtxoId]: UtxoInfo } = {};
    const unconfirmedUtxoInfoMap: { [utxoId: UtxoId]: UtxoInfo } = {};

    /** The API call below returns, per each utxo:
     * txid
     * vout
     * value
     * status
     *   confirmed (boolean)
     *   block_height (available for confirmed transactions, null otherwise)
     *   block_hash (available for confirmed transactions, null otherwise)
     *   block_time (available for confirmed transactions, null otherwise)
     */
    const fetchedUtxos = (await esploraFetchJson(
      `${this.#url}/${address ? 'address' : 'scripthash'}/${
        address || reverseScriptHash(scriptHash)
      }/utxo`
    )) as EsploraUtxosResponse;

    if (!Array.isArray(fetchedUtxos))
      throw new Error(
        'Invalid response from Esplora server while querying UTXOs.'
      );

    for (const utxo of fetchedUtxos) {
      const txHex = await esploraFetchText(`${this.#url}/tx/${utxo.txid}/hex`);

      const txId = Transaction.fromHex(txHex).getId();
      const vout = utxo.vout;
      const utxoId = txId + ':' + vout;
      const blockHeight = utxo.status.block_height || 0;

      if (utxo.status.confirmed === true) {
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

  async fetchAddressOrScriptHash({
    address,
    scriptHash
  }: {
    address?: string;
    scriptHash?: string;
  }): Promise<{
    balance: number;
    txCount: number;
    unconfirmedBalance: number;
    unconfirmedTxCount: number;
  }> {
    if (!address && !scriptHash) {
      throw new Error('Either address or scriptHash must be provided.');
    }

    const path = address
      ? `address/${address}`
      : `scripthash/${reverseScriptHash(scriptHash)}`;

    type StatType = {
      tx_count: number;
      funded_txo_sum: number;
      spent_txo_sum: number;
    };
    type Stats = { [chainType: string]: StatType };
    const stats: Stats = {};

    for (const chainType of ['chain_stats', 'mempool_stats']) {
      const fetchedData = (
        (await esploraFetchJson(`${this.#url}/${path}`)) as {
          [key: string]: StatType;
        }
      )[chainType];

      if (fetchedData) {
        stats[chainType] = fetchedData;
      } else {
        throw new Error(
          `Could not get stats for ${chainType} and ${address || scriptHash}`
        );
      }
    }
    if (!stats['chain_stats']) throw new Error('Chain stats are defined');
    if (!stats['mempool_stats']) throw new Error('Mempool stats not defined');

    return {
      balance:
        stats['chain_stats']['funded_txo_sum'] -
        stats['chain_stats']['spent_txo_sum'],
      txCount: stats['chain_stats']['tx_count'],
      unconfirmedBalance:
        stats['mempool_stats']['funded_txo_sum'] -
        stats['mempool_stats']['spent_txo_sum'],
      unconfirmedTxCount: stats['mempool_stats']['tx_count']
    };
  }

  /**
   * Implements {@link Explorer#fetchAddress}.
   */
  async fetchAddress(address: string): Promise<{
    balance: number;
    txCount: number;
    unconfirmedBalance: number;
    unconfirmedTxCount: number;
  }> {
    return this.fetchAddressOrScriptHash({ address });
  }

  /**
   * Implements {@link Explorer#fetchScriptHash}.
   */
  async fetchScriptHash(scriptHash: string): Promise<{
    balance: number;
    txCount: number;
    unconfirmedBalance: number;
    unconfirmedTxCount: number;
  }> {
    return this.fetchAddressOrScriptHash({ scriptHash });
  }

  /**
   * Implements {@link Explorer#fetchFeeEstimates}.
   */
  async fetchFeeEstimates(): Promise<Record<string, number>> {
    const feeEstimates = await esploraFetchJson(`${this.#url}/fee-estimates`);
    checkFeeEstimates(feeEstimates as Record<string, number>);
    return feeEstimates as Record<string, number>;
  }

  /**
   * Implements {@link Explorer#fetchBlockHeight}.
   * Get's current block height.
   * @async
   * @returns A number representing the current height.
   */
  async fetchBlockHeight(): Promise<number> {
    return parseInt(await esploraFetchText(`${this.#url}/blocks/tip/height`));
  }

  /** Returns the height of the last block.
   * It does not fetch it of it, unless either:
   *    fetched before more than #BLOCK_HEIGHT_CACHE_TIME ago
   *    the #cachedBlockTipHeight is behind the blockHeight passed as a param
   */

  async #getBlockHeight(blockHeight?: number): Promise<number> {
    const now: number = +new Date() / 1000;
    if (
      now - this.#blockTipHeightCacheTime > this.#BLOCK_HEIGHT_CACHE_TIME ||
      (blockHeight && blockHeight > this.#blockTipHeightCacheTime)
    ) {
      this.#cachedBlockTipHeight = await this.fetchBlockHeight();
      this.#blockTipHeightCacheTime = Math.floor(+new Date() / 1000);
    }
    return this.#cachedBlockTipHeight;
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
    // Validate the input: assert that either address or scriptHash is provided,
    // but not both.
    if (!((address && !scriptHash) || (!address && scriptHash)))
      throw new Error(
        `Please provide either an address or a script hash, but not both.`
      );

    const type = address ? 'address' : 'scripthash';
    const value = address || reverseScriptHash(scriptHash);

    const txHistory = [];

    type FetchedTxs = Array<{ txid: string; status: { block_height: number } }>;

    let fetchedTxs: FetchedTxs;
    let lastSeenTxid: string | undefined;

    let numQueries = 0;
    do {
      // First request to fetch transactions
      const url =
        numQueries === 0
          ? `${this.#url}/${type}/${value}/txs/mempool`
          : `${this.#url}/${type}/${value}/txs${
              lastSeenTxid ? `/chain/${lastSeenTxid}` : ''
            }`;
      fetchedTxs = (await esploraFetchJson(url)) as FetchedTxs;
      const lastSeenTx = fetchedTxs[fetchedTxs.length - 1];
      if (lastSeenTx) {
        if (numQueries !== 0) lastSeenTxid = lastSeenTx.txid;
        for (const fetchedTx of fetchedTxs) {
          const txId = fetchedTx.txid;
          const status = fetchedTx.status;
          const blockHeight = status.block_height || 0;
          const blockTipHeight = await this.#getBlockHeight(blockHeight);
          const numConfirmations =
            blockHeight === 0 ? 0 : blockTipHeight - blockHeight + 1;
          const irreversible =
            blockHeight !== 0 && numConfirmations >= this.#irrevConfThresh;

          txHistory.push({ txId, blockHeight, irreversible });
          if (txHistory.length > this.#maxTxPerScriptPubKey)
            throw new Error(`Too many transactions per address`);
        }
      }
      numQueries++;
    } while (
      numQueries === 1 ||
      fetchedTxs.filter(tx => tx.status.block_height).length ===
        this.#TXS_PER_PAGE
    );

    return txHistory.reverse();
  }

  /**
   * Fetches raw transaction data for a given transaction ID from an Esplora server.
   *
   * @param {string} txId - The transaction ID to fetch data for.
   *
   * @returns {Promise<string>} A promise that resolves to the raw transaction data as a string.
   */
  async fetchTx(txId: string): Promise<string> {
    return esploraFetchText(`${this.#url}/tx/${txId}/hex`);
  }
}
