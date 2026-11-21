package ch.doppel.pocket.finance

import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.ln
import kotlin.math.sin
import kotlin.math.sqrt

internal fun interface RandomDraw {
    operator fun invoke(): Double
}

/** Int multiplication wraps modulo 2^32, matching Math.imul. ushr matches JavaScript >>>. */
internal fun mulberry32(seed: Int): RandomDraw {
    var a = seed
    return RandomDraw {
        a += 0x6d2b79f5
        var t = a
        t = (t xor (t ushr 15)) * (t or 1)
        t = t xor (t + (t xor (t ushr 7)) * (t or 61))
        (t xor (t ushr 14)).toUInt().toDouble() / 4294967296.0
    }
}

internal fun pathSeed(seed: Int, path: Int): Int {
    var h = ((seed xor 0x9e3779b9.toInt()) * 0x85ebca6b.toInt()) xor ((path + 1) * 0xc2b2ae35.toInt())
    h = h xor (h ushr 16)
    h *= 0x7feb352d
    return h xor (h ushr 15)
}

/** Box–Muller sampler. The spare variate preserves the TypeScript stream order. */
internal fun normalSampler(rand: RandomDraw): RandomDraw {
    var hasSpare = false
    var spare = 0.0
    return RandomDraw {
        if (hasSpare) {
            hasSpare = false
            spare
        } else {
            var u = 0.0
            while (u == 0.0) u = rand()
            val v = rand()
            val r = sqrt(-2 * ln(u))
            spare = r * sin(2 * PI * v)
            hasSpare = true
            r * cos(2 * PI * v)
        }
    }
}
