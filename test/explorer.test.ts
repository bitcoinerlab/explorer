import { fixtures, ELECTRUM, ESPLORA } from './fixtures/explorer';

import {
  Explorer,
  EsploraExplorer,
  ElectrumExplorer,
  ELECTRUM_LOCAL_REGTEST_HOST,
  ELECTRUM_LOCAL_REGTEST_PORT,
  ELECTRUM_LOCAL_REGTEST_PROTOCOL,
  ESPLORA_LOCAL_REGTEST_URL
} from '../dist';
import { Transaction, Psbt, networks, Network } from 'bitcoinjs-lib';
import type { BIP32Interface } from 'bip32';
import * as secp256k1 from '@bitcoinerlab/secp256k1';
import * as descriptors from '@bitcoinerlab/descriptors';
import { mnemonicToSeedSync } from 'bip39';
const { Descriptor, BIP32 } = descriptors.DescriptorsFactory(secp256k1);
import { RegtestUtils } from 'regtest-client';
const regtestUtils = new RegtestUtils();

interface Server {
  service: 'ELECTRUM' | 'ESPLORA';
  host?: string;
  url?: string;
}

function utxoArrayToSet(
  utxos: Array<{ txId: string; value: number; vout: number }>
): Set<string> {
  return new Set(
    utxos.map(({ txId, value, vout }) => `${txId}-${value}-${vout}`)
  );
}

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
  const descs = [];
  const descriptor = new Descriptor({ expression, network });
  const address = descriptor.getAddress();
  const unspents = await regtestUtils.unspents(address);
  let value = 0;
  if (unspents.length === 0) return null;
  for (const unspent of unspents) {
    const tx = await regtestUtils.fetch(unspent.txId);
    descriptor.updatePsbt({ psbt, vout: unspent.vout, txHex: tx.txHex });
    descs.push(descriptor);
    value += unspent.value;
  }
  value -= 10000; //fee
  psbt.addOutput({ address: burnAddress, value });
  descriptors.signers.signBIP32({ psbt, masterNode });
  descriptors.finalizePsbt({ psbt, descriptors: descs });
  return psbt.extractTransaction();
}

const regtestExplorers = [
  {
    name: 'Electrum',
    explorer: new ElectrumExplorer({
      host: ELECTRUM_LOCAL_REGTEST_HOST,
      port: ELECTRUM_LOCAL_REGTEST_PORT,
      protocol: ELECTRUM_LOCAL_REGTEST_PROTOCOL,
      network: networks.regtest
    })
  },
  {
    name: 'Esplora',
    explorer: new EsploraExplorer({ url: ESPLORA_LOCAL_REGTEST_URL })
  }
];

for (const regtestExplorer of regtestExplorers) {
  const network = networks.regtest;
  const masterNode = BIP32.fromSeed(
    mnemonicToSeedSync(fixtures.regtest.mnemonic),
    network
  );

  describe(`Explorer: Tests on regtest with ${regtestExplorer.name}`, () => {
    const explorer = regtestExplorer.explorer;
    test(`Connect`, async () => {
      await expect(explorer.connect()).resolves.not.toThrow();
    });

    test('fetchAddress & fetchUtxos', async () => {
      expect({ balance: 0, used: false }).toEqual(
        await explorer.fetchAddress(fixtures.regtest.unusedAddress)
      );
      expect(
        (await explorer.fetchUtxos(fixtures.regtest.unusedAddress)).length
      ).toEqual(0);
      //Do the funding:
      for (const descriptor of fixtures.regtest.descriptors) {
        //First let's burn any possible remaining money out there (from
        //uncomplete previous tests)
        const burningTx = await burnTx({
          expression: descriptor.expression,
          network,
          masterNode,
          burnAddress: fixtures.regtest.burnAddress
        });
        if (burningTx) await regtestUtils.broadcast(burningTx.toHex());

        const address = new Descriptor({
          expression: descriptor.expression,
          network
        }).getAddress();
        await regtestUtils.faucet(address, descriptor.value);
      }
      //confirm the transactions above
      await regtestUtils.mine(6);
      await new Promise(resolve => setTimeout(resolve, 5000)); //sleep 5 sec
      //Do the tests:
      for (const descriptor of fixtures.regtest.descriptors) {
        const address = new Descriptor({
          expression: descriptor.expression,
          network
        }).getAddress();
        const { balance, used } = await explorer.fetchAddress(address);
        expect(balance).toBeGreaterThanOrEqual(descriptor.value);
        expect(used).toEqual(true);
        const expectedUtxos = await regtestUtils.unspents(address);

        const utxos = (await explorer.fetchUtxos(address)).map(utxo => {
          const tx = Transaction.fromHex(utxo.txHex);
          return {
            vout: utxo.vout,
            txId: tx.getId(),
            value: tx.outs[utxo.vout]!.value
          };
        });
        expect(utxoArrayToSet(utxos)).toEqual(utxoArrayToSet(expectedUtxos));
      }
      //Now burn all the money
      for (const descriptor of fixtures.regtest.descriptors) {
        //First let's burn any possible remaining money out there (from
        //uncomplete previous tests)
        const burningTx = await burnTx({
          expression: descriptor.expression,
          network,
          masterNode,
          burnAddress: fixtures.regtest.burnAddress
        });
        if (burningTx) await regtestUtils.broadcast(burningTx.toHex());
      }
      //confirm the transactions above
      await regtestUtils.mine(6);
      await new Promise(resolve => setTimeout(resolve, 5000)); //sleep 5 sec
      //Check that now there are no funds:
      for (const descriptor of fixtures.regtest.descriptors) {
        const address = new Descriptor({
          expression: descriptor.expression,
          network
        }).getAddress();
        const { balance, used } = await explorer.fetchAddress(address);
        expect(balance).toEqual(0);
        expect(used).toEqual(true);
      }
    }, 20000);
    test('close', async () => {
      await explorer.close();
    });
  });
}

describe('Explorer: Tests with public servers', () => {
  const explorers: Explorer[] = [];
  for (const server of fixtures.bitcoin.servers as Server[]) {
    test(`Create and connect to ${server.service} on ${
      server.service === ELECTRUM ? server.host : server.url
    }`, async () => {
      let explorer: Explorer;
      if (server.service === ELECTRUM) {
        try {
          explorer = new ElectrumExplorer(server);
        } catch (error) {
          fail('ElectrumExplorer constructor should not throw an error');
        }
      } else if (server.service === ESPLORA) {
        try {
          explorer = new EsploraExplorer(server);
        } catch (error) {
          fail('EsploraExplorer constructor should not throw an error');
        }
      } else throw new Error('Please, pass a correct service');
      await expect(explorer.connect()).resolves.not.toThrow();
      explorers.push(explorer);
    }, 10000);
  }
  test('fetchFeeEstimates', async () => {
    for (const explorer of explorers) {
      const feeEstimates = await explorer.fetchFeeEstimates();
      const T = [
        ...Array.from({ length: 25 }, (_, i) => i + 1),
        144,
        504,
        1008
      ];
      expect(Object.keys(feeEstimates).map(n => Number(n))).toEqual(
        expect.arrayContaining(T)
      );
      expect(Object.keys(feeEstimates).length).toEqual(T.length);
      let prevIndex: string | undefined;
      for (const index of Object.keys(feeEstimates)) {
        if (prevIndex)
          expect(feeEstimates[prevIndex]).toBeGreaterThanOrEqual(
            feeEstimates[index]!
          );
        prevIndex = index;
      }
    }
  }, 30000);
  test('close', async () => {
    for (const explorer of explorers) {
      await explorer.close();
    }
    await new Promise(r => setTimeout(r, 9000)); //give some time so that keepalive timeouts are closed after explorer.close
  }, 10000);
});
