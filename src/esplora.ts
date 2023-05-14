import { checkFeeEstimates } from './checkFeeEstimates';

import { ESPLORA_BLOCKSTREAM_URL } from './constants';

import type { Explorer } from './interface';

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
  async fetchUtxos({
    address,
    scriptHash
  }: {
    address?: string;
    scriptHash?: string;
  }): Promise<{ txHex: string; vout: number }[]> {
    const utxos = [];

    const fetchedUtxos = (await esploraFetchJson(
      `${this.#url}/${address ? 'address' : 'scripthash'}/${
        address || scriptHash
      }/utxo`
    )) as EsploraUtxosResponse;

    if (!Array.isArray(fetchedUtxos))
      throw new Error(
        'Invalid response from Esplora server while querying UTXOs.'
      );

    for (const utxo of fetchedUtxos) {
      if (utxo.status.confirmed === true) {
        const tx = await esploraFetchText(`${this.#url}/tx/${utxo.txid}/hex`);
        utxos.push({ txHex: tx, vout: utxo.vout });
      }
    }
    return utxos;
  }

  async fetchAddressOrScriptHash({
    address,
    scriptHash
  }: {
    address?: string;
    scriptHash?: string;
  }): Promise<{ used: boolean; balance: number }> {
    if (!address && !scriptHash) {
      throw new Error('Either address or scriptHash must be provided.');
    }

    const path = address ? `address/${address}` : `scripthash/${scriptHash}`;
    const chain_stats = (
      (await esploraFetchJson(`${this.#url}/${path}`)) as {
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
   * Implements {@link Explorer#fetchAddress}.
   */
  async fetchAddress(
    address: string
  ): Promise<{ used: boolean; balance: number }> {
    return this.fetchAddressOrScriptHash({ address });
  }

  /**
   * Implements {@link Explorer#fetchScriptHash}.
   */
  async fetchScriptHash(
    scriptHash: string
  ): Promise<{ used: boolean; balance: number }> {
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
}
