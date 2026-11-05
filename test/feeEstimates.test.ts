const estimateFee = jest.fn(async (_target: number) => 0.00002);

jest.mock('@bitcoinerlab/electrum-client', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    initElectrum: jest.fn().mockResolvedValue(undefined),
    subscribe: { on: jest.fn() },
    blockchainHeaders_subscribe: jest.fn().mockResolvedValue({
      height: 432,
      hex: '00'.repeat(80)
    }),
    blockchainEstimatefee: estimateFee,
    close: jest.fn()
  }))
}));

const { ElectrumExplorer, EsploraExplorer } =
  jest.requireActual<typeof import('../dist')>('../dist');
const targets = [
  ...Array.from({ length: 25 }, (_, i) => i + 1),
  144,
  504,
  1008
];
let electrum: InstanceType<typeof ElectrumExplorer> | undefined;

beforeEach(() => {
  estimateFee.mockReset().mockResolvedValue(0.00002);
});
afterEach(() => {
  if (electrum && !electrum.isClosed()) electrum.close();
  electrum = undefined;
  jest.restoreAllMocks();
});

test('Esplora preserves fee estimates in sat/vB', async () => {
  const fees = Object.fromEntries(targets.map(target => [target, 2]));
  const fetchMock = jest
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(new Response(JSON.stringify(fees)));
  const explorer = new EsploraExplorer({ url: 'http://127.0.0.1:1' });
  expect(await explorer.fetchFeeEstimates()).toEqual(fees);
  expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:1/fee-estimates');
});

test.each([{}, { '0': 1 }, { bad: 1 }, { '1': '2' }, { '1': -1 }])(
  'Esplora rejects invalid fee estimates: %j',
  async fees => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify(fees)));
    const explorer = new EsploraExplorer({ url: 'http://127.0.0.1:1' });
    await expect(explorer.fetchFeeEstimates()).rejects.toThrow(
      'Invalid fee estimates!'
    );
  }
);

test('Electrum converts BTC/kB to sat/vB for every confirmation target', async () => {
  electrum = new ElectrumExplorer();
  await electrum.connect();
  expect(await electrum.fetchFeeEstimates()).toEqual(
    Object.fromEntries(targets.map(target => [target, 2]))
  );
  expect(estimateFee.mock.calls.map(([target]) => target)).toEqual(targets);
});

test('Electrum rejects unavailable negative fee estimates', async () => {
  estimateFee.mockResolvedValue(-1);
  electrum = new ElectrumExplorer();
  await electrum.connect();
  await expect(electrum.fetchFeeEstimates()).rejects.toThrow(
    'Invalid fee estimates!'
  );
});
