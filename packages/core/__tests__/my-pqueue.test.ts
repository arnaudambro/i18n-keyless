import { describe, it, expect, vi } from "vitest";
import MyPQueue from "../my-pqueue.ts";

const deferred = <T>() => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("MyPQueue", () => {
  it("runs a task and resolves with its value", async () => {
    const queue = new MyPQueue();
    await expect(queue.add(async () => "done")).resolves.toBe("done");
  });

  it("rejects with the task's error", async () => {
    const queue = new MyPQueue();
    await expect(
      queue.add(async () => {
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");
  });

  it("keeps draining after a task throws", async () => {
    const queue = new MyPQueue({ concurrency: 1 });
    queue.add(async () => {
      throw new Error("boom");
    }).catch(() => {});
    await expect(queue.add(async () => "still here")).resolves.toBe("still here");
  });

  it("never runs more than `concurrency` tasks at once", async () => {
    const queue = new MyPQueue({ concurrency: 2 });
    let running = 0;
    let peak = 0;
    const gates = [deferred<void>(), deferred<void>(), deferred<void>(), deferred<void>()];

    const tasks = gates.map((gate) =>
      queue.add(async () => {
        running += 1;
        peak = Math.max(peak, running);
        await gate.promise;
        running -= 1;
      })
    );

    await tick();
    expect(peak).toBe(2);
    gates.forEach((g) => g.resolve());
    await Promise.all(tasks);
    expect(peak).toBe(2);
  });

  it("runs higher priority tasks first", async () => {
    const queue = new MyPQueue({ concurrency: 1 });
    const order: string[] = [];
    const block = deferred<void>();

    // occupy the single slot so the rest queue up and get sorted
    const first = queue.add(async () => {
      await block.promise;
      order.push("blocker");
    });
    await tick();

    const low = queue.add(async () => void order.push("low"), { priority: 1, id: "low" });
    const high = queue.add(async () => void order.push("high"), { priority: 10, id: "high" });

    block.resolve();
    await Promise.all([first, low, high]);

    expect(order).toEqual(["blocker", "high", "low"]);
  });

  describe("deduplication by id", () => {
    it("returns the SAME promise for a duplicate id, running the work once", async () => {
      const queue = new MyPQueue({ concurrency: 1 });
      const task = vi.fn(async () => "value");
      const block = deferred<void>();

      const blocker = queue.add(async () => void (await block.promise), { id: "blocker" });
      await tick();

      const first = queue.add(task, { id: "same" });
      const second = queue.add(task, { id: "same" });

      expect(queue.size).toBe(1); // one queued entry, not two
      expect(first).toBe(second); // and the same promise handed to both callers

      block.resolve();
      await blocker;
      await expect(first).resolves.toBe("value");
      expect(task).toHaveBeenCalledTimes(1);
    });

    // Regression guard. `add` used to `return existingTask.task()` for a duplicate id,
    // which ran the queued work immediately — past the concurrency limit — and then
    // decremented `pending` in the wrapper's finally for a run that never incremented it.
    // `pending` drifted negative and the limit stopped holding from then on.
    it("does not run a duplicate ahead of the queue while the slot is occupied", async () => {
      const queue = new MyPQueue({ concurrency: 1 });
      let running = 0;
      const blocker = deferred<void>();
      const gate = deferred<void>();

      const held = queue.add(async () => void (await blocker.promise), { id: "blocker" });
      await tick();

      const body = async () => {
        running += 1;
        await gate.promise;
        running -= 1;
      };
      queue.add(body, { id: "dup" });
      queue.add(body, { id: "dup" });
      await tick();

      expect(running).toBe(0); // the only slot belongs to the blocker

      gate.resolve();
      blocker.resolve();
      await held;
    });

    it("still honours the concurrency limit after a duplicate was added", async () => {
      const queue = new MyPQueue({ concurrency: 1 });
      const blocker = deferred<void>();
      const gate = deferred<void>();

      const held = queue.add(async () => void (await blocker.promise), { id: "blocker" });
      await tick();
      queue.add(async () => void (await gate.promise), { id: "dup" });
      queue.add(async () => void (await gate.promise), { id: "dup" });
      gate.resolve();
      blocker.resolve();
      await held;
      await tick();

      let running = 0;
      let peak = 0;
      const g2 = deferred<void>();
      const body = async () => {
        running += 1;
        peak = Math.max(peak, running);
        await g2.promise;
        running -= 1;
      };
      const rest = ["a", "b", "c"].map((id) => queue.add(body, { id }));
      await tick();

      expect(peak).toBe(1);
      g2.resolve();
      await Promise.all(rest);
    });

    it("gives distinct ids to tasks added in the same millisecond", async () => {
      // the default id was `String(Date.now())`, so anything added within one millisecond
      // collided and every task after the first was silently dropped
      const queue = new MyPQueue({ concurrency: 10 });
      const task = vi.fn(async () => "value");

      await Promise.all([queue.add(task), queue.add(task), queue.add(task)]);

      expect(task).toHaveBeenCalledTimes(3);
    });
  });

  it("emits `empty` once the queue drains", async () => {
    const queue = new MyPQueue({ concurrency: 1 });
    const onEmpty = vi.fn();
    queue.on("empty", onEmpty);

    await queue.add(async () => "x");
    await tick();

    expect(onEmpty).toHaveBeenCalled();
  });

  it("stops notifying a listener that was removed", async () => {
    const queue = new MyPQueue();
    const onEmpty = vi.fn();
    queue.on("empty", onEmpty);
    queue.off("empty", onEmpty);

    await queue.add(async () => "x");
    await tick();

    expect(onEmpty).not.toHaveBeenCalled();
  });

  it("ignores off() for an event that was never subscribed", () => {
    const queue = new MyPQueue();
    expect(() => queue.off("nothing", () => {})).not.toThrow();
  });

  it("reports its pending size, and is never paused", async () => {
    const queue = new MyPQueue({ concurrency: 1 });
    const block = deferred<void>();
    const blocker = queue.add(async () => void (await block.promise));
    await tick();

    queue.add(async () => "queued", { id: "q" });
    expect(queue.size).toBe(1);
    expect(queue.isPaused).toBe(false);

    block.resolve();
    await blocker;
  });

  it("defaults to unbounded concurrency", async () => {
    const queue = new MyPQueue();
    let running = 0;
    let peak = 0;
    const gates = Array.from({ length: 5 }, () => deferred<void>());

    const tasks = gates.map((gate) =>
      queue.add(async () => {
        running += 1;
        peak = Math.max(peak, running);
        await gate.promise;
        running -= 1;
      })
    );

    await tick();
    expect(peak).toBe(5);
    gates.forEach((g) => g.resolve());
    await Promise.all(tasks);
  });
});
