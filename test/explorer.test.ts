// Integration tests for local Electrum and Esplora services.
//TODO: Test the case for invalid address /script hash
//TODO: Test the case for addresses with too many txs.
import { fixtures } from './fixtures/explorer';
import { waitFor } from './helpers/waitFor';
import {
  EsploraExplorer,
  ElectrumExplorer,
  ELECTRUM_LOCAL_REGTEST_HOST,
  ELECTRUM_LOCAL_REGTEST_PORT,
  ESPLORA_LOCAL_REGTEST_URL
} from '../dist';
import { Psbt, networks, Network, Block } from 'bitcoinjs-lib';
import type { BIP32Interface } from 'bip32';
import * as secp256k1 from '@bitcoinerlab/secp256k1';
import * as descriptors from '@bitcoinerlab/descriptors';
import { mnemonicToSeedSync } from 'bip39';
import { RegtestUtils } from 'regtest-client';

const { Output, BIP32 } = descriptors.DescriptorsFactory(secp256k1);
const API_URL = process.env['APIURL'] || 'http://127.0.0.1:8080/1';
const ESPLORA_URL = process.env['ESPLORA_URL'] || ESPLORA_LOCAL_REGTEST_URL;
const ELECTRUM_PORT =
  Number(process.env['ELECTRUM_PORT']) || ELECTRUM_LOCAL_REGTEST_PORT;
const regtestUtils = new RegtestUtils();

async function burnTx({
  expression,
  network,
  masterNode,
  burnAddress
}: {
  expression: string;
  network: Network;
  masterNode: BIP32Interface;
  burnAddress: string;
}) {
  const psbt = new Psbt({ network });
  const output = new Output({ descriptor: expression, network });
  // Include any fixture funds left by interrupted test runs.
  const response = await fetch(
    `${ESPLORA_URL}/address/${output.getAddress()}/utxo`,
    {
      signal: AbortSignal.timeout(5000)
    }
  );
  expect(response.ok).toBe(true);
  const unspents: Array<{ txid: string; vout: number; value: number }> =
    await response.json();
  if (unspents.length === 0) return null;
  const finalizeInputs = [];
  let value = 0n;
  for (const unspent of unspents) {
    const tx = await regtestUtils.fetch(unspent.txid);
    finalizeInputs.push(
      output.updatePsbtAsInput({
        psbt,
        vout: unspent.vout,
        txHex: tx.txHex
      })
    );
    value += BigInt(unspent.value);
  }
  psbt.addOutput({ address: burnAddress, value: value - 10000n });
  descriptors.signers.signBIP32({ psbt, masterNode });
  for (const finalizeInput of finalizeInputs) finalizeInput({ psbt });
  return psbt.extractTransaction();
}

const regtestExplorers = [
  {
    name: 'Electrum',
    explorer: new ElectrumExplorer({
      host: ELECTRUM_LOCAL_REGTEST_HOST,
      port: Number(ELECTRUM_PORT),
      protocol: 'tcp',
      network: networks.regtest
    })
  },
  {
    name: 'Esplora',
    explorer: new EsploraExplorer({ url: ESPLORA_URL })
  }
];

for (const { name, explorer } of regtestExplorers) {
  const network = networks.regtest;
  const masterNode = BIP32.fromSeed(
    mnemonicToSeedSync(fixtures.regtest.mnemonic),
    network
  );

  describe(`Explorer: Tests on regtest with ${name}`, () => {
    afterAll(() => {
      if (!explorer.isClosed()) explorer.close();
    });

    async function mineAndWait() {
      const [blockHash] = await regtestUtils.mine(1);
      const height = await regtestUtils.height();
      await waitFor(`${name} to index block ${blockHash}`, async () => {
        expect(await explorer.fetchBlockHeight()).toBe(height);
        expect((await explorer.fetchBlockStatus(height))?.blockHash).toBe(
          blockHash
        );
        const response = await fetch(`${ESPLORA_URL}/blocks/tip/height`, {
          signal: AbortSignal.timeout(5000)
        });
        expect(response.ok).toBe(true);
        expect(Number(await response.text())).toBe(height);
      });
    }

    test('Connect', async () => {
      await expect(explorer.connect()).resolves.not.toThrow();
    }, 20000);

    test('isConnected', async () => {
      await expect(explorer.isConnected()).resolves.toBe(true);
    });

    test('fetchAddress', async () => {
      expect(
        await explorer.fetchAddress(fixtures.regtest.unusedAddress)
      ).toEqual({
        balance: 0,
        txCount: 0,
        unconfirmedBalance: 0,
        unconfirmedTxCount: 0
      });
      // Confirm any pending fixture transactions before recovering old funds.
      await mineAndWait();
      for (const descriptor of fixtures.regtest.descriptors) {
        const burningTx = await burnTx({
          expression: descriptor.expression,
          network,
          masterNode,
          burnAddress: fixtures.regtest.burnAddress
        });
        if (burningTx) {
          expect(await explorer.push(burningTx.toHex())).toBe(
            burningTx.getId()
          );
        }
        const address = new Output({
          descriptor: descriptor.expression,
          network
        }).getAddress();
        await regtestUtils.faucet(address, descriptor.value);
      }
      await mineAndWait();
      for (const descriptor of fixtures.regtest.descriptors) {
        const address = new Output({
          descriptor: descriptor.expression,
          network
        }).getAddress();
        await waitFor(`${name} to index funding for ${address}`, async () => {
          const { balance, txCount } = await explorer.fetchAddress(address);
          expect(balance).toBe(descriptor.value);
          expect(txCount).toBeGreaterThan(0);
        });
      }
      for (const descriptor of fixtures.regtest.descriptors) {
        const burningTx = await burnTx({
          expression: descriptor.expression,
          network,
          masterNode,
          burnAddress: fixtures.regtest.burnAddress
        });
        expect(burningTx).not.toBeNull();
        expect(await explorer.push(burningTx!.toHex())).toBe(
          burningTx!.getId()
        );
      }
      await mineAndWait();
      for (const descriptor of fixtures.regtest.descriptors) {
        const address = new Output({
          descriptor: descriptor.expression,
          network
        }).getAddress();
        await waitFor(`${name} to index spending for ${address}`, async () => {
          const { balance, txCount, unconfirmedBalance } =
            await explorer.fetchAddress(address);
          expect(balance).toBe(0);
          expect(unconfirmedBalance).toBe(0);
          expect(txCount).toBeGreaterThan(0);
        });
      }
    }, 120000);

    test('fetchBlockStatus', async () => {
      const tipHeight = await regtestUtils.height();
      await waitFor(`${name} to reach height ${tipHeight}`, async () => {
        expect(await explorer.fetchBlockHeight()).toBe(tipHeight);
      });
      const blockStatus = await explorer.fetchBlockStatus(tipHeight);
      expect(blockStatus?.irreversible).toBe(false);
      const headerHex = (await regtestUtils.dhttp({
        method: 'GET',
        url: `${API_URL}/b/${blockStatus?.blockHash}/header`
      })) as string;
      const header = Block.fromHex(headerHex);
      expect(blockStatus?.blockTime).toBe(header.timestamp);
      expect(blockStatus?.blockHash).toBe(header.getId());
      expect(blockStatus?.blockHeight).toBe(tipHeight);
    }, 35000);

    test('Push errors', async () => {
      await expect(
        explorer.push(
          '02000000000101a181e1db4f39ca9b14d764373d919bb01bdaa771a39d61bfc45e4c73b33b6bee00000000171600146a166349647f19f776f9f8c4dc8604b36b854ae4ffffffff02a08601000000000017a914a44bb6bc3228487f4a120fd187b13c23a4886cfc878a0035000000000017a91490bb10362943c1dc6bc97bae807525e934fa9a898702483045022100e4b56cf9ea496604d4ecb9898b7b221a3237e6c9eb12bc1473cf6946ac9244390220215e54c0e3d1131088a56caeac2b21099f33317b865affaef22ee6f3b7ea37980121031dd46bf77dd63d55bab8209dd606b16167d8c75a663475cc5abf85deb64a565600000000'
        )
      ).rejects.toThrow(/bad-txns-inputs-missingorspent/);
    });

    test('close', () => {
      explorer.close();
      expect(explorer.isClosed()).toBe(true);
    });
  });
}
