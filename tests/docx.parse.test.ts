import { describe, it, expect } from "vitest";
import PizZip from "pizzip";
import { parseDocx } from "@/lib/docx/parse";

function createTestDocx(documentXmlContent: string): Buffer {
  const zip = new PizZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
      <Default Extension="xml" ContentType="application/xml"/>
      <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
    </Types>`
  );
  zip.file("word/document.xml", documentXmlContent);
  return zip.generate({ type: "nodebuffer" });
}

describe("DOCX Parser (parseDocx)", () => {
  it("rejects invalid non-zip buffer", () => {
    const invalidBuffer = Buffer.from("not a zip file");
    expect(() => parseDocx(invalidBuffer)).toThrow("Invalid zip file");
  });

  it("rejects zip without word/document.xml", () => {
    const zip = new PizZip();
    zip.file("hello.txt", "world");
    const buffer = zip.generate({ type: "nodebuffer" });
    expect(() => parseDocx(buffer)).toThrow("Missing word/document.xml");
  });

  it("parses paragraphs, styles, lists, and tables in document order", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
      <w:body>
        <w:p>
          <w:pPr><w:pStyle w:val="Heading1"/></w:pPr>
          <w:r><w:t>John Doe</w:t></w:r>
        </w:p>
        <w:p>
          <w:pPr>
            <w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>
          </w:pPr>
          <w:r><w:t>Bullet point 1</w:t></w:r>
        </w:p>
        <w:tbl>
          <w:tr>
            <w:tc>
              <w:p>
                <w:r><w:t>Table cell paragraph</w:t></w:r>
              </w:p>
            </w:tc>
          </w:tr>
        </w:tbl>
      </w:body>
    </w:document>`;

    const docx = createTestDocx(xml);
    const paras = parseDocx(docx);

    expect(paras).toHaveLength(3);

    // Para 0: Heading
    expect(paras[0].id).toBe(0);
    expect(paras[0].text).toBe("John Doe");
    expect(paras[0].style).toBe("Heading1");
    expect(paras[0].isList).toBe(false);
    expect(paras[0].parentKey).toBe("body");
    expect(paras[0].locked).toBe(false);

    // Para 1: Bullet
    expect(paras[1].id).toBe(1);
    expect(paras[1].text).toBe("Bullet point 1");
    expect(paras[1].isList).toBe(true);
    expect(paras[1].parentKey).toBe("body");

    // Para 2: In Table
    expect(paras[2].id).toBe(2);
    expect(paras[2].text).toBe("Table cell paragraph");
    expect(paras[2].parentKey).toBe("tbl0.r0.c0");
    expect(paras[2].locked).toBe(false);
  });

  it("flags locked paragraphs correctly", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
      <w:body>
        <w:p>
          <w:hyperlink><w:r><w:t>https://example.com</w:t></w:r></w:hyperlink>
        </w:p>
        <w:p>
          <w:r><w:drawing><w:inline/></w:drawing><w:t>Photo</w:t></w:r>
        </w:p>
        <w:p>
          <w:r><w:br w:type="page"/></w:r>
        </w:p>
      </w:body>
    </w:document>`;

    const docx = createTestDocx(xml);
    const paras = parseDocx(docx);

    expect(paras).toHaveLength(3);
    expect(paras[0].locked).toBe(true);
    expect(paras[1].locked).toBe(true);
    expect(paras[2].locked).toBe(true);
  });

  it("detects mixed formatting across runs", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
      <w:body>
        <w:p>
          <w:r><w:rPr><w:b/></w:rPr><w:t>Bold</w:t></w:r>
          <w:r><w:t> Regular</w:t></w:r>
        </w:p>
      </w:body>
    </w:document>`;

    const docx = createTestDocx(xml);
    const paras = parseDocx(docx);

    expect(paras).toHaveLength(1);
    expect(paras[0].text).toBe("Bold Regular");
    expect(paras[0].mixedFormatting).toBe(true);
  });
});
