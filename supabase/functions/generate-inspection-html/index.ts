import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import {
  getLogoBase64,
  buildAdminEditBanner,
  buildAttestationBlock,
  buildVersionFooter,
  fetchPostCompletionEdits,
} from "../_shared/report-layout.ts";

// arrayBufferToBase64 removed — photos now use signed URLs instead of base64

function deduplicateHtmlContent(html: string | null): string {
  if (!html) return "";

  const listItemRegex = /<li>(.*?)<\/li>/gi;
  const uniqueItems = new Map<string, string>();
  let match;

  // Extract and deduplicate list items
  while ((match = listItemRegex.exec(html)) !== null) {
    const content = match[1].trim();
    const contentLower = content.toLowerCase();

    // Normalize content for better matching (remove extra spaces, punctuation differences)
    const normalizedContent = contentLower
      .replace(/[.,;:!?]+$/, "") // Remove trailing punctuation
      .replace(/\s+/g, " ") // Normalize whitespace
      .trim();

    // Skip empty items
    if (!content || !normalizedContent) continue;

    // Check for semantic duplicates (items that say the same thing)
    let isDuplicate = false;
    for (const [existingKey] of uniqueItems) {
      const normalizedExisting = existingKey
        .replace(/[.,;:!?]+$/, "")
        .replace(/\s+/g, " ")
        .trim();

      // Check if this item is essentially the same as an existing one
      if (
        normalizedContent === normalizedExisting ||
        normalizedContent.includes(normalizedExisting) ||
        normalizedExisting.includes(normalizedContent)
      ) {
        isDuplicate = true;
        break;
      }
    }

    if (!isDuplicate) {
      uniqueItems.set(contentLower, content);
    }
  }

  // If we found list items, return optimized list
  if (uniqueItems.size > 0) {
    const items = Array.from(uniqueItems.values())
      .map((item) => `<li>${item}</li>`)
      .join("\n");
    return `<ul class="bullet-list">\n${items}\n</ul>`;
  }

  // Handle non-list content: deduplicate lines
  const lines = html
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const uniqueLines = new Map<string, string>();

  lines.forEach((line) => {
    const lineLower = line
      .toLowerCase()
      .replace(/[.,;:!?]+$/, "")
      .replace(/\s+/g, " ")
      .trim();

    if (lineLower && !uniqueLines.has(lineLower)) {
      uniqueLines.set(lineLower, line);
    }
  });

  return Array.from(uniqueLines.values()).join("\n");
}

// Helper function to strip HTML tags while preserving line breaks
function stripHtmlTags(html: string | null | undefined): string {
  if (!html) return '';
  return html
    // Convert block-level elements to newlines first
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    // Remove remaining HTML tags
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    // Collapse multiple spaces (but preserve newlines)
    .replace(/[ \t]+/g, ' ')
    .trim();
}

// Helper function to parse text content into a bullet list array
// Each line becomes a separate bullet point
function parseTextToList(textContent: string | null | undefined): string[] {
  if (!textContent) return [];
  
  const text = stripHtmlTags(textContent);
  if (!text || text === 'N/A') return [];
  
  // Split by newlines - each line becomes a bullet point
  let items = text.split(/\n/).map(item => item.trim()).filter(Boolean);
  
  // Clean up each item - remove leading bullets/dashes/numbers if present
  items = items.map(item => {
    return item
      .replace(/^[\-•●○◦▪▸►]\s*/, '') // Remove bullet characters
      .replace(/^\d+[.)]\s*/, '') // Remove numbered list markers
      .trim();
  }).filter(Boolean);
  
  return items;
}

// Helper to render a bullet list from array
function renderBulletList(items: string[], fallbackHtml: string): string {
  if (items.length > 0) {
    return `<ul class="summary-list" style="list-style: disc; list-style-position: outside; padding-left: 24px; margin: 0;">
      ${items.map(item => `<li style="display: list-item; list-style-type: disc; padding: 6px 0; margin: 0 0 4px 0; line-height: 1.5; background: none; border-left: none;">${item}</li>`).join('')}
    </ul>`;
  }
  return fallbackHtml;
}

// Helper: prepend default bolt text for systems/ziplines in reports
function prependDefaultBolt(comments: string | null | undefined): string {
  const defaultText = "Tightened bolts and connectors as needed";
  if (!comments || comments.trim() === "" || comments === "—") {
    return `<p>${defaultText}</p>`;
  }
  if (comments.includes(defaultText)) return comments;
  return `<p>${defaultText}</p>${comments}`;
}

// Helper to format comments as bullet points for table cells
function formatCommentsAsBullets(comments: string | null | undefined): string {
  if (!comments || comments === "—" || comments.trim() === "") return "—";
  
  const items = parseTextToList(comments);
  if (items.length === 0) return "—";
  
  // Always render as bullet list
  return `<ul class="comment-bullets" style="list-style: disc; padding-left: 16px; margin: 0;">
    ${items.map(item => `<li style="padding: 2px 0; line-height: 1.4;">${item}</li>`).join('')}
  </ul>`;
}


serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Authorization: require service-role (internal/backup) or valid user JWT.
    // Ownership is enforced post-fetch (owner or admin/super_admin).
    const authHeader = req.headers.get("Authorization");
    const token = authHeader?.replace("Bearer ", "") ?? "";
    if (!token) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const isServiceRole = token === supabaseKey;
    let callerUserId: string | null = null;
    if (!isServiceRole) {
      const { data: { user }, error: authError } = await supabase.auth.getUser(token);
      if (authError || !user) {
        return new Response(
          JSON.stringify({ error: "Unauthorized" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      callerUserId = user.id;
    }

    const { inspectionId, forceRegenerate } = await req.json();

    if (!inspectionId) {
      throw new Error("Inspection ID is required");
    }

    console.log(`Generating HTML for inspection: ${inspectionId}`);

    // OPTIMIZATION: Parallelize logo fetch with initial DB query
    const [logos, inspectionResult] = await Promise.all([
      getLogoBase64(),
      supabase
        .from("inspections")
        .select(
          `
          *,
          profiles!inspections_inspector_id_profiles_fkey (
            first_name,
            last_name,
            acct_number
          )
        `,
        )
        .eq("id", inspectionId)
        .single(),
    ]);

    const belayReportsLogo = logos.belayReports;
    const acctLogo = logos.acct;

    const { data: inspection, error: inspectionError } = inspectionResult;
    if (inspectionError) throw inspectionError;
    if (!inspection) throw new Error("Inspection not found");

    // Ownership check: owner OR admin/super_admin. Service-role callers bypass.
    if (!isServiceRole && callerUserId && inspection.inspector_id !== callerUserId) {
      const { data: roleRow } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", callerUserId)
        .in("role", ["admin", "super_admin"])
        .maybeSingle();
      if (!roleRow) {
        return new Response(
          JSON.stringify({ error: "Forbidden" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    // OPTIMIZATION: Server-side cache check — skip regeneration if nothing changed
    if (!forceRegenerate && inspection.latest_report_generated_at && inspection.updated_at) {
      const generatedAt = new Date(inspection.latest_report_generated_at).getTime();
      const updatedAt = new Date(inspection.updated_at).getTime();
      
      if (generatedAt >= updatedAt && inspection.latest_report_html) {
        console.log(`[generate-inspection-html] Cache HIT — no changes since last generation. Returning cached report.`);
        return new Response(
          JSON.stringify({ html: inspection.latest_report_html, cached: true }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
        );
      }
      console.log(`[generate-inspection-html] Cache MISS — report data changed since last generation.`);
    }

    // Fetch related data including photos
    const [equipmentRes, standardsRes, systemsRes, ziplinesRes, summaryRes, photosRes] = await Promise.all([
      supabase.from("inspection_equipment").select("*").eq("inspection_id", inspectionId).order("display_order"),
      supabase.from("inspection_standards").select("*").eq("inspection_id", inspectionId),
      supabase.from("inspection_systems").select("*").eq("inspection_id", inspectionId).order("display_order"),
      supabase.from("inspection_ziplines").select("*").eq("inspection_id", inspectionId).order("display_order"),
      supabase.from("inspection_summary").select("*").eq("inspection_id", inspectionId).single(),
      supabase.from("inspection_photos").select("*").eq("inspection_id", inspectionId).is("deleted_at", null).order("display_order"),
    ]);

    const equipment = equipmentRes.data || [];
    const standards = standardsRes.data || [];
    const systems = systemsRes.data || [];
    const ziplines = ziplinesRes.data || [];
    const summary = summaryRes.data;
    const photos = photosRes.data || [];

    // Admin-edit banner intentionally disabled — audit trail lives in the admin panel only.
    const adminEditBannerHtml = '';

    console.log(`[Inspection HTML] Found ${photos.length} photos for inspection ${inspectionId}`);

    // Use signed URLs for photos instead of downloading and converting to base64
    // This eliminates the 10-25s photo processing bottleneck entirely
    const SIGNED_URL_EXPIRY = 86400; // 24 hours
    const photoStart = Date.now();

    // Generate signed URLs for gallery photos (near-instant vs downloading files)
    const gallerySignedUrls: { id: string; signedUrl: string; caption: string; section: string; photoPath: string }[] = [];
    if (photos.length > 0) {
      console.log(`[Inspection HTML] Generating signed URLs for ${photos.length} gallery photos`);
      const paths = photos.map((p: any) => p.photo_url);
      const { data: signedData, error: signedError } = await supabase
        .storage.from('inspection-photos')
        .createSignedUrls(paths, SIGNED_URL_EXPIRY);
      
      if (!signedError && signedData) {
        const seenPhotoKeys = new Set<string>();
        for (let i = 0; i < signedData.length; i++) {
          if (signedData[i].error || !signedData[i].signedUrl) continue;
          const photo = photos[i];
          const dedupeKey = `${photo.photo_section || 'general'}::${photo.photo_url}`;
          if (!seenPhotoKeys.has(dedupeKey)) {
            seenPhotoKeys.add(dedupeKey);
            gallerySignedUrls.push({
              id: photo.id,
              signedUrl: signedData[i].signedUrl,
              caption: photo.caption || '',
              section: photo.photo_section || 'general',
              photoPath: photo.photo_url,
            });
          }
        }
      } else {
        console.error('[Inspection HTML] Failed to generate signed URLs for gallery photos:', signedError);
      }
    }

    // Collect all unique per-item photo paths
    const allItemPhotoPaths: string[] = [];
    for (const sys of systems) { if (sys.photo_url) allItemPhotoPaths.push(sys.photo_url); }
    for (const zip of ziplines) { if (zip.photo_url) allItemPhotoPaths.push(zip.photo_url); }
    for (const eq of equipment) { if (eq.photo_url) allItemPhotoPaths.push(eq.photo_url); }
    const uniqueItemPaths = [...new Set(allItemPhotoPaths)];

    // Generate signed URLs for item photos
    const itemPhotoMap = new Map<string, string>();
    if (uniqueItemPaths.length > 0) {
      console.log(`[Inspection HTML] Generating signed URLs for ${uniqueItemPaths.length} item photos`);
      const { data: itemSignedData, error: itemSignedError } = await supabase
        .storage.from('inspection-photos')
        .createSignedUrls(uniqueItemPaths, SIGNED_URL_EXPIRY);
      
      if (!itemSignedError && itemSignedData) {
        for (let i = 0; i < itemSignedData.length; i++) {
          if (itemSignedData[i].error || !itemSignedData[i].signedUrl) continue;
          itemPhotoMap.set(uniqueItemPaths[i], itemSignedData[i].signedUrl);
        }
      } else {
        console.error('[Inspection HTML] Failed to generate signed URLs for item photos:', itemSignedError);
      }
    }

    // Use signed URL data in place of base64 data URIs
    const photoDataUris = gallerySignedUrls.map(p => ({
      id: p.id,
      dataUri: p.signedUrl,
      caption: p.caption,
      section: p.section,
      photoPath: p.photoPath,
    }));

    console.log(`[Inspection HTML] Photo processing complete in ${Date.now() - photoStart}ms: ${photoDataUris.length} gallery, ${itemPhotoMap.size} item photos (signed URLs)`);

    // Helper to render item thumbnail cell
    const renderItemPhotoCell = (photoUrl: string | null): string => {
      if (!photoUrl || !itemPhotoMap.has(photoUrl)) return '<td style="text-align:center;">—</td>';
      return `<td style="text-align:center;"><img src="${itemPhotoMap.get(photoUrl)}" class="item-thumbnail" /></td>`;
    };

    // Format dates in Central Time (CST/CDT)
    const formatDate = (dateStr: string | null) => {
      if (!dateStr) return "N/A";
      const SPECIAL_DATE_VALUES = ["N/A", "Unknown"];
      if (SPECIAL_DATE_VALUES.includes(dateStr)) return dateStr;

      // Parse date-only strings (YYYY-MM-DD) as local to avoid UTC shift
      const dateOnly = dateStr.split('T')[0];
      const parts = dateOnly.split('-');
      if (parts.length === 3) {
        const [year, month, day] = parts.map(Number);
        if (!isNaN(year) && !isNaN(month) && !isNaN(day)) {
          const months = [
            "January", "February", "March", "April", "May", "June",
            "July", "August", "September", "October", "November", "December"
          ];
          return `${months[month - 1]} ${day}, ${year}`;
        }
      }

      // Fallback for datetime strings or unparseable values
      const date = new Date(dateStr);
      if (isNaN(date.getTime())) return dateStr;
      return date.toLocaleDateString("en-US", {
        timeZone: "America/Chicago",
        year: "numeric",
        month: "long",
        day: "numeric",
      });
    };

    // Helper function to format result as checkbox with conditional highlighting
    const formatResultCheckbox = (result: string): { html: string; cellStyle: string } => {
      // Normalize the result to lowercase for comparison
      const normalizedResult = (result || "").toLowerCase().trim();

      // Check for pass variations
      const isPass = normalizedResult === "pass";

      // Check for pass with provisions variations (handle multiple formats)
      const isProvisions =
        normalizedResult === "pass w/provisions" ||
        normalizedResult === "pass with provisions" ||
        normalizedResult === "needs attention";

      // Check for fail
      const isFail = normalizedResult === "fail";

      const pass = isPass ? "☑" : "☐";
      const provisions = isProvisions ? "☑" : "☐";
      const fail = isFail ? "☑" : "☐";

      // Determine cell style for highlighting
      let cellStyle = "";
      if (isFail) {
        cellStyle = "background-color: #fee2e2; color: #991b1b;"; // Red highlight for fail
      } else if (isProvisions) {
        cellStyle = "background-color: #fef3c7; color: #92400e;"; // Yellow highlight for provisions
      } else if (isPass) {
        cellStyle = "background-color: #dcfce7; color: #166534;"; // Green highlight for pass
      }

      // Full words format with responsive line breaks
      return {
        html: `<span class="result-checkbox">${pass} Pass<br>${provisions} Pass with Provisions<br>${fail} Fail</span>`,
        cellStyle,
      };
    };

    const inspectorName = inspection.profiles
      ? `${inspection.profiles.first_name || ""} ${inspection.profiles.last_name || ""}`.trim() || "Unknown"
      : "Unknown";
    const acctNumber = inspection.profiles?.acct_number || inspection.acct_number || "N/A";

    // Content volume calculation for page consolidation
    // WHITESPACE REDUCTION SYSTEM (Phases 1-7):
    // Phase 1: Flow-based layout with flexbox (removed fixed heights)
    // Phase 2: Dynamic spacing with CSS variables (30-40% reduction)
    // Phase 3: Smart page consolidation based on content volume
    // Phase 4: Print-optimized margins and typography (0.35in margins, 9-15pt fonts)
    // Phase 5: Optimized table column widths to prevent wrapping
    // Phase 6: Enhanced bullet deduplication and tighter list spacing
    // Phase 7: Layout validation with min-heights, overflow handling, orphan/widow controls

    const COMBINE_THRESHOLD = 4; // Maximum rows to consider for combining pages
    const systemsRowCount = systems.length;
    const ziplinesRowCount = ziplines.length;
    const equipmentRowCount = equipment.length;
    const standardsRowCount = standards.length;

    // Determine which pages can be combined (Phase 3)
    const canCombineSystemsZiplines =
      systemsRowCount > 0 &&
      ziplinesRowCount > 0 &&
      systemsRowCount <= COMBINE_THRESHOLD &&
      ziplinesRowCount <= COMBINE_THRESHOLD;
    const canCombineEquipmentStandards =
      equipmentRowCount > 0 && standardsRowCount > 0 && equipmentRowCount <= 6 && standardsRowCount <= 6;

    // Calculate page count with consolidation
    // Pages: Cover + Reminders+Categories(combined) + Results Key = 3 base pages
    let pageCount = 3;

    if (canCombineSystemsZiplines) {
      pageCount++; // Combined systems/ziplines page
    } else {
      if (systems.length > 0) pageCount++;
      if (ziplines.length > 0) pageCount++;
    }

    if (canCombineEquipmentStandards) {
      pageCount++; // Combined equipment/standards page
    } else {
      if (equipment.length > 0) pageCount++;
      if (standards.length > 0) pageCount++;
    }

    // Summary takes 2 pages (content + retirement guidelines)
    if (summary) pageCount += 2;

    // Generate HTML
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${(inspection.organization || 'Inspection_Report').replace(/\s+/g, '_')}</title>
  <style>
    @page {
      size: letter;
      margin: 0.3in;
    }

    @viewport {
      width: device-width;
    }

    :root {
      --spacing-tight: 8px;
      --spacing-normal: 12px;
      --spacing-relaxed: 16px;
    }

    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    html, body {
      overflow-x: hidden;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: Georgia, 'Times New Roman', serif;
      font-size: 11pt;
      line-height: 1.6;
      color: #000;
      background: #fff;
      word-wrap: break-word;
      overflow-wrap: break-word;
    }

    /* Fixed print elements - NOT USED for browser PDF */
    .print-header,
    .print-footer {
      display: none !important;
    }

    /* 
     * Page structure - NO FIXED HEIGHTS, NO OVERFLOW HIDDEN
     * Content flows naturally and browser handles pagination
     */
    .page {
      display: flex;
      flex-direction: column;
      min-height: auto;
      padding: 0.25in;
      page-break-after: always;
      page-break-inside: auto;
      box-sizing: border-box;
      /* CRITICAL: No max-height, no overflow:hidden - allows photos to render fully */
    }
    
    .page-content {
      flex: 1;
      /* No overflow:hidden - content must flow naturally */
    }

    .page:last-child {
      page-break-after: avoid;
    }

    /* Content validation safeguards */
    .page-content > *:first-child {
      margin-top: 0;
    }

    .page-content > *:last-child {
      margin-bottom: 0;
    }

    /* In-page header/footer for SCREEN display */
    .page-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-bottom: 10px;
      border-bottom: 3px solid #1e40af;
      margin-bottom: 15px;
      position: relative;
    }

    .header-left {
      flex: 0 0 auto;
      display: flex;
      align-items: center;
    }

    .header-left img {
      height: 35px;
      max-height: 35px;
      width: auto;
      object-fit: contain;
    }

    .header-center {
      position: absolute;
      left: 50%;
      transform: translateX(-50%);
      text-align: center;
    }

    .header-title {
      font-size: 9pt;
      font-weight: bold;
      color: #1e40af;
      text-transform: uppercase;
      letter-spacing: 1px;
      white-space: normal;
      line-height: 1.3;
      max-width: 280px;
    }

    .header-right {
      flex: 0 0 auto;
      display: flex;
      align-items: center;
    }

    .header-right img {
      height: 35px;
      max-height: 35px;
      width: auto;
      object-fit: contain;
    }

    .page-footer {
      margin-top: 20px;
      font-size: 9pt;
      color: #666;
      position: relative;
    }

    .page-number {
      display: none;
    }

    .footer-line {
      border-top: 1px solid #000;
      margin-bottom: 8px;
    }

    .disclaimer {
      text-align: center;
      line-height: 1.5;
      font-size: 8.5pt;
      margin: 0 auto;
    }

    h1 {
      font-size: 24pt;
      color: #1e40af;
      margin-bottom: 15px;
      font-weight: bold;
      line-height: 1.3;
    }

    h2 {
      font-size: 16pt;
      color: #fff;
      background: #1B6DB5;
      margin: 12px 0 8px 0;
      padding: 6px 10px;
      font-weight: bold;
      line-height: 1.4;
      page-break-after: avoid;
    }
    
    /* Major sections that should start on new page if needed */
    h2.new-page-section {
      page-break-before: always;
    }

    h3 {
      font-size: 13pt;
      color: #000;
      margin: 10px 0 6px 0;
      font-weight: bold;
      line-height: 1.3;
    }

    .info-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px 20px;
      margin: 14px 0;
      border: none;
    }

    .info-cell {
      padding: 0;
      border: none;
      display: flex;
      align-items: baseline;
      gap: 8px;
    }

    .info-cell:nth-child(2n) {
      border-right: none;
    }

    .info-label {
      font-weight: 600;
      font-size: 10pt;
      color: #000;
      white-space: normal;
      flex-shrink: 0;
    }

    .info-value {
      flex: 1;
      font-size: 10pt;
      color: #000;
      line-height: 1.4;
      border-bottom: 1px dotted #666;
      min-height: 18px;
      padding-bottom: 2px;
    }

    .text-block {
      margin: 10px 0;
      padding: 10px 14px;
      background: transparent;
      border: 1px solid #000;
      font-size: 10pt;
      line-height: 1.7;
      min-height: 40px; /* Prevent collapsed text blocks */
      overflow-wrap: break-word;
      word-break: break-word;
    }

    /* Prevent orphaned content */
    .text-block, .key-section, .critical-box {
      orphans: 3;
      widows: 3;
    }

    .bullet-list {
      margin: 8px 0 8px 20px;
      font-size: 10pt;
      padding-left: 5px;
    }

    .bullet-list li {
      margin-bottom: 5px;
      line-height: 1.5;
      padding-left: 3px;
    }

    .bullet-list li:last-child {
      margin-bottom: 0;
    }

    em {
      font-style: italic;
      font-weight: 500;
      color: rgba(0, 0, 0, 0.9);
      letter-spacing: 0.01em;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      margin: 10px 0;
      font-size: 9.5pt;
    }

    table th {
      background: #1e40af;
      color: #fff;
      padding: 6px 8px;
      text-align: left;
      font-weight: bold;
      border: 1px solid #000;
      font-size: 10pt;
      white-space: normal;
    }

    table td {
      padding: 6px 8px;
      border: 1px solid #000;
      vertical-align: top;
      line-height: 1.4;
      max-width: none;
      white-space: normal;
      word-wrap: break-word;
      overflow-wrap: break-word;
    }

    table tr:nth-child(even) {
      background: transparent;
    }

    /* Prevent table overflow */
    table {
      table-layout: auto;
      overflow-wrap: break-word;
    }

    /* Handle empty table cells gracefully */
    table td:empty::after {
      content: '—';
      color: #999;
    }

    .result-checkbox {
      font-size: 8.5pt;
      white-space: normal;
      color: #000;
      font-weight: normal;
      line-height: 1.4;
      display: inline-block;
    }

    /* Optimized column widths for Equipment table (6 columns with Photo) */
    .equipment-table th:nth-child(1),
    .equipment-table td:nth-child(1) { width: 25%; } /* Type */
    .equipment-table th:nth-child(2),
    .equipment-table td:nth-child(2) { width: 8%; } /* Quantity */
    .equipment-table th:nth-child(3),
    .equipment-table td:nth-child(3) { width: 10%; } /* Year */
    .equipment-table th:nth-child(4),
    .equipment-table td:nth-child(4) { width: 20%; } /* Result */
    .equipment-table th:nth-child(5),
    .equipment-table td:nth-child(5) { width: auto; min-width: 100px; } /* Comments */
    .equipment-table th:nth-child(6),
    .equipment-table td:nth-child(6) { width: 75px; } /* Photo */

    /* Optimized column widths for Standards table */
    .standards-table th:nth-child(1),
    .standards-table td:nth-child(1) { width: 50%; } /* Standard Name */
    .standards-table th:nth-child(2),
    .standards-table td:nth-child(2) { width: 15%; } /* Yes */
    .standards-table th:nth-child(3),
    .standards-table td:nth-child(3) { width: 15%; } /* No */
    .standards-table th:nth-child(4),
    .standards-table td:nth-child(4) { width: auto; min-width: 150px; } /* Comments - dynamic */

    /* Optimized column widths for Ziplines table (11 columns with Photo) */
    .ziplines-table th:nth-child(1),
    .ziplines-table td:nth-child(1) { width: 9%; } /* Name */
    .ziplines-table th:nth-child(2),
    .ziplines-table td:nth-child(2) { width: 6%; } /* Cable Type */
    .ziplines-table th:nth-child(3),
    .ziplines-table td:nth-child(3) { width: 5%; } /* Length */
    .ziplines-table th:nth-child(4),
    .ziplines-table td:nth-child(4) { width: 9%; } /* Cable Result */
    .ziplines-table th:nth-child(5),
    .ziplines-table td:nth-child(5) { width: 7%; } /* Braking System */
    .ziplines-table th:nth-child(6),
    .ziplines-table td:nth-child(6) { width: 9%; } /* Braking Result */
    .ziplines-table th:nth-child(7),
    .ziplines-table td:nth-child(7) { width: 6%; } /* EAD System */
    .ziplines-table th:nth-child(8),
    .ziplines-table td:nth-child(8) { width: 9%; } /* EAD Result */
    .ziplines-table th:nth-child(9),
    .ziplines-table td:nth-child(9) { width: 9%; } /* Overall Result */
    .ziplines-table th:nth-child(10),
    .ziplines-table td:nth-child(10) { width: auto; min-width: 120px; } /* Comments */
    .ziplines-table th:nth-child(11),
    .ziplines-table td:nth-child(11) { width: 75px; } /* Photo */

    /* Optimized column widths for Operating Systems table (5 columns with Photo) */
    .systems-table th:nth-child(1),
    .systems-table td:nth-child(1) { width: 16%; } /* Element Name */
    .systems-table th:nth-child(2),
    .systems-table td:nth-child(2) { width: 16%; } /* System Type */
    .systems-table th:nth-child(3),
    .systems-table td:nth-child(3) { width: 14%; } /* Result */
    .systems-table th:nth-child(4),
    .systems-table td:nth-child(4) { width: auto; min-width: 150px; } /* Comments */
    .systems-table th:nth-child(5),
    .systems-table td:nth-child(5) { width: 75px; } /* Photo */

    /* Optimized column widths for Standards table */
    .standards-table th:nth-child(1),
    .standards-table td:nth-child(1) { width: 35%; } /* Standard */
    .standards-table th:nth-child(2),
    .standards-table td:nth-child(2) { width: 15%; } /* Documentation */
    .standards-table th:nth-child(3),
    .standards-table td:nth-child(3) { width: auto; min-width: 200px; } /* Comments - dynamic */

    /* Allow result columns to wrap for longer text like "Pass with Provisions" */
    .equipment-table td:nth-child(2),
    .equipment-table td:nth-child(3),
    .equipment-table td:nth-child(4),
    .ziplines-table td:nth-child(3),
    .ziplines-table td:nth-child(4),
    .ziplines-table td:nth-child(6),
    .ziplines-table td:nth-child(8),
    .systems-table td:nth-child(3),
    .standards-table td:nth-child(2) {
      white-space: normal;
      word-wrap: break-word;
    }

    /* Allow comments columns to wrap and expand */
    .equipment-table td:nth-child(5),
    .systems-table td:nth-child(4),
    .ziplines-table td:nth-child(10),
    .standards-table td:nth-child(3),
    .standards-table td:nth-child(4) {
      white-space: normal;
      word-wrap: break-word;
      overflow-wrap: break-word;
    }

    /* Per-item photo thumbnails */
    .item-thumbnail {
      width: 60px;
      height: 60px;
      object-fit: contain;
      border-radius: 4px;
      border: 1px solid #e2e8f0;
      display: block;
      margin: 0 auto;
    }

    @media print {
      .item-thumbnail {
        display: block !important;
        visibility: visible !important;
        opacity: 1 !important;
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
        page-break-inside: avoid !important;
      }
    }

    .key-section {
      margin: 10px 0;
      padding: 10px 14px;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 2px;
    }

    .key-section h3 {
      margin-top: 0;
      margin-bottom: 6px;
    }

    .key-section p {
      line-height: 1.6;
      font-size: 10pt;
    }

    .disclaimer {
      font-size: 8pt;
      color: #666;
      line-height: 1.5;
      font-style: italic;
      max-width: 100%;
    }

    .critical-box {
      background: #fee;
      border: 2px solid #dc2626;
      padding: 12px 14px;
      margin: 10px 0;
      border-radius: 2px;
    }

    .critical-box h3 {
      color: #dc2626;
      margin-top: 0;
      margin-bottom: 10px;
    }

    .combined-section {
      margin-bottom: 14px;
      min-height: 100px;
      page-break-inside: auto;
    }

    .combined-section:last-child {
      margin-bottom: 0;
    }

    .section-divider {
      border-top: 1px solid #e2e8f0;
      margin: 20px 0;
      page-break-after: auto;
      page-break-before: auto;
      min-height: 2px;
    }

    /* Ensure headers don't orphan after dividers */
    .section-divider + h2,
    .section-divider + h3,
    .section-divider + .combined-section {
      page-break-before: avoid;
    }

    /* Table wrapper for page break control */
    .table-wrapper {
      page-break-inside: auto;
      margin: 10px 0;
    }

    /* Keep entire table on one page (for smaller tables) */
    .table-wrapper.keep-together {
      page-break-inside: avoid;
    }

    /* Allow table to break but keep minimum rows together */
    .table-wrapper.allow-break {
      page-break-inside: auto;
    }

    /* Prevent break before a table section header */
    .table-section-header {
      page-break-after: avoid;
      page-break-inside: avoid;
    }

    /* Bullet list base styling for summary sections */
    ul.summary-list {
      list-style: disc;
      list-style-position: outside;
      padding-left: 24px;
      margin: 0;
    }
    
    ul.summary-list li {
      display: list-item;
      list-style-type: disc;
      padding: 6px 0;
      margin: 0 0 4px 0;
      line-height: 1.5;
      background: none;
      border-left: none;
    }
    
    ul.summary-list li::marker {
      color: #1e40af;
    }

      /* Hide fixed print elements - we use in-page headers/footers */
      .print-header,
      .print-footer {
        display: none !important;
      }

      /* Show in-page headers/footers during print */
      .page > .page-header {
        display: flex !important;
      }

      .page > .page-footer {
        display: block !important;
      }

      /* Content wrapper - no extra padding needed */
      .content-wrapper {
        padding: 0 !important;
      }

      /* 
       * PRINT: Page structure - content flows naturally
       * Browser handles pagination automatically
       */
      /*
       * Each .page = one physical sheet.
       * Use flex column + min-height matching the printable area so
       * .page-header sits at top and .page-footer is pushed to bottom.
       * @page margin is 0.25in => printable height = 11in - 0.5in = 10.5in.
       */
      .page {
        display: flex !important;
        flex-direction: column !important;
        min-height: 10.5in !important;
        height: auto !important;
        max-height: none !important;
        padding: 0 !important;
        margin: 0 !important;
        box-sizing: border-box !important;
        page-break-after: always !important;
        page-break-inside: auto !important;
        overflow: visible !important;
      }

      .page-content {
        display: block !important;
        flex: 1 1 auto !important;
        overflow: visible !important;
      }
      
      .page-header {
        flex: 0 0 auto !important;
      }
      
      .page-footer {
        flex: 0 0 auto !important;
        margin-top: auto !important;
        padding-top: 12px !important;
      }

      .page:last-child {
        page-break-after: avoid !important;
      }

      /* Force accurate color reproduction */
      body {
        print-color-adjust: exact;
        -webkit-print-color-adjust: exact;
        background: white;
        color: black;
        font-size: 9.5pt;
        line-height: 1.3;
      }

      /* Page setup */
      @page {
        size: letter portrait;
        margin: 0.25in;
      }

      /* Prevent breaks within critical elements */
      .info-grid,
      .key-section,
      .critical-box,
      .text-block,
      h1, h2, h3 {
        page-break-inside: avoid;
        page-break-after: avoid;
        orphans: 2;
        widows: 2;
      }

      /* Enhanced table break handling */
      table {
        page-break-inside: auto; /* Allow tables to break when necessary */
        break-inside: auto;
        width: 100%;
        max-width: 100%;
        overflow-x: auto;
      }

      /* Always repeat table headers on new pages */
      thead {
        display: table-header-group;
      }

      tbody {
        display: table-row-group;
        page-break-inside: auto;
      }

      /* Keep individual rows intact - never break mid-row */
      tr {
        page-break-inside: avoid;
        break-inside: avoid;
        page-break-after: auto;
      }

      /* Keep header rows with at least first 2 data rows */
      thead + tbody tr:nth-child(-n+2) {
        page-break-before: avoid;
        break-before: avoid;
      }

      /* Prevent orphaned last rows */
      tbody tr:last-child {
        page-break-before: avoid;
      }

      /* Group every 5 rows together to prevent awkward single-row breaks */
      tr:nth-child(5n+1) {
        page-break-before: auto;
      }

      html, body {
        overflow: visible !important;
      }

      td, th {
        max-width: none;
        overflow-wrap: break-word;
        word-wrap: break-word;
        hyphens: auto;
      }

      /* Prevent excessive cell width from breaking layout */
      .equipment-table td:nth-child(1),
      .systems-table td:nth-child(1),
      .ziplines-table td:nth-child(1) {
        max-width: 200px;
      }

      .equipment-table td:nth-child(5),
      .systems-table td:nth-child(4),
      .ziplines-table td:nth-child(10),
      .standards-table td:nth-child(3),
      .standards-table td:nth-child(4) {
        max-width: none; /* Remove limit to allow full content display */
      }

      /* Keep section headers with their tables */
      h2, h3 {
        page-break-after: avoid;
        break-after: avoid;
        orphans: 3;
        widows: 3;
      }

      h2 + .table-wrapper,
      h3 + .table-wrapper,
      h2 + table,
      h3 + table,
      h2 + *,
      h3 + * {
        page-break-before: avoid;
        break-before: avoid;
      }

      /* Optimize images for print */
      img {
        max-width: 100%;
        page-break-inside: avoid;
        display: block;
      }

      /* Background colors and borders for print */
      .result-pass {
        color: #16a34a !important;
        font-weight: bold;
      }

      .result-attention {
        color: #ea580c !important;
        font-weight: bold;
      }

      .result-fail {
        color: #dc2626 !important;
        font-weight: bold;
      }

      /* Ensure colored backgrounds print properly */
      .key-section {
        background: #f8fafc !important;
        border: 1px solid #333 !important;
        page-break-inside: avoid;
      }

      .critical-box {
        background: #fef2f2 !important;
        border: 2px solid #dc2626 !important;
        page-break-inside: avoid;
      }

      .info-grid {
        background: transparent !important;
      }

      /* Table styling for print */
      table {
        border-collapse: collapse;
      }

      table th {
        background: #1e40af !important;
        color: white !important;
        border: 1px solid #1e40af !important;
      }

      table td {
        border: 1px solid #333 !important;
      }

      table tr:nth-child(even) {
        background: #f8fafc !important;
      }

      .result-attention {
        background-color: #f59e0b !important;
        color: #ffffff !important;
        padding: 4px 10px !important;
        border-radius: 4px !important;
        font-weight: 600 !important;
        display: inline-block !important;
      }
      
      .result-fail {
        background-color: #ef4444 !important;
        color: #ffffff !important;
        padding: 4px 10px !important;
        border-radius: 4px !important;
        font-weight: 600 !important;
        display: inline-block !important;
      }
      
      /* Section spacing optimization */
      .key-section {
        margin-bottom: 6px !important;
        padding: 6px 8px !important;
      }
      
      .critical-box {
        margin: 6px 0 !important;
        padding: 8px !important;
        border: 2px solid #ef4444 !important;
      }
      
      /* Info grid spacing */
      .info-grid {
        margin-bottom: 4px !important;
      }
      
      .info-cell {
        padding: 4px 6px !important;
        margin-bottom: 2px !important;
      }
      
      /* Ensure proper spacing around tables */
      table {
        margin: 4px 0 !important;
      }
      
      /* Section headers */
      .section-header {
        background-color: #f1f5f9 !important;
        padding: 5px 8px !important;
        margin: 6px 0 4px 0 !important;
        border-left: 4px solid #3b82f6 !important;
      }
      
      /* Print color enforcement */
      *, *::before, *::after {
        print-color-adjust: exact !important;
        -webkit-print-color-adjust: exact !important;
      }
      
      /* LOGO FIX: Force visibility - logos must render in PDF, capped at 35px */
      .page-header .header-left img,
      .page-header .header-right img {
        display: block !important;
        visibility: visible !important;
        opacity: 1 !important;
        height: 35px !important;
        max-height: 35px !important;
        max-width: 180px !important;
        width: auto !important;
        object-fit: contain !important;
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
      }
      
      /* PHOTO FIX: Ensure photos render in PDF */
      .photo-gallery {
        display: grid !important;
        grid-template-columns: repeat(2, 1fr) !important;
        visibility: visible !important;
      }
      
      .photo-item {
        display: block !important;
        visibility: visible !important;
        page-break-inside: avoid !important;
        margin-bottom: 20px !important;
      }
      
      .inspection-photo {
        display: block !important;
        visibility: visible !important;
        opacity: 1 !important;
        max-width: 100% !important;
        height: auto !important;
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
      }
      
      /* Hide link URLs that browsers add by default */
      a[href]::after {
        content: none !important;
      }
      
      /* Remove shadows and transforms */
      * {
        box-shadow: none !important;
        text-shadow: none !important;
      }
      
      /* Remove any animations or transitions */
      *, *::before, *::after {
        animation: none !important;
        transition: none !important;
      }
      
      /* Bullet list styling for PDF print */
      ul {
        list-style: disc !important;
        list-style-position: inside !important;
        padding-left: 16px !important;
        margin: 0 !important;
      }
      
      ul li {
        display: list-item !important;
        list-style-type: disc !important;
        padding: 4px 0 !important;
        margin: 0 0 4px 0 !important;
        line-height: 1.5 !important;
        background: none !important;
        border-left: none !important;
      }
      
      ul li::marker {
        color: #1e40af !important;
        font-size: 10pt !important;
      }
    } /* End @media print */

    /* Mobile optimizations */
    @media screen and (max-width: 768px) {
      /* Prevent horizontal overflow */
      html, body {
        max-width: 100vw;
        overflow-x: hidden;
      }
      
      .page {
        padding: 12px;
        padding-bottom: 40px;
      }
      
      /* Stack info grid to single column */
      .info-grid {
        grid-template-columns: 1fr;
        gap: 8px;
      }

      /* Info cells: block display with wrapping */
      .info-cell {
        display: block !important;
        margin-bottom: 12px !important;
        border-bottom: 1px solid #e2e8f0 !important;
        padding-bottom: 8px !important;
      }

      .info-label {
        display: block !important;
        white-space: normal !important;
        margin-bottom: 4px !important;
      }

      .info-value {
        display: block !important;
        word-break: break-word !important;
        overflow-wrap: anywhere !important;
        border-bottom: none !important;
      }

      /* Header: Stack to prevent overlap */
      .page-header {
        flex-direction: column !important;
        align-items: center !important;
        gap: 8px !important;
        padding-bottom: 10px !important;
      }

      .header-left, .header-right {
        position: static !important;
        text-align: center !important;
        width: 100% !important;
      }

      /* CRITICAL: Reset absolute positioning on header center for mobile */
      .header-center {
        position: static !important;
        transform: none !important;
        width: 100% !important;
      }

      /* Force text wrapping in all table cells */
      th, td {
        padding: 4px 6px;
        white-space: normal !important;
        word-break: break-word !important;
        overflow-wrap: anywhere !important;
      }

      /* Neutralize ALL desktop min-width constraints on mobile */
      .equipment-table td,
      .equipment-table th,
      .standards-table td,
      .standards-table th,
      .ziplines-table td,
      .ziplines-table th,
      .systems-table td,
      .systems-table th {
        min-width: 0 !important;
        width: auto !important;
      }
      
      /* Make tables responsive with horizontal scroll container */
      .table-wrapper {
        overflow-x: auto;
        -webkit-overflow-scrolling: touch;
        max-width: 100%;
      }
      
      /* Reduce table font sizes — allow horizontal scroll */
      table {
        font-size: 8pt;
        table-layout: auto;
      }
      
      /* Per-table minimum widths for readability */
      .systems-table { min-width: 600px; }
      .equipment-table { min-width: 550px; }
      .ziplines-table { min-width: 900px; }
      .standards-table { min-width: 500px; }
      
      .item-thumbnail {
        width: 40px;
        height: 40px;
      }
      
      /* Reformat result checkboxes to stack vertically */
      .result-checkbox {
        white-space: normal;
        font-size: 7pt;
        display: block;
        line-height: 1.4;
      }
      
      /* Headers */
      .header-left img, .header-right img {
        height: 35px;
      }
      
      .header-title {
        font-size: 6pt;
        max-width: 150px;
      }
      
      h1 { font-size: 16pt; }
      h2 { font-size: 12pt; padding: 4px 8px; }
      h3 { font-size: 10pt; }
      
      /* Text blocks */
      .text-block {
        padding: 8px;
        font-size: 9pt;
        word-break: break-word;
        overflow-wrap: anywhere;
      }
      
      /* Bullet lists - wrapping guards */
      .bullet-list {
        margin-left: 12px;
        font-size: 9pt;
      }

      .comment-bullets, .summary-list {
        word-break: break-word !important;
        overflow-wrap: anywhere !important;
      }

      .comment-bullets li, .summary-list li {
        word-break: break-word !important;
        overflow-wrap: anywhere !important;
      }
      
      /* Photo gallery: Single column, full width */
      .photo-gallery {
        grid-template-columns: 1fr !important;
        max-width: 100% !important;
        padding: 0 !important;
        gap: 16px !important;
        margin: 16px 0 !important;
      }

      .photo-item {
        padding: 8px !important;
      }

      .inspection-photo {
        max-height: 250px !important;
        max-width: 100% !important;
        object-fit: contain !important;
      }

      /* Disclaimer */
      .disclaimer {
        font-size: 7pt;
        max-width: 100% !important;
        padding: 0 4px !important;
        text-align: center !important;
      }
    }

    /* Extra small screens */
    @media screen and (max-width: 480px) {
      .page { padding: 8px; }
      body { padding: 4px; }
      
      table { 
        font-size: 7pt;
        table-layout: auto;
      }
      
      .item-thumbnail {
        width: 30px;
        height: 30px;
      }
      
      .result-checkbox {
        font-size: 6pt;
      }
      
      h1 { font-size: 14pt; }
      h2 { font-size: 11pt; }

      .photo-gallery {
        gap: 12px !important;
      }
    }

    /* Photo Gallery Styles - Professional centered layout */
    .photo-gallery {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 20px;
      max-width: 90%;
      margin: 30px auto;
      overflow: visible;
    }

    .photo-item {
      page-break-inside: avoid;
      break-inside: avoid;
      overflow: hidden;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      background: #ffffff;
      box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -2px rgba(0,0,0,0.1);
      padding: 12px;
    }

    .inspection-photo {
      max-width: 100%;
      max-height: 280px;
      object-fit: contain;
      display: block;
      margin: 0 auto;
      background: #f8fafc;
      border-radius: 4px;
    }

    .photo-caption {
      font-size: 9.5pt;
      color: #475569;
      padding: 12px 10px 4px;
      text-align: center;
      line-height: 1.4;
    }

    .photo-section-label {
      font-size: 7pt;
      color: #1e40af;
      text-transform: uppercase;
      font-weight: 700;
      letter-spacing: 0.05em;
      padding: 3px 8px 6px;
      background: #eff6ff;
      display: block;
      text-align: center;
      margin: 0 0 12px 0;
      border-bottom: 2px solid #dbeafe;
      border-radius: 4px 4px 0 0;
    }

    @media print {
      .photo-gallery {
        grid-template-columns: repeat(2, 1fr);
        max-width: 92%;
        margin: 20px auto;
        gap: 20px;
        overflow: visible !important;
      }

      .inspection-photo {
        max-width: 100% !important;
        max-height: 300px !important;
        object-fit: contain !important;
        display: block !important;
        visibility: visible !important;
        opacity: 1 !important;
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
      }

      .photo-item {
        page-break-inside: avoid;
        break-inside: avoid;
        overflow: hidden !important;
        box-shadow: none !important;
        border: 1px solid #e2e8f0;
        border-radius: 6px;
        padding: 12px;
      }
    }
  </style>
</head>
<body>
  ${adminEditBannerHtml}

  <!-- Fixed header for print - repeats on every printed page -->
  <div class="print-header">
    <div class="print-header-inner">
      <div class="header-left">
        <img src="${belayReportsLogo}" alt="Belay Reports" style="height: 50px; width: auto;">
      </div>
      <div class="header-center">
        <div class="header-title"></div>
      </div>
      <div class="header-right">
        <img src="${acctLogo}" alt="ACCT Accredited Vendor" style="height: 45px; width: auto;">
      </div>
    </div>
  </div>

  <!-- Fixed footer for print - repeats on every printed page -->
  <div class="print-footer">
    <div class="print-footer-inner">
      <div class="footer-line"></div>
      <div class="disclaimer">
        The information contained in this report has been documented by a Qualified Professional.<br>
        This report is effective for one year from the date of inspection. Issued by:<br>
        Belay Reports
      </div>
    </div>
  </div>

  <!-- Content container -->
  <div class="content-wrapper">

  <!-- PAGE 1: COVER PAGE -->
  <div class="page">
    <div class="page-header">
      <div class="header-left">
        <img src="${belayReportsLogo}" alt="Belay Reports">
      </div>
      <div class="header-center">
        <div class="header-title"></div>
      </div>
      <div class="header-right">
        <img src="${acctLogo}" alt="ACCT Accredited Vendor">
      </div>
    </div>

    <div class="page-content">
      <h1 style="text-align: center; margin-top: 10px;">Professional Inspection for Aerial Adventure Programs</h1>

      <div class="info-grid">
        <div class="info-cell">
          <span class="info-label">Organization:</span>
          <span class="info-value">${inspection.organization}</span>
        </div>
        <div class="info-cell">
          <span class="info-label">Location:</span>
          <span class="info-value">${inspection.location}</span>
        </div>
        <div class="info-cell">
          <span class="info-label">Onsite Contact:</span>
          <span class="info-value">${inspection.onsite_contact || "N/A"}</span>
        </div>
        <div class="info-cell">
          <span class="info-label">ACCT Course Number:</span>
          <span class="info-value">${acctNumber}</span>
        </div>
        <div class="info-cell">
          <span class="info-label">Inspected by:</span>
          <span class="info-value">${inspectorName}</span>
        </div>
        <div class="info-cell">
          <span class="info-label">Inspector ACCT #:</span>
          <span class="info-value">${acctNumber}</span>
        </div>
        <div class="info-cell">
          <span class="info-label">Date of Inspection:</span>
          <span class="info-value">${formatDate(inspection.inspection_date)}</span>
        </div>
        <div class="info-cell">
          <span class="info-label">Next Inspection Date:</span>
          <span class="info-value">${summary?.next_inspection_date ? formatDate(summary.next_inspection_date) : "TBD"}</span>
        </div>
        ${
          inspection.previous_inspector
            ? `
        <div class="info-cell">
          <span class="info-label">Previously Inspected by:</span>
          <span class="info-value">${inspection.previous_inspector}</span>
        </div>
        <div class="info-cell">
          <span class="info-label">Prev. Inspection Date:</span>
          <span class="info-value">${formatDate(inspection.previous_inspection_date)}</span>
        </div>
        `
            : ""
        }
      </div>

      <h2>KNOWN COURSE HISTORY</h2>
      ${
        inspection.course_history
          ? `
      <div class="text-block">${inspection.course_history}</div>
      `
          : `
      <div class="text-block">
        <p>No course history provided.</p>
      </div>
      `
      }

      <h2>INSPECTION OVERVIEW</h2>
      <div class="text-block">
        <p>This report covers the condition of the aerial adventure site for the date of inspection reflected on this form. The inspection provided is strictly an evaluation of the structural condition of the course elements and equipment. The inspection does not include training on how to operate the equipment, nor how to operate the course. The inspection only verifies the existence of written local operating procedures (LOP), an emergency action plan (EAP), and training documentation. The inspection does not perform a review or evaluate the LOP, EAP and training documentation. Potential problems can occur afterwards due to vandalism, improper use, weather, etc. Belay Reports is not responsible for modifications or repairs made to the challenge course by anyone other than a Belay Reports employee. We recommend you conduct your own periodic internal monitoring at a minimum on a quarterly basis. At a minimum an annual professional inspection is required by a qualified professional to be in compliance with the Association for Challenge Course Technology ANSI/ACCT current published standards.</p>
      </div>
    </div>

    <div class="page-footer">
      <div class="page-number">Page 1</div>
      <div class="footer-line"></div>
      <div class="disclaimer">
        The information contained in this report has been documented by a Qualified Professional.<br>
        This report is effective for one year from the date of inspection. Issued by:<br>
        Belay Reports
      </div>
    </div>
  </div>

  <!-- PAGE 2: REMINDERS AND REQUIREMENTS + INSPECTION CATEGORIES (combined) -->
  <div class="page">
    <div class="page-header">
      <div class="header-left">
        <img src="${belayReportsLogo}" alt="Belay Reports">
      </div>
      <div class="header-center">
        <div class="header-title"></div>
      </div>
      <div class="header-right">
        <img src="${acctLogo}" alt="ACCT Accredited Vendor">
      </div>
    </div>

    <div class="page-content">
      <h2 style="margin-top: 5px;">REMINDERS AND REQUIREMENTS</h2>
      <ul class="bullet-list">
        <li><strong>Fall Protection:</strong> Employers are required to issue staff appropriate fall protection for the duties to be performed.</li>
        <li><strong>Periodic Internal Monitoring:</strong> A Periodic Internal Monitoring of the aerial activities on your site shall be conducted by qualified personnel.</li>
        <li><strong>Equipment Documentation:</strong> Proper identification, tracking, and documentation of ALL equipment used for operations shall be kept and available at your annual professional inspection.</li>
        <li><strong>Staff Training:</strong> Proper staff training should be provided for the operation of all aerial activities and equipment on your site.</li>
        <li><strong>Operational Reviews:</strong> Operational Reviews shall be conducted once every five years by a qualified professional in accordance with ACCT Standards.</li>
      </ul>

      <h2 style="margin-top: 14px;">INSPECTION CATEGORIES</h2>
      <p style="margin-bottom: 10px; font-size: 10pt; line-height: 1.5;">All inspections include the following categories when applicable:</p>

      <div class="key-section">
        <h3>Lifeline HDW (Hardware)</h3>
        <p>Represents all hardware associated with the Life Safety System including but not limited to: wire rope, bolts, wire rope terminations, and redundant terminations.</p>
      </div>

      <div class="key-section">
        <h3>Activity HDW (Hardware)</h3>
        <p>Represents all hardware associated with the element execution. This includes but is not limited to: foot cables, platforms, hand ropes/cables, boards, and structural components.</p>
      </div>

      <div class="key-section">
        <h3>Environment</h3>
        <p>This represents the surrounding area of the activity/element. This includes but is not limited to: ground cover, fall zones, trees, rocks, terrain, and clearances.</p>
      </div>

      <div class="key-section">
        <h3>Equipment</h3>
        <p>This represents the equipment utilized in the operation of the course activities. This includes but is not limited to: rope, carabiners, helmets, belay devices, pulleys, trolleys, lanyards, harnesses, and rescue equipment.</p>
      </div>
    </div>

    <div class="page-footer">
      <div class="page-number">Page 2</div>
      <div class="footer-line"></div>
      <div class="disclaimer">
        The information contained in this report has been documented by a Qualified Professional.<br>
        This report is effective for one year from the date of inspection. Issued by:<br>
        Belay Reports
      </div>
    </div>
  </div>

  <!-- PAGE 3: INSPECTION RESULTS KEY -->
  <div class="page">
    <div class="page-header">
      <div class="header-left">
        <img src="${belayReportsLogo}" alt="Belay Reports">
      </div>
      <div class="header-center">
        <div class="header-title"></div>
      </div>
      <div class="header-right">
        <img src="${acctLogo}" alt="ACCT Accredited Vendor">
      </div>
    </div>

    <div class="page-content">
      <h2 style="margin-top: 5px;">INSPECTION RESULTS KEY</h2>
      <p style="margin-bottom: 15px; font-size: 10pt; line-height: 1.6;">
        This represents the overall rating for each system based on the condition of the items inspected on the day of the inspection. 
        Belay Reports inspects all challenge course and canopy/zip line tours to the standards set forth by the Association for Challenge Course Technology (ACCT). 
        Any deviation from the ACCT standards in regards to the inspection criteria will be addressed in the comments section.
      </p>

      <div class="key-section" style="background: #f0f9ff; border-left: 4px solid #16a34a;">
        <h3 style="color: #16a34a;">Pass</h3>
        <p>The equipment or operating system meets all manufacturer specifications, industry standards, and operational safety requirements at the time of inspection. No corrective actions are necessary. The item is approved for continued use until the next scheduled inspection.</p>
      </div>

      <div class="key-section" style="background: #fff7ed; border-left: 4px solid #ea580c;">
        <h3 style="color: #ea580c;">Pass with Provisions</h3>
        <p>The equipment or operating system is generally in acceptable condition but requires minor corrective action, repair, or follow-up maintenance that does not pose an immediate safety concern. The item may remain in service under specified conditions or with specific limitations until the required actions are completed. A timeline for resolution should be established.</p>
      </div>

      <div class="key-section" style="background: #fef2f2; border-left: 4px solid #dc2626;">
        <h3 style="color: #dc2626;">Fail</h3>
        <p>The equipment or operating system does not meet minimum safety standards and poses a risk to participants or staff. <strong>Immediate corrective action is required.</strong> The item must be removed from service until all necessary repairs, replacements, or modifications are completed and verified by a qualified professional.</p>
      </div>

      <div class="key-section">
        <h3>N/A (Not Applicable)</h3>
        <p>The inspection criterion does not apply to this particular system, element, or piece of equipment at this time.</p>
      </div>
    </div>

    <div class="page-footer">
      <div class="page-number">Page 3</div>
      <div class="footer-line"></div>
      <div class="disclaimer">
        The information contained in this report has been documented by a Qualified Professional.<br>
        This report is effective for one year from the date of inspection. Issued by:<br>
        Belay Reports
      </div>
    </div>
  </div>

  <!-- PAGE 3: OPERATING SYSTEMS & ZIPLINES (COMBINED OR SEPARATE) -->
  ${
    canCombineSystemsZiplines
      ? `
  <!-- COMBINED SYSTEMS & ZIPLINES PAGE -->
  <div class="page">
    <div class="page-header">
      <div class="header-left">
        <img src="${belayReportsLogo}" alt="Belay Reports">
      </div>
      <div class="header-center">
        <div class="header-title"></div>
      </div>
      <div class="header-right">
        <img src="${acctLogo}" alt="ACCT Accredited Vendor">
      </div>
    </div>

    <div class="page-content">
      <!-- Operating Systems Section -->
      <div class="combined-section">
        <h2>SYSTEMS</h2>
        <p style="margin-bottom: 12px; font-size: 10pt; line-height: 1.6;">
          Each operating system has been inspected for structural integrity, hardware condition, and environmental factors.
        </p>
        <div class="table-wrapper allow-break">
        <table class="systems-table">
          <thead>
            <tr>
              <th>Element Name</th>
              <th>System Name</th>
              <th>Result</th>
              <th>Comments and/or Required Changes</th>
              <th>Photo</th>
            </tr>
          </thead>
          <tbody>
          ${systems
            .map((sys) => {
              if (sys.is_divider) {
                return `<tr><td colspan="5" style="text-align:center; font-weight:bold; padding:10px; background:#dbeafe; font-size:11pt;">${sys.divider_text || ''}</td></tr>`;
              }
              const resultData = formatResultCheckbox(sys.result);
              const formattedComments = formatCommentsAsBullets(sys.comments);
              return `
              <tr>
                <td>${sys.name || "N/A"}</td>
                <td><strong>${sys.system_name}</strong></td>
                <td style="${resultData.cellStyle}">${resultData.html}</td>
                <td style="font-size: 9pt;">${formattedComments}</td>
                ${renderItemPhotoCell(sys.photo_url)}
              </tr>
            `;
            })
            .join("")}
          </tbody>
        </table>
        </div>
      </div>
    </div>

      <div class="section-divider"></div>

      <!-- Ziplines Section -->
      <div class="combined-section">
        <h2>ZIPLINES</h2>
        
        <div style="margin-bottom: 12px; font-size: 9.5pt; padding: 10px; background: #f8fafc; border: 1px solid #e2e8f0; border-left: 3px solid #1e40af;">
          <strong>Key Abbreviations:</strong><br>
          <strong>Cable Type:</strong> GAC = Galvanized Aircraft Cable, SS = Stainless Steel<br>
          <strong>Braking System:</strong> ZS = Zipstop, FB = Friction Brake, SB = Spring Brake, G = Gravity<br>
          <strong>EAD System:</strong> Energy Absorption Device
        </div>

        <div class="table-wrapper allow-break">
        <table class="ziplines-table">
          <thead>
            <tr>
              <th>Zipline Name</th>
              <th>Cable Type</th>
              <th>Length (ft)</th>
              <th>Cable Result</th>
              <th>Braking System</th>
              <th>Braking Result</th>
              <th>EAD System</th>
              <th>EAD Result</th>
              <th>Overall</th>
              <th>Comments and/or Required Changes</th>
              <th>Photo</th>
            </tr>
          </thead>
          <tbody>
            ${ziplines
              .map((zip) => {
                const cableResultData = formatResultCheckbox(zip.cable_result || "Pass");
                const brakingResultData = formatResultCheckbox(zip.braking_result || "Pass");
                const eadResultData = formatResultCheckbox(zip.ead_result || "Pass");
                const overallResultData = formatResultCheckbox(zip.result || "Pass");
                const formattedComments = formatCommentsAsBullets(zip.comments);
                return `
                <tr>
                  <td><strong>${zip.zipline_name}</strong></td>
                  <td style="text-align: center;">${zip.cable_type || "N/A"}</td>
                  <td style="text-align: center;">${zip.cable_length || "N/A"}</td>
                  <td style="${cableResultData.cellStyle}">${cableResultData.html}</td>
                  <td style="text-align: center;">${zip.braking_system || "N/A"}</td>
                  <td style="${brakingResultData.cellStyle}">${brakingResultData.html}</td>
                  <td style="text-align: center;">${zip.ead_system || "N/A"}</td>
                  <td style="${eadResultData.cellStyle}">${eadResultData.html}</td>
                  <td style="${overallResultData.cellStyle}">${overallResultData.html}</td>
                  <td style="font-size: 9pt;">${formattedComments}</td>
                  ${renderItemPhotoCell(zip.photo_url)}
                </tr>
              `;
              })
              .join("")}
          </tbody>
        </table>
      </div>
    </div>

    <div class="page-footer">
      <div class="page-number">Page 5</div>
      <div class="footer-line"></div>
      <div class="disclaimer">
        The information contained in this report has been documented by a Qualified Professional.<br>
        This report is effective for one year from the date of inspection. Issued by:<br>
        Belay Reports
      </div>
    </div>
  </div>
  `
      : `
  <!-- SEPARATE PAGES -->
  <!-- PAGE 3: OPERATING SYSTEMS -->
  ${
    systems.length > 0
      ? `
  <div class="page">
    <div class="page-header">
      <div class="header-left">
        <img src="${belayReportsLogo}" alt="Belay Reports">
      </div>
      <div class="header-center">
        <div class="header-title"></div>
      </div>
      <div class="header-right">
        <img src="${acctLogo}" alt="ACCT Accredited Vendor">
      </div>
    </div>

    <div class="page-content">
      <h2>SYSTEMS - OPERATING SYSTEMS</h2>
      <p style="margin-bottom: 15px; font-size: 10pt; line-height: 1.6;">
        Each operating system has been inspected for structural integrity, hardware condition, and environmental factors.
      </p>
      <div class="table-wrapper allow-break">
      <table class="systems-table">
        <thead>
          <tr>
            <th>Element Name</th>
            <th>System Name</th>
            <th>Result</th>
            <th>Comments and/or Required Changes</th>
            <th>Photo</th>
          </tr>
        </thead>
        <tbody>
          ${systems
            .map((sys) => {
              const resultData = formatResultCheckbox(sys.result);
              const formattedComments = formatCommentsAsBullets(sys.comments);
              return `
              <tr>
                <td>${sys.name || "N/A"}</td>
                <td><strong>${sys.system_name}</strong></td>
                <td style="${resultData.cellStyle}">${resultData.html}</td>
                <td style="font-size: 9pt;">${formattedComments}</td>
                ${renderItemPhotoCell(sys.photo_url)}
              </tr>
            `;
            })
            .join("")}
        </tbody>
      </table>
      </div>
    </div>

    <div class="page-footer">
      <div class="page-number">Page 5</div>
      <div class="footer-line"></div>
      <div class="disclaimer">
        The information contained in this report has been documented by a Qualified Professional.<br>
        This report is effective for one year from the date of inspection. Issued by:<br>
        Belay Reports
      </div>
    </div>
  </div>
  `
      : ""
  }

  <!-- PAGE: ZIPLINES -->
  ${
    ziplines.length > 0
      ? `
  <div class="page">
    <div class="page-header">
      <div class="header-left">
        <img src="${belayReportsLogo}" alt="Belay Reports">
      </div>
      <div class="header-center">
        <div class="header-title"></div>
      </div>
      <div class="header-right">
        <img src="${acctLogo}" alt="ACCT Accredited Vendor">
      </div>
    </div>

    <div class="page-content">
      <h2>ZIPLINES</h2>
      
      <div style="margin-bottom: 15px; font-size: 9.5pt; padding: 10px; background: #f8fafc; border: 1px solid #e2e8f0; border-left: 3px solid #1e40af;">
        <strong>Key Abbreviations:</strong><br>
        <strong>Cable Type:</strong> GAC = Galvanized Aircraft Cable, SS = Stainless Steel<br>
        <strong>Braking System:</strong> ZS = Zipstop, FB = Friction Brake, SB = Spring Brake, G = Gravity<br>
        <strong>EAD System:</strong> Energy Absorption Device
      </div>

      <div class="table-wrapper allow-break">
      <table class="ziplines-table">
        <thead>
          <tr>
            <th>Zipline Name</th>
            <th>Cable Type</th>
            <th>Length (ft)</th>
            <th>Cable Result</th>
            <th>Braking System</th>
            <th>Braking Result</th>
            <th>EAD System</th>
            <th>EAD Result</th>
            <th>Overall</th>
            <th>Comments and/or Required Changes</th>
            <th>Photo</th>
          </tr>
        </thead>
        <tbody>
          ${ziplines
            .map((zip) => {
              const cableResultData = formatResultCheckbox(zip.cable_result || "Pass");
              const brakingResultData = formatResultCheckbox(zip.braking_result || "Pass");
              const eadResultData = formatResultCheckbox(zip.ead_result || "Pass");
              const overallResultData = formatResultCheckbox(zip.result || "Pass");
              const formattedComments = formatCommentsAsBullets(zip.comments);
              return `
              <tr>
                <td><strong>${zip.zipline_name}</strong></td>
                <td style="text-align: center;">${zip.cable_type || "N/A"}</td>
                <td style="text-align: center;">${zip.cable_length || "N/A"}</td>
                <td style="${cableResultData.cellStyle}">${cableResultData.html}</td>
                <td style="text-align: center;">${zip.braking_system || "N/A"}</td>
                <td style="${brakingResultData.cellStyle}">${brakingResultData.html}</td>
                <td style="text-align: center;">${zip.ead_system || "N/A"}</td>
                <td style="${eadResultData.cellStyle}">${eadResultData.html}</td>
                <td style="${overallResultData.cellStyle}">${overallResultData.html}</td>
                <td style="font-size: 9pt;">${formattedComments}</td>
                ${renderItemPhotoCell(zip.photo_url)}
              </tr>
            `;
            })
            .join("")}
        </tbody>
      </table>
      </div>
    </div>

    <div class="page-footer">
      <div class="page-number">Page ${systems.length > 0 ? "6" : "5"}</div>
      <div class="footer-line"></div>
      <div class="disclaimer">
        The information contained in this report has been documented by a Qualified Professional.<br>
        This report is effective for one year from the date of inspection. Issued by:<br>
        Belay Reports
      </div>
    </div>
  </div>
  `
      : ""
  }
  `
  }

  <!-- PAGE: EQUIPMENT & ACCT STANDARDS (COMBINED OR SEPARATE) -->
  ${
    canCombineEquipmentStandards
      ? `
  <!-- COMBINED EQUIPMENT & STANDARDS PAGE -->
  <div class="page">
    <div class="page-header">
      <div class="header-left">
        <img src="${belayReportsLogo}" alt="Belay Reports">
      </div>
      <div class="header-center">
        <div class="header-title"></div>
      </div>
      <div class="header-right">
        <img src="${acctLogo}" alt="ACCT Accredited Vendor">
      </div>
    </div>

    <div class="page-content">
      <!-- Equipment Section -->
      <div class="combined-section">
        <h2>EQUIPMENT INSPECTION</h2>
        <p style="margin-bottom: 12px; font-size: 10pt; line-height: 1.6;">
          All equipment has been inspected in accordance with manufacturer specifications and ACCT standards.
        </p>
        
        ${["harnesses", "helmets", "lanyards", "connectors", "rope", "belay", "trolleys", "other"]
          .map((category) => {
            const categoryEquipment = equipment.filter((eq) => eq.equipment_category === category);
            if (categoryEquipment.length === 0) return "";

            const categoryTitle =
              category === "connectors"
                ? "CONNECTORS (CARABINERS & QUICKLINKS)"
                : category === "rope"
                  ? "ROPE"
                  : category === "belay"
                    ? "BELAY/DESCENT DEVICES"
                    : category === "trolleys"
                      ? "TROLLEYS AND PULLEYS"
                      : category === "other"
                        ? "OTHER EQUIPMENT"
                        : category.toUpperCase();

            return `
            <h3 class="table-section-header" style="margin-top: 15px; color: #000; font-size: 11pt;">EQUIPMENT - <em>${categoryTitle}</em></h3>
            <div class="table-wrapper keep-together">
            <table class="equipment-table">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Quantity</th>
                  <th>Manufacture Year(s)</th>
                  <th>Result</th>
                  <th>Comments</th>
                  <th>Photo</th>
                </tr>
              </thead>
              <tbody>
                ${categoryEquipment
                  .map((eq) => {
                    if (eq.is_divider) {
                      return `<tr><td colspan="6" style="text-align:center; font-weight:bold; padding:10px; background:#dbeafe; font-size:11pt;">${eq.divider_text || ''}</td></tr>`;
                    }
                    const resultData = formatResultCheckbox(eq.result);
                    const formattedComments = formatCommentsAsBullets(eq.comments);
                    return `
                    <tr>
                      <td>${eq.equipment_type || "N/A"}</td>
                      <td style="text-align: center;">${eq.quantity || "N/A"}</td>
                      <td style="text-align: center;">${eq.production_year === "0" ? "N/A" : eq.production_year || "N/A"}</td>
                      <td style="${resultData.cellStyle}">${resultData.html}</td>
                      <td style="font-size: 9pt;">${formattedComments}</td>
                      ${renderItemPhotoCell(eq.photo_url)}
                    </tr>
                  `;
                  })
                  .join("")}
              </tbody>
            </table>
            </div>
          `;
          })
          .join("")}
      </div>

      <div class="section-divider"></div>

      <!-- Standards Section -->
      <div class="combined-section">
        <h2>ACCT OPERATIONS STANDARDS</h2>
        <p style="margin-bottom: 12px; font-size: 10pt; line-height: 1.6;">
          Documentation verification as required by ACCT (Association for Challenge Course Technology) Standards. 
          The presence of documentation does not constitute review or approval of content.
        </p>

        <div class="table-wrapper keep-together">
        <table class="standards-table">
          <thead>
            <tr>
              <th>Standard / Document</th>
              <th style="text-align: center;">YES</th>
              <th style="text-align: center;">NO</th>
              <th style="text-align: center;">Comments</th>
            </tr>
          </thead>
          <tbody>
            ${standards
              .map(
                (std) => `
              <tr>
                <td><strong>${std.standard_name}</strong></td>
                <td style="text-align: center; font-size: 12pt;">${std.has_documentation === true ? "☑" : "☐"}</td>
                <td style="text-align: center; font-size: 12pt;">${std.has_documentation === false ? "☑" : "☐"}</td>
                <td style="font-size: 9pt;">${std.comments || "—"}</td>
              </tr>
            `,
              )
              .join("")}
          </tbody>
        </table>
        </div>
      </div>
    </div>

    <div class="page-footer">
      <div class="page-number">Page ${pageCount - 2}</div>
      <div class="footer-line"></div>
      <div class="disclaimer">
        The information contained in this report has been documented by a Qualified Professional.<br>
        This report is effective for one year from the date of inspection. Issued by:<br>
        Belay Reports
      </div>
    </div>
  </div>
  `
      : `
  <!-- SEPARATE PAGES -->
  <!-- PAGE: EQUIPMENT -->
  ${
    equipment.length > 0
      ? `
  <div class="page">
    <div class="page-header">
      <div class="header-left">
        <img src="${belayReportsLogo}" alt="Belay Reports">
      </div>
      <div class="header-center">
        <div class="header-title"></div>
      </div>
      <div class="header-right">
        <img src="${acctLogo}" alt="ACCT Accredited Vendor">
      </div>
    </div>

    <div class="page-content">
      <h2>EQUIPMENT INSPECTION</h2>
      <p style="margin-bottom: 15px; font-size: 10pt; line-height: 1.6;">
        All equipment has been inspected in accordance with manufacturer specifications and ACCT standards.
      </p>
      
      ${["harnesses", "helmets", "lanyards", "connectors", "rope", "belay", "trolleys", "other"]
        .map((category) => {
          const categoryEquipment = equipment.filter((eq) => eq.equipment_category === category);
          if (categoryEquipment.length === 0) return "";

          const categoryTitle =
            category === "connectors"
              ? "CONNECTORS (CARABINERS & QUICKLINKS)"
              : category === "rope"
                ? "ROPE"
                : category === "belay"
                  ? "BELAY/DESCENT DEVICES"
                  : category === "trolleys"
                    ? "TROLLEYS AND PULLEYS"
                    : category === "other"
                      ? "OTHER EQUIPMENT"
                      : category.toUpperCase();

          return `
          <h3 class="table-section-header" style="margin-top: 20px; color: #000; font-size: 11pt;">EQUIPMENT - <em>${categoryTitle}</em></h3>
          <div class="table-wrapper keep-together">
          <table class="equipment-table">
            <thead>
              <tr>
                <th>Type</th>
                <th>Quantity</th>
                <th>Manufacture Year(s)</th>
                <th>Result</th>
                <th>Comments</th>
                <th>Photo</th>
              </tr>
            </thead>
            <tbody>
              ${categoryEquipment
                .map((eq) => {
                  if (eq.is_divider) {
                    return `<tr><td colspan="6" style="text-align:center; font-weight:bold; padding:10px; background:#dbeafe; font-size:11pt;">${eq.divider_text || ''}</td></tr>`;
                  }
                  const resultData = formatResultCheckbox(eq.result);
                  const formattedComments = formatCommentsAsBullets(eq.comments);
                  return `
                  <tr>
                    <td>${eq.equipment_type}</td>
                    <td style="text-align: center;">${eq.quantity || "N/A"}</td>
                    <td style="text-align: center;">${eq.production_year === "0" ? "N/A" : eq.production_year || "N/A"}</td>
                    <td style="${resultData.cellStyle}">${resultData.html}</td>
                    <td style="font-size: 9pt;">${formattedComments}</td>
                    ${renderItemPhotoCell(eq.photo_url)}
                  </tr>
                `;
                })
                .join("")}
            </tbody>
          </table>
          </div>
        `;
        })
        .join("")}
    </div>

    <div class="page-footer">
      <div class="page-number">Page ${systems.length > 0 ? (ziplines.length > 0 ? "7" : "6") : ziplines.length > 0 ? "6" : "5"}</div>
      <div class="footer-line"></div>
      <div class="disclaimer">
        The information contained in this report has been documented by a Qualified Professional.<br>
        This report is effective for one year from the date of inspection. Issued by:<br>
        Belay Reports
      </div>
    </div>
  </div>
  `
      : ""
  }

  <!-- PAGE: ACCT STANDARDS -->
  ${
    standards.length > 0
      ? `
  <div class="page">
    <div class="page-header">
      <div class="header-left">
        <img src="${belayReportsLogo}" alt="Belay Reports">
      </div>
      <div class="header-center">
        <div class="header-title"></div>
      </div>
      <div class="header-right">
        <img src="${acctLogo}" alt="ACCT Accredited Vendor">
      </div>
    </div>

    <div class="page-content">
      <h2>ACCT OPERATIONS STANDARDS</h2>
      <p style="margin-bottom: 15px; font-size: 10pt; line-height: 1.6;">
        Documentation verification as required by ACCT (Association for Challenge Course Technology) Standards. 
        The presence of documentation does not constitute review or approval of content.
      </p>

      <div class="table-wrapper keep-together">
      <table class="standards-table">
        <thead>
          <tr>
            <th>Standard / Document</th>
            <th style="text-align: center;">YES</th>
            <th style="text-align: center;">NO</th>
            <th style="text-align: center;">Comments</th>
          </tr>
        </thead>
        <tbody>
          ${standards
            .map(
              (std) => `
            <tr>
              <td><strong>${std.standard_name}</strong></td>
              <td style="text-align: center; font-size: 12pt;">${std.has_documentation === true ? "☑" : "☐"}</td>
              <td style="text-align: center; font-size: 12pt;">${std.has_documentation === false ? "☑" : "☐"}</td>
              <td style="font-size: 9pt;">${std.comments || "—"}</td>
            </tr>
          `,
            )
            .join("")}
        </tbody>
      </table>
      </div>
    </div>

    <div class="page-footer">
      <div class="page-number">Page ${pageCount - 2}</div>
      <div class="footer-line"></div>
      <div class="disclaimer">
        The information contained in this report has been documented by a Qualified Professional.<br>
        This report is effective for one year from the date of inspection. Issued by:<br>
        Belay Reports
      </div>
    </div>
  </div>
  `
      : ""
  }
  `
  }

  <!-- PAGE: SUMMARY -->
  ${
    summary
      ? `
  <div class="page">
    <div class="page-header">
      <div class="header-left">
        <img src="${belayReportsLogo}" alt="Belay Reports">
      </div>
      <div class="header-center">
        <div class="header-title"></div>
      </div>
      <div class="header-right">
        <img src="${acctLogo}" alt="ACCT Accredited Vendor">
      </div>
    </div>

    <div class="page-content">
      <h2 style="margin-top: 10px; margin-bottom: 20px;">INSPECTION SUMMARY</h2>

      <div style="margin-bottom: 20px;">
        
        <div class="text-block" style="padding: 10px 15px; background: #f8fafc; border-left: 4px solid #16a34a;">
          ${renderBulletList(parseTextToList(prependDefaultBolt(summary?.repairs_performed || "")), deduplicateHtmlContent(prependDefaultBolt(summary?.repairs_performed || "")))}
        </div>
      </div>

      ${
        summary.critical_actions
          ? `
      <div class="critical-box" style="margin-bottom: 20px; padding: 12px; background: #fef2f2; border: 2px solid #dc2626; border-radius: 4px;">
        <h3 style="font-size: 11pt; font-weight: bold; margin-bottom: 8px; color: #dc2626; text-transform: uppercase;">⚠ Critical Actions Required</h3>
        <div style="font-size: 10pt; line-height: 1.5; color: #1a1a1a;">
          ${renderBulletList(parseTextToList(summary.critical_actions), deduplicateHtmlContent(summary.critical_actions))}
        </div>
        <p style="margin-top: 8px; font-size: 9pt; font-style: italic; color: #7f1d1d;">
          <strong>IMPORTANT:</strong> Items listed above must be addressed immediately.
        </p>
      </div>
      `
          : ""
      }

      ${
        summary.future_considerations
          ? `
      <div style="margin-bottom: 20px;">
        <h3 style="font-size: 12pt; font-weight: bold; margin-bottom: 8px; color: #1a1a1a; border-bottom: 2px solid #ea580c; padding-bottom: 5px;">Future Considerations</h3>
        <div class="text-block" style="padding: 10px 15px; background: #fff7ed; border-left: 4px solid #ea580c;">
          ${renderBulletList(parseTextToList(summary.future_considerations), deduplicateHtmlContent(summary.future_considerations))}
        </div>
      </div>
      `
          : ""
      }

      ${
        summary.next_inspection_date
          ? `
      <div style="margin-bottom: 20px; padding: 12px 15px; background: #f0f9ff; border-left: 4px solid #0284c7;">
        <h3 style="font-size: 11pt; font-weight: bold; margin-bottom: 5px; color: #0284c7;">Next Scheduled Inspection</h3>
        <p style="font-size: 11pt; margin: 0; color: #1a1a1a;"><strong>${formatDate(summary.next_inspection_date)}</strong></p>
        <p style="font-size: 9pt; margin-top: 5px; color: #666; font-style: italic;">Annual professional inspections are required to maintain ACCT compliance.</p>
      </div>
      `
          : ""
      }
    </div>

    <div class="page-footer">
      <div class="page-number">Page ${pageCount - 1}</div>
      <div class="footer-line"></div>
      <div class="disclaimer">
        The information contained in this report has been documented by a Qualified Professional.<br>
        This report is effective for one year from the date of inspection. Issued by:<br>
        Belay Reports
      </div>
    </div>
  </div>

  <!-- PAGE: RETIREMENT GUIDELINES -->
  <div class="page">
    <div class="page-header">
      <div class="header-left">
        <img src="${belayReportsLogo}" alt="Belay Reports">
      </div>
      <div class="header-center">
        <div class="header-title"></div>
      </div>
      <div class="header-right">
        <img src="${acctLogo}" alt="ACCT Accredited Vendor">
      </div>
    </div>

    <div class="page-content">
      <h2 style="margin-top: 10px; margin-bottom: 15px;">EQUIPMENT RETIREMENT GUIDELINES</h2>
      
      <p style="font-size: 10pt; line-height: 1.6; margin-bottom: 12px; color: #1a1a1a;">
        <strong>Equipment must be retired from service when any of the following conditions are met:</strong>
      </p>
      
      <table style="width: 100%; border-collapse: collapse; margin: 10px 0; font-size: 10pt;">
        <thead>
          <tr>
            <th style="background: #1e40af; color: #fff; padding: 8px; text-align: left; font-weight: bold; border: 1px solid #1e40af; width: 40%;">Retirement Criteria</th>
            <th style="background: #1e40af; color: #fff; padding: 8px; text-align: left; font-weight: bold; border: 1px solid #1e40af; width: 60%;">Description</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style="padding: 6px 8px; border: 1px solid #000; vertical-align: top;">Manufacturer's Lifespan</td>
            <td style="padding: 6px 8px; border: 1px solid #000; vertical-align: top;">Manufacturer's recommended lifespan has been exceeded</td>
          </tr>
          <tr>
            <td style="padding: 6px 8px; border: 1px solid #000; vertical-align: top;">Visible Damage</td>
            <td style="padding: 6px 8px; border: 1px solid #000; vertical-align: top;">Visible damage, wear, or deterioration affecting structural integrity</td>
          </tr>
          <tr>
            <td style="padding: 6px 8px; border: 1px solid #000; vertical-align: top;">Impact/Shock Loading</td>
            <td style="padding: 6px 8px; border: 1px solid #000; vertical-align: top;">Equipment subjected to impact forces or shock loading beyond design parameters</td>
          </tr>
          <tr>
            <td style="padding: 6px 8px; border: 1px solid #000; vertical-align: top;">Missing Markings</td>
            <td style="padding: 6px 8px; border: 1px solid #000; vertical-align: top;">Missing or illegible manufacturer identification markings</td>
          </tr>
          <tr>
            <td style="padding: 6px 8px; border: 1px solid #000; vertical-align: top;">Fails Inspection</td>
            <td style="padding: 6px 8px; border: 1px solid #000; vertical-align: top;">Equipment fails inspection criteria outlined in current ACCT standards</td>
          </tr>
          <tr>
            <td style="padding: 6px 8px; border: 1px solid #000; vertical-align: top;">Incomplete Documentation</td>
            <td style="padding: 6px 8px; border: 1px solid #000; vertical-align: top;">Incomplete or unavailable documentation of equipment history</td>
          </tr>
          <tr>
            <td style="padding: 6px 8px; border: 1px solid #000; vertical-align: top;">Incident Involvement</td>
            <td style="padding: 6px 8px; border: 1px solid #000; vertical-align: top;">Equipment is involved in any incident resulting in injury or near-miss</td>
          </tr>
        </tbody>
      </table>
      
      <div style="margin-top: 15px; padding: 12px; border: 1px solid #000;">
        <p style="font-size: 10pt; line-height: 1.5; margin: 0; color: #1a1a1a;">
          <strong>Retirement Procedure:</strong> All retired equipment must be clearly marked "RETIRED - DO NOT USE", immediately removed from service, and physically destroyed or rendered permanently unusable to prevent accidental future use. Complete documentation of the retirement, including date, reason, and method of disposal, must be maintained in accordance with record-keeping requirements.
        </p>
      </div>
    </div>

    <div class="page-footer">
      <div class="page-number">Page ${pageCount}</div>
      <div class="footer-line"></div>
      <div class="disclaimer">
        The information contained in this report has been documented by a Qualified Professional.<br>
        This report is effective for one year from the date of inspection. Issued by:<br>
        Belay Reports
      </div>
    </div>
  </div>
  `
      : ""
  }

  <!-- PAGE: PHOTOS (if any) -->
  ${
    photoDataUris.length > 0
      ? `
  <div class="page">
    <div class="page-header">
      <div class="header-left">
        <img src="${belayReportsLogo}" alt="Belay Reports">
      </div>
      <div class="header-center">
        <div class="header-title"></div>
      </div>
      <div class="header-right">
        <img src="${acctLogo}" alt="ACCT Accredited Vendor">
      </div>
    </div>

    <div class="page-content">
      <h2 style="margin-top: 10px; margin-bottom: 20px;">INSPECTION PHOTOS</h2>
      
      <div class="photo-gallery">
        ${photoDataUris
          .map(
            (photo) => `
          <div class="photo-item">
            ${photo.section ? `<div class="photo-section-label">${photo.section}</div>` : ""}
            <img src="${photo.dataUri}" alt="Inspection photo" class="inspection-photo">
            ${photo.caption ? `<div class="photo-caption">${photo.caption}</div>` : `<div class="photo-caption" style="color:#94a3b8;">No caption</div>`}
          </div>
        `
          )
          .join("")}
      </div>
    </div>

    <div class="page-footer">
      <div class="page-number">Page ${pageCount + 1}</div>
      <div class="footer-line"></div>
      <div class="disclaimer">
        The information contained in this report has been documented by a Qualified Professional.<br>
        This report is effective for one year from the date of inspection. Issued by:<br>
        Belay Reports
      </div>
    </div>
  </div>
  `
      : ""
  }

  </div> <!-- End content-wrapper -->

  ${buildAttestationBlock({
    attestation_signed_at: (inspection as any).attestation_signed_at,
    attestation_signer_name: (inspection as any).attestation_signer_name,
    attestation_ip: (inspection as any).attestation_ip,
    attestation_user_agent: (inspection as any).attestation_user_agent,
    attestation_text: (inspection as any).attestation_text,
  })}
  ${buildVersionFooter({
    appVersion: (inspection as any).app_version_at_completion,
    reportVersion: (inspection as any).report_version,
    generatedAt: new Date().toISOString(),
  })}

</body>
</html>`;

    // OPTIMIZATION: Return HTML directly for reports under 1MB (eliminates storage upload + signed URL round trips)
    const htmlSizeBytes = new TextEncoder().encode(html).length;
    const ONE_MB = 1024 * 1024;
    
    if (htmlSizeBytes < ONE_MB) {
      console.log(`[generate-inspection-html] Report size ${(htmlSizeBytes / 1024).toFixed(1)}KB < 1MB — returning directly (skipping storage upload).`);
      return new Response(JSON.stringify({ html }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    // Large reports: upload to storage and return signed URL
    console.log(`[generate-inspection-html] Report size ${(htmlSizeBytes / 1024).toFixed(1)}KB >= 1MB — uploading to storage...`);
    
    const timestamp = Date.now();
    const filePath = `html-reports/${inspectionId}-${timestamp}.html`;
    const htmlBlob = new Blob([html], { type: 'text/html' });
    
    const { error: uploadError } = await supabase.storage
      .from('inspection-reports')
      .upload(filePath, htmlBlob, {
        contentType: 'text/html',
        upsert: false,
      });

    if (uploadError) {
      console.error(`[generate-inspection-html] Storage upload failed, falling back to direct return:`, uploadError);
      return new Response(JSON.stringify({ html }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    const { data: signedUrlData, error: signedUrlError } = await supabase.storage
      .from('inspection-reports')
      .createSignedUrl(filePath, 86400);

    if (signedUrlError || !signedUrlData?.signedUrl) {
      console.error(`[generate-inspection-html] Signed URL failed, falling back to direct return:`, signedUrlError);
      return new Response(JSON.stringify({ html }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    console.log(`[generate-inspection-html] Complete. Returning signed URL.`);
    return new Response(JSON.stringify({ htmlUrl: signedUrlData.signedUrl, html }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    console.error("Error generating HTML:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
    return new Response(JSON.stringify({ error: errorMessage }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
