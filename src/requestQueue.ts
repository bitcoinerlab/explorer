/**
 * Parameters for configuring the RequestQueue. This queue is used in
 * HTTP fetch operations in Esplora clients and is an optional input
 * parameter in the EsploraExplorer constructor.
 */
export type RequestQueueParams = {
  /**
   * Maximum number of attempts for soft errors (429 or 50x status).
   * Also applies to network-related throws (e.g., network down or CORS issues).
   * Defaults to 100 attempts.
   */
  maxAttemptsForSoftErrors?: number;
  /**
   * Maximum number of attempts for hard errors (other than 429 or 50x).
   * Limits the number of attempts for errors other than 429 and 50x, assuming
   * the network is up.
   * Defaults to 10 attempts.
   */
  maxAttemptsForHardErrors?: number;
  /**
   * Number of consecutive successful fetches required to unthrottle.
   * Automatically stops throttling after this many successful responses.
   * Defaults to 10 consecutive successes.
   */
  unthrottleAfterOkCount?: number;
  /**
   * Time in milliseconds of inactivity after the last fetch before unthrottling.
   * Automatically stops throttling if inactive for this period.
   * Defaults to 2000ms (2 seconds).
   */
  unthrottleAfterTime?: number;
  /**
   * Time in milliseconds to wait before retrying a fetch request when throttled.
   * Determines the delay between attempts when throttling is active.
   * Defaults to 200ms - 5 req/sec - the 5 r/s of Blockstream esplora:
   * limit_req_zone $limit_key zone=heavylimitzone:10m rate=5r/s;
   * https://github.com/Blockstream/esplora/blob/master/contrib/nginx.conf.in
   */
  throttleTime?: number;
  /**
   * Maximum number of concurrent fetch tasks allowed.
   * New fetch tasks will wait throttleTime before retrying if limit is reached.
   * Note that even if maxConcurrentTasks is set, new tasks are not added if
   * the server is struggling (throttling responses).
   * Blockstream allows up to 10 concurrent tasks:
   * limit_req zone=heavylimitzone burst=10 nodelay
   * https://github.com/Blockstream/esplora/blob/master/contrib/nginx.conf.in
   * May be interesting to limit it to lower to match the 5 requests / sec limit,
   * with a throttleTime of 200 ms.
   * Another approch is setting 30 maxConcurrentTasks which is 50% more of typical
   * gapLimit.
   */
  maxConcurrentTasks?: number;
};

/**
 * Generates a randomized throttle time around the mean time to prevent
 * synchronized retry attempts. This helps distribute the load more evenly
 * across multiple retries, reducing the risk of overwhelming the server or network.
 *
 * @param {number} meanTime - The average throttle time in milliseconds.
 */
const getRandomizedThrottleTime = (meanTime: number) => {
  const variance = meanTime * 0.2; // 20% variance
  return meanTime + (Math.random() * variance * 2 - variance);
};

/**
 * Manages rate-limited fetch requests with automated throttling control. This
 * class is designed to handle situations where rapid or concurrent fetch
 * requests might exceed a server's rate limits or encounter network errors,
 * resulting in HTTP 429 responses (Too Many Requests) or other fetch failures.
 *
 * The `RequestQueue` class provides a mechanism to control the rate of fetch
 * requests. It automatically throttles requests when necessary and unthrottles
 * after a set number of successful responses or a period of inactivity.
 *
 * For constructor params see type RequestQueueParams.
 *
 * Related:
 * https://github.com/Blockstream/esplora/issues/449#issuecomment-1546000515
 */

export class RequestQueue {
  private mustThrottle: boolean;
  private maxAttemptsForSoftErrors: number; //429, 50x and exceptions
  private maxAttemptsForHardErrors: number; //only exceptions
  private consecutiveOkResponses: number;
  private unthrottleAfterOkCount: number;
  private unthrottleAfterTime: number;
  private throttleTime: number;
  private unthrottleTimeout: ReturnType<typeof setTimeout> | undefined;
  private concurrentTasks: number;
  private maxConcurrentTasks: number;

  constructor({
    maxAttemptsForSoftErrors = 100,
    maxAttemptsForHardErrors = 5,
    unthrottleAfterOkCount = 10,
    unthrottleAfterTime = 2000,
    throttleTime = 200,
    maxConcurrentTasks = 30
  }: RequestQueueParams = {}) {
    this.maxAttemptsForSoftErrors = maxAttemptsForSoftErrors;
    this.maxAttemptsForHardErrors = maxAttemptsForHardErrors;
    this.unthrottleAfterOkCount = unthrottleAfterOkCount;
    this.unthrottleAfterTime = unthrottleAfterTime;
    this.throttleTime = throttleTime;
    this.maxConcurrentTasks = maxConcurrentTasks;
    this.concurrentTasks = 0;
    this.unthrottleTimeout = undefined;
    this.mustThrottle = false;
    this.consecutiveOkResponses = 0;
  }

  async fetch(...args: Parameters<typeof fetch>): Promise<Response> {
    const task = async () => {
      let softErrorAttempts = 0;
      let hardErrorAttempts = 0;

      while (
        softErrorAttempts < this.maxAttemptsForSoftErrors &&
        hardErrorAttempts < this.maxAttemptsForHardErrors
      ) {
        // Sleep if throttling is active
        if (this.mustThrottle) {
          const randomizedThrottleTime = getRandomizedThrottleTime(
            this.throttleTime
          );
          await new Promise(r => setTimeout(r, randomizedThrottleTime));
        }
        try {
          const response = await fetch(...args);

          const isSoftError =
            response.status === 429 ||
            response.status === 500 ||
            //501 is not implemented, don't add this one
            response.status === 502 ||
            response.status === 503 ||
            response.status === 504;

          const isLastSoftErrorAttempt =
            softErrorAttempts + 1 >= this.maxAttemptsForSoftErrors;

          if (isSoftError) {
            // Retry with increased delay
            this.mustThrottle = true;
            this.consecutiveOkResponses = 0;
            if (isLastSoftErrorAttempt) {
              this.concurrentTasks--;
              console.warn(
                `Max attempts reached soft ${softErrorAttempts + 1} / hard ${
                  hardErrorAttempts + 1
                } - returning SOFT error for ${
                  response.status
                }. Consider reducing rate limits and/or increasing maxAttemptsForSoftErrors.`
              );
              return response; //return whatever the error response was
            } else {
              softErrorAttempts++;
            }
          } else {
            if (softErrorAttempts || hardErrorAttempts)
              console.warn(
                `Recovered from ${softErrorAttempts} soft / ${hardErrorAttempts} hard errored attempts. Consider reducing rate limits.`
              );
            // this was an OK response
            this.consecutiveOkResponses++;
            if (this.consecutiveOkResponses > this.unthrottleAfterOkCount) {
              this.mustThrottle = false;
            }
            this.concurrentTasks--;
            return response;
          }
        } catch (error) {
          this.mustThrottle = true;
          this.consecutiveOkResponses = 0;
          if (
            softErrorAttempts >= this.maxAttemptsForSoftErrors - 1 ||
            hardErrorAttempts >= this.maxAttemptsForHardErrors - 1
          ) {
            this.concurrentTasks--;
            console.warn(
              `Max attempts reached soft ${softErrorAttempts + 1} / hard ${
                hardErrorAttempts + 1
              } - rethrowing error. Consider reducing rate limits and/or increasing maxAttemptsForSoftErrors & maxAttemptsForSoftErrors.`
            );
            throw error; //not going to try again - rethrow original error
          } else {
            softErrorAttempts++;
            hardErrorAttempts++;
          }
        }
        //Fetch performed. Now disable throttling after unthrottleAfterTime
        //However, clear the wait if a new fetch comes
        if (this.unthrottleTimeout) clearTimeout(this.unthrottleTimeout);
        this.unthrottleTimeout = setTimeout(() => {
          this.mustThrottle = false;
          this.unthrottleTimeout = undefined;
        }, this.unthrottleAfterTime);
      }
      throw new Error(
        'RequestQueue.fetch should have returned a valid response or thrown before reaching this point'
      );
    };

    while (
      this.concurrentTasks >= this.maxConcurrentTasks ||
      this.mustThrottle
    ) {
      // wait before processing this task because there are too many queries already
      // also dont allow adding more tasks if the server is struggling (throttling)
      // we use throttleTime here to be in some kind of order of magnitude similar
      // to the throttle time, although this is a bit unrelated
      await new Promise(r => setTimeout(r, this.throttleTime));
    }
    this.concurrentTasks++;
    return task(); // Execute the task and return its promise
  }
}
