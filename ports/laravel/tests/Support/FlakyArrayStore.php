<?php

namespace I18nKeyless\Laravel\Tests\Support;

use Illuminate\Cache\ArrayStore;
use RuntimeException;

/**
 * An array store that throws on every key matching a pattern, to replay a
 * cache backend that is partly down (a redis node holding the usage map, say).
 * `add()` is left to the repository, which builds it from `get()` and `put()`.
 */
final class FlakyArrayStore extends ArrayStore
{
    public function __construct(private readonly string $failing)
    {
        parent::__construct();
    }

    private function guard(string $key): void
    {
        if (str_contains($key, $this->failing)) {
            throw new RuntimeException("cache down for {$key}");
        }
    }

    public function get($key)
    {
        $this->guard($key);

        return parent::get($key);
    }

    public function put($key, $value, $seconds)
    {
        $this->guard($key);

        return parent::put($key, $value, $seconds);
    }

    public function forever($key, $value)
    {
        $this->guard($key);

        return parent::forever($key, $value);
    }

    public function forget($key)
    {
        $this->guard($key);

        return parent::forget($key);
    }
}
