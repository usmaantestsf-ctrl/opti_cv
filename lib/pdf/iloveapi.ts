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
  const keyLabel = `...${publicKey.slice(-4)}`;

  // 1. Authenticate to get JWT token
  console.log(`[iloveapi] Key ${keyLabel}: step 1/5 POST /v1/auth...`);
  const authRes = await fetch("https://api.ilovepdf.com/v1/auth", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ public_key: publicKey, secret_key: secretKey }),
  }).catch((err) => {
    console.warn(`[iloveapi] Key ${keyLabel}: step 1 auth network error:`, err?.message || err);
    return null;
  });

  if (!authRes || !authRes.ok) {
    console.warn(`[iloveapi] Key ${keyLabel}: step 1 auth failed (status=${authRes?.status})`);
    return null;
  }
  const authData = await authRes.json().catch(() => null);
  const token = authData?.token;
  if (!token || typeof token !== "string") {
    console.warn(`[iloveapi] Key ${keyLabel}: step 1 auth token missing in response`);
    return null;
  }

  // 2. Start officepdf task
  console.log(`[iloveapi] Key ${keyLabel}: step 2/5 GET /v1/start/officepdf...`);
  const startRes = await fetch("https://api.ilovepdf.com/v1/start/officepdf", {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  }).catch((err) => {
    console.warn(`[iloveapi] Key ${keyLabel}: step 2 start network error:`, err?.message || err);
    return null;
  });

  if (!startRes || !startRes.ok) {
    console.warn(`[iloveapi] Key ${keyLabel}: step 2 start failed (status=${startRes?.status})`);
    return null;
  }
  const startData = await startRes.json().catch(() => null);
  const server = startData?.server;
  const task = startData?.task;
  if (!server || !task) {
    console.warn(`[iloveapi] Key ${keyLabel}: step 2 server/task missing in response`);
    return null;
  }
  console.log(`[iloveapi] Key ${keyLabel}: step 2 task started: server=${server}, task=${task}`);

  // 3. Upload file (multipart/form-data)
  console.log(`[iloveapi] Key ${keyLabel}: step 3/5 POST /v1/upload (${docxBuffer.length} bytes)...`);
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
  }).catch((err) => {
    console.warn(`[iloveapi] Key ${keyLabel}: step 3 upload network error:`, err?.message || err);
    return null;
  });

  if (!uploadRes || !uploadRes.ok) {
    console.warn(`[iloveapi] Key ${keyLabel}: step 3 upload failed (status=${uploadRes?.status})`);
    return null;
  }
  const uploadData = await uploadRes.json().catch(() => null);
  const serverFilename = uploadData?.server_filename;
  if (!serverFilename) {
    console.warn(`[iloveapi] Key ${keyLabel}: step 3 server_filename missing in response`);
    return null;
  }

  // 4. Process officepdf task
  console.log(`[iloveapi] Key ${keyLabel}: step 4/5 POST /v1/process...`);
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
  }).catch((err) => {
    console.warn(`[iloveapi] Key ${keyLabel}: step 4 process network error:`, err?.message || err);
    return null;
  });

  if (!processRes || !processRes.ok) {
    console.warn(`[iloveapi] Key ${keyLabel}: step 4 process failed (status=${processRes?.status})`);
    return null;
  }

  // 5. Download converted PDF
  console.log(`[iloveapi] Key ${keyLabel}: step 5/5 GET /v1/download/${task}...`);
  const downloadRes = await fetch(`https://${server}/v1/download/${task}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  }).catch((err) => {
    console.warn(`[iloveapi] Key ${keyLabel}: step 5 download network error:`, err?.message || err);
    return null;
  });

  if (!downloadRes || !downloadRes.ok) {
    console.warn(`[iloveapi] Key ${keyLabel}: step 5 download failed (status=${downloadRes?.status})`);
    return null;
  }

  const arrayBuffer = await downloadRes.arrayBuffer().catch(() => null);
  if (!arrayBuffer) {
    console.warn(`[iloveapi] Key ${keyLabel}: step 5 failed to read downloaded arrayBuffer`);
    return null;
  }

  console.log(`[iloveapi] ✓ Key ${keyLabel}: conversion pipeline succeeded (${arrayBuffer.byteLength} bytes)`);
  return Buffer.from(arrayBuffer);
}

/**
 * Converts DOCX buffer to PDF with automated dual-key fallback (FR-7).
 */
export async function convertDocxToPdf(docxBuffer: Buffer): Promise<ConvertResult> {
  const keySets = getKeySets();
  console.log(`[iloveapi] convertDocxToPdf called: ${keySets.length} key set(s) configured`);

  if (keySets.length === 0) {
    console.warn("[iloveapi] No iLoveAPI keys found in environment variables");
    return {
      ok: false,
      code: "PDF_UNAVAILABLE",
      message: "PDF conversion is unavailable right now (monthly limit reached or keys not working).",
    };
  }

  for (let keyIndex = 0; keyIndex < keySets.length; keyIndex++) {
    const keySet = keySets[keyIndex];
    // Try attempt (with 1 retry on the same key set if needed)
    for (let attempt = 0; attempt < 2; attempt++) {
      console.log(`[iloveapi] Attempting key set ${keyIndex + 1}/${keySets.length} (try ${attempt + 1}/2)...`);
      try {
        const result = await attemptConversion(keySet, docxBuffer);
        if (result && result.length > 0) {
          console.log(`[iloveapi] ✓ Conversion successful with key set ${keyIndex + 1}`);
          return {
            ok: true,
            pdfBuffer: result,
          };
        }
      } catch (err: any) {
        console.warn(`[iloveapi] Exception during attempt with key set ${keyIndex + 1}:`, err?.message || err);
      }
    }
  }

  // All key sets exhausted
  console.error("[iloveapi] ✗ All iLoveAPI key sets exhausted without success");
  return {
    ok: false,
    code: "PDF_UNAVAILABLE",
    message: "PDF conversion is unavailable right now (monthly limit reached or keys not working).",
  };
}
