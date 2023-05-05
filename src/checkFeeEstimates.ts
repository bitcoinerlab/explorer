/**
 * Throws an error if feeEstimates do not respect Esplora format.
 *
 * See [`/fee-estimates`](https://github.com/Blockstream/esplora/blob/master/API.md#get-fee-estimates).
 *
 * @param {Object} feeEstimates An object where the key is the confirmation target (in number of blocks - an integer)
 * and the value is the estimated feerate (in sat/vB).
 * For example:
 * ```
 * { "1": 87.882, "2": 87.882, "3": 87.882, "4": 87.882, "5": 81.129, "6": 68.285, ..., "144": 1.027, "504": 1.027, "1008": 1.027 }
 * ```
 * @returns {boolean} If the function does not throw, then it always returns true.
 */

export function checkFeeEstimates(
  feeEstimates: Record<string, number>
): boolean {
  const error = 'Invalid fee estimates!';
  if (
    typeof feeEstimates !== 'object' ||
    Object.keys(feeEstimates).length === 0
  ) {
    throw new Error(error);
  }
  Object.keys(feeEstimates).map(key => {
    if (
      typeof key !== 'string' ||
      !Number.isInteger(Number(key)) ||
      Number(key) <= 0 ||
      typeof feeEstimates[key] !== 'number' ||
      (feeEstimates[key] as number) < 0
    ) {
      throw new Error(error);
    }
  });
  return true;
}
