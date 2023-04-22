import { fixtures, ELECTRUM, ESPLORA } from './fixtures/explorer';
import { EsploraExplorer } from '../dist/esplora';
//import { ElectrumExplorer } from '../dist/electrum'; // Assuming you have an ElectrumExplorer class

interface Server {
  service: typeof ELECTRUM | typeof ESPLORA;
  host?: string;
  url?: string;
}

describe('Explorer: Tests with public servers', () => {
  //const explorers: (ElectrumExplorer | EsploraExplorer)[] = [];
  const explorers: EsploraExplorer[] = [];
  for (const server of fixtures.public.servers as Server[]) {
    test(`Create and connect to ${server.service} on ${
      server.service === ELECTRUM ? server.host : server.url
    }`, async () => {
      //let explorer: ElectrumExplorer | EsploraExplorer;
      let explorer: EsploraExplorer;
      if (server.service === ELECTRUM) {
        throw new Error('TODO');
        //expect(() => (explorer = new ElectrumExplorer(server))).not.toThrow();
        //await expect(explorer.connect()).resolves.not.toThrow();
        //explorers.push(explorer);
      }
      if (server.service === ESPLORA) {
        try {
          explorer = new EsploraExplorer(server);
        } catch (error) {
          fail('EsploraExplorer constructor should not throw an error');
        }
        await expect(explorer.connect()).resolves.not.toThrow();
        explorers.push(explorer);
      }
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
