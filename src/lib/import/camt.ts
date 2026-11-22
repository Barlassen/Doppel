import { parseAmount, parseDate, round2 } from "./text";
import type { ParsedStatement, SkippedRow, StatementRow } from "./types";

/**
 * ISO 20022 camt.053 (statement) and camt.054 (debit/credit notification) reader.
 *
 * Namespace-agnostic: elements are matched by local name, so camt.053.001.04 (Swiss SPS 2019+) and .001.08 (SPS
 * 2022+) read the same. In the browser it uses `DOMParser`; where there is none (Node scripts) a small built-in XML
 * reader with the same element interface is used. No dependency either way.
 */

/** The few things the reader needs from an XML element. */
export interface XEl {
  name: string;
  attrs: Record<string, string>;
  children: XEl[];
  text: string;
}

const local = (qname: string) => qname.slice(qname.indexOf(":") + 1);

function fromDom(el: Element): XEl {
  const children: XEl[] = [];
  for (const c of Array.from(el.children)) children.push(fromDom(c));
  const attrs: Record<string, string> = {};
  for (const a of Array.from(el.attributes)) attrs[local(a.name)] = a.value;
  return { name: el.localName, attrs, children, text: children.length ? "" : (el.textContent ?? "").trim() };
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const unescapeXml = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) =>
    e[0] === "#" ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : (ENTITIES[e] ?? m),
  );

/** Minimal well-formed XML → element tree (no DTDs, no entities beyond the five predefined + numeric). */
export function parseXmlLite(xml: string): XEl {
  const root: XEl = { name: "#root", attrs: {}, children: [], text: "" };
  const stack: XEl[] = [root];
  const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<!DOCTYPE[^>]*>|<(\/?)([^\s/>]+)([^>]*?)(\/?)>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) top.text += m[1];
    else if (m[3]) {
      if (m[2] === "/") {
        if (stack.length > 1) stack.pop();
        continue;
      }
      const attrs: Record<string, string> = {};
      for (const a of m[4].matchAll(/([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) attrs[local(a[1])] = unescapeXml(a[3] ?? a[4] ?? "");
      const el: XEl = { name: local(m[3]), attrs, children: [], text: "" };
      top.children.push(el);
      if (!m[5]) stack.push(el);
    } else if (m[6] !== undefined && m[6].trim()) top.text += unescapeXml(m[6]);
  }
  const trim = (e: XEl) => {
    e.text = e.children.length ? "" : e.text.trim();
    e.children.forEach(trim);
  };
  trim(root);
  return root.children[0] ?? root;
}

export function parseXml(xml: string): XEl | undefined {
  if (typeof DOMParser !== "undefined") {
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    if (doc.getElementsByTagName("parsererror").length || !doc.documentElement) return undefined;
    return fromDom(doc.documentElement);
  }
  try {
    return parseXmlLite(xml);
  } catch {
    return undefined;
  }
}

// ---------------- element helpers ----------------

const kids = (el: XEl | undefined, name: string) => (el ? el.children.filter((c) => c.name === name) : []);
const kid = (el: XEl | undefined, name: string) => el?.children.find((c) => c.name === name);
/** Follows a path of local names: path(el, "RltdPties", "Cdtr", "Nm"). */
function path(el: XEl | undefined, ...names: string[]): XEl | undefined {
  let cur = el;
  for (const n of names) cur = kid(cur, n);
  return cur;
}
const text = (el: XEl | undefined, ...names: string[]) => path(el, ...names)?.text || undefined;
function descendants(el: XEl, name: string, out: XEl[] = []): XEl[] {
  for (const c of el.children) {
    if (c.name === name) out.push(c);
    else descendants(c, name, out);
  }
  return out;
}

/** A party name in .04 (`Cdtr/Nm`) and .08 (`Cdtr/Pty/Nm`) layouts. */
const partyName = (parties: XEl | undefined, role: "Cdtr" | "Dbtr") => text(parties, role, "Nm") ?? text(parties, role, "Pty", "Nm");
const dateOf = (el: XEl | undefined) => parseDate(text(el, "Dt") ?? text(el, "DtTm"));

/** True when the XML looks like camt (any version). */
export const isCamt = (xml: string) => /<(?:\w+:)?(?:BkToCstmrStmt|BkToCstmrDbtCdtNtfctn|BkToCstmrAcctRpt)\b/.test(xml);

/**
 * camt.053 / .054 → statement rows. Each `Ntry` becomes one row; a batch entry whose `TxDtls` carry their own
 * amounts in the account currency, adding up to the entry, becomes one row per transaction. `AcctSvcrRef` (entry or
 * transaction) is kept for dedupe against earlier imports. `RvslInd` marks the row as a reversal.
 */
export function parseCamt(xml: string): ParsedStatement | undefined {
  const doc = parseXml(xml);
  if (!doc) return undefined;
  const format = descendants(doc, "BkToCstmrDbtCdtNtfctn").length || doc.name === "BkToCstmrDbtCdtNtfctn" ? "camt.054" : "camt.053";
  const entries = descendants(doc, "Ntry");
  const rows: StatementRow[] = [];
  const skipped: SkippedRow[] = [];
  entries.forEach((ntry, index) => {
    const line = index + 1;
    const status = text(ntry, "Sts", "Cd") ?? text(ntry, "Sts");
    if (status && !/^BOOK$/i.test(status)) {
      skipped.push({ line, reason: "pending" });
      return;
    }
    const date = dateOf(kid(ntry, "BookgDt")) ?? dateOf(kid(ntry, "ValDt"));
    if (!date) {
      skipped.push({ line, reason: "badDate" });
      return;
    }
    const entryAmt = kid(ntry, "Amt");
    const entryCcy = entryAmt?.attrs.Ccy ?? "CHF";
    const entryAmount = parseAmount(entryAmt?.text);
    const credit = text(ntry, "CdtDbtInd") === "CRDT";
    const entryRef = text(ntry, "AcctSvcrRef");
    const entryInfo = text(ntry, "AddtlNtryInf");
    const reversal = /^(?:true|1)$/i.test(text(ntry, "RvslInd") ?? "");
    const txs = kids(ntry, "NtryDtls").flatMap((d) => kids(d, "TxDtls"));
    // A transaction's own amount in the account currency: `Amt` (SPS 2022+), else `AmtDtls/TxAmt/Amt`. An amount
    // in another currency (the instructed amount of a card payment abroad) is not what was booked.
    const ownAmount = (tx: XEl) => [kid(tx, "Amt"), path(tx, "AmtDtls", "TxAmt", "Amt")]
      .find((el) => el && (el.attrs.Ccy ?? entryCcy).toUpperCase() === entryCcy.toUpperCase() && parseAmount(el.text) !== undefined);
    const txSign = (tx: XEl) => {
      const ind = text(tx, "CdtDbtInd");
      return (ind ? ind === "CRDT" : credit) ? 1 : -1;
    };
    const own = txs.map(ownAmount);
    const batchSum = txs.reduce((sum, tx, i) => sum + txSign(tx) * Math.abs(parseAmount(own[i]?.text) ?? 0), 0);
    // Split a batch only when every transaction has its amount and they add up to the booked entry. Otherwise
    // (bank charges inside the entry, foreign-currency details) the entry amount is the booked truth: one row.
    const split = txs.length > 1 && own.every(Boolean) && entryAmount !== undefined
      && Math.abs(Math.abs(batchSum) - Math.abs(entryAmount)) < 0.005;

    const push = (amountEl: XEl | undefined, fallback: number | undefined, ccyFallback: string, tx: XEl | undefined, ref: string | undefined, isCredit: boolean, whole: boolean) => {
      const amount = amountEl ? parseAmount(amountEl.text) : fallback;
      const currency = (amountEl?.attrs.Ccy ?? ccyFallback).toUpperCase();
      if (amount === undefined) {
        skipped.push({ line, reason: "badAmount" });
        return;
      }
      if (currency !== "CHF") {
        skipped.push({ line, reason: "foreignCurrency", currency });
        return;
      }
      const parties = kid(tx, "RltdPties");
      // The related parties describe the original payment. On a reversal the money flows back, so the other side
      // of a returned debit is still its creditor (the shop), not the account holder.
      const payee = isCredit !== reversal;
      // One row for a whole batch of different payees has no single counterparty.
      const names = whole && txs.length > 1 ? new Set(txs.map((t) => partyName(kid(t, "RltdPties"), payee ? "Dbtr" : "Cdtr") ?? "")) : undefined;
      const counterparty = names && names.size > 1 ? undefined : payee ? partyName(parties, "Dbtr") : partyName(parties, "Cdtr");
      const rmt = kid(tx, "RmtInf");
      const ustrd = names && names.size > 1 ? "" : kids(rmt, "Ustrd").map((u) => u.text).filter(Boolean).join(" ");
      const strdRef = names && names.size > 1 ? undefined : text(rmt, "Strd", "CdtrRefInf", "Ref");
      const info = (names && names.size > 1 ? undefined : text(tx, "AddtlTxInf")) ?? entryInfo;
      // A mixed batch is described by the bank's own text, else by its first payees.
      const mixed = names && names.size > 1 && !info ? [...names].filter(Boolean).slice(0, 3).join(", ") : undefined;
      const parts = [counterparty, ustrd, info, mixed].filter((p): p is string => !!p);
      rows.push({
        line,
        date,
        description: [...new Set(parts)].join(" · ") || strdRef || "",
        counterparty: counterparty || undefined,
        signed: round2(isCredit ? Math.abs(amount) : -Math.abs(amount)),
        currency,
        ref: ref || (strdRef ? `${date}/${strdRef}` : undefined),
        ...(reversal ? { reversal: true } : {}),
      });
    };

    if (split) {
      txs.forEach((tx, i) => {
        const txRef = text(tx, "Refs", "AcctSvcrRef") ?? (entryRef ? `${entryRef}/${i + 1}` : undefined);
        push(own[i], undefined, entryCcy, tx, txRef, txSign(tx) > 0, false);
      });
    } else {
      const tx = txs[0];
      push(entryAmt, entryAmount, entryCcy, tx, entryRef ?? text(tx, "Refs", "AcctSvcrRef"), credit, true);
    }
  });
  return { format, profile: format, rows, trades: [], skipped, notes: [] };
}
