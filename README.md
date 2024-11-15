# Explorer

`@bitcoinerlab/explorer` is a library that provides a common interface for interacting with various blockchain explorer services like Esplora and Electrum. The library aims to standardize the way developers access the functionality provided by these services and enable easy integration with the `@bitcoinerlab` ecosystem.

## Features

- A consistent interface for interacting with different explorer services
- Connect and disconnect methods to manage connections to the services
- Fetch balance and usage information of a Bitcoin address
- Fetch fee estimates based on confirmation targets

## Installation

```bash
npm install @bitcoinerlab/explorer
```

### Installation in React-Native

Depending on the specific client you wish to use (`Electrum` or `Esplora`), there are different considerations to keep in mind.

#### Using the Electrum Client

1. **Install Required Modules**:

   ```bash
   npm install @bitcoinerlab/explorer react-native-tcp-socket
   ```

2. **Eject from Expo (if in use)**:

   ```bash
   npx expo prebuild
   cd ios && pod install && cd ..
   ```

3. **Shim `net` & `tls` by adding these lines to your `package.json`:**

```json
"react-native": {
  "net": "react-native-tcp-socket",
  "tls": "react-native-tcp-socket"
 }
```

4. **Set Up Global Variables**:
   Create an `electrumSupport.js` file that you must import at the entry point of your application (before any other imports). This file should contain the following code:

   ```javascript
   global.net = require('react-native-tcp-socket');
   global.tls = require('react-native-tcp-socket');
   ```

#### Using the Esplora Client

If you're integrating the Esplora client within a React Native environment, you might encounter the error `"URL.protocol is not implemented"`. This arises because React Native doesn't have a full implementation of the browser's `URL` class.

To address this:

1. **Install the URL Polyfill**:

   ```bash
   npm install @bitcoinerlab/explorer react-native-url-polyfill
   ```

2. **Integrate the Polyfill**:

   At the top of your entry file (e.g., `index.js` or `App.js`), include:

   ```javascript
   import 'react-native-url-polyfill/auto';
   ```

   This polyfill will provide the missing `URL` functionalities in React Native, ensuring the Esplora client operates without issues.

## Usage

This library provides a unified interface for interacting with Bitcoin Blockchain explorers. Currently, it supports two popular explorers: Esplora and Electrum.

The following methods are shared in all implementations:

- `connect()`: Establish a connection to the server.
- `close()`: Terminate the connection.
- `fetchAddress(address: string)`: Retrieve the balance and usage details of a Bitcoin address. This returns an object with:
  - `used`: A boolean that denotes if the address has received any coins in the past, even if its current balance is zero.
  - `balance`: The present balance of the address, measured in satoshis.
- `fetchScriptHash(scriptHash: string)`: Acts similar to `fetchAddress` but for a [script hash](https://electrumx.readthedocs.io/en/latest/protocol-basics.html#script-hashes).
- `fetchTxHistory({ address?: string; scriptHash?: string; })`: Acquires the transaction history for a specific address or script hash. The function returns a promise that resolves to an array of transaction histories. Each entry is an object that contains:
  - `txId: string`
  - `blockHeight: number`
  - `irreversible: boolean`
    Note: They're typically returned in blockchain order. But there's a known [issue with Esplora](https://github.com/Blockstream/esplora/issues/165) where transactions from the same block might not maintain this order.
- `fetchFeeEstimates()`: Obtain fee predictions based on confirmation targets. It returns an object where keys are confirmation targets and values are the projected feerate (measured in sat/vB).
- `fetchBlockHeight()`: Determine the current block tip height.
- `push(txHex: string)`: Submit a transaction in hex format.

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
  explorer.close();
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

## API Documentation

To generate the API documentation for this module, you can run the following command:

```bash
npm run docs
```

However, if you'd prefer to skip this step, the API documentation has already been compiled and is available for reference at [bitcoinerlab.com/modules/explorer/api](https://bitcoinerlab.com/modules/explorer/api).

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

Before finalizing and committing your code, it's essential to make sure all tests are successful. To run these tests:

1. A Bitcoin regtest node must be active.
2. Utilize the [Express-based bitcoind manager](https://github.com/bitcoinjs/regtest-server) which should be operational at `127.0.0.1:8080`.
3. An Electrum server and an Esplora server are required, both indexing the regtest node.

To streamline this setup, you can use the Docker image, `bitcoinerlab/tester`, which comes preconfigured with the required services. The Docker image can be found under **Dockerfile for bitcoinerlab/tester**. When you run the test script using:

```bash
npm test
```

it will automatically download and start the Docker image if it's not already present on your machine. However, ensure you have the `docker` binary available in your path for this to work seamlessly.

### License

This project is licensed under the MIT License.
