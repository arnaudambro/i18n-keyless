import React, { useEffect } from "react";
import { useI18nKeyless } from "./store";

// Get the props type from the component in config
type ComponentProps =
  NonNullable<
    ReturnType<typeof useI18nKeyless.getState>["config"]
  >["component"] extends React.ComponentType<infer P>
    ? P
    : never;

/**
 * the component should be a React component
 *
 * ```ts
 * export default function MyComponent({ anyprop, can, fit, children}) {
 *  return <Text>{children}</Text>;
 * }
 * ```
 *
 * Then you can pass MyComponent's props to i18n-keyless' MyI18nText
 *
 * ```ts
 * <MyI18nText anyprop can fit>My text to translate</MyI18nText>
 * ```
 */
type MyI18nTextProps = Omit<ComponentProps, "children"> & {
  children: string;
};

export const MyI18nText: React.FC<MyI18nTextProps> = ({
  children,
  ...textProps
}) => {
  const translations = useI18nKeyless((store) => store.translations);
  const currentLanguage = useI18nKeyless((store) => store.currentLanguage);
  const config = useI18nKeyless((store) => store.config);
  const translateKey = useI18nKeyless((store) => store.translateKey);

  useEffect(() => {
    translateKey(children);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [children, currentLanguage]);

  if (!config) {
    return null;
  }

  const translatedText = translations[children] || children;
  const TextComponent = config.component;

  return <TextComponent {...textProps}>{translatedText}</TextComponent>;
};
