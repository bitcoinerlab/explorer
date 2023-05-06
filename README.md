# Explorer

`@bitcoinerlab/explorer` is a library that provides a common interface for interacting with various blockchain explorer services like Esplora and Electrum. The library aims to standardize the way developers access the functionality provided by these services and enable easy integration with the @bitcoinerlab ecosystem.

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

To use this package, you will need to implement an explorer client that adheres to the `Explorer` interface.

The following methods need to be implemented:

- `connect()`: Connect to the server.
- `close()`: Close the connection.
- `fetchUtxos(address: string)`: Get the UTXOs of a Bitcoin address. Returns an array of UTXO objects with the following format: `[{ txHex: string, vout: number },...]`.
- `fetchAddress(address: string)`: Get the balance and usage information of a Bitcoin address. Returns an object with `used` and `balance` properties.
- `fetchFeeEstimates()`: Get fee estimates based on confirmation targets. Returns an object with keys representing confirmation targets and values representing the estimated feerate (in sat/vB).

### Example

This repository includes two implementations of the `Explorer` interface so far - Esplora and Electrum. Users can implement new clients following the `Explorer` interface, and if they adhere to the interface, those implementations will be able to work seamlessly with the @bitcoinerlab ecosystem.

For Esplora, the constructor takes an optional `url` parameter that specifies the API URL for the Esplora server. If no URL is provided, it defaults to the Blockstream.info API.

For Electrum, the constructor takes an object with three properties: `host`, `port`, and `protocol`. The `host` is the server address, `port` is the server port number, and `protocol` is either 'tcp' or 'ssl'.

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
