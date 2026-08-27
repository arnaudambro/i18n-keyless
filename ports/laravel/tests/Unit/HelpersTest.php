<?php

namespace I18nKeyless\Laravel\Tests\Unit;

use PHPUnit\Framework\TestCase;

final class HelpersTest extends TestCase
{
    public function test_the_helper_file_can_be_included_twice(): void
    {
        $this->assertTrue(function_exists('i18nk'), 'composer autoloads src/helpers.php');

        // A second include (a cached autoloader plus an explicit require, say) must
        // not redeclare the function.
        require __DIR__.'/../../src/helpers.php';
        require __DIR__.'/../../src/helpers.php';

        $this->assertTrue(function_exists('i18nk'));
        $parameters = array_map(fn (\ReflectionParameter $p) => $p->getName(), (new \ReflectionFunction('i18nk'))->getParameters());
        $this->assertSame(['text', 'replace', 'context', 'locale', 'namespace'], $parameters);
    }
}
