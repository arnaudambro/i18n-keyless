// https://github.com/sindresorhus/p-queue/issues/145#issuecomment-882068004
// p-queu import is broken, so here is the smalle implementation of it

type Task<T> = () => Promise<T>;
type QueuedTask = {
  task: Task<any>;
  priority: number;
  id: string;
  /** The promise handed to every caller that adds this id while it is still waiting. */
  promise: Promise<any>;
};

class EventEmitter {
  private events: Record<string, Array<() => void>> = {};

  on(event: string, callback: () => void) {
    if (!this.events[event]) {
      this.events[event] = [];
    }
    this.events[event].push(callback);
  }

  off(event: string, callback: () => void) {
    if (!this.events[event]) return;
    this.events[event] = this.events[event].filter((cb) => cb !== callback);
  }

  emit(event: string) {
    if (!this.events[event]) return;
    this.events[event].forEach((callback) => callback());
  }
}

export default class MyPQueue extends EventEmitter {
  private queue: QueuedTask[] = [];
  private pending = 0;
  private readonly concurrency: number;
  private processing = false;
  /** Backs the default id. `Date.now()` collided for anything added in the same ms. */
  private nextId = 0;

  constructor(options: { concurrency?: number } = {}) {
    super();
    this.concurrency = options.concurrency ?? Infinity;
  }

  add<T>(task: Task<T>, options: { priority?: number; id?: string } = {}): Promise<T> {
    const { priority = 0, id = `task-${this.nextId++}` } = options;

    // Same id, still waiting its turn: hand back the promise it will settle with.
    //
    // This used to `return existingTask.task()`, which re-invoked the queued work straight
    // away — bypassing the concurrency limit, and then decrementing `pending` in the
    // wrapper's `finally` for a run that never incremented it. `pending` drifted negative
    // and the limit stopped holding for the lifetime of the queue.
    const existingTask = this.queue.find((item) => item.id === id);
    if (existingTask) {
      return existingTask.promise as Promise<T>;
    }

    let wrappedTask!: Task<T>;
    const promise = new Promise<T>((resolve, reject) => {
      wrappedTask = async () => {
        try {
          const result = await task();
          resolve(result);
          return result;
        } catch (error) {
          reject(error);
          throw error;
        } finally {
          this.pending--;
          this.processNext();
        }
      };
    });

    this.queue.push({ task: wrappedTask, priority, id, promise });
    this.queue.sort((a, b) => b.priority - a.priority);
    this.processNext();

    return promise;
  }

  private async processNext() {
    if (this.processing) return;
    this.processing = true;

    while (this.queue.length > 0 && this.pending < this.concurrency) {
      const task = this.queue.shift();
      if (task) {
        this.pending++;
        task.task().catch(() => {});
      }
    }

    this.processing = false;

    if (this.queue.length === 0 && this.pending === 0) {
      this.emit("empty");
    }
  }

  get size(): number {
    return this.queue.length;
  }

  get isPaused(): boolean {
    return false;
  }
}
