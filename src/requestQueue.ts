const log = (_message: unknown) => {};
//const log = (_message: unknown) => console.log(_message);

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
 * Constructor params:
 * @param maxRetries - Maximum number of retries for a fetch request upon
 * encountering a 429 status or general network errors. Default is 100.
 * @param unthrottleAfterCount - Number of consecutive successful fetches after
 * which the queue will automatically stop throttling. Default is 10.
 * @param unthrottleAfterTime - Time in milliseconds of inactivity after the
 * last fetch, upon which the queue will automatically stop throttling.
 * Default is 2000ms (2 seconds).
 * @param throttleTime - Time in milliseconds to wait before retrying a fetch
 * request when throttling is active. Default is 200ms.
 * @param maxConcurrentTasks - Maximum number of concurrent fetch tasks allowed.
 * When this limit is reached, new fetch tasks will wait `throttleTime` before
 * trying again. Default is 30.
 *
 * Usage:
 * ```
 * const queue = new RequestQueue();
 * queue.fetch('https://example.com/api/data');
 * ```
 * See:
 * https://github.com/Blockstream/esplora/issues/449#issuecomment-1546000515
 */

export class RequestQueue {
  private mustThrottle: boolean;
  private maxRetries: number;
  private consecutiveOkResponses: number;
  private unthrottleAfterCount: number;
  private unthrottleAfterTime: number;
  private throttleTime: number;
  private unthrottleTimeout: ReturnType<typeof setTimeout> | undefined;
  private concurrentTasks: number;
  private maxConcurrentTasks: number;
  constructor(
    maxRetries: number = 100,
    /** number of consecutive ok fetches that will automatically unthrottle
     * the system */
    unthrottleAfterCount: number = 10,
    /** inactivity time after last fetch that will automatically unthrottle
     * the system */
    unthrottleAfterTime: number = 2000, // 2 second: number = 200, 2 seconds after last fetch, deactivate sleeping for each call
    throttleTime: number = 200,
    /** max number of fetch tasks that are allowed to be running concurrently.
     * When reaching maxConcurrentTasks, then sleep throttleTime and try
     * again
     */
    maxConcurrentTasks: number = 30 // 50% over the typical gapLimit
  ) {
    this.maxRetries = maxRetries;
    this.unthrottleAfterCount = unthrottleAfterCount;
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
      log(`New task started, concurrentTasks: ${this.concurrentTasks}`);
      let retries = 0;

      while (retries <= this.maxRetries) {
        log(`New fetch trial ${retries}`);
        //sleep
        if (this.mustThrottle) {
          log(`Throttled - sleeping ${this.throttleTime}`);
          await new Promise(r => setTimeout(r, this.throttleTime));
        }
        try {
          log(`Real fetch`);
          const response = await fetch(...args);
          if (this.unthrottleTimeout) clearTimeout(this.unthrottleTimeout);
          this.unthrottleTimeout = setTimeout(() => {
            log(`UN-throttling after time ${this.unthrottleAfterTime}`);
            this.mustThrottle = false;
            this.unthrottleTimeout = undefined;
          }, this.unthrottleAfterTime);

          if (response.status === 429 && retries < this.maxRetries) {
            this.mustThrottle = true;
            this.consecutiveOkResponses = 0;
            log(`429, on trial ${retries} - Throttling`);
            retries++;
            continue; // Retry with increased delay
          }

          this.consecutiveOkResponses++;
          if (this.consecutiveOkResponses > this.unthrottleAfterCount) {
            this.mustThrottle = false;
            log(`UN-throttling`);
          }
          this.concurrentTasks--;
          return response; // Resolve on successful response or max retries reached
        } catch (error) {
          log(`unknowon Error`);
          this.mustThrottle = true;
          this.consecutiveOkResponses = 0;
          retries++;
        }
      }
      this.concurrentTasks--;
      throw new Error('Maximum retries exceeded');
    };

    while (this.concurrentTasks >= this.maxConcurrentTasks) {
      // wait before processing this task because there are too many queries already
      log(`Not launching yet because ${this.concurrentTasks}`);
      await new Promise(r => setTimeout(r, this.throttleTime));
    }
    this.concurrentTasks++;
    return task(); // Execute the task and return its promise
  }
}
