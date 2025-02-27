# i18n-keyless - Ultimate DX for i18n implementation. No key, use your natural language.

Welcome to **i18n-keyless**! 🚀 This package provides a seamless way to handle translations without the need for cumbersome key management. This README will guide you through the setup and usage of the library.

---

## 📜 **Table of Contents**

- [Installation](#installation)
- [Usage](#usage)
- [Setup](#setup-with-i18n-keyless-service)
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


## 🚀 **Usage**

### **Component Usage**

Use the `I18nText` component to wrap your text in any supported language:

```javascript
import { I18nText } from "i18n-keyless";

<I18nText>Je mets mon texte dans ma langue, finies les clés !</I18nText>
```

### **Methods**

For translating text outside of components, use the `getTranslation` method:

```javascript
import { getTranslation } from "i18n-keyless";

export default function Home() {
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

For setting a new current language, use the `setCurrentLanguage` method wherever you want:

```javascript
import { setCurrentLanguage } from "i18n-keyless";

setCurrentLanguage("en");
```

To retrieve the current language, use the `useCurrentLanguage` hook:

```javascript
import { useCurrentLanguage } from "i18n-keyless";

const currentLanguage = useCurrentLanguage();
```

---

## ⚙️ **Setup with [i18n-keyless service](https://i18n-keyless.com)**

Here's a basic setup example to get started with i18n-keyless:

```javascript
import * as I18nKeyless from "i18n-keyless";
import MyCustomText from "./src/components/MyCustomText";
import myStorage from "./src/services/storage";

I18nKeyless.init({
  API_KEY: "<YOUR_API_KEY>",
  storage: myStorage, // Example: MMKV, AsyncStorage, window.localStorage, or any other storage solution
  languages: {
    primary: "fr", // Set the primary language ('fr' or 'en' available by default)
    supported: ["fr", "en"], // this is what supports your app. But i18n-keyless allows also: nl,it,de,es,pl,pt,ro,sv,tr,ja,cn,ru,ko,ar. Reach out if you need more
  },
});
```

## ⚙️ **Setup with your own API**

### **Using `API_URL`**

To use your own API, you need to provide the `API_URL` in the `I18nKeyless.init` configuration. Your API must implement the following routes:

-   `GET /translate/:lang`: This route should return all translations for a given language.
    **Response format to GET /translate/en:**

    ```json
    {
        "ok": true,
        "data": {
            "translations": {
                "Bonjour le monde": "Hello world",
                "Bienvenue chez nous": "Welcome to our website",
                "Au revoir": "Goodbye"    
            }
        },
        "error": null,
        "message": "" // there would be a message if the key is not valid, or whatever
    }
    ```

-   `POST /translate`: This route should accept a body with the key to translate and return the translated text.
    **Request body:**

    ```json
    {
        "key": "Bonjour le monde",
        "languages": ["en","nl","it","de","es"],
        "primaryLanguage": "fr"
    }
    ```

    **Response format:**

    ```json
    {
        "ok": true,
        "message": "" // there would be a message if the key is not valid, or whatever
    }
    ```

Here's how to configure `i18n-keyless` with your `API_URL`:

```javascript
import * as I18nKeyless from "i18n-keyless";
import myStorage from "./src/services/storage";

I18nKeyless.init({
    API_URL: "https://your-api.com",
    storage: myStorage,
    languages: {
        primary: "fr",
        supported: ["en", "fr"],
    },
});
```

### **Using `handleTranslate` and `getAllTranslations`**

Alternatively, you can provide custom functions to handle the translation and retrieval of all translations. This is useful if you want to integrate with an existing translation service or database.

```javascript
import * as I18nKeyless from "i18n-keyless";
import MyCustomText from "./src/components/MyCustomText";
import myStorage from "./src/services/storage";

async function handleTranslate(key: string) {
    // Your custom logic to translate the key
}

async function getAllTranslations() {
    // Your custom logic to fetch all translations
    // return all translations for all languages
    return {
        "ok": true,
        "data": {
            "translations": {
                "Bonjour le monde": "Hello world",
            }
        }
    }
}

I18nKeyless.init({
    storage: myStorage,
    languages: {
        primary: "fr",
        supported: ["en", "fr"],
    },
    handleTranslate: handleTranslate,
    getAllTranslations: getAllTranslations
});
```

---

## 🛠️ **Custom Component Example**

Create a custom text component for advanced text rendering needs. I strongly advise to use a custom component, even the simplest `p` or `Text` component

```javascript
import { StyleProp, Text, TextProps, TextStyle } from "react-native";
import { I18nText } from "i18n-keyless-react";
import { colors } from "~/utils/colors";

interface MyTextProps {
  className?: string;
  style?: StyleProp<TextStyle>;
  children: string;
  color?: keyof typeof colors;
  textProps?: TextProps;
}

export default function MyText({
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
      <I18nText>{children}</I18nText>
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
