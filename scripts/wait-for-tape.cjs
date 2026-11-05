const assert = require('node:assert/strict');
const { waitFor } = require('../test/helpers/waitFor');

const APIURL = process.env.APIURL || 'http://127.0.0.1:8080/1';
const ESPLORA_URL = process.env.ESPLORA_URL || 'http://127.0.0.1:3002';

async function readHeight(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
  assert.ok(response.ok, `${url} returned ${response.status}`);
  const height = Number(await response.text());
  assert.ok(
    Number.isInteger(height) && height >= 432,
    `Invalid height: ${height}`
  );
  return height;
}

waitFor(
  'Tape and its indexer to become ready',
  async () => {
    const height = await readHeight(`${APIURL}/b/best/height`);
    assert.equal(await readHeight(`${ESPLORA_URL}/blocks/tip/height`), height);
  },
  60000
).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
