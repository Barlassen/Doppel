package ch.doppel.pocket

import android.content.ContentResolver
import android.graphics.BitmapFactory
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.platform.LocalContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@Composable
internal actual fun rememberQrPicker(
    title: String,
    onReading: (Boolean) -> Unit,
    onResult: (String?) -> Unit,
): () -> Unit {
    val resolver = LocalContext.current.contentResolver
    val scope = rememberCoroutineScope()
    val reading = rememberUpdatedState(onReading)
    val result = rememberUpdatedState(onResult)
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri != null) scope.launch {
            reading.value(true)
            try {
                val raw = withContext(Dispatchers.IO) { runCatching { readQr(resolver, uri) }.getOrNull() }
                result.value(raw)
            } finally {
                reading.value(false)
            }
        }
    }
    return { picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) }
}

private fun readQr(resolver: ContentResolver, uri: Uri): String? {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    val boundsStream = resolver.openInputStream(uri) ?: return null
    boundsStream.use { BitmapFactory.decodeStream(it, null, bounds) }
    val edge = maxOf(bounds.outWidth, bounds.outHeight)
    if (edge <= 0) return null
    var sample = 1
    while (edge / sample > MAX_IMAGE_EDGE) sample *= 2
    val options = BitmapFactory.Options().apply { inSampleSize = sample }
    val bitmap = resolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, options) } ?: return null
    return try {
        val pixels = IntArray(bitmap.width * bitmap.height)
        bitmap.getPixels(pixels, 0, bitmap.width, 0, 0, bitmap.width, bitmap.height)
        decodeQr(bitmap.width, bitmap.height, pixels)
    } finally {
        bitmap.recycle()
    }
}
