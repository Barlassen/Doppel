package ch.doppel.pocket

import androidx.compose.runtime.Composable
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import java.awt.FileDialog
import java.awt.Frame
import java.awt.KeyboardFocusManager
import java.io.File
import javax.imageio.ImageIO
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@Composable
internal actual fun rememberQrPicker(
    title: String,
    onReading: (Boolean) -> Unit,
    onResult: (String?) -> Unit,
): () -> Unit {
    val scope = rememberCoroutineScope()
    val reading = rememberUpdatedState(onReading)
    val result = rememberUpdatedState(onResult)
    return {
        val owner = KeyboardFocusManager.getCurrentKeyboardFocusManager().activeWindow as? Frame
        val dialog = FileDialog(owner, title, FileDialog.LOAD)
        val file = try {
            dialog.isVisible = true
            dialog.files.firstOrNull()
        } finally {
            dialog.dispose()
        }
        if (file != null) scope.launch {
            reading.value(true)
            try {
                val raw = withContext(Dispatchers.IO) { runCatching { readQr(file) }.getOrNull() }
                result.value(raw)
            } finally {
                reading.value(false)
            }
        }
    }
}

private fun readQr(file: File): String? {
    val input = ImageIO.createImageInputStream(file) ?: return null
    input.use {
        val reader = ImageIO.getImageReaders(input).asSequence().firstOrNull() ?: return null
        try {
            reader.setInput(input, true, true)
            val edge = maxOf(reader.getWidth(0), reader.getHeight(0))
            val sample = 1 + (edge - 1) / MAX_IMAGE_EDGE
            val params = reader.defaultReadParam.apply { setSourceSubsampling(sample, sample, 0, 0) }
            val image = reader.read(0, params)
            val pixels = image.getRGB(0, 0, image.width, image.height, null, 0, image.width)
            return decodeQr(image.width, image.height, pixels)
        } finally {
            reader.dispose()
        }
    }
}
