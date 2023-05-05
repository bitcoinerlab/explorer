export const ESPLORA = 'ESPLORA';
export const ELECTRUM = 'ELECTRUM';
//Use a tool such as: https://iancoleman.io/bip39/
//And / or: https://codesandbox.io/s/sweet-meadow-vessce?file=/index.ts
export const fixtures = {
  regtest: {
    mnemonic: `caution help average spoil brain enforce balcony siege volcano snap child ugly`,
    //Don't send anything here:
    unusedAddress: '2N4HNDu7u2WV2XXbMV2e38RjUAiosbeKwBH',
    //Spend utxos here so that it has value:0, but used true:
    burnAddress: '2N5vEX6xsMhxDLPa8GGXJHnYVh2BwTtvq8V',
    //Descriptors below created with
    //https://codesandbox.io/s/sweet-meadow-vessce?file=/index.ts
    descriptors: [
      {
        //purpose: LEGACY,
        //accountNumber: 0,
        //index: 0,
        //isChange: false,
        //2 BTC
        value: 200000000,
        expression: `pkh([6caa26c2/44'/1'/0']tpubDD2Ua3TWLrEL3HgoT9BV2yN41WKLrZmyYAJdHb1uV1pBsfi3FjfRVxhqJHLr9KqmX8oSRb5cuQ13UuTNFPS2rbLv6FhndYqdoByNzvSJXyw/0/0)`
      },
      {
        //purpose: LEGACY,
        //accountNumber: 0,
        //index: 3,
        //isChange: false,
        //1 BTC
        value: 100000000,
        expression: `pkh([6caa26c2/44'/1'/0']tpubDD2Ua3TWLrEL3HgoT9BV2yN41WKLrZmyYAJdHb1uV1pBsfi3FjfRVxhqJHLr9KqmX8oSRb5cuQ13UuTNFPS2rbLv6FhndYqdoByNzvSJXyw/0/3)`
      },
      {
        //purpose: NATIVE_SEGWIT,
        //accountNumber: 0,
        //index: 5,
        //isChange: false,
        //0.2 BTC
        value: 20000000,
        expression: `wpkh([6caa26c2/84'/1'/0']tpubDDJBmwn6ZhezcdYVYoJkUQGfAHQiFq8VQvSyx5ccbVe9MaySWaKYgcSFKqVX8rNsHVWHgVortksWo3E83FocMK7msF1NT6ATLP4fejD3VLk/0/5)`
      },
      {
        //purpose: NATIVE_SEGWIT,
        //accountNumber: 1,
        //index: 8,
        //isChange: false,
        //0.9 BTC
        value: 90000000,
        expression: `wpkh([6caa26c2/84'/1'/1']tpubDDJBmwn6ZhezfVksk8FXPyRQWPtB9gmbNarRiMntCsY5w9NpJZ4VyoaGtPLn312nC1tVc4AjDWXbgUGWBPHQC4ep5yYDjKBLFLEecpkepk2/0/8)`
      },
      {
        //purpose: NESTED_SEGWIT,
        //accountNumber: 0,
        //index: 1,
        //isChange: true,
        //0.8 BTC
        value: 80000000,
        expression: `sh(wpkh([6caa26c2/49'/1'/0']tpubDDPr5on5VEVzS8FXec5ybmcehAPsQHvqZGhvcxpRjj1WVoofcYNbCcVGpz9tTM1aXUGhruYNYF8q7VZB2JmNNujRUW49AcENSzp6ov4qSQ6/1/1))`
      }
    ]
  },
  bitcoin: {
    servers: [
      {
        service: ELECTRUM,
        host: 'electrum.bitaroo.net',
        port: 50002,
        protocol: 'ssl'
      },
      {
        service: ELECTRUM,
        host: 'electrum3.bluewallet.io',
        port: 50001,
        protocol: 'tcp'
      },
      {
        service: ELECTRUM,
        host: 'electrum2.bluewallet.io',
        port: 443,
        protocol: 'ssl'
      },
      {
        //will default to blockstream electrum
        service: ELECTRUM
      }
    ]
  }
};
