<?php

namespace I18nKeyless\Laravel;

/**
 * One source string that had no translation, with the languages it was
 * requested in. Sent to POST /translate once per (namespace, key, context).
 */
final class Miss
{
    /**
     * @param  list<string>  $langs  i18n-keyless codes the string was requested in
     */
    public function __construct(
        public readonly string $key,
        public readonly ?string $context,
        public readonly string $namespace,
        public array $langs = [],
    ) {
    }

    /** The lookup key, stored exactly like the SDKs: "key__context". */
    public function lookupKey(): string
    {
        return self::lookupKeyFor($this->key, $this->context);
    }

    public static function lookupKeyFor(string $key, ?string $context): string
    {
        return ($context === null || $context === '') ? $key : "{$key}__{$context}";
    }

    /** Dedupe id: one POST per (namespace, key, context), whatever the languages. */
    public function id(): string
    {
        return $this->namespace.':'.$this->lookupKey();
    }

    public function addLang(string $lang): void
    {
        if (! in_array($lang, $this->langs, true)) {
            $this->langs[] = $lang;
        }
    }

    /** @return array{key: string, context: ?string, namespace: string, langs: list<string>} */
    public function toArray(): array
    {
        return [
            'key' => $this->key,
            'context' => $this->context,
            'namespace' => $this->namespace,
            'langs' => array_values($this->langs),
        ];
    }

    /** @param  array{key: string, context?: ?string, namespace?: string, langs?: list<string>}  $data */
    public static function fromArray(array $data): self
    {
        return new self(
            $data['key'],
            $data['context'] ?? null,
            $data['namespace'] ?? KeylessTranslator::DEFAULT_NAMESPACE,
            array_values($data['langs'] ?? []),
        );
    }
}
