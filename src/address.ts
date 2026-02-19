//https://github.com/bitcoinjs/bitcoinjs-lib/issues/990
//https://electrumx.readthedocs.io/en/latest/protocol-basics.html#script-hashes
import { address as bjsAddress, crypto, Network } from 'bitcoinjs-lib';
import { fromHex, toHex } from 'uint8array-tools';

export function addressToScriptHash(address: string, network: Network): string {
  try {
    const scriptPubKey = bjsAddress.toOutputScript(address, network);
    const scriptHash = toHex(
      Uint8Array.from(crypto.sha256(scriptPubKey)).reverse()
    );
    return scriptHash;
  } catch (error) {
    throw new Error(
      `Error converting address to script hash: ${
        error instanceof Error ? error.message : 'unknown error'
      }`
    );
  }
}

//Esplora's http scriptHash is different than Electrum's. Electrum's is reversed
//https://electrumx.readthedocs.io/en/latest/protocol-basics.html#script-hashes
//https://github.com/Blockstream/esplora/issues/460
export function reverseScriptHash(
  scriptHash: string | undefined
): string | undefined {
  if (!scriptHash) return;
  return toHex(fromHex(scriptHash).reverse());
}
