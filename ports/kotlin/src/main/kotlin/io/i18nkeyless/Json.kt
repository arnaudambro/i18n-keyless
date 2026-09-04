package io.i18nkeyless

/** A malformed JSON text, or a value the serializer does not know. */
class JsonException(message: String) : RuntimeException(message)

/**
 * A minimal JSON codec: objects, arrays, strings, numbers, booleans and null.
 *
 * The library carries its own codec on purpose. `kotlinx.serialization` needs a compiler
 * plugin in every consumer, and `org.json` ships inside the Android runtime, so depending on
 * it on the JVM produces duplicate classes in an Android build. The wire format of
 * i18n-keyless is a handful of flat maps: sixty lines of parser are cheaper than either.
 *
 * Parsed values: `Map<String, Any?>` (insertion order kept), `List<Any?>`, `String`, `Long`
 * (integral numbers that fit), `Double`, `Boolean`, `null`. Serialized values: the same, plus
 * any `Number`, `Iterable`, array and `Map` (keys through `toString()`).
 */
object Json {
    fun parse(text: String): Any? {
        val parser = Parser(text)
        parser.skipWhitespace()
        val value = parser.value()
        parser.skipWhitespace()
        if (parser.index != text.length) throw JsonException("unexpected character at ${parser.index}")
        return value
    }

    /** [parse], or `null` when the text is not JSON (a 200 with a broken body is a failed attempt). */
    fun parseOrNull(text: String): Any? = try {
        parse(text)
    } catch (_: JsonException) {
        null
    }

    fun stringify(value: Any?): String = StringBuilder().also { write(it, value) }.toString()

    private fun write(out: StringBuilder, value: Any?) {
        when (value) {
            null -> out.append("null")
            is Boolean -> out.append(value)
            is String -> writeString(out, value)
            is Int, is Long, is Short, is Byte -> out.append(value)
            is Double -> {
                if (value.isNaN() || value.isInfinite()) throw JsonException("$value is not a JSON number")
                out.append(value)
            }
            is Float -> write(out, value.toDouble())
            is Number -> out.append(value)
            is Map<*, *> -> {
                out.append('{')
                var first = true
                for ((key, item) in value) {
                    if (!first) out.append(',')
                    first = false
                    writeString(out, key.toString())
                    out.append(':')
                    write(out, item)
                }
                out.append('}')
            }
            is Iterable<*> -> writeArray(out, value)
            is Array<*> -> writeArray(out, value.asIterable())
            else -> throw JsonException("cannot serialize ${value::class.java.name}")
        }
    }

    private fun writeArray(out: StringBuilder, items: Iterable<*>) {
        out.append('[')
        var first = true
        for (item in items) {
            if (!first) out.append(',')
            first = false
            write(out, item)
        }
        out.append(']')
    }

    private fun writeString(out: StringBuilder, text: String) {
        out.append('"')
        for (char in text) {
            when {
                char == '"' -> out.append("\\\"")
                char == '\\' -> out.append("\\\\")
                char == '\n' -> out.append("\\n")
                char == '\r' -> out.append("\\r")
                char == '\t' -> out.append("\\t")
                char == '\b' -> out.append("\\b")
                char == '\u000C' -> out.append("\\f")
                char < ' ' -> out.append("\\u").append(char.code.toString(16).padStart(4, '0'))
                else -> out.append(char)
            }
        }
        out.append('"')
    }

    private class Parser(private val text: String) {
        var index = 0

        fun skipWhitespace() {
            while (index < text.length && text[index].let { it == ' ' || it == '\n' || it == '\r' || it == '\t' }) index++
        }

        fun value(): Any? {
            if (index >= text.length) throw JsonException("unexpected end of input")
            return when (val char = text[index]) {
                '{' -> obj()
                '[' -> array()
                '"' -> string()
                't' -> literal("true", true)
                'f' -> literal("false", false)
                'n' -> literal("null", null)
                '-', in '0'..'9' -> number()
                else -> throw JsonException("unexpected '$char' at $index")
            }
        }

        private fun obj(): Map<String, Any?> {
            val result = LinkedHashMap<String, Any?>()
            index++ // {
            skipWhitespace()
            if (peek() == '}') {
                index++
                return result
            }
            while (true) {
                skipWhitespace()
                if (peek() != '"') throw JsonException("expected a string key at $index")
                val key = string()
                skipWhitespace()
                if (peek() != ':') throw JsonException("expected ':' at $index")
                index++
                skipWhitespace()
                result[key] = value()
                skipWhitespace()
                when (peek()) {
                    ',' -> index++
                    '}' -> {
                        index++
                        return result
                    }
                    else -> throw JsonException("expected ',' or '}' at $index")
                }
            }
        }

        private fun array(): List<Any?> {
            val result = ArrayList<Any?>()
            index++ // [
            skipWhitespace()
            if (peek() == ']') {
                index++
                return result
            }
            while (true) {
                skipWhitespace()
                result.add(value())
                skipWhitespace()
                when (peek()) {
                    ',' -> index++
                    ']' -> {
                        index++
                        return result
                    }
                    else -> throw JsonException("expected ',' or ']' at $index")
                }
            }
        }

        private fun string(): String {
            index++ // opening quote
            val out = StringBuilder()
            while (true) {
                if (index >= text.length) throw JsonException("unterminated string")
                val char = text[index++]
                when (char) {
                    '"' -> return out.toString()
                    '\\' -> {
                        if (index >= text.length) throw JsonException("unterminated escape")
                        when (val escaped = text[index++]) {
                            '"' -> out.append('"')
                            '\\' -> out.append('\\')
                            '/' -> out.append('/')
                            'b' -> out.append('\b')
                            'f' -> out.append('\u000C')
                            'n' -> out.append('\n')
                            'r' -> out.append('\r')
                            't' -> out.append('\t')
                            'u' -> {
                                if (index + 4 > text.length) throw JsonException("truncated \\u escape")
                                val code = text.substring(index, index + 4).toIntOrNull(16)
                                    ?: throw JsonException("invalid \\u escape at $index")
                                out.append(code.toChar())
                                index += 4
                            }
                            else -> throw JsonException("invalid escape '\\$escaped' at ${index - 1}")
                        }
                    }
                    else -> {
                        if (char < ' ') throw JsonException("control character in string at ${index - 1}")
                        out.append(char)
                    }
                }
            }
        }

        private fun number(): Number {
            val start = index
            if (peek() == '-') index++
            var integral = true
            while (index < text.length) {
                val char = text[index]
                if (char in '0'..'9') {
                    index++
                } else if (char == '.' || char == 'e' || char == 'E' || char == '+' || char == '-') {
                    integral = false
                    index++
                } else {
                    break
                }
            }
            val raw = text.substring(start, index)
            if (integral) raw.toLongOrNull()?.let { return it }
            return raw.toDoubleOrNull() ?: throw JsonException("invalid number '$raw' at $start")
        }

        private fun literal(word: String, value: Any?): Any? {
            if (!text.startsWith(word, index)) throw JsonException("unexpected token at $index")
            index += word.length
            return value
        }

        private fun peek(): Char? = if (index < text.length) text[index] else null
    }
}
