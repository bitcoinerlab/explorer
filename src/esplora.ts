import { checkFeeEstimates } from './checkFeeEstimates';

import { ESPLORA_BLOCKSTREAM_URL } from './constants';

import type { Explorer } from './interface';

//https://github.com/Blockstream/esplora/issues/449#issuecomment-1546000515
class RequestQueue {
  private queue: (() => void)[] = [];
  private delayBetweenRequests: number;
  private lastRequestTime: number = 0;

  constructor(delayBetweenRequests: number) {
    this.delayBetweenRequests = delayBetweenRequests;
  }

  async fetch(...args: Parameters<typeof fetch>): Promise<Response> {
    return new Promise((resolve, reject) => {
      const fetchTask = async () => {
        const now = Date.now();
        const timeSinceLastRequest = now - this.lastRequestTime;
        if (timeSinceLastRequest < this.delayBetweenRequests) {
          // If the delay has not passed yet, wait for the remaining time
          await new Promise(resolve =>
            setTimeout(
              resolve,
              this.delayBetweenRequests - timeSinceLastRequest
            )
          );
        }
        try {
          const response = await fetch(...args);
          this.lastRequestTime = Date.now();
          resolve(response);
        } catch (error) {
          reject(error);
        }
      };
      this.queue.push(fetchTask);
      this.processQueue();
    });
  }

  private processQueue() {
    if (this.queue.length > 0) {
      const fetchTask = this.queue.shift();
      if (fetchTask) fetchTask();
    }
  }
}
//250 milliseconds between consecutive calls.
//Blockstream ends up cutting the replies at 200ms consecutive calls
const requestQueue = new RequestQueue(210);

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
  #url: string;

  /**
   * @param {object} params
   * @param {string} params.url Esplora's API url. Defaults to blockstream.info if `service = ESPLORA`.
   */
  constructor({ url }: { url?: string } = { url: ESPLORA_BLOCKSTREAM_URL }) {
    if (typeof url !== 'string' || !isValidHttpUrl(url)) {
      throw new Error(
        'Specify a valid URL for Esplora and nothing else. Note that the url can include the port: http://api.example.com:8080/api'
      );
    }
    this.#url = url;
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
  async fetchUtxos(
    address: string
  ): Promise<Array<{ txHex: string; vout: number }>> {
    const utxos = [];

    const fetchedUtxos = await esploraFetchJson(
      `${this.#url}/address/${address}/utxo`
    );

    if (!Array.isArray(fetchedUtxos))
      throw new Error(
        'Invalid response from Esplora server while querying UTXOs.'
      );

    for (const utxo of fetchedUtxos) {
      if (utxo.status.confirmed === true) {
        const tx = await esploraFetchText(`${this.#url}/tx/${utxo.txid}/hex`);
        utxos.push({ txHex: tx, vout: parseInt(utxo.vout) });
      }
    }
    return utxos;
  }

  /**
   * Implements {@link Explorer#fetchAddress}.
   */
  async fetchAddress(
    address: string
  ): Promise<{ used: boolean; balance: number }> {
    const chain_stats = (
      (await esploraFetchJson(`${this.#url}/address/${address}`)) as {
        chain_stats: {
          tx_count: number;
          funded_txo_sum: number;
          spent_txo_sum: number;
        };
      }
    )['chain_stats'];
    return {
      used: chain_stats['tx_count'] !== 0,
      balance: chain_stats['funded_txo_sum'] - chain_stats['spent_txo_sum']
    };
  }

  /**
   * Implements {@link Explorer#fetchFeeEstimates}.
   */
  async fetchFeeEstimates(): Promise<Record<string, number>> {
    const feeEstimates = await esploraFetchJson(`${this.#url}/fee-estimates`);
    checkFeeEstimates(feeEstimates as Record<string, number>);
    return feeEstimates as Record<string, number>;
  }
}
