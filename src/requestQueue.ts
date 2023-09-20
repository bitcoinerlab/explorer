//https://github.com/Blockstream/esplora/issues/449#issuecomment-1546000515
/**
 * Class to handle rate-limited requests
 */
export class RequestQueue {
  private queue: (() => Promise<void>)[] = [];
  private delayBetweenRequests: number;
  private originalDelay: number;
  private lastRequestTime: number = 0;
  private retries: number = 0;
  private maxRetries: number;
  private increasePercent: number;

  /**
   * @param delayBetweenRequests Initial delay between requests in milliseconds
   * @param maxRetries Maximum number of retries when status 429 is encountered
   * @param increasePercent Increase percentage for delay between requests when status 429 is encountered
   */
  constructor(
    delayBetweenRequests: number = 100,
    maxRetries: number = 100,
    increasePercent: number = 10
  ) {
    this.delayBetweenRequests = delayBetweenRequests;
    this.originalDelay = delayBetweenRequests;
    this.maxRetries = maxRetries;
    this.increasePercent = increasePercent;
  }

  /**
   * Sends a fetch request with rate limiting and retrying for status 429
   * @param args Arguments to be passed to fetch function
   * @returns Response from the fetch request
   */
  async fetch(...args: Parameters<typeof fetch>): Promise<Response> {
    return new Promise((resolve, reject) => {
      const fetchTask = async () => {
        const now = Date.now();
        const timeSinceLastRequest = now - this.lastRequestTime;
        if (timeSinceLastRequest < this.delayBetweenRequests) {
          await new Promise(resolve =>
            setTimeout(
              resolve,
              this.delayBetweenRequests - timeSinceLastRequest
            )
          );
        }

        while (this.retries < this.maxRetries) {
          try {
            const response = await fetch(...args);
            this.lastRequestTime = Date.now();

            if (response.status === 429) {
              this.delayBetweenRequests *= 1 + this.increasePercent / 100;
              this.retries++;
              //console.warn(
              //  `Received 429 status. Increasing delay to ${this.delayBetweenRequests} ms and retrying. Retry count: ${this.retries}`
              //);
              await new Promise(resolve =>
                setTimeout(resolve, this.delayBetweenRequests)
              ); // Wait for the updated delayBetweenRequests
            } else {
              // If status is not 429, reset retries and delay
              this.retries = 0;
              this.delayBetweenRequests = this.originalDelay;
              resolve(response);
              break;
            }
          } catch (error) {
            reject(error);
            break;
          }
        }

        if (this.retries >= this.maxRetries) {
          // If retries is equal to or more than maxRetries, reject the promise
          reject(new Error('Maximum retries exceeded.'));
        }
      };
      this.queue.push(fetchTask);
      this.processQueue();
    });
  }

  /**
   * Process the queued fetch tasks
   */
  private async processQueue() {
    if (this.queue.length > 0) {
      const fetchTask = this.queue.shift();
      if (fetchTask) {
        try {
          await fetchTask();
        } catch (error) {
          console.error('Error processing fetch task:', error);
        }
      }
    }
  }
}
