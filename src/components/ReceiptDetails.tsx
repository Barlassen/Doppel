"use client";

import { categoryMsg } from "@/lib/data/merchants";
import type { ReceiptItem } from "@/lib/finance/types";
import { receiptMoney } from "@/lib/format";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { receiptSum } from "@/lib/snap/receipt";

export function ReceiptDetails({ items, total, currency }: { items: ReceiptItem[]; total?: number; currency?: string }) {
  const { t, tm } = useI18n();
  const sum = receiptSum(items, total);
  return (
    <details className="text-xs text-ink-2">
      <summary className="cursor-pointer font-medium">
        {t("receipt.summary", { count: items.length, amount: receiptMoney(total ?? sum.amount, currency) })}
      </summary>
      <ul className="mt-1 space-y-1 border-l border-line pl-2">
        {items.map((item, index) => (
          <li key={index} className="flex min-w-0 justify-between gap-2">
            <span className="min-w-0 break-words">
              {item.name}
              {item.qty !== undefined && <span className="text-ink-3"> · {item.qty}×{item.unitPrice !== undefined && " " + receiptMoney(item.unitPrice, currency)}</span>}
              {item.category && <span className="text-ink-3"> · {tm(categoryMsg(item.category))}</span>}
            </span>
            <span className="num shrink-0">{receiptMoney(item.amount, currency)}</span>
          </li>
        ))}
      </ul>
      {!sum.matches && total !== undefined && <p className="mt-1 text-warn">{t("receipt.mismatch")}</p>}
    </details>
  );
}
