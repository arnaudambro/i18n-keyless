# i18n-keyless - Ultimate DX for i18n implementation. No key, use your natural language.

Welcome to **i18n-keyless**! 🚀 This package provides a seamless way to handle translations without the need for cumbersome key management. This README will guide you through the setup and usage of the library.

---

## 📜 **Table of Contents**

- [How it works](#-how-it-works)
- [Installation](#-installation)
- [Usage](#-usage)
  - [React](#-react-usage-i18n-keyless-react)
  - [Node](#-node-usage-i18n-keyless-node)
- [Setup](#️-setup-with-i18n-keyless-service)
- [Custom Component Example](#️-custom-component-example)
- [What pains does it solve?](#-what-pains-does-it-solve)
- [Contact](#-contact)

---

## 😎 **How it works**

First, you should read the [What pains does it solve?](#-what-pains-does-it-solve) section to understand the pains you have with the current i18n solutions.

i18n-keyless is a library, combined with an API service (I [provide one](https://i18n-keyless.com), but [you can use your own](#%EF%B8%8F-setup-with-your-own-api)) that allows you to translate your text without the need to use keys.

By calling `I18nKeyless.init` you [initialize](#%EF%B8%8F-setup-with-i18n-keyless-service) an object that will be used to translate your text.
If your primary language is `en` and the user's language is `fr`, the object would look like this:

```javascript
{
   "Hello!": "Bonjour !",
   "Welcome to our website": "Bienvenue sur notre site web",
   ...
}
```

If the user's language is `en`, i18n-keyless won't use such an object and will use the default translations.

If the translation is not found, there will be an asynchronous fetch to I18nKeyless' API (or your own if you prefer) to get the translation by an AI API call.
Then the translation is returned and stored in the object.
This operation is only made once ever per key, for all the users all over the world.
The operation can be made in dev mode if you encounter that key, but it can also be made in production if the key is dynamic.

At the first opening of the app ever in a new language, there is an API call to the server where all your translations are stored.
Then it stores all those translations in the object and the storage you provide (localStorage, AsyncStorage, MMKV, etc.).
No translations are stored in the app initially.

At each opening of the app, the newest translations are fetched from the storage and the object is updated.

## 🔧 **Installation**

### **React Installation**

Install the package via npm or yarn:

```bash
npm install i18n-keyless-react
```

### **Node Installation**

Install the package via npm or yarn:

```bash
npm install i18n-keyless-node
```

---

## ⚡ **Quick Start**

Get up and running in minutes!

### **React Quick Start**

1.  **Install:**
    ```bash
    npm install i18n-keyless-react
    ```

2.  **Initialize:** Call `init` once at the root of your app (e.g., `App.js` or `index.js`).
    ```javascript
    import { init } from "i18n-keyless-react";
    import myStorage from "./src/services/storage"; // Use your preferred storage solution

    init({
      API_KEY: "<YOUR_API_KEY>", // Get your key from i18n-keyless.com
      storage: myStorage, 
      languages: {
        primary: "en", // Your app's primary language
        supported: ["en", "fr", "es"], // Languages your app supports
      },
    });
    ```
    *Note: You'll need an `API_KEY` from [i18n-keyless.com](https://i18n-keyless.com) or configure your [own API](#️-setup-with-your-own-api).*

3.  **Use:** Wrap text with the `I18nKeylessText` component.
    ```javascript
    import { I18nKeylessText } from "i18n-keyless-react";
    import { setCurrentLanguage } from "i18n-keyless-react"; // Optional: for changing language

    // Example Component
    function MyComponent() {
      return (
        <div>
          <button onClick={() => setCurrentLanguage("fr")}>Set FR</button>
          <button onClick={() => setCurrentLanguage("es")}>Set ES</button>
          <h1>
            <I18nKeylessText>Welcome to our app!</I18nKeylessText>
          </h1>
          <p>
            <I18nKeylessText>This text will be automatically translated.</I18nKeylessText>
          </p>
          {/* Example with context for disambiguation */}
          <button>
            <I18nKeylessText context="this is a back button">Back</I18nKeylessText>
          </button>
        </div>
      );
    }
    ```

### **Node Quick Start**

1.  **Install:**
    ```bash
    npm install i18n-keyless-node
    ```

2.  **Initialize:** Call `init` at the start of your application.
    ```javascript
    import { init } from "i18n-keyless-node";

    (async () => {
      await init({
        API_KEY: "<YOUR_API_KEY>", // Get your key from i18n-keyless.com
        languages: {
          primary: "en", // Your primary language
          supported: ["en", "fr", "es"], // Languages you need translations for
        },
      });
      console.log("i18n-keyless initialized!");
    })();
    ```
     *Note: You'll need an `API_KEY` from [i18n-keyless.com](https://i18n-keyless.com) or configure your [own API](#️-setup-with-your-own-api).*

3.  **Use:** Use `awaitForTranslation` to fetch and retrieve translations.



    ```javascript
    import { awaitForTranslation } from "i18n-keyless-node";

    // Assuming init has completed
    (async () => {
      // Fetch and get the French translation for "Hello world"
      const greeting = await awaitForTranslation("Hello world", "fr"); // Target language 'fr'
      console.log(greeting); // Output: "Bonjour le monde" (or similar)

      // Fetch and get the Spanish translation for "Processing complete."
      const message = await awaitForTranslation("Processing complete.", "es"); // Target language 'es'
      console.log(message); // Output: "Procesamiento completo." (or similar)

      // Example with context
      const backButtonText = await awaitForTranslation("Back", "es", { context: "this is a back button" });
      console.log(backButtonText); // Output: Spanish translation for "Back" (e.g., "Atrás")

      // ⚠️ IMPORTANT: Always await translations to avoid API rate limiting
      // Bad - could get rate limited:
      awaitForTranslation("Hello", "fr");
      awaitForTranslation("World", "fr");
      
      // Good - await each translation:
      await awaitForTranslation("Hello", "fr");
      await awaitForTranslation("World", "fr");
      
      // Even better - await in parallel if possible:
      await Promise.all([
        awaitForTranslation("Hello", "fr"),
        awaitForTranslation("World", "fr") 
      ]);

    })();
    ```

---

## 🚀 **React Usage (i18n-keyless-react)**

### **Component Usage**

Use the `I18nKeylessText` component to wrap your text in any supported language:

```javascript
import { I18nKeylessText } from "i18n-keyless-react";

<I18nKeylessText>Je mets mon texte dans ma langue, finies les clés !</I18nKeylessText>
```

### **Dynamic Text Replacement**

For text with dynamic content, use the `I18nKeylessTextWithReplacement` component:

```javascript
import { I18nKeylessTextWithReplacement } from "i18n-keyless-react";

// Replace specific text patterns with dynamic values
<I18nKeylessTextWithReplacement 
  replace={{
    "{name}": user.name,
    "{date}": formattedDate
  }}
>
  Bonjour {name}, votre rendez-vous est confirmé pour le {date}
</I18nKeylessTextWithReplacement>

// This will first translate the entire text, then replace the placeholders with their respective values. It's perfect for dynamic content like usernames, dates, or counts.
```

### **React Hooks and Methods**

For translating text outside of components, use the `getTranslation` method:

```javascript
import { getTranslation } from "i18n-keyless-react";

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
import { setCurrentLanguage } from "i18n-keyless-react";

setCurrentLanguage("en");
```

To retrieve the current language, use the `useCurrentLanguage` hook:

```javascript
import { useCurrentLanguage } from "i18n-keyless-react";

const currentLanguage = useCurrentLanguage();
```

### **Storage Management**

Clear the i18n-keyless storage:

```javascript
import { clearI18nKeylessStorage } from "i18n-keyless-react";

// Clear all translations from storage
clearI18nKeylessStorage();
```

## 🚀 **Node Usage (i18n-keyless-node)**

### **Initialization**

Initialize the i18n system with your configuration (usually done once at startup):

```javascript
import { init } from "i18n-keyless-node";

await init({
  API_KEY: "<YOUR_API_KEY>",
  languages: {
    primary: "fr",
    supported: ["fr", "en"]
  }
});
```

### **Translation Methods**

#### `awaitForTranslation` (Asynchronous - **MANDATORY AWAIT**)

Use `awaitForTranslation` to retrieve a translation, automatically fetching it from the backend via API or custom handler if it's missing locally. 

**🚨 CRITICAL NODE.JS USAGE NOTE 🚨**

**You MUST `await` the `awaitForTranslation` function call within a `try...catch` block, or chain a `.catch()` handler to the returned promise.**

Failure to do so is **not optional**. If the underlying translation process encounters an error (network issue, API error, etc.) and the promise rejects, **the unhandled rejection WILL cause a fatal error and CRASH your Node.js application.** This is by design to prevent silent failures in a server environment.

**Strongly Recommended:** Enable the `@typescript-eslint/no-floating-promises` lint rule in your project to detect unhandled promises during development.

```javascript
import { awaitForTranslation } from "i18n-keyless-node";

// --- CORRECT USAGE (Mandatory) ---
async function getGreetingSafe(name: string, lang: string): Promise<string> {
  try {
    // ALWAYS await inside try/catch
    const greetingTemplate = await awaitForTranslation("Hello {user}", lang, { context: "polite_greeting" });
    return greetingTemplate.replace("{user}", name);
  } catch (error) {
    console.error(`FATAL: Failed to get greeting translation for lang ${lang}:`, error);
    // Return a fallback or re-throw a specific application error
    return `Hello ${name}`; // Fallback
  }
}

// Alternative: Using .catch() (Less common in async/await contexts)
awaitForTranslation("Processing complete.", "es")
  .then(message => {
    console.log(message); // Output: "Procesamiento completo."
  })
  .catch(error => {
    console.error("FATAL: Failed to get processing message:", error);
    // Handle error, maybe use fallback text
  });

// --- INCORRECT USAGE (Will crash on error) ---
// DO NOT DO THIS:
// awaitForTranslation("This will crash if it rejects!", "de");

// ALSO DO NOT DO THIS (assigning promise without handling rejection):
// const promise = awaitForTranslation("This also crashes if it rejects!", "it");

```

### **Managing Translations**

Fetch all translations for all supported languages:

```javascript
import { getAllTranslationsForAllLanguages } from "i18n-keyless-node";

// Fetch and update translation store with latest translations
const response = await getAllTranslationsForAllLanguages(store);
if (response?.ok) {
  // Handle successful translation update
  console.log("Translations updated successfully");
}
```

---

## ⚙️ **Setup Options**

While the Quick Start uses the [i18n-keyless service](https://i18n-keyless.com) via `API_KEY`, you have other options:

### **Using the i18n-keyless Service (Default)**

This is the easiest way to get started. Provide your `API_KEY` during initialization as shown in the Quick Start guides.

*(React Setup Example - Covered in Quick Start)*

*(Node Setup Example - Covered in Quick Start)*

### **Using your own API**

If you prefer to host your own translation backend, you can configure `i18n-keyless` to point to your API endpoints.

#### **Using `API_URL`**

To use your own API, you need to provide the `API_URL` in the init configuration. Your API must implement the following routes:

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
        "message": "", // there would be a message if the key is not valid, or whatever
        "data": { "translation": { "fr": "Bonjour tout le monde", "en": "Hello world" } }
    }
    ```

Here's how to configure with your `API_URL`:

```javascript
// For React
import { init } from "i18n-keyless-react";
import myStorage from "./src/services/storage";

init({
    API_URL: "https://your-api.com",
    storage: myStorage,
    languages: {
        primary: "fr",
        supported: ["en", "fr"],
    },
});

// For Node.js
import { init } from "i18n-keyless-node";

await init({
    API_URL: "https://your-api.com",
    languages: {
        primary: "fr",
        supported: ["en", "fr"],
    },
});
```

#### **Using Custom Handlers**

Alternatively, you can provide custom functions to handle the translation and retrieval of all translations:

```javascript
// For React
import { init } from "i18n-keyless-react";
import myStorage from "./src/services/storage";

async function handleTranslate(key, languages, primaryLanguage) {
    // Your custom logic to translate the key
    return { ok: true, message: "" };
}

async function getAllTranslations(lang) {
    // Your custom logic to fetch all translations for a specific language
    return {
        ok: true,
        data: {
            translations: {
                "Bonjour le monde": "Hello world",
            }
        }
    };
}

init({
    storage: myStorage,
    languages: {
        primary: "fr",
        supported: ["en", "fr"],
    },
    handleTranslate: handleTranslate,
    getAllTranslations: getAllTranslations
});

// For Node.js
import { init } from "i18n-keyless-node";

async function handleTranslate(key, languages, primaryLanguage) {
    // Your custom logic to translate the key
    return { ok: true, message: "" };
}

async function getAllTranslationsForAllLanguages() {
    // Your custom logic to fetch translations for all languages
    return {
        ok: true,
        data: {
            translations: {
                en: {
                    "Bonjour le monde": "Hello world"
                },
                fr: {}
            }
        }
    };
}

await init({
    languages: {
        primary: "fr",
        supported: ["en", "fr"],
    },
    handleTranslate: handleTranslate,
    getAllTranslationsForAllLanguages: getAllTranslationsForAllLanguages
});
```

---

## 🛠️ **Custom Component Example (React)**

For better integration and consistency, wrap `I18nKeylessText` within your own custom text component:

```javascript
import { StyleProp, Text, TextProps, TextStyle } from "react-native";
import { I18nKeylessText, type I18nKeylessTextProps } from "i18n-keyless-react";
import { colors } from "~/utils/colors";

interface MyTextProps {
  className?: string;
  style?: StyleProp<TextStyle>;
  color?: keyof typeof colors;
  textProps?: TextProps;
  skipTranslation?: boolean;
  children: I18nKeylessTextProps["children"];
  debug?: I18nKeylessTextProps["debug"];
  context?: I18nKeylessTextProps["context"];
  replace?: I18nKeylessTextProps["replace"];
  forceTemporary?: I18nKeylessTextProps["forceTemporary"];
}

export default function MyText({
  className,
  style = {},
  children,
  color = "app-white",
  textProps,
  skipTranslation = false,
  debug = false,
  context,
  replace,
  forceTemporary,
}: MyTextProps) {
  if (skipTranslation) {
    if (debug) {
      console.log("skipTranslation", children);
    }
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
  if (debug) {
    console.log("children translated", children);
  }
  return (
    <Text
      className={["text-dark dark:text-white", className].join(" ")}
      style={[style, { color: color ? colors[color] : undefined }]}
      {...textProps}
    >
      <I18nKeylessText
        context={context}
        replace={replace}
        forceTemporary={forceTemporary}
        debug={debug}
      >
        {children}
      </I18nKeylessText>
    </Text>
  );
}
```

## 🔧 **What pains does it solve?**

Multiple pains exist with the current i18n solutions.

### i18n key system management

Today most of the systems use keys to translate the text:

```javascript
{
   "en": {
      "hello": "Hello"
   },
   "fr": {
      "hello": "Bonjour"
   }
}
```

This is painful to generate.
This is painful to maintain.

When you see a text in the app, and you want to update it, you need to find the corresponding key, update the text, and make sure to not forget to update the key if needed.

With i18n-keyless, you don't care about the i18n system at all.

### Translation management

With the key system, you also need to manage the translations in the app. 
You need to not forget any. In all the languages you support.
You need to check manually, or create a script to do it.

With i18n-keyless, you don't care about the i18n system at all.

### Code reading

With the key system, when you read the code and the content, you have to read keys, not natural language.
So you don't really know what you are reading.
Sometimes you should make a fix because a sentence is not grammatically correct. But you don't know that because you read keys, not natural language.

With i18n-keyless, you read natural language.
So you know exactly what you are reading.
And you can make sure the sentence is grammatically correct, in real time.

### Time saving

With basic i18n system on your own, you need at least to
- setup the keys' system: at least 1 hour of senior dev time
- back and forth for each new key: 1 minutes per key, x1000 keys = 1000 minutes = 16 hours

At 100$ per hour, that's 1600$ for 1000 keys.

With [i18n-keyless.com](https://i18n-keyless.com), at 8$ a month for 1000 keys, you can afford 200 months of subscription.

You can setup your own system : it took me at least 1.5 day to make it strong enough, that would cost you at least 1200$ for
- handling translation with AI
- in several languages
- storage in DB
- retrieving translations from DB
- only the latest ones to make the service fast and efficient
- handling multiple languages
- maintaining the service

## 📬 **Contact**

Need help or have questions? Reach out to:

- **Twitter**: [@ambroselli_io](https://x.com/ambroselli_io)
- **Email**: [arnaud.ambroselli.io@gmail.com](mailto:arnaud.ambroselli.io@gmail.com)

---

© 2025 i18n-keyless

