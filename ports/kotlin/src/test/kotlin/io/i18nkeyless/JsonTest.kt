package io.i18nkeyless

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Test

class JsonTest {
    @Test
    fun `parses every value kind`() {
        val parsed = Json.parse("""{"s":"a\"b\\c\n\u00e9","n":12,"f":-1.5e2,"t":true,"x":null,"l":[1,"two",{}],"o":{"k":[]}}""")
        assertEquals(
            mapOf(
                "s" to "a\"b\\c\né",
                "n" to 12L,
                "f" to -150.0,
                "t" to true,
                "x" to null,
                "l" to listOf(1L, "two", emptyMap<String, Any?>()),
                "o" to mapOf("k" to emptyList<Any?>()),
            ),
            parsed,
        )
    }

    @Test
    fun `keeps object key order`() {
        val parsed = Json.parse("""{"b":1,"a":2,"c":3}""") as Map<*, *>
        assertEquals(listOf("b", "a", "c"), parsed.keys.toList())
    }

    @Test
    fun `round-trips unicode, control characters and surrogate pairs`() {
        val text = "Prix : 12 € \u0001 tab\t emoji \uD83D\uDE00 ключ"
        val encoded = Json.stringify(mapOf(text to text))
        assertEquals(mapOf(text to text), Json.parse(encoded))
        assertEquals("\"\\u0001\"", Json.stringify("\u0001"))
    }

    @Test
    fun `stringify writes the wire shapes`() {
        assertEquals("""{"key":"Bonjour","languages":["fr","en"],"n":null,"ok":true}""", Json.stringify(linkedMapOf("key" to "Bonjour", "languages" to listOf("fr", "en"), "n" to null, "ok" to true)))
        assertEquals("[]", Json.stringify(emptyList<Any>()))
        assertEquals("{}", Json.stringify(emptyMap<String, Any>()))
        assertEquals("1.5", Json.stringify(1.5))
        assertEquals("7", Json.stringify(7))
    }

    @Test
    fun `rejects malformed text and unknown values`() {
        assertThrows(JsonException::class.java) { Json.parse("{not json") }
        assertThrows(JsonException::class.java) { Json.parse("{\"a\":1} trailing") }
        assertThrows(JsonException::class.java) { Json.parse("[1,]") }
        assertThrows(JsonException::class.java) { Json.parse("\"unterminated") }
        assertThrows(JsonException::class.java) { Json.parse("\"raw\nnewline\"") }
        assertThrows(JsonException::class.java) { Json.stringify(Any()) }
        assertThrows(JsonException::class.java) { Json.stringify(Double.NaN) }
        assertNull(Json.parseOrNull("{not json"))
    }

    @Test
    fun `numbers too large for a Long become Double`() {
        assertEquals(1.0E20, Json.parse("100000000000000000000"))
        assertEquals(1756209600000L, Json.parse("1756209600000"))
    }
}
