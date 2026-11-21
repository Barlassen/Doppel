package ch.doppel.pocket

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.unit.dp
import ch.doppel.pocket.finance.Message
import ch.doppel.pocket.finance.Profile
import ch.doppel.pocket.finance.Scenario
import ch.doppel.pocket.finance.message
import ch.doppel.pocket.snap.*

@Composable
internal expect fun rememberQrPicker(
    title: String,
    onReading: (Boolean) -> Unit,
    onResult: (String?) -> Unit,
): () -> Unit

@Composable
internal fun QrImport(profile: Profile, scenario: Scenario, onApply: (Scenario, List<Message>) -> Unit) {
    var reading by remember { mutableStateOf(false) }
    var bill by remember { mutableStateOf<QrBill?>(null) }
    var failed by remember { mutableStateOf(false) }
    val label = localized("pocket.scan")
    val pick = rememberQrPicker(label, { reading = it }) { raw ->
        bill = raw?.let(::parseQrBill)
        failed = bill == null
    }

    OutlinedButton(onClick = { failed = false; pick() }, enabled = !reading) {
        Text(if (reading) localized("pocket.scanReading") else label)
    }
    if (failed) Text(localized("pocket.scanError"), color = MaterialTheme.colorScheme.error)

    val pending = bill ?: return
    val expense = remember(pending, profile, scenario) { reviewQrExpense(pending, profile, scenario) }
    val summary = when (expense) {
        QrExpense.InvalidAmount -> message("pocket.scanAmount")
        QrExpense.AlreadyBudgeted -> message("pocket.scanDuplicate")
        is QrExpense.OneOff -> message("pocket.scanOneOff", "amount" to expense.amount)
        is QrExpense.Recurring -> message("pocket.scanRecurring", "amount" to expense.monthly)
    }
    val canApply = expense is QrExpense.OneOff || expense is QrExpense.Recurring
    AlertDialog(
        onDismissRequest = { bill = null },
        title = { Text(localized("pocket.scanReview")) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                if (pending.creditor.name.isNotBlank()) Text(pending.creditor.name)
                if (pending.message.isNotBlank()) Text(pending.message, style = MaterialTheme.typography.bodyMedium)
                Text(localized(summary), style = MaterialTheme.typography.titleSmall)
            }
        },
        confirmButton = {
            if (canApply) Button(onClick = {
                bill = null
                onApply(scenario.withQrExpense(pending, expense), listOf(summary))
            }) { Text(localized("pocket.scanAdd")) }
        },
        dismissButton = { TextButton(onClick = { bill = null }) { Text(localized("common.close")) } },
    )
}
