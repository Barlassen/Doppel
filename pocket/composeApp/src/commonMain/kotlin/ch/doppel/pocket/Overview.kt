package ch.doppel.pocket

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import ch.doppel.pocket.finance.*
import kotlin.math.abs
import kotlin.math.roundToLong

@Composable
internal fun Overview(profile: Profile, result: TwinResult) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text("${profile.name} · ${profile.city}", style = MaterialTheme.typography.headlineMedium)
        Text("Goal at age ${profile.goal.age} · ${chf(profile.goal.target)}",
            style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        OddsCard("Real twin", result.real.successProb, Modifier.weight(1f), true)
        OddsCard("Ideal twin", result.ideal.successProb, Modifier.weight(1f), false)
    }
    BoxWithConstraints(Modifier.fillMaxWidth()) {
        val home = result.real.house
        if (maxWidth >= 780.dp && home != null) {
            Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                Cone(profile, result, Modifier.weight(1.7f))
                HouseCard(home, Modifier.weight(1f))
            }
        } else {
            Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
                Cone(profile, result, Modifier.fillMaxWidth())
                if (home != null) HouseCard(home, Modifier.fillMaxWidth())
                else SectionCard(Modifier.fillMaxWidth()) {
                    Text("Bank affordability test", style = MaterialTheme.typography.titleMedium)
                    Text("No home purchase planned.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
    }
}

@Composable
private fun OddsCard(label: String, probability: Double, modifier: Modifier, real: Boolean) {
    val scheme = MaterialTheme.colorScheme
    Column(
        modifier.background(if (real) scheme.primaryContainer else scheme.surfaceContainerHigh, MaterialTheme.shapes.large)
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        val color = if (real) scheme.onPrimaryContainer else scheme.onSurface
        Text(label, color = color, style = MaterialTheme.typography.titleSmall)
        Text(percent(probability), color = color, style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.SemiBold)
    }
}

@Composable
private fun HouseCard(house: HouseStats, modifier: Modifier) {
    val result = remember(house) { house.affordability() }
    SectionCard(modifier) {
        Text("Bank affordability test", style = MaterialTheme.typography.titleMedium)
        Text(house.label, style = MaterialTheme.typography.bodyMedium)
        Text(chf(house.price), style = MaterialTheme.typography.headlineSmall)
        Text(if (result.plan.pass) "Passes" else "Fails", style = MaterialTheme.typography.titleSmall,
            color = if (result.plan.pass) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.error)
        Metric("Cost / gross income", if (result.plan.costToIncome.isFinite()) percent(result.plan.costToIncome) else "—")
        Metric("Equity in", chf(result.equityUsed))
        Metric("Max price at purchase", chf(result.maxPrice))
        Metric("Passes across futures", percent(house.boughtProb))
    }
}

@Composable
private fun Metric(label: String, value: String) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(label, color = MaterialTheme.colorScheme.onSurfaceVariant,
            style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
        Text(value, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold)
    }
}

@Composable
private fun Cone(profile: Profile, result: TwinResult, modifier: Modifier) = SectionCard(modifier) {
    Text("Net worth incl. pension & home equity, today’s CHF", style = MaterialTheme.typography.titleMedium)
    val real = result.real.bands
    val ideal = result.ideal.bands
    val finalAge = maxOf(profile.goal.age, result.real.retirementAge + 5, real.first().age + 10)
        .coerceAtMost(real.last().age)
    val end = finalAge - real.first().age
    val plottedReal = real.take(end + 1)
    val plottedIdeal = ideal.take(end + 1)
    val lo = minOf(0.0, plottedReal.minOf { it.p10 }, plottedIdeal.minOf { it.p50 })
    val hi = maxOf(1.0, profile.goal.target, plottedReal.maxOf { it.p90 }, plottedIdeal.maxOf { it.p50 })
    val realColor = MaterialTheme.colorScheme.primary
    val idealColor = MaterialTheme.colorScheme.tertiary
    val guide = MaterialTheme.colorScheme.outlineVariant
    val goal = MaterialTheme.colorScheme.outline
    val goalBand = real.firstOrNull { it.age == profile.goal.age } ?: real.first()
    val description = "At age ${goalBand.age}, real twin median ${chf(goalBand.p50)}. " +
        "10th to 90th percentile: ${chf(goalBand.p10)} to ${chf(goalBand.p90)}."
    Canvas(Modifier.fillMaxWidth().height(194.dp).semantics { contentDescription = description }) {
        val inset = 6.dp.toPx()
        fun x(index: Int): Float = index.toFloat() / end.coerceAtLeast(1) * size.width
        fun y(value: Double): Float = (size.height - inset) - ((value - lo) / (hi - lo)).toFloat() * (size.height - 2 * inset)
        for (i in 0..3) {
            val line = y(lo + (hi - lo) * i / 3)
            drawLine(guide, Offset(0f, line), Offset(size.width, line), strokeWidth = 1.dp.toPx())
        }
        val band = Path().apply {
            moveTo(x(0), y(plottedReal.first().p90))
            for ((index, point) in plottedReal.withIndex()) lineTo(x(index), y(point.p90))
            for (index in plottedReal.indices.reversed()) lineTo(x(index), y(plottedReal[index].p10))
            close()
        }
        drawPath(band, realColor.copy(alpha = 0.17f))
        fun line(points: List<YearBand>) = Path().apply {
            moveTo(x(0), y(points.first().p50))
            for ((index, point) in points.withIndex()) lineTo(x(index), y(point.p50))
        }
        val dash = PathEffect.dashPathEffect(floatArrayOf(5.dp.toPx(), 4.dp.toPx()))
        drawPath(line(plottedIdeal), idealColor, style = Stroke(2.dp.toPx(), pathEffect = dash))
        drawPath(line(plottedReal), realColor, style = Stroke(2.dp.toPx()))
        val marker = Offset(x((profile.goal.age - real.first().age).coerceIn(0, end)), y(profile.goal.target))
        drawLine(goal, Offset(marker.x, size.height), marker, strokeWidth = 1.dp.toPx(), pathEffect = dash)
        drawCircle(goal, radius = 3.dp.toPx(), center = marker)
    }
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        for (age in listOf(real.first().age, (real.first().age + finalAge) / 2, finalAge)) {
            Text("Age $age", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Legend(realColor, "Real twin · median and 10–90% range")
        Legend(idealColor, "Ideal twin · median")
        Legend(goal, "Goal · ${chf(profile.goal.target)}")
    }
}

@Composable
private fun Legend(color: Color, label: String) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Box(Modifier.size(8.dp).background(color, CircleShape))
        Text(label, style = MaterialTheme.typography.labelMedium)
    }
}

internal fun swissInteger(value: Long): String {
    val digits = abs(value).toString().reversed().chunked(3).joinToString("'").reversed()
    return if (value < 0) "−$digits" else digits
}

internal fun chf(value: Double): String = "CHF " + swissInteger(value.roundToLong())

internal fun percent(value: Double): String {
    if (!value.isFinite()) return "—"
    val tenths = (value * 1000).roundToLong()
    return "${tenths / 10}.${abs(tenths % 10)}%"
}
