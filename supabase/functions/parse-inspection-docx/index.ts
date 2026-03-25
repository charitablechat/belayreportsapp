import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/** Rough text extraction from a .docx (ZIP of XML). */
async function extractTextFromDocx(buffer: ArrayBuffer): Promise<string> {
  // docx is a ZIP; we look for word/document.xml
  const uint8 = new Uint8Array(buffer);

  // Find PK signature pairs for local file headers
  const files: { name: string; data: Uint8Array }[] = [];

  // Minimal ZIP parsing — find central directory entries
  // We'll use a simpler approach: search for "word/document.xml" inside the zip
  // and extract the XML content between the file data markers.

  // Use DecompressionStream if available (Deno supports it)
  const zipEntries = await parseZipEntries(uint8);

  let fullText = "";

  // Process main document and any headers/footers
  const xmlFiles = ["word/document.xml", "word/header1.xml", "word/header2.xml", "word/footer1.xml", "word/footer2.xml"];

  for (const xmlFile of xmlFiles) {
    const entry = zipEntries.find((e) => e.name === xmlFile);
    if (entry) {
      const xml = new TextDecoder().decode(entry.data);
      // Extract text from XML by removing tags and keeping text content
      const text = extractTextFromXml(xml);
      if (text.trim()) {
        fullText += text + "\n\n";
      }
    }
  }

  return fullText.trim();
}

/** Minimal ZIP parser for deflate-compressed entries */
async function parseZipEntries(data: Uint8Array): Promise<{ name: string; data: Uint8Array }[]> {
  const entries: { name: string; data: Uint8Array }[] = [];
  let offset = 0;

  while (offset < data.length - 4) {
    const sig =
      data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16) | (data[offset + 3] << 24);

    if (sig !== 0x04034b50) break; // Not a local file header

    const compressionMethod = data[offset + 8] | (data[offset + 9] << 8);
    const compressedSize =
      data[offset + 18] |
      (data[offset + 19] << 8) |
      (data[offset + 20] << 16) |
      (data[offset + 21] << 24);
    const uncompressedSize =
      data[offset + 22] |
      (data[offset + 23] << 8) |
      (data[offset + 24] << 16) |
      (data[offset + 25] << 24);
    const nameLen = data[offset + 26] | (data[offset + 27] << 8);
    const extraLen = data[offset + 28] | (data[offset + 29] << 8);

    const name = new TextDecoder().decode(data.slice(offset + 30, offset + 30 + nameLen));
    const dataStart = offset + 30 + nameLen + extraLen;

    const rawData = data.slice(dataStart, dataStart + compressedSize);

    if (name.endsWith(".xml") || name.endsWith(".rels")) {
      try {
        let decompressed: Uint8Array;
        if (compressionMethod === 8) {
          // Deflate
          const ds = new DecompressionStream("deflate-raw");
          const writer = ds.writable.getWriter();
          const reader = ds.readable.getReader();

          writer.write(rawData);
          writer.close();

          const chunks: Uint8Array[] = [];
          let totalLen = 0;
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            totalLen += value.length;
          }
          decompressed = new Uint8Array(totalLen);
          let pos = 0;
          for (const chunk of chunks) {
            decompressed.set(chunk, pos);
            pos += chunk.length;
          }
        } else {
          // Stored (no compression)
          decompressed = rawData;
        }
        entries.push({ name, data: decompressed });
      } catch {
        // Skip entries that fail to decompress
      }
    }

    offset = dataStart + compressedSize;
  }

  return entries;
}

/** Extract readable text from OOXML content */
function extractTextFromXml(xml: string): string {
  // Replace paragraph breaks with newlines
  let text = xml.replace(/<\/w:p[^>]*>/gi, "\n");
  // Replace table cell/row boundaries
  text = text.replace(/<\/w:tc>/gi, "\t");
  text = text.replace(/<\/w:tr>/gi, "\n");
  // Remove all remaining XML tags
  text = text.replace(/<[^>]+>/g, "");
  // Decode common XML entities
  text = text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x2019;/g, "'")
    .replace(/&#x201C;/g, '"')
    .replace(/&#x201D;/g, '"');
  // Collapse multiple blank lines
  text = text.replace(/\n{3,}/g, "\n\n");
  return text.trim();
}

/** Extract text from legacy .doc (OLE2 binary) — scans for readable text sequences */
function extractTextFromDoc(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const textParts: string[] = [];

  // Try UTF-16LE extraction (common in .doc files)
  let i = 0;
  let currentRun = "";
  while (i < bytes.length - 1) {
    const lo = bytes[i];
    const hi = bytes[i + 1];
    // Printable ASCII as UTF-16LE (hi byte = 0, lo byte is printable)
    if (hi === 0 && lo >= 0x20 && lo <= 0x7E) {
      currentRun += String.fromCharCode(lo);
    } else if (hi === 0 && (lo === 0x0D || lo === 0x0A || lo === 0x09)) {
      currentRun += lo === 0x09 ? "\t" : "\n";
    } else {
      if (currentRun.length >= 8) {
        textParts.push(currentRun.trim());
      }
      currentRun = "";
    }
    i += 2;
  }
  if (currentRun.length >= 8) {
    textParts.push(currentRun.trim());
  }

  if (textParts.length > 0) {
    return textParts.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  // Fallback: grab printable ASCII sequences
  const raw = new TextDecoder("latin1").decode(bytes);
  const printable = raw.replace(/[^\x20-\x7E\n\r\t]/g, " ").replace(/\s{3,}/g, "\n");
  return printable.slice(0, 15000).trim();
}

/** Strip Markdown syntax and return clean text */
function extractTextFromMarkdown(buffer: ArrayBuffer): string {
  let text = new TextDecoder().decode(buffer);
  // Remove images
  text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1");
  // Convert links to just text
  text = text.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
  // Remove headers markup
  text = text.replace(/^#{1,6}\s+/gm, "");
  // Remove bold/italic
  text = text.replace(/\*{1,3}([^*]+)\*{1,3}/g, "$1");
  text = text.replace(/_{1,3}([^_]+)_{1,3}/g, "$1");
  // Remove strikethrough
  text = text.replace(/~~([^~]+)~~/g, "$1");
  // Remove inline code
  text = text.replace(/`([^`]+)`/g, "$1");
  // Remove code blocks
  text = text.replace(/```[\s\S]*?```/g, "");
  // Remove blockquotes
  text = text.replace(/^>\s*/gm, "");
  // Remove horizontal rules
  text = text.replace(/^[-*_]{3,}\s*$/gm, "");
  // Remove HTML tags
  text = text.replace(/<[^>]+>/g, "");
  // Collapse whitespace
  text = text.replace(/\n{3,}/g, "\n\n");
  return text.trim();
}

/** Simple text extraction from PDF — grabs text between stream markers */
function extractTextFromPdf(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const raw = new TextDecoder("latin1").decode(bytes);

  // Try to extract text objects: BT ... ET blocks with Tj/TJ operators
  const textParts: string[] = [];
  const btBlocks = raw.matchAll(/BT\s([\s\S]*?)ET/g);
  for (const match of btBlocks) {
    const block = match[1];
    // Extract parenthesized strings from Tj operators
    const tjMatches = block.matchAll(/\(([^)]*)\)\s*Tj/g);
    for (const tj of tjMatches) {
      textParts.push(tj[1]);
    }
    // Extract from TJ arrays
    const tjArrayMatches = block.matchAll(/\[(.*?)\]\s*TJ/g);
    for (const tja of tjArrayMatches) {
      const innerMatches = tja[1].matchAll(/\(([^)]*)\)/g);
      for (const inner of innerMatches) {
        textParts.push(inner[1]);
      }
    }
  }

  if (textParts.length > 0) {
    return textParts.join(" ").replace(/\s+/g, " ").trim();
  }

  // Fallback: just grab printable ASCII sequences (lossy but better than nothing)
  const printable = raw.replace(/[^\x20-\x7E\n\r\t]/g, " ").replace(/\s{3,}/g, "\n");
  // Take first ~10000 chars
  return printable.slice(0, 10000).trim();
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    const contentType = req.headers.get("content-type") || "";
    let fileBuffer: ArrayBuffer;
    let fileName = "document";

    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      const file = formData.get("file") as File | null;
      if (!file) {
        return new Response(JSON.stringify({ error: "No file provided" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      fileName = file.name;
      fileBuffer = await file.arrayBuffer();
    } else {
      // Accept raw binary with filename in header
      fileName = req.headers.get("x-file-name") || "document";
      fileBuffer = await req.arrayBuffer();
    }

    // Determine file type
    const ext = fileName.toLowerCase().split(".").pop();
    let extractedText = "";

    if (ext === "docx") {
      extractedText = await extractTextFromDocx(fileBuffer);
  } else if (ext === "doc") {
      extractedText = extractTextFromDoc(fileBuffer);
    } else if (ext === "pdf") {
      extractedText = extractTextFromPdf(fileBuffer);
    } else if (ext === "md" || ext === "markdown") {
      extractedText = extractTextFromMarkdown(fileBuffer);
    } else {
      return new Response(
        JSON.stringify({ error: "Unsupported file type. Please upload a .docx, .doc, .pdf, or .md file." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!extractedText || extractedText.length < 50) {
      return new Response(
        JSON.stringify({
          error: "Could not extract enough text from the document. The file may be image-based or corrupted.",
        }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Truncate to avoid exceeding token limits
    const maxChars = 60000;
    const wasTruncated = extractedText.length > maxChars;
    const truncatedText = wasTruncated
      ? extractedText.slice(0, maxChars) + "\n\n[...truncated...]"
      : extractedText;

    console.log(`[parse-inspection-docx] Extracted ${extractedText.length} chars from ${fileName} (truncated: ${wasTruncated})`);
    console.log(`[parse-inspection-docx] First 500 chars:\n${extractedText.slice(0, 500)}`);

    // Call AI to extract structured data
    const toolSchema = {
      type: "function" as const,
      function: {
        name: "extract_inspection_data",
        description: "Extract structured inspection report data",
        parameters: {
          type: "object",
          properties: {
            organization: { type: "string", description: "Organization/facility name" },
            location: { type: "string", description: "Location/address" },
            onsite_contact: { type: "string", description: "Onsite contact person" },
            previous_inspector: { type: "string", description: "Inspector who performed the inspection" },
            previous_inspection_date: { type: "string", description: "Date of inspection in YYYY-MM-DD format" },
            course_history: { type: "string", description: "Known course history or notes" },
            systems: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  system_name: { type: "string", description: "Category or type of system" },
                  result: { type: "string" },
                  comments: { type: "string" },
                },
                required: ["name"],
              },
              description: "Operating systems / elements inspected",
            },
            equipment: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  equipment_type: { type: "string" },
                  equipment_category: { type: "string" },
                  result: { type: "string" },
                  comments: { type: "string" },
                  production_year: { type: "string" },
                  rope_type: { type: "string" },
                },
                required: ["equipment_type", "equipment_category"],
              },
              description: "Equipment items (PPE, hardware, ropes, etc.) — do NOT include quantity",
            },
            ziplines: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  zipline_name: { type: "string" },
                  cable_type: { type: "string" },
                  cable_length: { type: "number" },
                  braking_system: { type: "string" },
                  ead_system: { type: "string" },
                  load_tension: { type: "number" },
                  unload_tension: { type: "number" },
                  result: { type: "string" },
                  comments: { type: "string" },
                },
                required: ["zipline_name"],
              },
              description: "Zipline elements",
            },
            standards: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  standard_name: { type: "string" },
                  has_documentation: { type: "boolean" },
                  comments: { type: "string" },
                },
                required: ["standard_name"],
              },
              description: "Standards / compliance items",
            },
            summary: {
              type: "object",
              properties: {
                repairs_performed: { type: "string" },
                critical_actions: { type: "string" },
                future_considerations: { type: "string" },
                next_inspection_date: { type: "string" },
              },
              description: "Inspection summary section",
            },
          },
          required: ["organization"],
        },
      },
    };

    const systemPrompt = `You are an expert at parsing adventure park / ropes course inspection reports. Extract structured data from the report text provided.

CRITICAL RULES:
1. Extract ONLY items that are EXPLICITLY listed in the document text. Do NOT invent, infer, or fabricate any items that are not present in the source.
2. Preserve all comments, notes, and descriptions EXACTLY as written in the source document — do not paraphrase, summarize, or reword them.
3. Each element's name, type, and category must match the source document VERBATIM. Do not rename or normalize them.
4. If a section (systems, equipment, ziplines, standards) has no items in the document, return an empty array for that section.
5. For results, use the EXACT original values from the report (e.g. "Pass", "Fail", "Acceptable", "Needs Repair", "N/A", etc.). Do not standardize or change result values.
6. If a field value is not found in the document, use null — do not guess or fill in default values.
7. Include ALL items from every section — do not skip any element that appears in the document.
8. Do NOT include equipment quantity — omit it entirely.
9. Include the COMPLETE summary section with repairs performed, critical actions, future considerations, and next inspection date — copy all text verbatim.`;

    const userPrompt = `Extract ALL structured data from this inspection report. You MUST include:
- Every operating system/element with its name, system_name, result, and full comments (verbatim)
- Every piece of equipment with type, category, result, full comments, production_year, rope_type — do NOT include quantity
- Every zipline with all measurements (cable_type, cable_length, braking_system, ead_system, load_tension, unload_tension) and full comments
- Every standard with documentation status and full comments
- The complete summary section: repairs_performed, critical_actions, future_considerations, next_inspection_date — copy ALL text verbatim, do not summarize

Do not skip ANY item. Do not abbreviate or summarize comments. Include every single row from every table in the document.

Report text:

${truncatedText}`;

    const makeAiCall = async (userMsg: string) => {
      const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        signal: AbortSignal.timeout(90_000),
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          max_tokens: 16384,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userMsg },
          ],
          tools: [toolSchema],
          tool_choice: { type: "function", function: { name: "extract_inspection_data" } },
        }),
      });

      if (!resp.ok) {
        if (resp.status === 429) throw new Error("__RATE_LIMIT__");
        if (resp.status === 402) throw new Error("__CREDITS__");
        const errText = await resp.text();
        console.error("[parse-inspection-docx] AI error:", resp.status, errText);
        throw new Error("AI extraction failed");
      }

      return resp.json();
    };

    // First pass
    const aiData = await makeAiCall(userPrompt);
    const choice = aiData.choices?.[0];
    const finishReason = choice?.finish_reason;
    const usage = aiData.usage;

    console.log(`[parse-inspection-docx] finish_reason: ${finishReason}, usage: prompt=${usage?.prompt_tokens}, completion=${usage?.completion_tokens}`);

    const toolCall = choice?.message?.tool_calls?.[0];
    if (!toolCall?.function?.arguments) {
      throw new Error("AI did not return structured data");
    }

    let extracted = JSON.parse(toolCall.function.arguments);
    let partial = false;

    // If truncated, do a second pass for commonly dropped sections
    if (finishReason === "length" || finishReason === "MAX_TOKENS") {
      console.warn("[parse-inspection-docx] Output was truncated — running second pass for equipment & summary");
      partial = true;

      try {
        const secondPrompt = `The previous extraction was truncated. Extract ONLY the following sections from this report — include every item with full verbatim comments:
1. ALL equipment items (type, category, result, comments, production_year, rope_type — NO quantity)
2. The complete summary section (repairs_performed, critical_actions, future_considerations, next_inspection_date)

Report text:

${truncatedText}`;

        const secondData = await makeAiCall(secondPrompt);
        const secondCall = secondData.choices?.[0]?.message?.tool_calls?.[0];

        if (secondCall?.function?.arguments) {
          const secondExtracted = JSON.parse(secondCall.function.arguments);

          // Merge: use second pass data if first pass had fewer or empty results
          if (secondExtracted.equipment?.length > (extracted.equipment?.length || 0)) {
            console.log(`[parse-inspection-docx] Second pass found ${secondExtracted.equipment.length} equipment (vs ${extracted.equipment?.length || 0})`);
            extracted.equipment = secondExtracted.equipment;
          }
          if (secondExtracted.summary && !extracted.summary?.repairs_performed && !extracted.summary?.critical_actions) {
            console.log("[parse-inspection-docx] Using summary from second pass");
            extracted.summary = secondExtracted.summary;
          }

          // Check if second pass completed fully
          const secondFinish = secondData.choices?.[0]?.finish_reason;
          if (secondFinish !== "length" && secondFinish !== "MAX_TOKENS") {
            partial = false; // second pass got everything
          }
        }
      } catch (retryErr) {
        console.error("[parse-inspection-docx] Second pass failed:", retryErr);
        // Keep partial = true so client shows warning
      }
    }

    console.log(
      `[parse-inspection-docx] Extracted: ${extracted.systems?.length || 0} systems, ${extracted.equipment?.length || 0} equipment, ${extracted.ziplines?.length || 0} ziplines, ${extracted.standards?.length || 0} standards (partial: ${partial})`
    );

    return new Response(JSON.stringify({ success: true, data: extracted, truncated: wasTruncated, partial }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[parse-inspection-docx] Error:", error);
    if (error instanceof DOMException && error.name === "TimeoutError") {
      return new Response(JSON.stringify({ error: "AI extraction timed out. Please try a smaller file or different format." }), {
        status: 504,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
