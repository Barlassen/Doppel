package ch.doppel.pocket

import com.google.zxing.BinaryBitmap
import com.google.zxing.NotFoundException
import com.google.zxing.RGBLuminanceSource
import com.google.zxing.common.HybridBinarizer
import com.google.zxing.qrcode.QRCodeReader

internal const val MAX_IMAGE_EDGE = 2048

internal fun decodeQr(width: Int, height: Int, pixels: IntArray): String? {
    val luminance = RGBLuminanceSource(width, height, pixels)
    val bitmap = BinaryBitmap(HybridBinarizer(luminance))
    return try {
        QRCodeReader().decode(bitmap).text
    } catch (_: NotFoundException) {
        null
    }
}
