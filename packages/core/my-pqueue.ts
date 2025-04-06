// https://github.com/sindresorhus/p-queue/issues/145#issuecomment-882068004
// p-queu import is broken, so here is the smalle implementation of it

type Task<T> = () => Promise<T>;
type QueuedTask = {
  task: Task<any>;
  priority: number;
  id: string;
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

  constructor(options: { concurrency?: number } = {}) {
    super();
    this.concurrency = options.concurrency ?? Infinity;
  }

  add<T>(task: Task<T>, options: { priority?: number; id?: string } = {}): Promise<T> {
    const { priority = 0, id = String(Date.now()) } = options;

    // If task with same ID exists, return its promise
    const existingTask = this.queue.find((item) => item.id === id);
    if (existingTask) {
      return existingTask.task() as Promise<T>;
    }

    return new Promise<T>((resolve, reject) => {
      const wrappedTask = async () => {
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

      this.queue.push({ task: wrappedTask, priority, id });
      this.queue.sort((a, b) => b.priority - a.priority);

      this.processNext();
    });
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
