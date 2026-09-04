package io.i18nkeyless

import java.util.concurrent.CompletableFuture
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.Executor
import java.util.concurrent.Executors
import java.util.concurrent.ThreadFactory
import java.util.concurrent.atomic.AtomicInteger

/**
 * A cached pool of daemon threads: the queue must never keep a process alive, and the
 * concurrency limit lives in the queue, not in the pool.
 */
internal fun daemonExecutor(name: String): Executor {
    val counter = AtomicInteger()
    val factory = ThreadFactory { runnable ->
        Thread(runnable, "$name-${counter.incrementAndGet()}").apply { isDaemon = true }
    }
    return Executors.newCachedThreadPool(factory)
}

/**
 * A small priority queue with a concurrency limit, a port of the JavaScript
 * `my-pqueue.ts` onto threads.
 *
 * - Tasks run by descending priority; equal priorities keep insertion order.
 * - At most [concurrency] tasks run at once.
 * - Adding an [id] that is still waiting returns the future of the waiting task: the work
 *   is never duplicated and never bypasses the limit.
 * - [onEmpty] listeners fire every time the last running task finishes with nothing
 *   waiting, on the thread of that task, outside the queue's lock.
 */
class PQueue(val concurrency: Int = 30, private val executor: Executor = daemonExecutor("i18n-keyless-queue")) {
    private class Task(val id: String, val priority: Int, val run: () -> Unit, val future: CompletableFuture<Unit>)

    private val lock = Any()
    private val waiting = ArrayList<Task>()
    private val emptyListeners = CopyOnWriteArrayList<() -> Unit>()
    private val idleFutures = ArrayList<CompletableFuture<Unit>>()
    private var pending = 0
    private var firingEmpty = false
    private var nextId = 0

    /** Tasks waiting for a slot. */
    val size: Int get() = synchronized(lock) { waiting.size }

    /** Tasks running now. */
    val pendingCount: Int get() = synchronized(lock) { pending }

    /** Nothing waiting, nothing running, and the `empty` listeners have returned. */
    val isIdle: Boolean get() = synchronized(lock) { waiting.isEmpty() && pending == 0 && !firingEmpty }

    fun onEmpty(listener: () -> Unit) {
        emptyListeners.add(listener)
    }

    fun offEmpty(listener: () -> Unit) {
        emptyListeners.remove(listener)
    }

    /** Completes the next time the queue becomes idle (at once when it already is). */
    fun whenIdle(): CompletableFuture<Unit> = synchronized(lock) {
        if (waiting.isEmpty() && pending == 0 && !firingEmpty) return CompletableFuture.completedFuture(Unit)
        CompletableFuture<Unit>().also { idleFutures.add(it) }
    }

    fun add(priority: Int = 0, id: String? = null, task: () -> Unit): CompletableFuture<Unit> {
        val toStart: List<Task>
        val future: CompletableFuture<Unit>
        synchronized(lock) {
            val taskId = id ?: "task-${nextId++}"
            // Same id, still waiting its turn: hand back the future it will settle with.
            waiting.firstOrNull { it.id == taskId }?.let { return it.future }
            future = CompletableFuture()
            // Insertion sort keeps equal priorities in insertion order.
            val entry = Task(taskId, priority, task, future)
            var position = waiting.size
            while (position > 0 && waiting[position - 1].priority < priority) position--
            waiting.add(position, entry)
            toStart = takeRunnable()
        }
        toStart.forEach(::launch)
        return future
    }

    /** Under the lock: moves as many waiting tasks as the limit allows into `pending`. */
    private fun takeRunnable(): List<Task> {
        val started = ArrayList<Task>()
        while (waiting.isNotEmpty() && pending < concurrency) {
            started.add(waiting.removeAt(0))
            pending++
        }
        return started
    }

    private fun launch(task: Task) {
        executor.execute {
            try {
                task.run()
                task.future.complete(Unit)
            } catch (error: Throwable) {
                task.future.completeExceptionally(error)
            } finally {
                settle()
            }
        }
    }

    private fun settle() {
        val toStart: List<Task>
        val fireEmpty: Boolean
        synchronized(lock) {
            pending--
            toStart = takeRunnable()
            fireEmpty = waiting.isEmpty() && pending == 0
            if (fireEmpty) firingEmpty = true
        }
        toStart.forEach(::launch)
        if (!fireEmpty) return
        // Listeners run outside the lock: they call back into the client, which holds its
        // own lock while it calls `add`. Holding ours here would be a lock-order inversion.
        try {
            for (listener in emptyListeners) listener()
        } finally {
            val toComplete: List<CompletableFuture<Unit>>
            synchronized(lock) {
                firingEmpty = false
                toComplete = ArrayList(idleFutures)
                idleFutures.clear()
            }
            toComplete.forEach { it.complete(Unit) }
        }
    }
}
