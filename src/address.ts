//https://github.com/bitcoinjs/bitcoinjs-lib/issues/990
//https://electrumx.readthedocs.io/en/latest/protocol-basics.html#script-hashes
import { address as bjsAddress, crypto, Network } from 'bitcoinjs-lib';
export function addressToScriptHash(address: string, network: Network): string {
  try {
    const scriptPubKey = bjsAddress.toOutputScript(address, network);
    const scriptHash = Buffer.from(crypto.sha256(scriptPubKey))
      .reverse()
      .toString('hex');
    return scriptHash;
  } catch (error) {
    throw new Error(
      `Error converting address to script hash: ${
        error instanceof Error ? error.message : 'unknown error'
      }`
    );
  }
}
