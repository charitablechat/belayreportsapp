import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.0";
import { PDFDocument, rgb, StandardFonts } from "https://esm.sh/pdf-lib@1.17.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const authHeader = req.headers.get('Authorization')!;
    
    const supabaseClient = createClient(supabaseUrl, supabaseServiceKey);
    
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser(token);
    
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { inspectionId, regenerate } = await req.json();

    const { data: inspection, error: inspError } = await supabaseClient
      .from('inspections')
      .select('*')
      .eq('id', inspectionId)
      .single();

    if (inspError || !inspection) {
      return new Response(JSON.stringify({ error: 'Inspection not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: roles } = await supabaseClient
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id);
    
    const isSuperAdmin = roles?.some(r => r.role === 'super_admin');
    const isInspector = inspection.inspector_id === user.id;

    if (!isSuperAdmin && !isInspector) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!regenerate) {
      const { data: existingReport } = await supabaseClient
        .from('inspection_reports')
        .select('pdf_url')
        .eq('inspection_id', inspectionId)
        .order('generated_at', { ascending: false })
        .limit(1)
        .single();

      if (existingReport) {
        const { data: signedUrl } = await supabaseClient.storage
          .from('inspection-reports')
          .createSignedUrl(existingReport.pdf_url.split('/').pop()!, 900);
        
        return new Response(JSON.stringify({ pdfUrl: signedUrl?.signedUrl || '' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    const [systemsRes, ziplinesRes, equipmentRes, standardsRes, summaryRes, photosRes, profileRes] = await Promise.all([
      supabaseClient.from('inspection_systems').select('*').eq('inspection_id', inspectionId),
      supabaseClient.from('inspection_ziplines').select('*').eq('inspection_id', inspectionId),
      supabaseClient.from('inspection_equipment').select('*').eq('inspection_id', inspectionId),
      supabaseClient.from('inspection_standards').select('*').eq('inspection_id', inspectionId),
      supabaseClient.from('inspection_summary').select('*').eq('inspection_id', inspectionId).single(),
      supabaseClient.from('inspection_photos').select('*').eq('inspection_id', inspectionId),
      supabaseClient.from('profiles').select('first_name, last_name').eq('id', inspection.inspector_id).single(),
    ]);

    const systems = systemsRes.data || [];
    const ziplines = ziplinesRes.data || [];
    const equipment = equipmentRes.data || [];
    const standards = standardsRes.data || [];
    const summary = summaryRes.data;
    const profile = profileRes.data;

    const pdfDoc = await PDFDocument.create();
    const helveticaFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const pageWidth = 612;
    const pageHeight = 792;
    const margin = 54;
    const tableWidth = pageWidth - 2 * margin;
    
    const addPage = () => pdfDoc.addPage([pageWidth, pageHeight]);
    
    // Sanitize text to replace Unicode characters not supported by WinAnsi encoding
    const sanitizeText = (text: string): string => {
      if (!text) return '';
      return text
        .replace(/○/g, '•')  // Replace white circle with bullet (supported by WinAnsi)
        .replace(/[^\x00-\xFF]/g, '?');  // Replace any other non-Latin1 characters with ?
    };
    
    const drawText = (page: any, text: string, x: number, y: number, options: any = {}) => {
      // Sanitize text before processing
      text = sanitizeText(text);
      
      // Split by newlines first to handle multi-line text
      const paragraphs = text.split(/\n+/);
      const maxWidth = options.maxWidth || (pageWidth - x - margin);
      const lines = [];
      
      for (const paragraph of paragraphs) {
        if (!paragraph.trim()) continue;
        
        let currentLine = '';
        const words = paragraph.split(' ');
        
        for (const word of words) {
          const testLine = currentLine ? `${currentLine} ${word}` : word;
          const font = options.bold ? helveticaBold : helveticaFont;
          const testWidth = font.widthOfTextAtSize(testLine, options.size || 10);
          
          if (testWidth > maxWidth && currentLine) {
            lines.push(currentLine);
            currentLine = word;
          } else {
            currentLine = testLine;
          }
        }
        if (currentLine) lines.push(currentLine);
      }
      
      let currentY = y;
      for (const line of lines) {
        page.drawText(line, {
          x,
          y: currentY,
          size: options.size || 10,
          font: options.bold ? helveticaBold : helveticaFont,
          color: options.color || rgb(0, 0, 0),
        });
        currentY -= (options.size || 10) + 2;
      }
      
      return currentY;
    };

    const formatDate = (date: string | null) => {
      if (!date) return 'N/A';
      return new Date(date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    };

    // ACCT Header for all pages
    const drawACCTHeader = (page: any, yPos: number) => {
      drawText(page, 'ACCT', margin, yPos, { size: 10, bold: true });
      drawText(page, 'ACCREDITED VENDOR', margin, yPos - 12, { size: 8 });
      drawText(page, 'ROPES/CHALLENGE COURSE', margin, yPos - 22, { size: 8 });
      
      // ACCT logo placeholder (text-based)
      page.drawRectangle({ 
        x: margin - 2, 
        y: yPos - 35, 
        width: 120, 
        height: 35, 
        borderColor: rgb(0, 0, 0), 
        borderWidth: 1 
      });
      
      return yPos - 45; // Return new yPos after header
    };

    // Consistent page footer
    const drawPageFooter = (page: any, pageNumber: number, totalPages: number) => {
      const footerY = 35;
      
      // Company info
      drawText(page, 'Rope Works Inc., PO Box 1074, Dripping Springs, TX 78620', 
        margin, footerY, { size: 7, color: rgb(0.5, 0.5, 0.5) });
      
      // Disclaimer (on all pages except cover)
      if (pageNumber > 1) {
        drawText(page, 'The information contained in this report has been documented by a Qualified Professional.', 
          margin, footerY - 10, { size: 7, color: rgb(0.4, 0.4, 0.4) });
        drawText(page, 'This report is effective for one year from the date of inspection.', 
          margin, footerY - 18, { size: 7, color: rgb(0.4, 0.4, 0.4) });
      }
      
      // Page number
      drawText(page, `Page ${pageNumber} of ${totalPages}`, 
        pageWidth - margin - 70, footerY, { size: 8, color: rgb(0.5, 0.5, 0.5) });
    };

    const drawHighlightedTableRow = (page: any, x: number, y: number, width: number, height: number, result: string) => {
      const resultLower = result.toLowerCase();
      let bgColor = rgb(1, 1, 1);
      
      if (resultLower.includes('provision')) {
        bgColor = rgb(1, 1, 0.6); // Yellow
      } else if (resultLower.includes('fail') && !resultLower.includes('pass')) {
        bgColor = rgb(1, 0.6, 0.6); // Red
      }
      
      page.drawRectangle({ x, y, width, height, color: bgColor });
      page.drawRectangle({ x, y, width, height, borderColor: rgb(0.7, 0.7, 0.7), borderWidth: 0.5 });
    };

    // === COVER PAGE ===
    let page = addPage();
    let yPos = pageHeight - 60;

    // ACCT Header
    yPos = drawACCTHeader(page, yPos);
    yPos -= 5;

    // Title
    drawText(page, 'Professional Inspection for Aerial Adventure Programs', margin, yPos, { size: 14, bold: true });
    yPos -= 30;

    // Organization Table (3 columns)
    const orgTableHeight = 50;
    page.drawRectangle({ x: margin, y: yPos - orgTableHeight, width: tableWidth, height: orgTableHeight, borderColor: rgb(0, 0, 0), borderWidth: 1 });

    // Vertical dividers for 3 columns
    page.drawLine({ start: { x: margin + tableWidth/3, y: yPos }, end: { x: margin + tableWidth/3, y: yPos - orgTableHeight }, thickness: 1 });
    page.drawLine({ start: { x: margin + 2*tableWidth/3, y: yPos }, end: { x: margin + 2*tableWidth/3, y: yPos - orgTableHeight }, thickness: 1 });

    // Horizontal divider (header row)
    page.drawLine({ start: { x: margin, y: yPos - 22 }, end: { x: margin + tableWidth, y: yPos - 22 }, thickness: 1 });

    // Column 1: Organization
    drawText(page, 'Organization:', margin + 5, yPos - 14, { size: 9, bold: true });
    drawText(page, inspection.organization || 'N/A', margin + 5, yPos - 38, { size: 9 });

    // Column 2: Location
    drawText(page, 'Location:', margin + tableWidth/3 + 5, yPos - 14, { size: 9, bold: true });
    drawText(page, inspection.location || 'N/A', margin + tableWidth/3 + 5, yPos - 38, { size: 9 });

    // Column 3: Onsite Contact
    drawText(page, 'Onsite Contact:', margin + 2*tableWidth/3 + 5, yPos - 14, { size: 9, bold: true });
    drawText(page, inspection.onsite_contact || 'N/A', margin + 2*tableWidth/3 + 5, yPos - 38, { size: 9 });

    yPos -= orgTableHeight + 15;

    // Inspector/Date Table (2 columns, 3 rows)
    const inspTableHeight = 75;
    const inspectorName = profile ? `${profile.first_name || ''} ${profile.last_name || ''}`.trim() : 'Unknown';

    page.drawRectangle({ x: margin, y: yPos - inspTableHeight, width: tableWidth, height: inspTableHeight, borderColor: rgb(0, 0, 0), borderWidth: 1 });

    // Vertical divider (2 columns)
    page.drawLine({ start: { x: margin + tableWidth/2, y: yPos }, end: { x: margin + tableWidth/2, y: yPos - inspTableHeight }, thickness: 1 });

    // Horizontal dividers (3 rows)
    page.drawLine({ start: { x: margin, y: yPos - 25 }, end: { x: margin + tableWidth, y: yPos - 25 }, thickness: 1 });
    page.drawLine({ start: { x: margin, y: yPos - 50 }, end: { x: margin + tableWidth, y: yPos - 50 }, thickness: 1 });

    // Row 1
    drawText(page, 'Inspected by:', margin + 5, yPos - 16, { size: 9, bold: true });
    drawText(page, inspectorName, margin + 5, yPos - 23, { size: 9 });
    drawText(page, 'Date of Inspection:', margin + tableWidth/2 + 5, yPos - 16, { size: 9, bold: true });
    drawText(page, formatDate(inspection.inspection_date), margin + tableWidth/2 + 5, yPos - 23, { size: 9 });

    // Row 2
    drawText(page, 'Previously Inspected by:', margin + 5, yPos - 41, { size: 9, bold: true });
    drawText(page, inspection.previous_inspector || 'N/A', margin + 5, yPos - 48, { size: 9 });
    drawText(page, 'Prev. Inspection Date:', margin + tableWidth/2 + 5, yPos - 41, { size: 9, bold: true });
    drawText(page, formatDate(inspection.previous_inspection_date), margin + tableWidth/2 + 5, yPos - 48, { size: 9 });

    yPos -= inspTableHeight + 20;

    // Known Course History
    drawText(page, 'Known Course History', margin, yPos, { size: 11, bold: true });
    yPos -= 15;
    yPos = drawText(page, inspection.course_history || 'No prior history documented.', margin, yPos, { size: 9, maxWidth: tableWidth });
    yPos -= 20;

    // Full Disclaimer Paragraph
    yPos = drawText(page, 'This report covers the condition of the aerial adventure site for the date of inspection reflected on this form. The inspection provided is strictly an evaluation of the structural condition of the course elements and equipment. The inspection does not include training on how to operate the equipment, nor how to operate the course. The inspection only verifies the existence of written local operating procedures (LOP), an emergency action plan (EAP), and training documentation. The inspection does not perform a review or evaluate the LOP, EAP and training documentation. Potential problems can occur afterwards due to vandalism, improper use, weather, etc. Rope Works Inc. is not responsible for modifications or repairs made to the challenge course by anyone other than a Rope Works Inc. employee. We recommend you conduct your own periodic internal monitoring at a minimum on a quarterly basis. At a minimum an annual professional inspection is required by a qualified professional to be in compliance with the Association for Challenge Course Technology ANSI/ACCT current published standards.', margin, yPos, { size: 7, maxWidth: tableWidth });
    yPos -= 20;

    // Reminders and Requirements
    drawText(page, 'Reminders and Requirements', margin, yPos, { size: 11, bold: true });
    yPos -= 15;
    drawText(page, '• Employers are required to issue staff appropriate fall protection for the duties to be performed.', margin, yPos, { size: 8 });
    yPos -= 12;
    drawText(page, '• A Periodic Internal Monitoring of the aerial activities on your site shall be conducted by qualified personnel.', margin, yPos, { size: 8 });
    yPos -= 12;
    drawText(page, '• Proper identification, tracking, and documentation of ALL equipment used for operations shall be kept and available at your annual professional inspection.', margin, yPos, { size: 8 });
    yPos -= 12;
    drawText(page, '• Proper staff training should be provided for the operation of all aerial activities and equipment on your site.', margin, yPos, { size: 8 });
    yPos -= 12;
    drawText(page, '• Operational Reviews shall be conducted once every five years.', margin, yPos, { size: 8 });

    // Definitions Page (EXPANDED)
    page = addPage();
    yPos = pageHeight - 80;
    drawText(page, 'Definitions', margin, yPos, { size: 16, bold: true });
    yPos -= 20;
    drawText(page, 'Acceptable/Pass: Meets manufacturer’s and/or industry standards, is fit for continued use.', margin, yPos, { size: 10 });
    yPos -= 15;
    drawText(page, 'Unacceptable/Fail: Does not meet manufacturer’s and/or industry standards, is not fit for continued use. Immediate action required.', margin, yPos, { size: 10 });
    yPos -= 15;
    drawText(page, 'Provisionally Acceptable/Pass: Meets manufacturer’s and/or industry standards, and is fit for continued use, but requires monitoring or future action.', margin, yPos, { size: 10 });
    yPos -= 15;
    drawText(page, 'N/A: Not applicable or not inspected.', margin, yPos, { size: 10 });

    // === OPERATING SYSTEMS PAGE ===
    page = addPage();
    yPos = pageHeight - 60;
    yPos = drawACCTHeader(page, yPos);

    drawText(page, 'Operating Systems', margin, yPos, { size: 14, bold: true });
    yPos -= 20;

    const systemTableHeader = ['Operating System | Name', 'Result', 'Comments or Required Changes'];
    const systemColumnWidths = [200, 80, tableWidth - 280];
    const systemColumnX = [margin, margin + 200, margin + 280];

    // Draw table header
    page.drawRectangle({ x: margin, y: yPos - 20, width: tableWidth, height: 20, color: rgb(0.8, 0.8, 0.8) });
    systemTableHeader.forEach((header, i) => {
      drawText(page, header, systemColumnX[i] + 5, yPos - 14, { size: 10, bold: true });
    });
    yPos -= 20;

    // Draw table rows (filtered for populated rows)
    systems.filter(s => s.system_name && s.result).forEach(system => {
      const rowHeight = 60;
      drawHighlightedTableRow(page, margin, yPos - rowHeight, tableWidth, rowHeight, system.result);

      drawText(page, system.system_name, margin + 5, yPos - 17, { size: 10, maxWidth: systemColumnWidths[0] - 10 });
      drawText(page, system.result, margin + 205, yPos - 17, { size: 10, maxWidth: systemColumnWidths[1] - 10 });
      yPos = drawText(page, system.comments || 'N/A', margin + 285, yPos - 17, { size: 10, maxWidth: systemColumnWidths[2] - 10 });

      yPos -= rowHeight - 20;
    });

    // === ZIPLINES PAGE ===
    page = addPage();
    yPos = pageHeight - 60;
    yPos = drawACCTHeader(page, yPos);

    drawText(page, 'SYSTEMS - ZIPLINES', margin, yPos, { size: 14, bold: true });
    yPos -= 22;

    // Cable Type KEY (matching template exactly)
    drawText(page, 'Cable Type KEY: GAC = Galvanized Aircraft Cable, SS = Super Swaged', margin, yPos, { size: 8 });
    yPos -= 11;
    drawText(page, 'Braking System KEY: ZS = Zip Stop, FB = Friction Break, SB = Spring Bank, G = Gravity', margin, yPos, { size: 8 });
    yPos -= 11;
    drawText(page, 'EAD System KEY: ZS = Zip Stop, AP = Auto Pulley', margin, yPos, { size: 8 });
    yPos -= 22;

    // Filter populated ziplines
    const populatedZiplines = ziplines.filter((z: any) => z.zipline_name && z.result);

    if (populatedZiplines.length === 0) {
      drawText(page, 'No ziplines inspected', margin, yPos, { size: 10, color: rgb(0.5, 0.5, 0.5) });
    } else {
      populatedZiplines.forEach((zipline: any) => {
        // TWO-ROW TABLE FORMAT
        const rowHeight = 70;
        
        // Draw highlighting for entire block
        drawHighlightedTableRow(page, margin, yPos - rowHeight, tableWidth, rowHeight, zipline.result);
        
        // === ROW 1: Main Info ===
        const row1Y = yPos - 15;
        const colWidths = [110, 85, 95, 85, 75, tableWidth - 450];
        const colX = [
          margin + 5, 
          margin + 115, 
          margin + 200, 
          margin + 295, 
          margin + 380, 
          margin + 455
        ];
        
        // Row 1 headers (bold)
        drawText(page, 'Zip Cable Line', colX[0], row1Y, { size: 8, bold: true });
        drawText(page, 'Cable Length (feet)', colX[1], row1Y, { size: 8, bold: true });
        drawText(page, 'Unload Tension (lbf)', colX[2], row1Y, { size: 8, bold: true });
        drawText(page, 'Load Tension (lbf)', colX[3], row1Y, { size: 8, bold: true });
        drawText(page, 'Result:', colX[4], row1Y, { size: 8, bold: true });
        drawText(page, 'Comments:', colX[5], row1Y, { size: 8, bold: true });
        
        // Row 1 data
        drawText(page, zipline.zipline_name || '', colX[0], row1Y - 12, { size: 9 });
        drawText(page, zipline.cable_length?.toString() || '', colX[1], row1Y - 12, { size: 9 });
        drawText(page, zipline.unload_tension?.toString() || '', colX[2], row1Y - 12, { size: 9 });
        drawText(page, zipline.load_tension?.toString() || '', colX[3], row1Y - 12, { size: 9 });
        drawText(page, zipline.result || '', colX[4], row1Y - 12, { size: 9 });
        drawText(page, zipline.comments || '', colX[5], row1Y - 12, { size: 8, maxWidth: colWidths[5] - 10 });
        
        // === ROW 2: Cable/Braking/EAD ===
        const row2Y = yPos - 45;
        
        drawText(page, 'Cable', colX[0], row2Y, { size: 8, bold: true });
        drawText(page, 'Braking System', colX[2], row2Y, { size: 8, bold: true });
        drawText(page, 'EAD System', colX[3] + 20, row2Y, { size: 8, bold: true });
        
        drawText(page, zipline.cable_type || 'N/A', colX[0], row2Y - 12, { size: 9 });
        drawText(page, zipline.braking_system || 'N/A', colX[2], row2Y - 12, { size: 9 });
        drawText(page, zipline.ead_system || 'N/A', colX[3] + 20, row2Y - 12, { size: 9 });
        
        // Horizontal divider between rows
        page.drawLine({ 
          start: { x: margin, y: yPos - 35 }, 
          end: { x: margin + tableWidth, y: yPos - 35 }, 
          thickness: 0.5, 
          color: rgb(0.7, 0.7, 0.7) 
        });
        
        // Border around entire two-row block
        page.drawRectangle({ 
          x: margin, 
          y: yPos - rowHeight, 
          width: tableWidth, 
          height: rowHeight, 
          borderColor: rgb(0.7, 0.7, 0.7), 
          borderWidth: 1 
        });
        
        yPos -= rowHeight + 10;
        
        // Check if new page needed
        if (yPos < 150) {
          page = addPage();
          yPos = pageHeight - 60;
          yPos = drawACCTHeader(page, yPos);
        }
      });
    }

    // === EQUIPMENT PAGES (grouped by category) ===
    // Filter and group by category
    const populatedEquipment = equipment.filter((e: any) => e.equipment_type && e.result);
    const equipmentByCategory: { [key: string]: any[] } = {};

    populatedEquipment.forEach((eq: any) => {
      const category = eq.equipment_category || 'other';
      if (!equipmentByCategory[category]) {
        equipmentByCategory[category] = [];
      }
      equipmentByCategory[category].push(eq);
    });

    // Category display names
    const categoryNames: { [key: string]: string } = {
      'harness': 'EQUIPMENT - HARNESS',
      'helmets': 'EQUIPMENT - HELMETS',
      'trolleys': 'EQUIPMENT - TROLLEYS AND PULLEYS',
      'carabiners': 'EQUIPMENT - CONNECTORS (CARABINERS & QUICKLINKS)',
      'rope': 'EQUIPMENT - KERNMANTLE ROPE',
      'belay': 'EQUIPMENT - BELAY/DESCENT DEVICE',
      'lanyard': 'EQUIPMENT - LANYARD',
      'other': 'EQUIPMENT - OTHER'
    };

    let firstEquipmentPage = true;

    Object.keys(equipmentByCategory).forEach(category => {
      // New page for each category (or if space runs out)
      if (!firstEquipmentPage || yPos < 300) {
        page = addPage();
        yPos = pageHeight - 60;
        yPos = drawACCTHeader(page, yPos);
      }
      firstEquipmentPage = false;
      
      // Category header
      drawText(page, categoryNames[category] || category.toUpperCase(), margin, yPos, { size: 12, bold: true });
      yPos -= 18;
      
      // Warning for failed equipment in this category
      const hasFailed = equipmentByCategory[category].some((e: any) => e.result.toLowerCase().includes('fail'));
      if (hasFailed) {
        drawText(page, '(!) WARNING: Failed equipment must be retired or repaired before use', margin, yPos, { size: 9, bold: true, color: rgb(0.94, 0.27, 0.27) });
        yPos -= 18;
      }
      
      // Table header
      const eqColWidths = [150, 100, 70, 80, tableWidth - 400];
      const eqColX = [margin + 5, margin + 155, margin + 255, margin + 325, margin + 405];
      
      page.drawRectangle({ x: margin, y: yPos - 20, width: tableWidth, height: 20, color: rgb(0.8, 0.8, 0.8) });
      drawText(page, 'Type', eqColX[0], yPos - 14, { size: 9, bold: true });
      drawText(page, 'Production Year', eqColX[1], yPos - 14, { size: 9, bold: true });
      drawText(page, 'Quantity', eqColX[2], yPos - 14, { size: 9, bold: true });
      drawText(page, 'Result:', eqColX[3], yPos - 14, { size: 9, bold: true });
      drawText(page, 'Comments and/or Required Changes', eqColX[4], yPos - 14, { size: 8, bold: true });
      yPos -= 20;
      
      // Table rows
      equipmentByCategory[category].forEach((eq: any) => {
        const rowHeight = 40;
        
        drawHighlightedTableRow(page, margin, yPos - rowHeight, tableWidth, rowHeight, eq.result);
        
        drawText(page, eq.equipment_type || '', eqColX[0], yPos - 15, { size: 9, maxWidth: eqColWidths[0] - 10 });
        drawText(page, eq.production_year?.toString() || 'N/A', eqColX[1], yPos - 15, { size: 9 });
        drawText(page, eq.quantity?.toString() || 'N/A', eqColX[2], yPos - 15, { size: 9 });
        drawText(page, eq.result || '', eqColX[3], yPos - 15, { size: 9 });
        drawText(page, eq.comments || '', eqColX[4], yPos - 15, { size: 8, maxWidth: eqColWidths[4] - 10 });
        
        yPos -= rowHeight;
        
        // New page if needed
        if (yPos < 150) {
          page = addPage();
          yPos = pageHeight - 60;
          yPos = drawACCTHeader(page, yPos);
        }
      });
      
      yPos -= 20; // Space between categories
    });

    // === STANDARDS & DOCUMENTATION PAGE ===
    page = addPage();
    yPos = pageHeight - 60;
    yPos = drawACCTHeader(page, yPos);

    drawText(page, 'Standards & Documentation', margin, yPos, { size: 14, bold: true });
    yPos -= 20;

    drawText(page, 'Documentation Verification per ACCT Standards:', margin, yPos, { size: 10, bold: true });
    yPos -= 18;

    // Table header
    const stdColWidths = [320, 100, tableWidth - 420];
    const stdColX = [margin + 5, margin + 325, margin + 425];

    page.drawRectangle({ x: margin, y: yPos - 20, width: tableWidth, height: 20, color: rgb(0.8, 0.8, 0.8) });
    drawText(page, 'Standard/Requirement', stdColX[0], yPos - 14, { size: 9, bold: true });
    drawText(page, 'Documentation Present', stdColX[1], yPos - 14, { size: 9, bold: true });
    drawText(page, 'Comments', stdColX[2], yPos - 14, { size: 9, bold: true });
    yPos -= 20;

    // Standards rows with YES/NO checkboxes
    standards.forEach((std: any) => {
      const rowHeight = 35;
      
      // Draw border
      page.drawRectangle({ 
        x: margin, 
        y: yPos - rowHeight, 
        width: tableWidth, 
        height: rowHeight, 
        borderColor: rgb(0.7, 0.7, 0.7), 
        borderWidth: 0.5 
      });
      
      // Standard name
      drawText(page, std.standard_name, stdColX[0], yPos - 18, { size: 9, maxWidth: stdColWidths[0] - 10 });
      
      // YES/NO with checkbox symbols
      const docStatus = std.has_documentation ? '[X] YES  [ ] NO' : '[ ] YES  [X] NO';
      drawText(page, docStatus, stdColX[1], yPos - 18, { size: 9, bold: true });
      
      // Comments
      drawText(page, std.comments || '', stdColX[2], yPos - 18, { size: 8, maxWidth: stdColWidths[2] - 10 });
      
      yPos -= rowHeight;
      
      // New page if needed
      if (yPos < 150) {
        page = addPage();
        yPos = pageHeight - 60;
        yPos = drawACCTHeader(page, yPos);
      }
    });

    // === SUMMARY PAGE ===
    page = addPage();
    yPos = pageHeight - 60;
    yPos = drawACCTHeader(page, yPos);

    drawText(page, 'Inspection Summary', margin, yPos, { size: 14, bold: true });
    yPos -= 25;

    if (summary) {
      // Repairs & Alterations
      drawText(page, 'Repairs, Alterations performed:', margin, yPos, { size: 11, bold: true });
      yPos -= 13;
      yPos = drawText(page, summary.repairs_performed || 'None documented', margin, yPos, { size: 9, maxWidth: tableWidth });
      yPos -= 20;
      
      // Comments
      drawText(page, 'Comments:', margin, yPos, { size: 11, bold: true });
      yPos -= 13;
      yPos = drawText(page, summary.critical_actions || 'None', margin, yPos, { size: 9, maxWidth: tableWidth });
      yPos -= 25;
      
      // CRITICAL ACTIONS - RED BORDERED BOX
      const criticalBoxHeight = 75;
      page.drawRectangle({
        x: margin - 3,
        y: yPos - criticalBoxHeight,
        width: tableWidth + 6,
        height: criticalBoxHeight,
        borderColor: rgb(0.94, 0.27, 0.27),
        borderWidth: 3,
      });
      drawText(page, '(!) CRITICAL ACTIONS', margin + 5, yPos - 18, { size: 11, bold: true, color: rgb(0.94, 0.27, 0.27) });
      yPos = drawText(page, summary.critical_actions || 'No critical actions required at this time.', margin + 5, yPos - 32, { size: 9, maxWidth: tableWidth - 10 });
      yPos -= criticalBoxHeight - 32 + 20;
      
      // Future Considerations
      drawText(page, 'Future Considerations:', margin, yPos, { size: 11, bold: true });
      yPos -= 13;
      yPos = drawText(page, summary.future_considerations || 'None noted', margin, yPos, { size: 9, maxWidth: tableWidth });
      yPos -= 20;
      
      // Next Inspection Date
      drawText(page, 'Next inspection date:', margin, yPos, { size: 11, bold: true });
      yPos -= 13;
      const nextInspDate = summary.next_inspection_date 
        ? formatDate(summary.next_inspection_date) + ' (within 12 months of last inspection)'
        : 'To be determined (within 12 months of ' + formatDate(inspection.inspection_date) + ')';
      drawText(page, nextInspDate, margin, yPos, { size: 9 });
      yPos -= 25;
      
      // General Rope Works Inspection Retirement Guidelines
      drawText(page, 'General Rope Works Inspection Retirement Guidelines:', margin, yPos, { size: 10, bold: true });
      yPos -= 13;
      drawText(page, '• Rope: 5-7 years from production date (heavy use), 7-10 years (moderate use)', margin + 10, yPos, { size: 8 });
      yPos -= 11;
      drawText(page, '• Webbing/Slings: 3-5 years from production date', margin + 10, yPos, { size: 8 });
      yPos -= 11;
      drawText(page, '• Carabiners/Hardware: 10+ years with proper inspection and no damage', margin + 10, yPos, { size: 8 });
      yPos -= 11;
      drawText(page, '• Helmets: Follow manufacturer guidelines (typically 5-10 years)', margin + 10, yPos, { size: 8 });
      yPos -= 11;
      drawText(page, '• Harnesses: 5-7 years from production date with regular use', margin + 10, yPos, { size: 8 });
      yPos -= 11;
      drawText(page, '• Always retire equipment that shows signs of damage, excessive wear, or has been involved in a fall', margin + 10, yPos, { size: 8, bold: true });
      
    } else {
      drawText(page, 'No summary information available.', margin, yPos, { size: 10 });
    }
    
    // === ADD FOOTERS TO ALL PAGES ===
    const allPages = pdfDoc.getPages();
    allPages.forEach((p, idx) => {
      drawPageFooter(p, idx + 1, allPages.length);
    });
    
    // Save and return PDF
    const pdfBytes = await pdfDoc.save();
    const fileName = `inspection-${inspectionId}-${Date.now()}.pdf`;
    
    const { data: uploadData, error: uploadError } = await supabaseClient.storage
      .from('inspection-reports')
      .upload(fileName, pdfBytes, {
        contentType: 'application/pdf',
        upsert: false,
      });

    if (uploadError) throw uploadError;

    await supabaseClient.from('inspection_reports').insert({
      inspection_id: inspectionId,
      pdf_url: uploadData.path,
      generated_by: user.id,
      file_size_bytes: pdfBytes.length,
      version: 1,
    });

    const base64Data = btoa(String.fromCharCode(...new Uint8Array(pdfBytes)));

    return new Response(
      JSON.stringify({ pdfData: base64Data, fileName, fileSize: pdfBytes.length }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error generating PDF:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error occurred' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
