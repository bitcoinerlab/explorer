# Explorer

`@bitcoinerlab/explorer` is a library that provides a common interface for interacting with various blockchain explorer services like Esplora and Electrum. The library aims to standardize the way developers access the functionality provided by these services and enable easy integration with the `@bitcoinerlab` ecosystem.

## Features

- A consistent interface for interacting with different explorer services
- Connect and disconnect methods to manage connections to the services
- Fetch UTXOs of a Bitcoin address
- Fetch balance and usage information of a Bitcoin address
- Fetch fee estimates based on confirmation targets

## Installation

```bash
npm install @bitcoinerlab/explorer
```

## Usage

This library provides a unified interface for interacting with Bitcoin Blockchain explorers. Currently, it supports two popular explorers: Esplora and Electrum.

The following methods are shared in all implementations:

- `connect()`: Connect to the server.
- `close()`: Close the connection.
- `fetchUtxos(address: string)`: Get the UTXOs of a Bitcoin address. Returns an array of UTXO objects with the following format: `[{ txHex: string, vout: number },...]`.
- `fetchAddress(address: string)`: Get the balance and usage information of a Bitcoin address. Returns an object with `used` and `balance` properties. The `used` property is a boolean indicating whether the address has ever received any coins, even if the balance is currently zero. The `balance` property represents the current balance of the address in satoshis.
- `fetchFeeEstimates()`: Get fee estimates based on confirmation targets. Returns an object with keys representing confirmation targets and values representing the estimated feerate (in sat/vB).

### Examples

In this section, we demonstrate how to use the existing implementations, Esplora and Electrum, provided by this library. You can also create your own implementations following the `Explorer` interface to work with other services.

Here's an example of how to use the `EsploraExplorer` class:

```javascript
import { EsploraExplorer } from '@bitcoinerlab/explorer';

(async () => {
  const explorer = new EsploraExplorer({ url: 'https://blockstream.info/api' });

  // Connect to the Esplora server
  await explorer.connect();

  // Fetch UTXOs of an address (returns a Promise)
  const utxos = await explorer.fetchUtxos(
    'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq'
  );

  // Fetch address information (returns a Promise)
  const addressInfo = await explorer.fetchAddress(
    'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq'
  );

  // Fetch fee estimates (returns a Promise)
  const feeEstimates = await explorer.fetchFeeEstimates();

  // Close the connection
  await explorer.close();
})();
```

To use the `ElectrumExplorer` class, follow a similar pattern but with different constructor parameters:

```javascript
import { ElectrumExplorer } from '@bitcoinerlab/explorer';

async () => {
  const explorer = new ElectrumExplorer({
    host: 'electrum.example.com',
    port: 50002,
    protocol: 'ssl'
  });
  //...
};
```
Note that the `EsploraExplorer` and `ElectrumExplorer` classes accept optional parameters `irrevConfThresh` and `maxTxPerScriptPubKey`, which correspond to the number of confirmations required to consider a transaction as irreversible (defaults to 3) and the maximum number of transactions per address that are allowed (defaults to 1000). You can set a larger `maxTxPerScriptPubKey` if you expect to be working with addresses that have been highly reused, at the cost of having worse performance. Note that many Electrum servers will already return at most 1000 transactions per script hash anyway, so consider using an Esplora server or an Electrum server that supports a large number of transactions if this is of your interest.

## Authors and Contributors

The project was initially developed and is currently maintained by [Jose-Luis Landabaso](https://github.com/landabaso). Contributions and help from other developers are welcome.

Here are some resources to help you get started with contributing:

### Building from source

To download the source code and build the project, follow these steps:

1. Clone the repository:

```bash
git clone https://github.com/bitcoinerlab/explorer.git
```

2. Install the dependencies:

```bash
npm install
```

3. Build the project:

```bash
npm run build
```

This will build the project and generate the necessary files in the `dist` directory.

### Testing

Before committing any code, ensure it passes all tests. First, you need a Bitcoin regtest node running and [this Express-based bitcoind manager](https://github.com/bitcoinjs/regtest-server) running on 127.0.0.1:8080. Additionally, you will need an Electrum server and an Esplora server indexing the regtest node.

The easiest way to set up these services is by using a Docker image that comes preconfigured with them. Use the following commands to download and run the Docker image:

```bash
docker pull bitcoinerlab/tester
docker run -d -p 8080:8080 -p 60401:60401 -p 3002:3002 bitcoinerlab/tester
```

These commands will start a container running a Bitcoin regtest node, the bitcoind manager, and the Blockstream Electrs and Esplora servers on your machine. Once your node, manager, and servers are set up, run the tests with the following command:

```bash
npm run test
```

### License

This project is licensed under the MIT License.
