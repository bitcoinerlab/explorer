// Optional live-service checks: npm run test:public, never npm test.
//TODO: Test that results between electrum and esplora are consistent on abandon
import { fixtures, ELECTRUM } from './fixtures/explorer';
import { Explorer, ElectrumExplorer, EsploraExplorer } from '../dist';

// Bound the underlying HTTP requests as well as the Jest test timeout.
const fetchPublic = globalThis.fetch;
beforeAll(() => {
  jest
    .spyOn(globalThis, 'fetch')
    .mockImplementation((input, init) =>
      fetchPublic(input, { ...init, signal: AbortSignal.timeout(3000) })
    );
});
afterAll(() => jest.restoreAllMocks());

for (const server of fixtures.bitcoin.servers) {
  const name = `${server.service} on ${'host' in server ? server.host : 'default host'}`;
  describe(name, () => {
    let explorer: Explorer;
    beforeAll(async () => {
      explorer =
        server.service === ELECTRUM
          ? new ElectrumExplorer({ ...server, timeout: 3000 })
          : new EsploraExplorer({
              ...server,
              timeout: 3000,
              requestQueueParams: {
                maxAttemptsForSoftErrors: 1,
                maxAttemptsForHardErrors: 1
              }
            });
      await explorer.connect();
    }, 10000);
    afterAll(() => {
      if (explorer && !explorer.isClosed()) explorer.close();
    });

    test('isConnected', async () => {
      expect(await explorer.isConnected()).toBe(true);
    });

    test('fetchFeeEstimates', async () => {
      const feeEstimates = await explorer.fetchFeeEstimates();
      expect(Object.keys(feeEstimates).length).toBeGreaterThan(0);
      for (const fee of Object.values(feeEstimates)) {
        expect(Number.isFinite(fee)).toBe(true);
        expect(fee).toBeGreaterThanOrEqual(0);
      }
    }, 15000);

    test('fetchBlockStatus and cache', async () => {
      const blockStatus = await explorer.fetchBlockStatus(847612);
      expect(blockStatus).toEqual({
        blockTime: 1718187771,
        blockHash:
          '00000000000000000000134f8f660b67822a1bff2657887428745ccdee1e2900',
        blockHeight: 847612,
        irreversible: true
      });
      expect(await explorer.fetchBlockStatus(847612)).toBe(blockStatus);
    }, 10000);
  });
}
