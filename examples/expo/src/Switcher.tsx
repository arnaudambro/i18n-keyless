import { Pressable, Text, StyleSheet } from "react-native";
import { I18nKeylessText, useCurrentLanguage, setCurrentLanguage, type Lang } from "i18n-keyless-react";
import { SUPPORTED_LANGUAGES } from "./i18n";

export function Switcher() {
  const current = (useCurrentLanguage() ?? "fr") as Lang;
  return (
    <Pressable
      onPress={() => {
        const list = SUPPORTED_LANGUAGES as readonly Lang[];
        setCurrentLanguage(list[(list.indexOf(current) + 1) % list.length]);
      }}
    >
      <Text style={styles.switch}>
        <I18nKeylessText>Changer de langue</I18nKeylessText> ({current})
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  switch: {
    color: "#e8eaed",
    borderWidth: 1,
    borderColor: "#3a4a6b",
    backgroundColor: "#1d2536",
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 12,
    alignSelf: "flex-start",
  },
});
