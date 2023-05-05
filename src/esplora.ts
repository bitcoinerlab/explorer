import { checkFeeEstimates } from './checkFeeEstimates';

import { ESPLORA_BLOCKSTREAM_URL } from './constants';

import type { Explorer } from './interface';

async function esploraFetchJson(
  ...args: Parameters<typeof fetch>
): Promise<unknown> {
  const response = await fetch(...args);
  if (response.status !== 200) {
    throw new Error('Service is down!');
  }
  try {
    const json = await response.json();
    return json;
  } catch (error) {
    throw new Error('Invalid json format!');
  }
}

async function esploraFetchText(
  ...args: Parameters<typeof fetch>
): Promise<string> {
  const response = await fetch(...args);
  if (response.status !== 200) {
    throw new Error('Service is down!');
  }
  try {
    const text = await response.text();
    return text;
  } catch (error) {
    throw new Error('Invalid text format!');
  }
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
