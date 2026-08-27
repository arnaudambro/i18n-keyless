import 'package:flutter/widgets.dart';

import '../core/client.dart';

/// Bridges an [I18nKeylessClient] onto Flutter's [Listenable] so an
/// [InheritedNotifier] can rebuild dependents on every translation or language change.
class I18nKeylessNotifier extends ChangeNotifier {
  I18nKeylessNotifier(this.client) {
    client.addListener(_onChange);
  }

  final I18nKeylessClient client;

  void _onChange() => notifyListeners();

  @override
  void dispose() {
    client.removeListener(_onChange);
    super.dispose();
  }
}

/// The inherited widget that hands the client to the tree. Put an [I18nKeylessScope]
/// above your app; read the client anywhere below with [I18nKeyless.of].
class I18nKeyless extends InheritedNotifier<I18nKeylessNotifier> {
  const I18nKeyless({
    super.key,
    required I18nKeylessNotifier notifier,
    required super.child,
  }) : super(notifier: notifier);

  /// The client of the nearest [I18nKeylessScope]. The calling widget rebuilds when a
  /// translation lands or the language changes.
  static I18nKeylessClient of(BuildContext context) {
    final client = maybeOf(context);
    assert(
      client != null,
      'No I18nKeylessScope found above this widget. '
      'Wrap your app: I18nKeylessScope(client: i18n, child: MyApp()).',
    );
    return client!;
  }

  /// [of], or `null` when there is no [I18nKeylessScope] above.
  static I18nKeylessClient? maybeOf(BuildContext context) => context
      .dependOnInheritedWidgetOfExactType<I18nKeyless>()
      ?.notifier
      ?.client;
}

/// Wraps the app and makes [client] available to every [T] widget, to
/// `context.t(...)` and to [I18nKeyless.of].
///
/// ```dart
/// final i18n = I18nKeylessClient();
/// await i18n.init(I18nKeylessConfig(...));
/// runApp(I18nKeylessScope(client: i18n, child: const MyApp()));
/// ```
class I18nKeylessScope extends StatefulWidget {
  const I18nKeylessScope(
      {super.key, required this.client, required this.child});

  final I18nKeylessClient client;
  final Widget child;

  @override
  State<I18nKeylessScope> createState() => _I18nKeylessScopeState();
}

class _I18nKeylessScopeState extends State<I18nKeylessScope> {
  late I18nKeylessNotifier _notifier = I18nKeylessNotifier(widget.client);

  @override
  void didUpdateWidget(I18nKeylessScope oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.client != widget.client) {
      _notifier.dispose();
      _notifier = I18nKeylessNotifier(widget.client);
    }
  }

  @override
  void dispose() {
    _notifier.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) =>
      I18nKeyless(notifier: _notifier, child: widget.child);
}
