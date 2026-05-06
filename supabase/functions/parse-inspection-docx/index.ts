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
          model: "google/gemini-2.5-pro",
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

    // If truncated, do a second pass for ALL sections
    if (finishReason === "length" || finishReason === "MAX_TOKENS") {
      console.warn("[parse-inspection-docx] Output was truncated — running second pass for all sections");
      partial = true;

      try {
        const secondPrompt = `The previous extraction was truncated. Extract ALL sections from this report — include every item with full verbatim comments:
1. ALL operating systems/elements with name, system_name, result, and full comments
2. ALL equipment items (type, category, result, comments, production_year, rope_type — NO quantity)
3. ALL ziplines with all measurements and full comments
4. ALL standards with documentation status and full comments
5. The complete summary section (repairs_performed, critical_actions, future_considerations, next_inspection_date) — copy ALL text verbatim

Do not skip ANY item. Do not abbreviate or summarize comments.

Report text:

${truncatedText}`;

        const secondData = await makeAiCall(secondPrompt);
        const secondCall = secondData.choices?.[0]?.message?.tool_calls?.[0];

        if (secondCall?.function?.arguments) {
          const secondExtracted = JSON.parse(secondCall.function.arguments);

          // Merge each section: keep whichever pass returned more items
          for (const section of ["systems", "equipment", "ziplines", "standards"] as const) {
            const firstLen = extracted[section]?.length || 0;
            const secondLen = secondExtracted[section]?.length || 0;
            if (secondLen > firstLen) {
              console.log(`[parse-inspection-docx] Second pass: ${section} ${secondLen} items (vs ${firstLen})`);
              extracted[section] = secondExtracted[section];
            }
          }

          // Merge summary: keep whichever has more total content (by character length)
          if (secondExtracted.summary) {
            const sumLen = (obj: Record<string, string | undefined> | undefined) =>
              Object.values(obj || {}).reduce((acc: number, v) => acc + (typeof v === "string" ? v.length : 0), 0);
            const firstSumLen = sumLen(extracted.summary);
            const secondSumLen = sumLen(secondExtracted.summary);
            if (secondSumLen > firstSumLen) {
              console.log(`[parse-inspection-docx] Second pass summary is longer (${secondSumLen} vs ${firstSumLen} chars)`);
              extracted.summary = secondExtracted.summary;
            }
          }

          // Check if second pass completed fully
          const secondFinish = secondData.choices?.[0]?.finish_reason;
          if (secondFinish !== "length" && secondFinish !== "MAX_TOKENS") {
            partial = false;
          }
        }
      } catch (retryErr) {
        console.error("[parse-inspection-docx] Second pass failed:", retryErr);
      }
    }

    // Log extraction stats with comment char counts for debugging
    const commentChars = (arr: { comments?: string }[] | undefined) =>
      (arr || []).reduce((acc, item) => acc + (item.comments?.length || 0), 0);
    const sumChars = Object.values(extracted.summary || {}).reduce((acc: number, v) => acc + (typeof v === "string" ? v.length : 0), 0);
    console.log(
      `[parse-inspection-docx] Extracted: ${extracted.systems?.length || 0} systems (${commentChars(extracted.systems)} comment chars), ${extracted.equipment?.length || 0} equipment (${commentChars(extracted.equipment)} comment chars), ${extracted.ziplines?.length || 0} ziplines, ${extracted.standards?.length || 0} standards, summary: ${sumChars} chars (partial: ${partial})`
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
