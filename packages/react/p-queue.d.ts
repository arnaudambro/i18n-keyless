// https://github.com/sindresorhus/p-queue/issues/145#issuecomment-2233852587
declare module "p-queue/dist" {
  interface Options {
    concurrency?: number;
    timeout?: number;
    throwOnTimeout?: boolean;
    signal?: AbortSignal;
    autoStart?: boolean;
  }

  class PQueue {
    constructor(options?: Options);
    add<T>(fn: () => Promise<T> | T, options?: { priority?: number }): Promise<T>;
    addAll<T>(fns: (() => Promise<T> | T)[], options?: { priority?: number }): Promise<T[]>;
    size: number;
    pending: number;
    pause(): void;
    start(): void;
    clear(): void;
    on(event: "active" | "idle" | "empty", callback: () => void): void;
    off(event: "active" | "idle" | "empty", callback: () => void): void;
  }

  export default PQueue;
}
