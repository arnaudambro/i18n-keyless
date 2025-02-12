
# i18n-keyless API Documentation

Welcome to **i18n-keyless**! 🚀 This package provides a seamless way to handle translations without the need for cumbersome key management. This README will guide you through the setup and usage of the library.

---

## 📜 **Table of Contents**

- [Installation](#installation)
- [Setup](#setup)
- [Usage](#usage)
- [Custom Component Example](#custom-component-example)
- [Contact](#contact)

---

## 🔧 **Installation**

Install the package via npm or yarn:

```bash
npm install i18n-keyless
```

or

```bash
yarn add i18n-keyless
```

---

## ⚙️ **Setup**

Here's a basic setup example to get started with i18n-keyless:

```javascript
import * as I18nKeyless from "i18n-keyless";
import MyCustomText from "./src/components/MyCustomText";
import myStorage from "./src/services/storage";

I18nKeyless.init({
  API_KEY: "<YOUR_API_KEY>",
  component: MyCustomText, // You can also use the basic React Native Text component
  storage: myStorage, // Example: MMKV, AsyncStorage, or any other storage solution
  languages: {
    primary: "fr", // Set the primary language ('fr' or 'en' available by default)
    supported: ["en", "fr"], // 15 languages supported; reach out if you need more
  },
});
```

---

## 🚀 **Usage**

### **Component Usage**

Use the `MyI18nText` component to wrap your text in any supported language:

```javascript
import { MyI18nText } from "i18n-keyless";

<MyI18nText>Je mets mon texte dans ma langue, finies les clés !</MyI18nText>
```

### **Hook Usage**

For translating text outside of components, use the `useI18nKeyless` hook:

```javascript
import { useI18nKeyless } from "i18n-keyless";

export default function Home() {
  const getTranslation = useI18nKeyless((state) => state.getTranslation);

  return (
    <HomeTabs.Navigator>
      <HomeTabs.Screen
        options={{ tabBarLabel: getTranslation("Welcome") }}
        name="WELCOME"
      />
    </HomeTabs.Navigator>
  );
}
```

---

## 🛠️ **Custom Component Example**

Create a custom text component for advanced text rendering needs:

```javascript
import { StyleProp, Text, TextProps, TextStyle } from "react-native";
import { colors } from "~/utils/colors";

interface MyTextProps {
  className?: string;
  style?: StyleProp<TextStyle>;
  children: string;
  color?: keyof typeof colors;
  textProps?: TextProps;
}

export default function MySimpleText({
  className,
  style = {},
  children,
  color = "app-white",
  textProps,
}: MyTextProps) {
  return (
    <Text
      className={["text-dark dark:text-white", className].join(" ")}
      style={[style, { color: color ? colors[color] : undefined }]}
      {...textProps}
    >
      {children}
    </Text>
  );
}
```

---

## 📬 **Contact**

Need help or have questions? Reach out to:

- **Twitter**: [@ambroselli_io](https://x.com/ambroselli_io)
- **Email**: [arnaud.ambroselli.io@gmail.com](mailto:arnaud.ambroselli.io@gmail.com)

---

© 2025 i18n-keyless
