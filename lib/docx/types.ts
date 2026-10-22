export type Para = {
  id: number; // index in document order
  text: string; // concatenated w:t text
  style: string | null; // w:pStyle value
  isList: boolean; // has w:numPr
  parentKey: string; // "body" or "tbl{i}.r{j}.c{k}" — identifies the container
  runCount: number;
  mixedFormatting: boolean; // runs have different rPr
  locked: boolean; // contains drawing, field, hyperlink, sdt, page break, or text box; never edited
};
