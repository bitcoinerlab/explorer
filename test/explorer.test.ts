//Note on these tests: These are not unit tests but integration tests.
//They will call real servers to make sure the APIs did not change.
//TODO: Test the case for invalid address /script hash
//TODO: Test the case for addresses with too many txs.
//TODO: Test that results between electrum and esplora are consistent on abandon
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
import { Psbt, networks, Network, Block } from 'bitcoinjs-lib';
import type { BIP32Interface } from 'bip32';
import * as secp256k1 from '@bitcoinerlab/secp256k1';
import * as descriptors from '@bitcoinerlab/descriptors';
import { mnemonicToSeedSync } from 'bip39';
const { Output, BIP32 } = descriptors.DescriptorsFactory(secp256k1);
import { RegtestUtils } from 'regtest-client';
const API_URL = 'http://127.0.0.1:8080/1';
const regtestUtils = new RegtestUtils();

interface Server {
  service: 'ELECTRUM' | 'ESPLORA';
  host?: string;
  url?: string;
}

//DEPRECATED
//function utxoArrayToSet(
//  utxos: Array<{ txId: string; value: number; vout: number }>
//): Set<string> {
//  return new Set(
//    utxos.map(({ txId, value, vout }) => `${txId}-${value}-${vout}`)
//  );
//}

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
  const finalizeInputs: Array<
    (params: { psbt: Psbt; validate?: boolean | undefined }) => void
  > = [];
  const output = new Output({ descriptor: expression, network });
  const address = output.getAddress();

  //const unspents = await regtestUtils.unspents(address); broken. See: https://github.com/bitcoinjs/regtest-server/issues/23

  const response = await fetch(
    `${ESPLORA_LOCAL_REGTEST_URL}/address/${address}/utxo`
  );
  const unspents = await response.json();

  let value = 0n;
  if (unspents.length === 0) return null;
  for (const unspent of unspents) {
    const tx = await regtestUtils.fetch(unspent.txid);
    const finalizeInput = output.updatePsbtAsInput({
      psbt,
      vout: unspent.vout,
      txHex: tx.txHex
    });
    finalizeInputs.push(finalizeInput);
    value += BigInt(unspent.value);
  }
  value -= 10000n; //fee
  psbt.addOutput({ address: burnAddress, value });
  descriptors.signers.signBIP32({ psbt, masterNode });
  for (const finalizeInput of finalizeInputs) {
    finalizeInput({ psbt });
  }
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
    }, 20000);
    test(`isConnected`, async () => {
      await expect(explorer.isConnected()).resolves.toBe(true);
    });

    test('fetchAddress', async () => {
      expect({
        balance: 0,
        txCount: 0,
        unconfirmedBalance: 0,
        unconfirmedTxCount: 0
      }).toEqual(await explorer.fetchAddress(fixtures.regtest.unusedAddress));
      // DEPRECATED
      // const utxosResult = await explorer.fetchUtxos({
      //   address: fixtures.regtest.unusedAddress
      // });
      // expect(utxosResult.confirmed).toBeUndefined();
      // expect(utxosResult.unconfirmed).toBeUndefined();
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
        if (burningTx) {
          //await regtestUtils.broadcast(burningTx.toHex());
          await explorer.push(burningTx.toHex());
        }

        const address = new Output({
          descriptor: descriptor.expression,
          network
        }).getAddress();
        await regtestUtils.faucet(address, descriptor.value);
      }
      //confirm the transactions above
      await regtestUtils.mine(1);
      await new Promise(resolve => setTimeout(resolve, 5000)); //sleep 5 sec - esplora can be really slow to catch up at times...
      //Do the tests:
      for (const descriptor of fixtures.regtest.descriptors) {
        const address = new Output({
          descriptor: descriptor.expression,
          network
        }).getAddress();
        const { balance, txCount } = await explorer.fetchAddress(address);
        expect(balance).toBeGreaterThanOrEqual(descriptor.value);
        expect(txCount > 0).toEqual(true);
        //DEPRECATED --- unspents is broken anyway, see: https://github.com/bitcoinjs/regtest-server/issues/23
        //const expectedUtxos = await regtestUtils.unspents(address);

        //const { confirmed } = await explorer.fetchUtxos({ address });
        //const utxos = confirmed
        //  ? Object.values(confirmed).map(utxo => {
        //      const tx = Transaction.fromHex(utxo.txHex);
        //      return {
        //        vout: utxo.vout,
        //        txId: tx.getId(),
        //        value: tx.outs[utxo.vout]!.value
        //      };
        //    })
        //  : [];
        //expect(utxoArrayToSet(utxos)).toEqual(utxoArrayToSet(expectedUtxos));
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
        if (burningTx) {
          //await regtestUtils.broadcast(burningTx.toHex());
          await explorer.push(burningTx.toHex());
        }
      }
      //confirm the transactions above
      await regtestUtils.mine(1);
      await new Promise(resolve => setTimeout(resolve, 5000)); //sleep 5 sec - esplora can be really slow to catch up at times...
      //Check that now there are no funds:
      for (const descriptor of fixtures.regtest.descriptors) {
        const address = new Output({
          descriptor: descriptor.expression,
          network
        }).getAddress();
        const { balance, txCount } = await explorer.fetchAddress(address);
        expect(balance).toEqual(0);
        expect(txCount > 0).toEqual(true);
      }
    }, 60000);
    test(`fetchBlockStatus`, async () => {
      const tipHeight = await explorer.fetchBlockHeight();
      const blockStatus = await explorer.fetchBlockStatus(tipHeight);
      expect(blockStatus?.blockTime).toBeDefined();
      expect(blockStatus?.irreversible).toBe(false);
      const currentTime = Math.floor(Date.now() / 1000); // current time in seconds
      const timeDifference = Math.abs(
        currentTime - (blockStatus?.blockTime || 0)
      );
      expect(timeDifference).toBeLessThan(60); //Note this block was mined a few secs ago
      const headerHex = (await regtestUtils.dhttp({
        method: 'GET',
        url: API_URL + '/b/' + blockStatus?.blockHash + '/header'
      })) as string;
      const header = Block.fromHex(headerHex);
      expect(blockStatus?.blockTime).toBe(header.timestamp);
      expect(blockStatus?.blockHash).toBe(header.getId());
      expect(blockStatus?.blockHeight).toBe(tipHeight);
    });
    test(`Push errors`, async () => {
      await expect(
        explorer.push(
          '02000000000101a181e1db4f39ca9b14d764373d919bb01bdaa771a39d61bfc45e4c73b33b6bee00000000171600146a166349647f19f776f9f8c4dc8604b36b854ae4ffffffff02a08601000000000017a914a44bb6bc3228487f4a120fd187b13c23a4886cfc878a0035000000000017a91490bb10362943c1dc6bc97bae807525e934fa9a898702483045022100e4b56cf9ea496604d4ecb9898b7b221a3237e6c9eb12bc1473cf6946ac9244390220215e54c0e3d1131088a56caeac2b21099f33317b865affaef22ee6f3b7ea37980121031dd46bf77dd63d55bab8209dd606b16167d8c75a663475cc5abf85deb64a565600000000'
        ) //Push a problematic tx that has "Missing inputs"
      ).rejects.toThrow(/bad-txns-inputs-missingorspent/);
    });
    test('close', () => {
      explorer.close();
    });
  });
}

//if ('skip this battery of tests' === regtestExplorers[0]!.name) //enable this line to skip the tests below
describe('Explorer: Tests with public servers', () => {
  for (const server of fixtures.bitcoin.servers as Server[]) {
    let explorer: Explorer;
    const explorerName =
      server.service + ' on ' + (server.host || 'default host');
    const hostOrUrl =
      server.service === ELECTRUM
        ? server.host || 'default Electrum host'
        : server.url || 'default Esplora host';
    test(`Create and connect to ${server.service} on ${hostOrUrl}`, async () => {
      if (server.service === ELECTRUM) {
        try {
          explorer = new ElectrumExplorer(server);
        } catch (error) {
          void error;
          fail('ElectrumExplorer constructor should not throw an error');
        }
      } else if (server.service === ESPLORA) {
        try {
          explorer = new EsploraExplorer(server);
        } catch (error) {
          void error;
          fail('EsploraExplorer constructor should not throw an error');
        }
      } else throw new Error('Please, pass a correct service');
      await expect(explorer.connect()).resolves.not.toThrow();
      await expect(explorer.isConnected()).resolves.toBe(true);
    }, 30000);
    ////As of May 19th, 2023, 19iqYbeATe4RxghQZJnYVFU4mjUUu76EA6 has > 90K txs
    ////electrum (depending on the server): history too large / server busy - request timed out
    ////esplora will: Too many transactions per address
    //test(`address 19iqYbeATe4RxghQZJnYVFU4mjUUu76EA6 with large number of txs using ${explorerName}`, async () => {
    //  const val = await explorer.fetchTxHistory({
    //    address: '19iqYbeATe4RxghQZJnYVFU4mjUUu76EA6'
    //  });
    //  console.log({ val });
    //  //await expect(
    //  //  explorer.fetchTxHistory({
    //  //    address: '19iqYbeATe4RxghQZJnYVFU4mjUUu76EA6'
    //  //  })
    //  //).rejects.toThrow();
    //}, 120000);
    test(`fetchFeeEstimates using ${explorerName}`, async () => {
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
    }, 60000);
    test(`fetchBlockStatus using ${explorerName}`, async () => {
      const blockStatus = await explorer.fetchBlockStatus(847612);
      expect(blockStatus?.blockTime).toBe(1718187771);
      expect(blockStatus?.blockHash).toBe(
        '00000000000000000000134f8f660b67822a1bff2657887428745ccdee1e2900'
      );
      expect(blockStatus?.blockHeight).toBe(847612);
      expect(blockStatus?.irreversible).toBe(true);
      // Make sure caching works:
      const blockStatus2 = await explorer.fetchBlockStatus(847612);
      expect(blockStatus2).toBe(blockStatus); // Checks reference equality
    }, 30000);
    test(`close ${explorerName}`, () => {
      explorer.close();
      //await new Promise(r => setTimeout(r, 9000));
    }, 10000);
  }
  //give some time so that keepalive timeouts are closed after explorer.close
  afterAll(async () => {
    await new Promise(r => setTimeout(r, 9000));
  }, 10000);
});
