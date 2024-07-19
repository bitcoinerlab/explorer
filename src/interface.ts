/**
 * Interface describing a client that connects to a Blockchain explorer.
 * For example, a client to an Esplora Server or a client to an Electrum Server.
 *
 * Devs adding new Explorer clients to bitcoinerlab must implement this
 * interface.
 *
 * When referring to scriptHash, this is the scriptHash used for indexing in
 * electrum. Read more here:
 * https://github.com/bitcoinjs/bitcoinjs-lib/issues/990
 * and
 * https://electrumx.readthedocs.io/en/latest/protocol-basics.html#script-hashes
 */

//The irreversible number of confirmations threshold.
export const IRREV_CONF_THRESH = 3;
//max number of txs per address supported. With esplora this can be larger.
//Most Electrum servers will stop at around 1000 anyway.
export const MAX_TX_PER_SCRIPTPUBKEY = 1000;

export interface Explorer {
  /**
   * Connect to the server.
   * @async
   */
  connect(): Promise<void>;

  /**
   * Checks if the connection to the server is alive.
   *
   * For the Electrum client, this method directly checks the server's
   * availability by sending a ping.
   * It returns `true` if the ping is successful, otherwise `false`.
   *
   * For the Esplora client, this method checks the server's availability by
   * attempting to fetch the current block height.
   * Note that the Esplora client returns `true` even after closing the
   * connection, because an HTTP connection is stateless and not persistent.
   * Thus, for Esplora, `isConnected` effectively checks if the server can
   * respond to requests.
   *
   * @async
   * @returns {Promise<boolean>} Promise resolving to `true` if the server is
   * reachable and responding; otherwise, `false`.
   */
  isConnected(): Promise<boolean>;

  /**
   * Close the connection.
   * @async
   */
  close(): Promise<void>;

  /**
   * Get the balance of an address and find out whether the address ever
   * received some coins.
   * @async
   * @param address A Bitcoin address
   * @returns An object with 'balance' & confirmedTxCount properties.
   */
  fetchAddress(address: string): Promise<{
    balance: number;
    txCount: number;
    unconfirmedBalance: number;
    unconfirmedTxCount: number;
  }>;

  /**
   * Get the balance of a scriptHash and find out whether the scriptHash ever
   * received some coins.
   * @async
   * @param scriptHash A Bitcoin scriptHash
   * @returns An object with 'balance' & txCount properties.
   */
  fetchScriptHash(scriptHash: string): Promise<{
    balance: number;
    txCount: number;
    unconfirmedBalance: number;
    unconfirmedTxCount: number;
  }>;

  /**
   * Fetches the transaction history for a given address or script hash.
   *
   * @param {object} params - The parameters for the method.
   * @param {string} params.address - The address to fetch transaction history for.
   * @param {string} params.scriptHash - The script hash to fetch transaction history for.
   *
   * @throws {Error} If both address and scriptHash are provided or if neither are provided.
   *
   * @returns {Promise<Array<{ txId: string; blockHeight: number; irreversible: boolean }>>} A promise that resolves to an array containing
   * transaction history, each item is an object containing txId, blockHeight and irreversible.
   * `txId` is the transaction ID, `blockHeight` is the height of the block that includes the transaction,
   * and `irreversible` is a boolean indicating whether the transaction has reached the irreversible confirmation threshold (set to IRREV_CONF_THRESH confirmations).
   * They are returned in blockchain order. However, esplora might not respect
   * order when txs belong to the same block. See https://github.com/Blockstream/esplora/issues/165
   *
   */
  fetchTxHistory({
    address,
    scriptHash
  }: {
    address?: string;
    scriptHash?: string;
  }): Promise<
    Array<{ txId: string; blockHeight: number; irreversible: boolean }>
  >;

  fetchTx(txId: string): Promise<string>;

  /**
   * Get an object where the key is the confirmation target (in number of blocks)
   * and the value is the estimated feerate (in sat/vB).
   *
   * The available confirmation targets are `1-25, 144, 504` and `1008` blocks.
   * @async
   * @returns An object where the key is the confirmation target (in number of blocks).
   */
  fetchFeeEstimates(): Promise<Record<string, number>>;

  /**
   * Get's the `BlockStatus: { blockHeight: number; blockHash: string; blockTime: number; }`)
   * of a certain `blockHeight`.
   *
   * Returns `undefined` if this block height has not been mined yet.
   * @async
   * @returns `BlockStatus | undefined`;
   */
  fetchBlockStatus(blockHeight: number): Promise<BlockStatus | undefined>;

  /**
   * Get's current block height (blockchain tip).
   * @async
   * @returns A number representing the current height.
   */
  fetchBlockHeight(): Promise<number>;

  /**
   * Push a raw Bitcoin transaction to the network.
   * @async
   * @param txHex A raw Bitcoin transaction in hexadecimal string format.
   * @returns The transaction ID (`txId`) if the transaction was broadcasted successfully.
   * @throws {Error} If the transaction is invalid or fails to be broadcasted.
   */
  push(txHex: string): Promise<string>;
}

export type BlockStatus = {
  blockHeight: number;
  blockHash: string;
  blockTime: number;
  irreversible: boolean;
};
