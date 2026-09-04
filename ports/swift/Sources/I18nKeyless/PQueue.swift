import Foundation

/// A small priority queue with a concurrency limit, a port of the JavaScript `my-pqueue.ts`.
///
/// - Tasks run by descending priority; equal priorities keep insertion order.
/// - At most `concurrency` tasks run at once.
/// - Adding an id that is still waiting is a no-op: the work is never duplicated and
///   never bypasses the limit.
/// - `onEmpty` listeners fire every time the last running task finishes with nothing
///   waiting.
public final class PQueue: @unchecked Sendable {
    public typealias Task = @Sendable () async -> Void

    private struct Queued {
        let id: String
        let priority: Int
        let run: Task
    }

    public let concurrency: Int
    private let lock = NSLock()
    private var waiting: [Queued] = []
    private var pending = 0
    private var listeners: [(UUID, () -> Void)] = []

    public init(concurrency: Int = 30) {
        self.concurrency = concurrency
    }

    /// Tasks waiting for a slot.
    public var size: Int { lock.lock(); defer { lock.unlock() }; return waiting.count }

    /// Tasks running now.
    public var running: Int { lock.lock(); defer { lock.unlock() }; return pending }

    public var isIdle: Bool { lock.lock(); defer { lock.unlock() }; return waiting.isEmpty && pending == 0 }

    @discardableResult
    public func onEmpty(_ listener: @escaping () -> Void) -> UUID {
        let token = UUID()
        lock.lock(); listeners.append((token, listener)); lock.unlock()
        return token
    }

    public func offEmpty(_ token: UUID) {
        lock.lock(); listeners.removeAll { $0.0 == token }; lock.unlock()
    }

    /// Resumes the next time the queue becomes idle (at once when it already is).
    public func whenIdle() async {
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            let idleNow: Bool = lock.withLock {
                if waiting.isEmpty && pending == 0 { return true }
                let token = UUID()
                listeners.append((token, { [weak self] in
                    self?.offEmpty(token)
                    continuation.resume()
                }))
                return false
            }
            if idleNow { continuation.resume() }
        }
    }

    /// Queues `task`. Returns false when a task with the same id is still waiting.
    @discardableResult
    public func add(id: String, priority: Int = 0, _ task: @escaping Task) -> Bool {
        lock.lock()
        if waiting.contains(where: { $0.id == id }) {
            lock.unlock()
            return false
        }
        // Stable insertion: after every task of a priority >= this one.
        let index = waiting.lastIndex(where: { $0.priority >= priority }).map { $0 + 1 } ?? 0
        waiting.insert(Queued(id: id, priority: priority, run: task), at: index)
        lock.unlock()
        processNext()
        return true
    }

    private func processNext() {
        var toStart: [Queued] = []
        var fire: [() -> Void] = []
        lock.lock()
        while !waiting.isEmpty && pending < concurrency {
            toStart.append(waiting.removeFirst())
            pending += 1
        }
        if waiting.isEmpty && pending == 0 { fire = listeners.map(\.1) }
        lock.unlock()
        for queued in toStart {
            _Concurrency.Task { [weak self] in
                await queued.run()
                guard let self = self else { return }
                self.lock.withLock { self.pending -= 1 }
                self.processNext()
            }
        }
        for listener in fire { listener() }
    }
}

extension NSLock {
    func withLock<T>(_ body: () throws -> T) rethrows -> T {
        lock(); defer { unlock() }
        return try body()
    }
}
