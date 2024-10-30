import { checkFeeEstimates } from './checkFeeEstimates';

import { ESPLORA_BLOCKSTREAM_URL } from './constants';
import { reverseScriptHash } from './address';

import {
  BlockStatus,
  Explorer,
  IRREV_CONF_THRESH,
  MAX_TX_PER_SCRIPTPUBKEY
} from './interface';

import { RequestQueue, RequestQueueParams } from './requestQueue';

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
  #BLOCK_HEIGHT_CACHE_TIME: number = 3; //cache for 3 seconds at most
  #cachedTipBlockHeight: number = 0;
  #tipBlockHeightCacheTime: number = 0;
  #url: string;
  #maxTxPerScriptPubKey: number;
  #blockStatusMap: Map<number, BlockStatus> = new Map();
  #requestQueue: RequestQueue;

  /**
   * @param {object} params
   * @param {string} params.url Esplora's API url. Defaults to blockstream.info if `service = ESPLORA`.
   */
  constructor({
    url = ESPLORA_BLOCKSTREAM_URL,
    //url = ESPLORA_MEMPOOLSPACE_URL,
    irrevConfThresh = IRREV_CONF_THRESH,
    maxTxPerScriptPubKey = MAX_TX_PER_SCRIPTPUBKEY,
    requestQueueParams = undefined
  }: {
    url?: string;
    irrevConfThresh?: number;
    maxTxPerScriptPubKey?: number;
    requestQueueParams?: RequestQueueParams;
  } = {}) {
    this.#requestQueue = new RequestQueue(requestQueueParams);
    if (typeof url !== 'string' || !isValidHttpUrl(url)) {
      throw new Error(
        'Specify a valid URL for Esplora and nothing else. Note that the url can include the port: http://api.example.com:8080/api'
      );
    }
    this.#url = url;
    this.#irrevConfThresh = irrevConfThresh;
    this.#maxTxPerScriptPubKey = maxTxPerScriptPubKey;
  }

  async #esploraFetch(...args: Parameters<typeof fetch>): Promise<Response> {
    const response = await this.#requestQueue.fetch(...args);
    if (!response.ok) {
      const errorDetails = await response.text();
      throw new Error(
        `Failed request: ${errorDetails}. Status code: ${response.status} (${response.statusText}). URL: ${response.url}.`
      );
    }
    return response;
  }

  async #esploraFetchJson(...args: Parameters<typeof fetch>): Promise<unknown> {
    const response = await this.#esploraFetch(...args);
    const responseText = await response.text();
    try {
      const json = JSON.parse(responseText);
      return json;
    } catch (error) {
      console.warn(error);
      throw new Error(
        `Failed to parse server response as JSON fetching ${response.url}: ${responseText}`
      );
    }
  }

  async #esploraFetchText(...args: Parameters<typeof fetch>): Promise<string> {
    const response = await this.#esploraFetch(...args);
    return await response.text();
  }

  async connect() {
    return;
  }
  /**
   * Implements {@link Explorer#isConnected}.
   * Checks server connectivity by attempting to fetch the current block height.
   * Returns `true` if successful, otherwise `false`.
   */
  async isConnected(
    requestNetworkConfirmation: boolean = true
  ): Promise<boolean> {
    if (requestNetworkConfirmation) {
      try {
        await this.fetchBlockHeight();
        return true;
      } catch {}
      return false;
    } else return true;
  }
  async close() {
    return;
  }

  /**
   * Implements {@link Explorer#fetchBlockStatus}.
   */
  async fetchBlockStatus(
    blockHeight: number
  ): Promise<BlockStatus | undefined> {
    let blockStatus = this.#blockStatusMap.get(blockHeight);
    if (blockStatus && blockStatus.irreversible) return blockStatus;
    if (blockHeight > (await this.#getTipBlockHeight())) return;

    const blockHash = await this.#esploraFetchText(
      `${this.#url}/block-height/${blockHeight}`
    );
    const fetchedBlock = (await this.#esploraFetchJson(
      `${this.#url}/block/${blockHash}`
    )) as { timestamp: number };
    const tipBlockHeight = await this.#getTipBlockHeight(blockHeight);
    const numConfirmations = tipBlockHeight - blockHeight + 1;
    const irreversible = numConfirmations >= this.#irrevConfThresh;
    blockStatus = {
      blockHeight,
      blockHash,
      blockTime: fetchedBlock.timestamp,
      irreversible
    };
    //cache this info to skip queries in fetchBlockStatus
    this.#blockStatusMap.set(blockHeight, blockStatus);

    return blockStatus;
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
        (await this.#esploraFetchJson(`${this.#url}/${path}`)) as {
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
    const feeEstimates = await this.#esploraFetchJson(
      `${this.#url}/fee-estimates`
    );
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
    const tipBlockHeight = parseInt(
      await this.#esploraFetchText(`${this.#url}/blocks/tip/height`)
    );
    this.#cachedTipBlockHeight = tipBlockHeight;
    this.#tipBlockHeightCacheTime = Math.floor(+new Date() / 1000);
    return tipBlockHeight;
  }

  /** Returns the height of the last block.
   * It does not fetch it, unless either:
   *    fetched before more than #BLOCK_HEIGHT_CACHE_TIME ago
   *    the #cachedTipBlockHeight is behind the blockHeight passed as a param
   */

  async #getTipBlockHeight(blockHeight?: number): Promise<number> {
    const now: number = +new Date() / 1000;
    if (
      now - this.#tipBlockHeightCacheTime > this.#BLOCK_HEIGHT_CACHE_TIME ||
      (blockHeight && blockHeight > this.#cachedTipBlockHeight)
    )
      await this.fetchBlockHeight();
    return this.#cachedTipBlockHeight;
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

    type FetchedTxs = Array<{
      txid: string;
      status: {
        block_height: number | null;
        block_hash: string | null;
        block_time: number | null;
      };
    }>;

    let fetchedTxs: FetchedTxs;
    let lastTxid: string | undefined;

    do {
      // First request to fetch transactions
      const url = `${this.#url}/${type}/${value}/txs${
        lastTxid ? `/chain/${lastTxid}` : ''
      }`;
      fetchedTxs = (await this.#esploraFetchJson(url)) as FetchedTxs;
      const lastTx = fetchedTxs[fetchedTxs.length - 1];
      lastTxid = undefined;
      if (lastTx) {
        if (lastTx.status.block_height !== 0) lastTxid = lastTx.txid;
        for (const fetchedTx of fetchedTxs) {
          let irreversible = false;
          let blockHeight = 0;
          const txId = fetchedTx.txid;
          const status = fetchedTx.status;
          if (status.block_hash && status.block_time && status.block_height) {
            const tipBlockHeight = await this.#getTipBlockHeight(blockHeight);
            blockHeight = status.block_height;
            const numConfirmations = tipBlockHeight - blockHeight + 1;
            irreversible = numConfirmations >= this.#irrevConfThresh;
            //cache this info to skip queries in fetchBlockStatus
            this.#blockStatusMap.set(status.block_height, {
              blockHeight,
              blockTime: status.block_time,
              blockHash: status.block_hash,
              irreversible
            });
          }
          txHistory.push({ txId, blockHeight, irreversible });
          if (txHistory.length > this.#maxTxPerScriptPubKey)
            throw new Error(`Too many transactions per address`);
        }
      }
    } while (lastTxid);

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
    return this.#esploraFetchText(`${this.#url}/tx/${txId}/hex`);
  }

  /**
   * Push a raw Bitcoin transaction to the network.
   * @async
   * @param txHex A raw Bitcoin transaction in hexadecimal string format.
   * @returns The transaction ID (`txId`) if the transaction was broadcasted successfully.
   * @throws {Error} If the transaction is invalid or fails to be broadcasted.
   */
  async push(txHex: string): Promise<string> {
    const response = await this.#esploraFetch(`${this.#url}/tx`, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain'
      },
      body: txHex
    });

    // Check if the response is successful
    const result = await response.text();
    if (!/^[a-fA-F0-9]{64}$/.test(result)) {
      throw new Error(`Failed to broadcast transaction: ${result}`);
    }

    return result;
  }
}
