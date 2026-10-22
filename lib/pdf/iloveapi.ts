interface KeySet {
  publicKey: string;
  secretKey: string;
}

export interface ConvertResultSuccess {
  ok: true;
  pdfBuffer: Buffer;
}

export interface ConvertResultFailure {
  ok: false;
  code: "PDF_UNAVAILABLE";
  message: string;
}

export type ConvertResult = ConvertResultSuccess | ConvertResultFailure;

function getKeySets(): KeySet[] {
  const sets: KeySet[] = [];

  const pub1 = process.env.ILOVEAPI_PUBLIC_KEY_1?.trim();
  const sec1 = process.env.ILOVEAPI_SECRET_KEY_1?.trim();
  if (pub1 && sec1) {
    sets.push({ publicKey: pub1, secretKey: sec1 });
  }

  const pub2 = process.env.ILOVEAPI_PUBLIC_KEY_2?.trim();
  const sec2 = process.env.ILOVEAPI_SECRET_KEY_2?.trim();
  if (pub2 && sec2) {
    sets.push({ publicKey: pub2, secretKey: sec2 });
  }

  return sets;
}

/**
 * Attempts a full iLoveAPI conversion pipeline on a specific key set.
 */
async function attemptConversion(
  keySet: KeySet,
  docxBuffer: Buffer
): Promise<Buffer | null> {
  const { publicKey, secretKey } = keySet;

  // 1. Authenticate to get JWT token
  const authRes = await fetch("https://api.ilovepdf.com/v1/auth", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ public_key: publicKey, secret_key: secretKey }),
  }).catch(() => null);

  if (!authRes || !authRes.ok) return null;
  const authData = await authRes.json().catch(() => null);
  const token = authData?.token;
  if (!token || typeof token !== "string") return null;

  // 2. Start officepdf task
  const startRes = await fetch("https://api.ilovepdf.com/v1/start/officepdf", {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  }).catch(() => null);

  if (!startRes || !startRes.ok) return null;
  const startData = await startRes.json().catch(() => null);
  const server = startData?.server;
  const task = startData?.task;
  if (!server || !task) return null;

  // 3. Upload file (multipart/form-data)
  const formData = new FormData();
  formData.append("task", task);
  const blob = new Blob([new Uint8Array(docxBuffer)], {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
  formData.append("file", blob, "document.docx");

  const uploadRes = await fetch(`https://${server}/v1/upload`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  }).catch(() => null);

  if (!uploadRes || !uploadRes.ok) return null;
  const uploadData = await uploadRes.json().catch(() => null);
  const serverFilename = uploadData?.server_filename;
  if (!serverFilename) return null;

  // 4. Process officepdf task
  const processRes = await fetch(`https://${server}/v1/process`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      task,
      tool: "officepdf",
      files: [
        {
          server_filename: serverFilename,
          filename: "document.docx",
        },
      ],
    }),
  }).catch(() => null);

  if (!processRes || !processRes.ok) return null;

  // 5. Download converted PDF
  const downloadRes = await fetch(`https://${server}/v1/download/${task}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  }).catch(() => null);

  if (!downloadRes || !downloadRes.ok) return null;

  const arrayBuffer = await downloadRes.arrayBuffer().catch(() => null);
  if (!arrayBuffer) return null;

  return Buffer.from(arrayBuffer);
}

/**
 * Converts DOCX buffer to PDF with automated dual-key fallback (FR-7).
 */
export async function convertDocxToPdf(docxBuffer: Buffer): Promise<ConvertResult> {
  const keySets = getKeySets();

  if (keySets.length === 0) {
    return {
      ok: false,
      code: "PDF_UNAVAILABLE",
      message: "PDF conversion is unavailable right now (monthly limit reached or keys not working).",
    };
  }

  for (const keySet of keySets) {
    // Try attempt (with 1 retry on the same key set if needed)
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const result = await attemptConversion(keySet, docxBuffer);
        if (result && result.length > 0) {
          return {
            ok: true,
            pdfBuffer: result,
          };
        }
      } catch {
        // Retry once on network failure
      }
    }
  }

  // All key sets exhausted
  return {
    ok: false,
    code: "PDF_UNAVAILABLE",
    message: "PDF conversion is unavailable right now (monthly limit reached or keys not working).",
  };
}
