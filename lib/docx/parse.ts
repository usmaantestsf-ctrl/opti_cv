import PizZip from "pizzip";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { Para } from "./types";

/**
 * Checks if an element or its descendants contain locked elements:
 * drawing, field, hyperlink, sdt, page break, or text box.
 */
function isParagraphLocked(pNode: any): boolean {
  // Check for locked tags in descendants
  const lockedTags = [
    "w:drawing",
    "drawing",
    "w:hyperlink",
    "hyperlink",
    "w:fldSimple",
    "fldSimple",
    "w:fldChar",
    "fldChar",
    "w:instrText",
    "instrText",
    "w:sdt",
    "sdt",
    "w:txbxContent",
    "txbxContent",
    "w:lastRenderedPageBreak",
    "lastRenderedPageBreak",
  ];

  for (const tag of lockedTags) {
    const found = pNode.getElementsByTagName(tag);
    if (found && found.length > 0) {
      return true;
    }
  }

  // Check for page breaks in w:br (w:type="page")
  const breaks = pNode.getElementsByTagName("w:br");
  for (let i = 0; i < breaks.length; i++) {
    const br = breaks[i];
    const type = br.getAttribute("w:type") || br.getAttribute("type");
    if (type === "page") {
      return true;
    }
  }

  return false;
}

/**
 * Extracts style name from w:pPr > w:pStyle
 */
function getParagraphStyle(pNode: any): string | null {
  const pPrList = pNode.getElementsByTagName("w:pPr");
  if (pPrList.length === 0) return null;

  const pPr = pPrList[0];
  const pStyleList = pPr.getElementsByTagName("w:pStyle");
  if (pStyleList.length === 0) return null;

  const pStyle = pStyleList[0];
  return pStyle.getAttribute("w:val") || pStyle.getAttribute("val") || null;
}

/**
 * Checks if paragraph has w:pPr > w:numPr (is a list/bullet item)
 */
function isParagraphList(pNode: any): boolean {
  const pPrList = pNode.getElementsByTagName("w:pPr");
  if (pPrList.length === 0) return false;

  const pPr = pPrList[0];
  const numPrList = pPr.getElementsByTagName("w:numPr");
  return numPrList.length > 0;
}

/**
 * Extracts concatenated text and run formatting from w:p
 */
function extractParagraphRuns(pNode: any): {
  text: string;
  runCount: number;
  mixedFormatting: boolean;
} {
  const serializer = new XMLSerializer();
  let fullText = "";
  const runs = pNode.getElementsByTagName("w:r");
  const textBearingRunRPrs: string[] = [];

  for (let i = 0; i < runs.length; i++) {
    const run = runs[i];
    const tList = run.getElementsByTagName("w:t");
    let runText = "";
    for (let j = 0; j < tList.length; j++) {
      runText += tList[j].textContent || "";
    }

    if (runText.length > 0) {
      fullText += runText;
      const rPrList = run.getElementsByTagName("w:rPr");
      const rPrXml = rPrList.length > 0 ? serializer.serializeToString(rPrList[0] as unknown as any) : "";
      textBearingRunRPrs.push(rPrXml);
    }
  }

  // Check if text-bearing runs have different rPr
  let mixedFormatting = false;
  if (textBearingRunRPrs.length > 1) {
    const firstRPr = textBearingRunRPrs[0];
    for (let i = 1; i < textBearingRunRPrs.length; i++) {
      if (textBearingRunRPrs[i] !== firstRPr) {
        mixedFormatting = true;
        break;
      }
    }
  }

  return {
    text: fullText,
    runCount: runs.length,
    mixedFormatting,
  };
}

/**
 * Parses a DOCX buffer and extracts all paragraphs in document order.
 * Deterministic and validates zip / document.xml structure.
 */
export function parseDocx(buffer: Buffer | Uint8Array | ArrayBuffer): Para[] {
  let zip: PizZip;
  try {
    zip = new PizZip(buffer);
  } catch {
    throw new Error("Invalid zip file. Cannot open as DOCX.");
  }

  const docXmlFile = zip.file("word/document.xml");
  if (!docXmlFile) {
    throw new Error("Invalid DOCX. Missing word/document.xml.");
  }

  const docXmlStr = docXmlFile.asText();
  const doc = new DOMParser().parseFromString(docXmlStr, "application/xml");

  const documentElement = doc.documentElement;
  if (!documentElement) {
    throw new Error("Malformed XML in word/document.xml.");
  }

  const bodyList = documentElement.getElementsByTagName("w:body");
  if (bodyList.length === 0) {
    throw new Error("Missing w:body in word/document.xml.");
  }

  const body = bodyList[0];
  const paragraphs: Para[] = [];
  let currentId = 0;

  function traverseNode(node: any, parentKey: string) {
    const childNodes = node.childNodes;
    if (!childNodes) return;

    let tableIndex = 0;

    for (let i = 0; i < childNodes.length; i++) {
      const child = childNodes[i];
      if (child.nodeType !== 1) continue; // Only element nodes

      const el = child as Element;
      const nodeName = el.nodeName;

      if (nodeName === "w:p") {
        const { text, runCount, mixedFormatting } = extractParagraphRuns(el);
        const style = getParagraphStyle(el);
        const isList = isParagraphList(el);
        const locked = isParagraphLocked(el);

        paragraphs.push({
          id: currentId++,
          text,
          style,
          isList,
          parentKey,
          runCount,
          mixedFormatting,
          locked,
        });
      } else if (nodeName === "w:tbl") {
        const currentTableKey = parentKey === "body" ? `tbl${tableIndex}` : `${parentKey}.tbl${tableIndex}`;
        tableIndex++;

        // Process table rows and cells
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

            traverseNode(tcNode, cellKey);
          }
        }
      }
    }
  }

  traverseNode(body, "body");
  return paragraphs;
}
