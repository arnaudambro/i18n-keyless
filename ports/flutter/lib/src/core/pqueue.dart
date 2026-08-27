import 'dart:async';

/// A task the queue runs.
typedef QueueTask<T> = Future<T> Function();

class _QueuedTask {
  _QueuedTask({
    required this.run,
    required this.priority,
    required this.id,
    required this.future,
  });

  final Future<void> Function() run;
  final int priority;
  final String id;

  /// The future handed to every caller that adds this id while it is still waiting.
  final Future<dynamic> future;
}

/// A small priority queue with a concurrency limit, a port of the JavaScript
/// `my-pqueue.ts`.
///
/// - Tasks run by descending [priority]; equal priorities keep insertion order.
/// - At most [concurrency] tasks run at once.
/// - Adding an [id] that is still waiting returns the future of the waiting task: the
///   work is never duplicated and never bypasses the limit.
/// - [onEmpty] fires every time the last running task finishes with nothing waiting.
class PQueue {
  PQueue({this.concurrency = 30});

  final int concurrency;
  final List<_QueuedTask> _queue = [];
  final List<void Function()> _emptyListeners = [];
  int _pending = 0;
  int _nextId = 0;
  bool _processing = false;

  /// Tasks waiting for a slot.
  int get size => _queue.length;

  /// Tasks running now.
  int get pending => _pending;

  bool get isIdle => _queue.isEmpty && _pending == 0;

  void onEmpty(void Function() listener) => _emptyListeners.add(listener);

  void offEmpty(void Function() listener) => _emptyListeners.remove(listener);

  /// Completes the next time the queue becomes idle (at once when it already is).
  Future<void> whenIdle() {
    if (isIdle) return Future.value();
    final completer = Completer<void>();
    late void Function() listener;
    listener = () {
      offEmpty(listener);
      completer.complete();
    };
    onEmpty(listener);
    return completer.future;
  }

  Future<T> add<T>(QueueTask<T> task, {int priority = 0, String? id}) {
    final taskId = id ?? 'task-${_nextId++}';

    // Same id, still waiting its turn: hand back the future it will settle with.
    for (final existing in _queue) {
      if (existing.id == taskId) return existing.future as Future<T>;
    }

    final completer = Completer<T>();
    Future<void> run() async {
      try {
        completer.complete(await task());
      } catch (error, stack) {
        completer.completeError(error, stack);
      } finally {
        _pending--;
        _processNext();
      }
    }

    _queue.add(_QueuedTask(
      run: run,
      priority: priority,
      id: taskId,
      future: completer.future,
    ));
    // Stable sort: equal priorities keep their insertion order.
    _stableSortByPriority();
    _processNext();
    return completer.future;
  }

  void _stableSortByPriority() {
    // List.sort is not guaranteed stable; an insertion sort on a short list is.
    for (var i = 1; i < _queue.length; i++) {
      final item = _queue[i];
      var j = i - 1;
      while (j >= 0 && _queue[j].priority < item.priority) {
        _queue[j + 1] = _queue[j];
        j--;
      }
      _queue[j + 1] = item;
    }
  }

  void _processNext() {
    if (_processing) return;
    _processing = true;
    while (_queue.isNotEmpty && _pending < concurrency) {
      final next = _queue.removeAt(0);
      _pending++;
      // The completer already carries the error to the caller; nothing to do here.
      unawaited(next.run());
    }
    _processing = false;
    if (_queue.isEmpty && _pending == 0) {
      for (final listener in List.of(_emptyListeners)) {
        listener();
      }
    }
  }
}
