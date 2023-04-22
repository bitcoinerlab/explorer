//TODO: checkFeeEstimates
/**
 * Interface describing a client that connects to a Blockchain explorer.
 * For example, a client to an Esplora Server or a client to an Electrum Server.
 *
 * Devs adding new Explorer clients to bitcoinerlab must implement this
 * interface.
 */
export interface IExplorer {
  /**
   * Connect to the server.
   * @async
   */
  connect(): Promise<void>;

  /**
   * Close the connection.
   * @async
   */
  close(): Promise<void>;

  /**
   * Get the utxos of an address.
   * @async
   * @param address A Bitcoin address
   * @returns An array of utxos objects like this: `[{ tx, n },...]`,
   * where `tx` is a string in hex format and `n` is an integer >= 0.
   */
  fetchUtxos(address: string): Promise<Array<{ tx: string; n: number }>>;

  /**
   * Get the balance of an address and find out whether the address ever
   * received some coins.
   * @async
   * @param address A Bitcoin address
   * @returns An object with 'used' and 'balance' properties.
   */
  fetchAddress(address: string): Promise<{ used: boolean; balance: number }>;

  /**
   * Get an object where the key is the confirmation target (in number of blocks)
   * and the value is the estimated feerate (in sat/vB).
   *
   * The available confirmation targets are `1-25, 144, 504` and `1008` blocks.
   * @async
   * @returns An object where the key is the confirmation target (in number of blocks).
   */
  fetchFeeEstimates(): Promise<Record<string, number>>;
}
