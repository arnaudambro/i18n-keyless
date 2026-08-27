// A two-page app showing i18n_keyless: `T(...)`, `context.t(...)`, `context`,
// `replace` and a language switcher. Primary language is French.
//
// It runs offline against the mock backend of the repository:
//
//     node ../../../examples/_mock-server/server.mjs      # http://localhost:8787
//     flutter run
//
// On an Android emulator, localhost of the host machine is 10.0.2.2. To use the
// real service, set `apiUrl` to https://api.i18n-keyless.com and `apiKey` to yours.
import 'dart:io' show Platform;

import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/material.dart';
import 'package:i18n_keyless/i18n_keyless.dart';

const supportedLanguages = [Lang.fr, Lang.en, Lang.es];

String mockServerUrl() {
  if (!kIsWeb && Platform.isAndroid) return 'http://10.0.2.2:8787';
  return 'http://localhost:8787';
}

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final i18n = I18nKeylessClient();
  await i18n.init(I18nKeylessConfig(
    apiKey: 'demo',
    apiUrl: mockServerUrl(),
    languages: const LanguagesConfig(
      primary: Lang.fr,
      supported: supportedLanguages,
    ),
    storage: SharedPreferencesStorage(),
    debug: true,
  ));
  runApp(I18nKeylessScope(client: i18n, child: const ExampleApp()));
}

class ExampleApp extends StatelessWidget {
  const ExampleApp({super.key});

  @override
  Widget build(BuildContext context) => MaterialApp(
        title: 'i18n-keyless',
        theme: ThemeData(colorSchemeSeed: Colors.indigo, useMaterial3: true),
        home: const HomePage(),
      );
}

class HomePage extends StatefulWidget {
  const HomePage({super.key});

  @override
  State<HomePage> createState() => _HomePageState();
}

class _HomePageState extends State<HomePage> {
  var _page = 0;

  @override
  Widget build(BuildContext context) {
    final i18n = I18nKeyless.of(context);
    final current = i18n.currentLanguage;
    return Scaffold(
      appBar: AppBar(
        title: const Text('i18n-keyless · Flutter'),
        actions: [
          TextButton.icon(
            onPressed: () {
              final next = supportedLanguages[
                  (supportedLanguages.indexOf(current) + 1) %
                      supportedLanguages.length];
              i18n.setCurrentLanguage(next);
            },
            icon: const Icon(Icons.language),
            label: const T('Changer de langue'),
          ),
        ],
      ),
      body: Padding(
        padding: const EdgeInsets.all(24),
        child: _page == 0 ? const _Home() : const _About(),
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _page,
        onDestinationSelected: (index) => setState(() => _page = index),
        destinations: [
          NavigationDestination(
            icon: const Icon(Icons.home),
            label: context.t('Accueil'),
          ),
          NavigationDestination(
            icon: const Icon(Icons.info),
            label: context.t('À propos'),
          ),
        ],
      ),
    );
  }
}

class _Home extends StatelessWidget {
  const _Home();

  @override
  Widget build(BuildContext context) {
    final current = I18nKeyless.of(context).currentLanguage.code;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        T(
          'Langue : {{current_lang}}',
          replace: {'{{current_lang}}': current},
          style: Theme.of(context).textTheme.titleLarge,
        ),
        const SizedBox(height: 16),
        const T(
          'Voici une phrase disponible dans toutes vos langues, vous pouvez la '
          'modifier si vous le souhaitez.',
        ),
      ],
    );
  }
}

class _About extends StatelessWidget {
  const _About();

  @override
  Widget build(BuildContext context) {
    // The imperative `context.t()` plus the `context` option.
    final asTime = context.t('8 heures', context: 'heure');
    final asDuration = context.t('8 heures', context: 'durée');
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const T(
          'Ce texte est rendu avec la fonction getTranslation() au lieu du '
          'composant <T>.',
        ),
        const SizedBox(height: 16),
        Text('$asTime / $asDuration'),
      ],
    );
  }
}
