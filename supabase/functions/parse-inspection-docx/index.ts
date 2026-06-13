import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { Buffer } from "node:buffer";
import mammoth from "npm:mammoth@1.8.0";
import WordExtractor from "npm:word-extractor@1.0.4";
import pdfParse from "npm:pdf-parse@1.1.1";

import { corsHeaders } from "../_shared/cors.ts";
/** Strip Markdown syntax and return clean text */
function extractTextFromMarkdown(buffer: ArrayBuffer): string {
  let text = new TextDecoder().decode(buffer);
  text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1");
  text = text.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
  text = text.replace(/^#{1,6}\s+/gm, "");
  text = text.replace(/\*{1,3}([^*]+)\*{1,3}/g, "$1");
  text = text.replace(/_{1,3}([^_]+)_{1,3}/g, "$1");
  text = text.replace(/~~([^~]+)~~/g, "$1");
  text = text.replace(/`([^`]+)`/g, "$1");
  text = text.replace(/```[\s\S]*?```/g, "");
  text = text.replace(/^>\s*/gm, "");
  text = text.replace(/^[-*_]{3,}\s*$/gm, "");
  text = text.replace(/<[^>]+>/g, "");
  text = text.replace(/\n{3,}/g, "\n\n");
  return text.trim();
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
    let fileBuffer: ArrayBuffer | null = null;
    let fileName = "document";
    let extractedText = "";

    if (contentType.includes("application/json")) {
      // Fast path: client extracted text in the browser. No file size limit.
      const body = await req.json();
      fileName = body.fileName || "document";
      extractedText = typeof body.text === "string" ? body.text : "";
      console.log(`[parse-inspection-docx] JSON path: ${extractedText.length} chars from ${fileName}`);
    } else if (contentType.includes("multipart/form-data")) {
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
      fileName = req.headers.get("x-file-name") || "document";
      fileBuffer = await req.arrayBuffer();
    }

    const ext = fileName.toLowerCase().split(".").pop();

    if (!extractedText && fileBuffer) {
      if (ext === "docx") {
        const result = await mammoth.extractRawText({ buffer: Buffer.from(fileBuffer) });
        extractedText = result.value;
      } else if (ext === "doc") {
        const extractor = new WordExtractor();
        const doc = await extractor.extract(Buffer.from(fileBuffer));
        extractedText = doc.getBody();
      } else if (ext === "pdf") {
        const data = await pdfParse(Buffer.from(fileBuffer));
        extractedText = data.text;
      } else if (ext === "md" || ext === "markdown") {
        extractedText = extractTextFromMarkdown(fileBuffer);
      } else {
        return new Response(
          JSON.stringify({ error: "Unsupported file type. Please upload a .docx, .doc, .pdf, or .md file." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    if (!extractedText || extractedText.length < 50) {
      return new Response(
        JSON.stringify({
          error: "Could not extract enough text from the document. The file may be image-based or corrupted.",
        }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Chunk long inputs instead of hard-truncating. Single-pass for small inputs
    // preserves the original behavior exactly.
    const CHUNK_THRESHOLD = 50_000;
    const CHUNK_SIZE = 45_000;
    const CHUNK_OVERLAP = 2_000;

    function chunkText(text: string): string[] {
      if (text.length <= CHUNK_THRESHOLD) return [text];
      const chunks: string[] = [];
      let start = 0;
      while (start < text.length) {
        const end = Math.min(start + CHUNK_SIZE, text.length);
        // Try to break on a paragraph/line boundary near `end` for cleaner splits
        let breakAt = end;
        if (end < text.length) {
          const windowStart = Math.max(start + CHUNK_SIZE - 500, start);
          const window = text.slice(windowStart, end);
          const lastNl = window.lastIndexOf("\n");
          if (lastNl > 0) breakAt = windowStart + lastNl;
        }
        chunks.push(text.slice(start, breakAt));
        if (breakAt >= text.length) break;
        start = Math.max(0, breakAt - CHUNK_OVERLAP);
      }
      return chunks;
    }

    const chunks = chunkText(extractedText);
    console.log(`[parse-inspection-docx] Extracted ${extractedText.length} chars from ${fileName}; ${chunks.length} chunk(s)`);
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
            report_inspection_date: {
              type: "string",
              description:
                "The date the UPLOADED report itself was performed (cover page / report header date), in YYYY-MM-DD format. This is NOT the value the report lists under its own 'Previous Inspection Date' field.",
            },
            previous_inspection_date: {
              type: "string",
              description:
                "The value the uploaded report listed under its own 'Previous Inspection Date' field (usually a prior year), in YYYY-MM-DD format. Do NOT confuse with the date the report itself was performed — that goes in report_inspection_date.",
            },
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
              description: "Operating systems / elements inspected. EXCLUDES ziplines — every zipline/zip-line/zip line element goes ONLY in the `ziplines` array.",
            },
            equipment: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  equipment_type: { type: "string" },
                  equipment_category: { type: "string", description: "Category slug: harnesses, helmets, lanyards, connectors, rope, belay, trolleys, or other" },
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
9. Include the COMPLETE summary section with repairs performed, critical actions, future considerations, and next inspection date — copy all text verbatim.
10. DATE DISAMBIGUATION: The report itself was performed on a specific date (cover page, header, or "Inspection Date" field). Put THAT date in \`report_inspection_date\`. The report also lists a separate "Previous Inspection Date" field that refers to an EARLIER inspection (usually a prior year) — put THAT value in \`previous_inspection_date\`. Never put the same date in both fields unless the document literally shows the same date for both.
11. ZIPLINE CLASSIFICATION: Any element whose name or type contains "zipline", "zip line", "zip-line", "canopy zipline", "racing zipline", or similar zipline terminology goes ONLY in the \`ziplines\` array. NEVER also list it under \`systems\`. The \`systems\` array is exclusively for non-zipline operating systems / elements (e.g. swings, climbing walls, traverses, belay systems).`;

    const buildUserPrompt = (text: string, chunkInfo?: { index: number; total: number }) => {
      const header = chunkInfo
        ? `This is chunk ${chunkInfo.index + 1} of ${chunkInfo.total} from a long inspection report. Extract every item that appears in THIS chunk. Do not infer items from missing chunks. Header fields (organization, dates, etc.) may only appear in chunk 1 — leave them null otherwise.\n\n`
        : "";
      return `${header}Extract ALL structured data from this inspection report. You MUST include:
- Every operating system/element with its name, system_name, result, and full comments (verbatim)
- Every piece of equipment with type, category, result, full comments, production_year, rope_type — do NOT include quantity
- Every zipline with all measurements (cable_type, cable_length, braking_system, ead_system, load_tension, unload_tension) and full comments
- Every standard with documentation status and full comments
- The complete summary section: repairs_performed, critical_actions, future_considerations, next_inspection_date — copy ALL text verbatim, do not summarize

Do not skip ANY item. Do not abbreviate or summarize comments. Include every single row from every table in the document.

Report text:

${text}`;
    };

    const makeAiCall = async (userMsg: string) => {
      const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        signal: AbortSignal.timeout(90_000),
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-pro",
          max_tokens: 32_768,
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

    // Extract one chunk; returns parsed data + whether the model was truncated.
    const extractChunk = async (text: string, info?: { index: number; total: number }) => {
      const data = await makeAiCall(buildUserPrompt(text, info));
      const choice = data.choices?.[0];
      const finish = choice?.finish_reason;
      const toolCall = choice?.message?.tool_calls?.[0];
      if (!toolCall?.function?.arguments) {
        throw new Error("AI did not return structured data");
      }
      let parsed: Record<string, any> = {};
      try {
        parsed = JSON.parse(toolCall.function.arguments);
      } catch (e) {
        console.error("[parse-inspection-docx] JSON parse failed for chunk", info?.index, e);
        parsed = {};
      }
      const incomplete = finish === "length" || finish === "MAX_TOKENS";
      console.log(
        `[parse-inspection-docx] chunk ${info ? info.index + 1 + "/" + info.total : "1/1"} finish=${finish} systems=${parsed.systems?.length || 0} equipment=${parsed.equipment?.length || 0} ziplines=${parsed.ziplines?.length || 0} standards=${parsed.standards?.length || 0}`,
      );
      return { parsed, incomplete };
    };

    // Run all chunks sequentially (rate-limit polite).
    const chunkResults: { parsed: Record<string, any>; incomplete: boolean }[] = [];
    for (let i = 0; i < chunks.length; i++) {
      const info = chunks.length > 1 ? { index: i, total: chunks.length } : undefined;
      const result = await extractChunk(chunks[i], info);
      chunkResults.push(result);
      if (result.incomplete) {
        console.warn(`[parse-inspection-docx] chunk ${i + 1} truncated — retrying once`);
        try {
          const retry = await extractChunk(chunks[i], info);
          chunkResults.push(retry);
        } catch (e) {
          console.error(`[parse-inspection-docx] retry failed for chunk ${i + 1}:`, e);
        }
      }
    }

    // ---- Union + dedupe merge ----
    const norm = (s: unknown) => (typeof s === "string" ? s.trim().toLowerCase().replace(/\s+/g, " ") : "");
    const commentLen = (v: unknown) => (typeof v === "string" ? v.length : 0);

    function mergeArray<T extends Record<string, any>>(
      acc: Map<string, T>,
      items: T[] | undefined,
      keyFn: (item: T) => string,
    ) {
      for (const item of items || []) {
        if (!item) continue;
        const key = keyFn(item);
        if (!key) continue;
        const existing = acc.get(key);
        if (!existing) {
          acc.set(key, item);
          continue;
        }
        // Prefer the row with the longer verbatim comments; backfill empty fields from the other.
        const winner = commentLen(item.comments) > commentLen(existing.comments) ? item : existing;
        const loser = winner === item ? existing : item;
        const merged: Record<string, any> = { ...winner };
        for (const k of Object.keys(loser)) {
          if (merged[k] == null || merged[k] === "") merged[k] = (loser as any)[k];
        }
        acc.set(key, merged as T);
      }
    }

    const systemsMap = new Map<string, any>();
    const equipmentMap = new Map<string, any>();
    const ziplinesMap = new Map<string, any>();
    const standardsMap = new Map<string, any>();

    const header: Record<string, any> = {};
    const summary: Record<string, string> = {};
    let anyIncomplete = false;

    for (const { parsed, incomplete } of chunkResults) {
      if (incomplete) anyIncomplete = true;
      for (const k of [
        "organization",
        "location",
        "onsite_contact",
        "previous_inspector",
        "report_inspection_date",
        "previous_inspection_date",
        "course_history",
      ]) {
        if (!header[k] && parsed[k]) header[k] = parsed[k];
      }
      if (parsed.summary && typeof parsed.summary === "object") {
        for (const [k, v] of Object.entries(parsed.summary)) {
          if (typeof v === "string" && v.length > (summary[k]?.length || 0)) {
            summary[k] = v;
          }
        }
      }
      mergeArray(systemsMap, parsed.systems, (s) => `${norm(s.name)}|${norm(s.system_name)}`);
      mergeArray(
        equipmentMap,
        parsed.equipment,
        (e) =>
          `${norm(e.equipment_type)}|${norm(e.equipment_category)}|${norm(e.production_year)}|${norm(e.rope_type)}`,
      );
      mergeArray(ziplinesMap, parsed.ziplines, (z) => norm(z.zipline_name));
      mergeArray(standardsMap, parsed.standards, (s) => norm(s.standard_name));
    }

    const extracted: Record<string, any> = {
      ...header,
      systems: [...systemsMap.values()],
      equipment: [...equipmentMap.values()],
      ziplines: [...ziplinesMap.values()],
      standards: [...standardsMap.values()],
      summary: Object.keys(summary).length ? summary : null,
    };

    const commentChars = (arr: { comments?: string }[] | undefined) =>
      (arr || []).reduce((acc, item) => acc + (item.comments?.length || 0), 0);
    const sumChars = Object.values(extracted.summary || {}).reduce(
      (acc: number, v) => acc + (typeof v === "string" ? v.length : 0),
      0,
    );
    console.log(
      `[parse-inspection-docx] FINAL: ${extracted.systems.length} systems (${commentChars(extracted.systems)} cc), ${extracted.equipment.length} equipment (${commentChars(extracted.equipment)} cc), ${extracted.ziplines.length} ziplines, ${extracted.standards.length} standards, summary ${sumChars} chars, incomplete=${anyIncomplete}, chunks=${chunks.length}`,
    );

    return new Response(
      JSON.stringify({
        success: true,
        data: extracted,
        truncated: false,
        incomplete: anyIncomplete,
        chunks: chunks.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("[parse-inspection-docx] Error:", error);
    if (error instanceof DOMException && error.name === "TimeoutError") {
      return new Response(JSON.stringify({ error: "AI extraction timed out. Please try a smaller file or different format." }), {
        status: 504,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    if (message === "__RATE_LIMIT__") {
      return new Response(JSON.stringify({ error: "AI rate limit exceeded. Please try again in a moment." }), {
        status: 429,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (message === "__CREDITS__") {
      return new Response(JSON.stringify({ error: "AI credits exhausted. Please add funds." }), {
        status: 402,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
