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
export interface Explorer {
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
   * @returns An array of utxos objects like this: `[{ txHex, vout },...]`,
   * where `txHex` is a string in hex format and `vout` is an integer >= 0.
   */
  fetchUtxos({
    address,
    scriptHash
  }: {
    address?: string;
    scriptHash?: string;
  }): Promise<Array<{ txHex: string; vout: number }>>;

  /**
   * Get the balance of an address and find out whether the address ever
   * received some coins.
   * @async
   * @param address A Bitcoin address
   * @returns An object with 'used' and 'balance' properties.
   */
  fetchAddress(address: string): Promise<{ used: boolean; balance: number }>;

  /**
   * Get the balance of a scriptHash and find out whether the scriptHash ever
   * received some coins.
   * @async
   * @param scriptHash A Bitcoin scriptHash
   * @returns An object with 'used' and 'balance' properties.
   */
  fetchScriptHash(
    scriptHash: string
  ): Promise<{ used: boolean; balance: number }>;

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
