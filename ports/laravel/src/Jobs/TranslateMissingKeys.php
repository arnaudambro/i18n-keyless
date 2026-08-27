<?php

namespace I18nKeyless\Laravel\Jobs;

use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use I18nKeyless\Laravel\KeylessTranslator;
use I18nKeyless\Laravel\Miss;

/**
 * Sends the misses of one request to POST /translate from a queue worker.
 * Dispatched when `config('i18n-keyless.queue')` is set.
 */
final class TranslateMissingKeys implements ShouldQueue
{
    use Dispatchable;
    use InteractsWithQueue;
    use Queueable;
    use SerializesModels;

    /**
     * @param  list<array{key: string, context: ?string, namespace: string, langs: list<string>}>  $misses
     */
    public function __construct(public array $misses)
    {
    }

    public function handle(KeylessTranslator $translator): void
    {
        $translator->translateNow(array_map(fn (array $miss) => Miss::fromArray($miss), $this->misses));
    }
}
