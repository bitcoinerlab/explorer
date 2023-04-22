"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const explorer_1 = require("./fixtures/explorer");
const esplora_1 = require("../dist/esplora");
describe('Explorer: Tests with public servers', () => {
    //const explorers: (ElectrumExplorer | EsploraExplorer)[] = [];
    const explorers = [];
    for (const server of explorer_1.fixtures.public.servers) {
        test(`Create and connect to ${server.service} on ${server.service === explorer_1.ELECTRUM ? server.host : server.url}`, async () => {
            //let explorer: ElectrumExplorer | EsploraExplorer;
            let explorer;
            if (server.service === explorer_1.ELECTRUM) {
                throw new Error('TODO');
                //expect(() => (explorer = new ElectrumExplorer(server))).not.toThrow();
                //await expect(explorer.connect()).resolves.not.toThrow();
                //explorers.push(explorer);
            }
            if (server.service === explorer_1.ESPLORA) {
                try {
                    explorer = new esplora_1.EsploraExplorer(server);
                }
                catch (error) {
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
            expect(Object.keys(feeEstimates).map(n => Number(n))).toEqual(expect.arrayContaining(T));
            expect(Object.keys(feeEstimates).length).toEqual(T.length);
            let prevIndex;
            for (const index of Object.keys(feeEstimates)) {
                if (prevIndex)
                    expect(feeEstimates[prevIndex]).toBeGreaterThanOrEqual(feeEstimates[index]);
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
