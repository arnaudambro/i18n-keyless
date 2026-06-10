import { View, Text, StyleSheet } from "react-native";
import { Link } from "expo-router";
import { I18nKeylessText, useCurrentLanguage } from "i18n-keyless-react";
import { Switcher } from "../src/Switcher";

export default function Home() {
  const current = useCurrentLanguage();
  return (
    <View style={styles.screen}>
      <Switcher />
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
      <Link href="/about" style={styles.link}>
        <I18nKeylessText>À propos</I18nKeylessText>
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
