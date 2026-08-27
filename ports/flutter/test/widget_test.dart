import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:i18n_keyless/i18n_keyless.dart';

/// `GET /translate/:lang` answers the dictionary; everything else answers ok.
http.Client fakeServer(Map<String, Map<String, String>> dictionaries) =>
    MockClient((request) async {
      final path = request.url.path;
      if (request.method == 'GET' && path.startsWith('/translate/')) {
        final lang = path.substring('/translate/'.length);
        return http.Response(
          jsonEncode({
            'ok': true,
            'data': {
              'translations': dictionaries[lang] ?? {},
              'uniqueId': null,
              'lastRefresh': '1',
            },
            'error': '',
            'message': '',
          }),
          200,
          headers: {'content-type': 'application/json'},
        );
      }
      return http.Response(
        jsonEncode({'ok': true, 'data': {}, 'error': '', 'message': ''}),
        200,
        headers: {'content-type': 'application/json'},
      );
    });

Future<I18nKeylessClient> bootClient(
  WidgetTester tester,
  Map<String, Map<String, String>> dictionaries, {
  Lang initWithDefault = Lang.en,
}) async {
  final client = I18nKeylessClient();
  await tester.runAsync(() => client.init(I18nKeylessConfig(
        apiKey: 'test-key',
        apiUrl: 'https://api.test',
        languages: LanguagesConfig(
          primary: Lang.fr,
          supported: const [Lang.fr, Lang.en, Lang.es],
          initWithDefault: initWithDefault,
        ),
        httpClient: fakeServer(dictionaries),
        logger: (_) {},
      )));
  return client;
}

Widget app(I18nKeylessClient client, Widget home) =>
    I18nKeylessScope(client: client, child: MaterialApp(home: home));

void main() {
  testWidgets('T shows the source text, then the translation when it lands',
      (tester) async {
    final client = I18nKeylessClient();
    // Before init has landed, the source text renders and nothing throws.
    await tester.pumpWidget(app(client, const Scaffold(body: T('Bonjour'))));
    expect(find.text('Bonjour'), findsOneWidget);

    await tester.runAsync(() async {
      await client.init(I18nKeylessConfig(
        apiKey: 'test-key',
        apiUrl: 'https://api.test',
        languages: const LanguagesConfig(
          primary: Lang.fr,
          supported: [Lang.fr, Lang.en],
          initWithDefault: Lang.en,
        ),
        httpClient: fakeServer({
          'en': {'Bonjour': 'Hello'},
        }),
        logger: (_) {},
      ));
      await client.waitForIdle();
    });
    await tester.pump();
    expect(find.text('Hello'), findsOneWidget);
    expect(find.text('Bonjour'), findsNothing);
  });

  testWidgets('T passes the Text parameters and applies replace and context',
      (tester) async {
    final client = await bootClient(tester, {
      'en': {
        'Bonjour {name}': 'Hello {name}',
        '8 heures__durée': '8 hours',
      },
    });
    await tester.runAsync(() => client.waitForIdle());
    await tester.pumpWidget(app(
      client,
      const Scaffold(
        body: Column(children: [
          T(
            'Bonjour {name}',
            replace: {'{name}': 'Ana'},
            style: TextStyle(fontSize: 30),
            maxLines: 1,
            textAlign: TextAlign.center,
          ),
          T('8 heures', context: 'durée'),
        ]),
      ),
    ));
    expect(find.text('Hello Ana'), findsOneWidget);
    expect(find.text('8 hours'), findsOneWidget);
    final text = tester.widget<Text>(find.text('Hello Ana'));
    expect(text.style?.fontSize, 30);
    expect(text.maxLines, 1);
    expect(text.textAlign, TextAlign.center);
  });

  testWidgets('a language change re-renders every T', (tester) async {
    final client = await bootClient(tester, {
      'en': {'Bonjour': 'Hello', 'Au revoir': 'Goodbye'},
      'es': {'Bonjour': 'Hola', 'Au revoir': 'Adiós'},
    });
    await tester.runAsync(() => client.waitForIdle());
    await tester.pumpWidget(app(
      client,
      const Scaffold(body: Column(children: [T('Bonjour'), T('Au revoir')])),
    ));
    expect(find.text('Hello'), findsOneWidget);
    expect(find.text('Goodbye'), findsOneWidget);

    await tester.runAsync(() => client.setCurrentLanguage(Lang.es));
    await tester.pump();
    expect(find.text('Hola'), findsOneWidget);
    expect(find.text('Adiós'), findsOneWidget);

    await tester.runAsync(() => client.setCurrentLanguage(Lang.fr));
    await tester.pump();
    expect(find.text('Bonjour'), findsOneWidget);
    expect(find.text('Au revoir'), findsOneWidget);
  });

  testWidgets('context.t translates and follows the language', (tester) async {
    final client = await bootClient(tester, {
      'en': {'Votre email': 'Your email'},
    });
    await tester.runAsync(() => client.waitForIdle());
    await tester.pumpWidget(app(
      client,
      Scaffold(
        body: Builder(
          builder: (context) => Column(children: [
            Text(context.t('Votre email')),
            TextButton(
              onPressed: () => context.i18n.setCurrentLanguage(Lang.fr),
              child: Text(context.i18n.currentLanguage.code),
            ),
          ]),
        ),
      ),
    ));
    expect(find.text('Your email'), findsOneWidget);
    expect(find.text('en'), findsOneWidget);
    await tester.tap(find.text('en'));
    await tester.pump();
    expect(find.text('Votre email'), findsOneWidget);
    expect(find.text('fr'), findsOneWidget);
  });

  testWidgets('the source text is trimmed before it becomes the key',
      (tester) async {
    final client = await bootClient(tester, {
      'en': {'Bonjour': 'Hello'},
    });
    await tester.runAsync(() => client.waitForIdle());
    await tester
        .pumpWidget(app(client, const Scaffold(body: T('  Bonjour \n'))));
    expect(find.text('Hello'), findsOneWidget);
  });

  testWidgets('I18nKeyless.of throws a clear error without a scope',
      (tester) async {
    await tester.pumpWidget(const MaterialApp(home: T('Bonjour')));
    expect(tester.takeException(), isAssertionError);
  });

  testWidgets('I18nKeyless.maybeOf is null without a scope', (tester) async {
    I18nKeylessClient? found;
    await tester.pumpWidget(MaterialApp(
      home: Builder(builder: (context) {
        found = I18nKeyless.maybeOf(context);
        return const SizedBox();
      }),
    ));
    expect(found, isNull);
  });

  testWidgets('a scope handed a new client follows it and lets the old one go',
      (tester) async {
    final first = await bootClient(tester, {
      'en': {'Bonjour': 'Hello'},
      'es': {'Bonjour': 'Hola'},
    });
    final second = await bootClient(tester, {
      'en': {'Bonjour': 'Hi'},
    });
    await tester.runAsync(() async {
      await first.waitForIdle();
      await second.waitForIdle();
    });
    // A non-const T: the constructor itself runs at least once in the suite.
    final key = ValueKey(first.currentLanguage);
    await tester.pumpWidget(app(first, Scaffold(body: T('Bonjour', key: key))));
    expect(find.text('Hello'), findsOneWidget);
    expect(find.byKey(key), findsOneWidget);

    await tester.pumpWidget(app(second, const Scaffold(body: T('Bonjour'))));
    expect(find.text('Hi'), findsOneWidget);

    // The old client no longer drives the tree: its change is not rendered.
    await tester.runAsync(() => first.setCurrentLanguage(Lang.es));
    await tester.pump();
    expect(find.text('Hi'), findsOneWidget);
    expect(find.text('Hola'), findsNothing);

    // The new one does.
    await tester.runAsync(() => second.setCurrentLanguage(Lang.fr));
    await tester.pump();
    expect(find.text('Bonjour'), findsOneWidget);

    // Unmounting the scope detaches the notifier; a later change is harmless.
    await tester.pumpWidget(const SizedBox());
    await tester.runAsync(() => second.setCurrentLanguage(Lang.en));
    expect(tester.takeException(), isNull);
  });
}
