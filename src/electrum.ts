import net from 'net';
import tls from 'tls';
import ElectrumClient from 'electrum-client';
import { checkFeeEstimates } from './checkFeeEstimates';
//API: https://electrumx.readthedocs.io/en/latest/protocol-methods.html

import { networks, Network } from 'bitcoinjs-lib';
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
import type { Explorer } from './interface';
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
  #client!: ElectrumClient | undefined;
  #height!: number;
  //#blockTime!: number;

  #host: string;
  #port: number;
  #protocol: string;
  #network: Network;

  constructor({
    host = ELECTRUM_BLOCKSTREAM_HOST,
    port = ELECTRUM_BLOCKSTREAM_PORT,
    protocol = ELECTRUM_BLOCKSTREAM_PROTOCOL,
    network = networks.bitcoin
  }: {
    host?: string;
    port?: number;
    protocol?: 'ssl' | 'tcp';
    network?: Network;
  } = {}) {
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

  #updateHeight(header: { height: number }) {
    if (
      header &&
      header.height &&
      (typeof this.#height === 'undefined' || header.height > this.#height)
    ) {
      this.#height = header.height;
      //this.#blockTime = Math.floor(+new Date() / 1000);
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
            this.#updateHeight(header);
          }
        }
      }
    );
    const header = await this.#client.blockchainHeaders_subscribe();
    this.#updateHeight(header);
  }

  /**
   * Implements {@link Explorer#close}.
   */
  async close(): Promise<void> {
    this.#assertConnect();
    await this.#client!.close();
    this.#client = undefined;
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
    this.#assertConnect();
    const utxos: { txHex: string; vout: number }[] = [];
    this.#assertConnect();
    if (!scriptHash && address)
      scriptHash = addressToScriptHash(address, this.#network);
    if (!scriptHash) throw new Error(`Please provide an address or scriptHash`);
    const unspents = await this.#client!.blockchainScripthash_listunspent(
      scriptHash
    );
    for (const unspent of unspents) {
      if (this.#height - unspent.height >= 5) {
        this.#assertConnect();
        const txHex = await this.#client!.blockchainTransaction_get(
          unspent.tx_hash
        );
        utxos.push({ txHex, vout: unspent.tx_pos });
      }
    }
    return utxos;
  }

  /**
   * Implements {@link Explorer#fetchAddress}.
   * */
  async fetchAddress(
    address: string
  ): Promise<{ balance: number; used: boolean }> {
    const scriptHash = addressToScriptHash(address, this.#network);
    return this.fetchScriptHash(scriptHash);
  }

  /**
   * Implements {@link Explorer#fetchScriptHash}.
   * */
  async fetchScriptHash(
    scriptHash: string
  ): Promise<{ balance: number; used: boolean }> {
    this.#assertConnect();
    let used = false;
    this.#assertConnect();
    const balance = await this.#client!.blockchainScripthash_getBalance(
      scriptHash
    );
    if (balance.confirmed === 0) {
      this.#assertConnect();
      const history = await this.#client!.blockchainScripthash_getHistory(
        scriptHash
      );
      if (history.length) {
        used = true;
      }
    } else {
      used = true;
    }
    return { balance: balance.confirmed, used };
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
}
