import { View, Text, StyleSheet } from "react-native";
import { Link } from "expo-router";
import { I18nKeylessText, getTranslation, useCurrentLanguage } from "i18n-keyless-react";
import { Switcher } from "../src/Switcher";

export default function About() {
  useCurrentLanguage();
  const intro = getTranslation(
    "Ce texte est rendu avec la fonction getTranslation() au lieu du composant <T>."
  );
  const asTime = getTranslation("8 heures", { context: "heure" });
  const asDuration = getTranslation("8 heures", { context: "durée" });
  return (
    <View style={styles.screen}>
      <Switcher />
      <Text style={styles.bold}>
        <I18nKeylessText>À propos de cette démo</I18nKeylessText>
      </Text>
      <Text style={styles.body}>{intro}</Text>
      <Text style={styles.body}>
        8 heures → {asTime} (heure) · {asDuration} (durée)
      </Text>
      <Link href="/" style={styles.link}>
        <I18nKeylessText>Accueil</I18nKeylessText>
      </Link>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 20, gap: 12 },
  bold: { color: "#e8eaed", fontWeight: "600" },
  body: { color: "#cfd3da" },
  link: { color: "#6c8cff", marginTop: 8 },
});
