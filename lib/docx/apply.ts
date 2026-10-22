import PizZip from "pizzip";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { Operation } from "@/lib/llm/schema";
import { markStructure } from "./structural";

export interface ApplyResult {
  docx: Buffer;
  appliedCount: number;
  droppedCount: number;
  stats: {
    reorderedCount: number;
    rewrittenCount: number;
    deletedCount: number;
    charDelta: number;
  };
  warnings: string[];
}

interface ParaNodeRef {
  id: number;
  text: string;
  style: string | null;
  isList: boolean;
  locked: boolean;
  parentKey: string;
  node: Element;
}

/* ------------------------------------------------------------------ */
/* Indexing                                                            */
/* ------------------------------------------------------------------ */

function indexParagraphNodes(doc: any): ParaNodeRef[] {
  const documentElement = doc.documentElement;
  if (!documentElement) return [];

  const bodyList = documentElement.getElementsByTagName("w:body");
  if (bodyList.length === 0) return [];

  const body = bodyList[0];
  const refs: ParaNodeRef[] = [];
  let currentId = 0;

  function traverse(node: any, parentKey: string) {
    const childNodes = node.childNodes;
    if (!childNodes) return;

    let tableIndex = 0;

    for (let i = 0; i < childNodes.length; i++) {
      const child = childNodes[i];
      if (child.nodeType !== 1) continue;

      const el = child as Element;
      const nodeName = el.nodeName;

      if (nodeName === "w:p") {
        refs.push({
          id: currentId++,
          text: extractText(el),
          style: getStyle(el),
          isList: checkIsList(el),
          locked: checkIsLocked(el),
          parentKey,
          node: el,
        });
      } else if (nodeName === "w:tbl") {
        const currentTableKey =
          parentKey === "body" ? `tbl${tableIndex}` : `${parentKey}.tbl${tableIndex}`;
        tableIndex++;

        const trList = el.childNodes;
        let rowIndex = 0;
        for (let r = 0; r < trList.length; r++) {
          const trNode = trList[r];
          if (trNode.nodeType !== 1 || (trNode as Element).nodeName !== "w:tr") continue;

          const rowKey = `${currentTableKey}.r${rowIndex}`;
          rowIndex++;

          const tcList = trNode.childNodes;
          let cellIndex = 0;
          for (let c = 0; c < tcList.length; c++) {
            const tcNode = tcList[c];
            if (tcNode.nodeType !== 1 || (tcNode as Element).nodeName !== "w:tc") continue;

            const cellKey = `${rowKey}.c${cellIndex}`;
            cellIndex++;
            traverse(tcNode, cellKey);
          }
        }
      }
    }
  }

  traverse(body, "body");
  return refs;
}

function extractText(pNode: Element): string {
  let fullText = "";
  const tList = pNode.getElementsByTagName("w:t");
  for (let i = 0; i < tList.length; i++) fullText += tList[i].textContent || "";
  return fullText;
}

function getStyle(pNode: Element): string | null {
  const pPrList = pNode.getElementsByTagName("w:pPr");
  if (pPrList.length === 0) return null;
  const pStyleList = pPrList[0].getElementsByTagName("w:pStyle");
  if (pStyleList.length === 0) return null;
  return pStyleList[0].getAttribute("w:val") || pStyleList[0].getAttribute("val") || null;
}

function checkIsList(pNode: Element): boolean {
  const pPr = pNode.getElementsByTagName("w:pPr");
  if (pPr.length === 0) return false;
  return pPr[0].getElementsByTagName("w:numPr").length > 0;
}

function checkIsLocked(pNode: Element): boolean {
  const lockedTags = [
    "w:drawing", "drawing",
    "w:hyperlink", "hyperlink",
    "w:fldSimple", "fldSimple",
    "w:fldChar", "fldChar",
    "w:instrText", "instrText",
    "w:sdt", "sdt",
    "w:txbxContent", "txbxContent",
    "w:lastRenderedPageBreak", "lastRenderedPageBreak",
  ];
  for (const tag of lockedTags) {
    if (pNode.getElementsByTagName(tag).length > 0) return true;
  }
  const breaks = pNode.getElementsByTagName("w:br");
  for (let i = 0; i < breaks.length; i++) {
    const type = breaks[i].getAttribute("w:type") || breaks[i].getAttribute("type");
    if (type === "page") return true;
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* Text writing (keeps formatting, keeps bold label run)               */
/* ------------------------------------------------------------------ */

function isBoldRun(run: Element): boolean {
  const rPrList = run.getElementsByTagName("w:rPr");
  if (rPrList.length === 0) return false;
  const bList = rPrList[0].getElementsByTagName("w:b");
  if (bList.length === 0) return false;
  const val = bList[0].getAttribute("w:val") || bList[0].getAttribute("val");
  return val !== "false" && val !== "0";
}

function runTextOf(run: Element): string {
  const ts = run.getElementsByTagName("w:t");
  let s = "";
  for (let i = 0; i < ts.length; i++) s += ts[i].textContent || "";
  return s;
}

function setRunText(run: Element, text: string, doc: any) {
  const ts = run.getElementsByTagName("w:t");
  if (ts.length === 0) {
    const t = doc.createElement("w:t");
    run.appendChild(t);
    t.textContent = text;
    t.setAttribute("xml:space", "preserve");
    return;
  }
  ts[0].textContent = text;
  ts[0].setAttribute("xml:space", "preserve");
  for (let i = ts.length - 1; i >= 1; i--) {
    ts[i].parentNode?.removeChild(ts[i]);
  }
}

function writeTextToParagraph(pNode: Element, newText: string, doc: any) {
  const runs = Array.from(pNode.getElementsByTagName("w:r")) as Element[];

  if (runs.length === 0) {
    const r = doc.createElement("w:r");
    pNode.appendChild(r);
    setRunText(r, newText, doc);
    return;
  }

  const first = runs[0];
  const firstText = runTextOf(first);
  const label = firstText.trimEnd();
  const hasLabel =
    runs.length >= 2 &&
    isBoldRun(first) &&
    label.length > 0 &&
    runs.slice(1).some((r) => !isBoldRun(r));

  let bodyText = newText;
  let startIdx = 0;

  if (hasLabel) {
    let rest: string | null = null;
    if (newText.startsWith(firstText)) rest = newText.slice(firstText.length);
    else if (newText.startsWith(label)) rest = newText.slice(label.length).trimStart();

    if (rest !== null) {
      if (!firstText.endsWith(" ") && rest && !/^[\s,:;]/.test(rest)) rest = " " + rest;
      bodyText = rest;
      startIdx = 1; // keep the bold label run untouched
    }
  }

  // Body run = the non-bold run with the most text (fallback: longest run)
  const candidates = runs.slice(startIdx);
  const nonBold = candidates.filter((r) => !isBoldRun(r) && runTextOf(r).length > 0);
  const pool = nonBold.length > 0 ? nonBold : candidates;
  const body = pool.reduce((a, b) => (runTextOf(b).length > runTextOf(a).length ? b : a));

  for (const r of candidates) {
    if (r === body) continue;
    const ts = r.getElementsByTagName("w:t");
    for (let i = 0; i < ts.length; i++) ts[i].textContent = "";
  }
  setRunText(body, bodyText, doc);
}

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */

export function applyOperations(
  docxBuffer: Buffer | Uint8Array | ArrayBuffer,
  operations: Operation[]
): ApplyResult {
  const warnings: string[] = [];
  const buffer = Buffer.isBuffer(docxBuffer) ? docxBuffer : Buffer.from(docxBuffer as any);

  if (!operations || operations.length === 0) {
    return {
      docx: buffer,
      appliedCount: 0,
      droppedCount: 0,
      stats: { reorderedCount: 0, rewrittenCount: 0, deletedCount: 0, charDelta: 0 },
      warnings: [],
    };
  }

  const zip = new PizZip(buffer);
  const docXmlFile = zip.file("word/document.xml");
  if (!docXmlFile) throw new Error("Missing word/document.xml in DOCX zip.");

  const doc: any = new DOMParser().parseFromString(docXmlFile.asText(), "application/xml");

  const paraRefs = indexParagraphNodes(doc);
  const paraMap = new Map<number, ParaNodeRef>();
  for (const ref of paraRefs) paraMap.set(ref.id, ref);

  // Structural marks computed on ORIGINAL text, before any change
  const marks = markStructure(
    paraRefs.map((p) => ({ id: p.id, text: p.text, style: p.style, isList: p.isList }))
  );
  const isLocked = (r: ParaNodeRef) => r.locked || !!marks.get(r.id)?.structural;

  const masterText = paraRefs.map((p) => p.text).join(" ");
  const originalTotalChars = paraRefs.reduce((acc, p) => acc + p.text.length, 0);

  let appliedCount = 0;
  let droppedCount = 0;
  let reorderedCount = 0;
  let rewrittenCount = 0;
  let deletedCount = 0;

  const appliedRewrites: Array<{ id: number; origText: string; newText: string }> = [];

  const reorderOps: Extract<Operation, { type: "reorder" }>[] = [];
  const rewriteOps: Extract<Operation, { type: "rewrite" }>[] = [];
  const deleteOps: Extract<Operation, { type: "delete" }>[] = [];

  for (const op of operations) {
    if (op.type === "reorder") reorderOps.push(op);
    else if (op.type === "rewrite") rewriteOps.push(op);
    else if (op.type === "delete") deleteOps.push(op);
  }

  // --- A. Rewrites first (so reorder moves the already-rewritten nodes) ---
  for (const op of rewriteOps) {
    const { id } = op;
    const target = paraMap.get(id);

    if (!target || isLocked(target)) {
      warnings.push(`Dropped rewrite ${id}: missing or locked`);
      droppedCount++;
      continue;
    }

    // normalise: single line, trimmed
    const newText = op.text.replace(/\s*[\r\n]+\s*/g, " ").trim();
    const origText = target.text;

    if (newText.length === 0) {
      warnings.push(`Dropped rewrite ${id}: empty text`);
      droppedCount++;
      continue;
    }
    if (newText === origText.trim()) {
      warnings.push(`Skipped rewrite ${id}: identical to original`);
      droppedCount++;
      continue;
    }

    // Length: +10% for normal lines, up to 80 chars for the headline
    const origLen = origText.length;
    const isHeadline = !!marks.get(id)?.headline;
    const maxLen = isHeadline
      ? Math.max(Math.floor(origLen * 1.15), 80)
      : Math.max(Math.floor(origLen * 1.1), origLen);
    if (newText.length > maxLen) {
      warnings.push(`Dropped rewrite ${id}: length ${newText.length} > limit ${maxLen}`);
      droppedCount++;
      continue;
    }

    // Numbers must already exist in the CV
    const numbersInNew = newText.match(/\d+/g) || [];
    const badNum = numbersInNew.find((n) => !origText.includes(n) && !masterText.includes(n));
    if (badNum) {
      warnings.push(`Dropped rewrite ${id}: new number "${badNum}" not in CV`);
      droppedCount++;
      continue;
    }

    // No new links / emails
    const urlsInNew = newText.match(/https?:\/\/[^\s]+|www\.[^\s]+/gi) || [];
    const emailsInNew = newText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/gi) || [];
    if (
      urlsInNew.some((u) => !masterText.includes(u)) ||
      emailsInNew.some((e) => !masterText.includes(e))
    ) {
      warnings.push(`Dropped rewrite ${id}: new URL or email`);
      droppedCount++;
      continue;
    }

    writeTextToParagraph(target.node, newText, doc);
    appliedRewrites.push({ id, origText, newText });
    target.text = newText;

    appliedCount++;
    rewrittenCount++;
  }

  // --- B. Reorders ---
  for (const op of reorderOps) {
    const { ids } = op;

    if (ids.length < 2) {
      droppedCount++;
      continue;
    }
    if (new Set(ids).size !== ids.length) {
      warnings.push(`Dropped reorder: duplicate IDs`);
      droppedCount++;
      continue;
    }

    const targets = ids.map((id) => paraMap.get(id));
    if (targets.some((t) => !t || isLocked(t))) {
      warnings.push(`Dropped reorder [${ids.join(",")}]: missing or locked paragraph`);
      droppedCount++;
      continue;
    }
    const valid = targets as ParaNodeRef[];

    if (valid.some((t) => t.parentKey !== valid[0].parentKey)) {
      warnings.push(`Dropped reorder: different parent containers`);
      droppedCount++;
      continue;
    }

    // Same kind of paragraph: all bullets, or all non-bullets with the same style (skills lines)
    const sameKind = valid.every(
      (t) => t.isList === valid[0].isList && (t.style || "") === (valid[0].style || "")
    );
    if (!sameKind) {
      warnings.push(`Dropped reorder: mixed list/style types`);
      droppedCount++;
      continue;
    }

    // Contiguous: anything between min and max id that is NOT in the set must be an empty paragraph
    const sortedIds = [...ids].sort((a, b) => a - b);
    const idSet = new Set(ids);
    let contiguous = true;
    for (let i = sortedIds[0]; i <= sortedIds[sortedIds.length - 1]; i++) {
      if (idSet.has(i)) continue;
      const between = paraMap.get(i);
      if (between && between.text.trim().length > 0) {
        contiguous = false;
        break;
      }
    }
    if (!contiguous) {
      warnings.push(`Dropped reorder [${ids.join(",")}]: not a contiguous run`);
      droppedCount++;
      continue;
    }

    // Already in order -> nothing to do
    if (ids.every((id, i) => id === sortedIds[i])) continue;

    const parentNode = valid[0].node.parentNode;
    if (!parentNode) {
      droppedCount++;
      continue;
    }

    // Slot-based reorder: keeps any empty paragraphs in between where they are
    const slotNodes = sortedIds.map((id) => paraMap.get(id)!.node);
    const markers = slotNodes.map((n) => {
      const m = doc.createComment("slot");
      parentNode.insertBefore(m, n);
      return m;
    });
    const newOrder = ids.map((id) => paraMap.get(id)!.node);

    for (const n of slotNodes) parentNode.removeChild(n);
    newOrder.forEach((n, i) => {
      parentNode.insertBefore(n, markers[i]);
      parentNode.removeChild(markers[i]);
    });

    appliedCount++;
    reorderedCount += ids.length;
  }

  // --- C. Deletes (max 3, bullets only) ---
  const MAX_DELETIONS = 3;
  for (const op of deleteOps) {
    if (deletedCount >= MAX_DELETIONS) {
      warnings.push(`Dropped delete: max ${MAX_DELETIONS} per run`);
      droppedCount++;
      continue;
    }
    const target = paraMap.get(op.id);
    if (!target || isLocked(target) || !target.isList) {
      warnings.push(`Dropped delete ${op.id}: missing, locked or not a bullet`);
      droppedCount++;
      continue;
    }
    const parentNode = target.node.parentNode;
    if (parentNode) {
      parentNode.removeChild(target.node);
      paraMap.delete(op.id);
      appliedCount++;
      deletedCount++;
    }
  }

  // --- D. Global length guard: 103%. Revert only rewrites that GREW, biggest growth first ---
  const total = () =>
    Array.from(paraMap.values()).reduce((acc, p) => acc + p.text.length, 0);
  const maxAllowedChars = Math.floor(originalTotalChars * 1.03);
  let running = total();

  if (running > maxAllowedChars) {
    const growers = appliedRewrites
      .map((r) => ({ ...r, delta: r.newText.length - r.origText.length }))
      .filter((r) => r.delta > 0)
      .sort((a, b) => b.delta - a.delta);

    for (const item of growers) {
      if (running <= maxAllowedChars) break;
      const target = paraMap.get(item.id);
      if (!target) continue;
      writeTextToParagraph(target.node, item.origText, doc);
      target.text = item.origText;
      running -= item.delta;
      rewrittenCount--;
      appliedCount--;
      warnings.push(`Reverted rewrite ${item.id} (global length guard)`);
    }
  }

  const charDelta = total() - originalTotalChars;

  const modifiedDocXml = new XMLSerializer().serializeToString(doc);
  zip.file("word/document.xml", modifiedDocXml);
  const outputDocx = zip.generate({ type: "nodebuffer" });

  return {
    docx: outputDocx,
    appliedCount,
    droppedCount,
    stats: { reorderedCount, rewrittenCount, deletedCount, charDelta },
    warnings,
  };
}