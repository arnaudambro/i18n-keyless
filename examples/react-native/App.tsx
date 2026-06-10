import { useState } from "react";
import { SafeAreaView, View, Text, Pressable, StyleSheet } from "react-native";
import {
  I18nKeylessText,
  getTranslation,
  useCurrentLanguage,
  setCurrentLanguage,
  type Lang,
} from "i18n-keyless-react";
import { initI18n, SUPPORTED_LANGUAGES } from "./src/i18n";

// In React Native, <I18nKeylessText> must live inside a <Text> (it renders a string).
initI18n();

export default function App() {
  const [page, setPage] = useState<"home" | "about">("home");
  const current = (useCurrentLanguage() ?? "fr") as Lang;

  return (
    <SafeAreaView style={styles.screen}>
      <Text style={styles.h1}>i18n-keyless · React Native</Text>

      <View style={styles.nav}>
        <Pressable onPress={() => setPage("home")}>
          <Text style={[styles.tab, page === "home" && styles.active]}>
            <I18nKeylessText>Accueil</I18nKeylessText>
          </Text>
        </Pressable>
        <Pressable onPress={() => setPage("about")}>
          <Text style={[styles.tab, page === "about" && styles.active]}>
            <I18nKeylessText>À propos</I18nKeylessText>
          </Text>
        </Pressable>
        <Pressable
          onPress={() => {
            const list = SUPPORTED_LANGUAGES as readonly Lang[];
            setCurrentLanguage(list[(list.indexOf(current) + 1) % list.length]);
          }}
        >
          <Text style={[styles.tab, styles.switch]}>
            <I18nKeylessText>Changer de langue</I18nKeylessText> ({current})
          </Text>
        </Pressable>
      </View>

      {page === "home" ? <Home /> : <About />}
    </SafeAreaView>
  );
}

function Home() {
  const current = useCurrentLanguage();
  return (
    <View style={styles.card}>
      <Text style={styles.bold}>
        <I18nKeylessText replace={{ "{{current_lang}}": current ?? "" }}>
          {`Langue : {{current_lang}}`}
        </I18nKeylessText>
      </Text>
      <Text style={styles.body}>
        <I18nKeylessText>
          Voici une phrase disponible dans toutes vos langues, vous pouvez la modifier si vous le
          souhaitez.
        </I18nKeylessText>
      </Text>
    </View>
  );
}

function About() {
  useCurrentLanguage();
  // The imperative getTranslation() function + the `context` option.
  const intro = getTranslation(
    "Ce texte est rendu avec la fonction getTranslation() au lieu du composant <T>."
  );
  const asTime = getTranslation("8 heures", { context: "heure" });
  const asDuration = getTranslation("8 heures", { context: "durée" });
  return (
    <View style={styles.card}>
      <Text style={styles.bold}>
        <I18nKeylessText>À propos de cette démo</I18nKeylessText>
      </Text>
      <Text style={styles.body}>{intro}</Text>
      <Text style={styles.body}>
        8 heures → {asTime} (heure) · {asDuration} (durée)
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#0f1115", padding: 20 },
  h1: { color: "#e8eaed", fontSize: 20, fontWeight: "600", marginBottom: 16 },
  nav: { flexDirection: "row", gap: 8, marginBottom: 16, flexWrap: "wrap" },
  tab: { color: "#e8eaed", borderWidth: 1, borderColor: "#2a2f3a", borderRadius: 8, paddingVertical: 6, paddingHorizontal: 12 },
  active: { borderColor: "#6c8cff", backgroundColor: "#1b2030" },
  switch: { borderColor: "#3a4a6b", backgroundColor: "#1d2536" },
  card: { borderWidth: 1, borderColor: "#232834", borderRadius: 12, padding: 16, backgroundColor: "#14171e", gap: 8 },
  bold: { color: "#e8eaed", fontWeight: "600" },
  body: { color: "#cfd3da" },
});
