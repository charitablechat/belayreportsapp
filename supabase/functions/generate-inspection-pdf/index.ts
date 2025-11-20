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
    
    const drawText = (page: any, text: string, x: number, y: number, options: any = {}) => {
      const maxWidth = options.maxWidth || (pageWidth - x - margin);
      const lines = [];
      let currentLine = '';
      const words = text.split(' ');
      
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

    // Cover Page
    let page = addPage();
    let yPos = pageHeight - 80;

    drawText(page, 'INSPECTION REPORT', margin, yPos, { size: 20, bold: true });
    yPos -= 25;
    drawText(page, 'Challenge Course, Adventure Park & Canopy/Zip Line Tour', margin, yPos, { size: 11 });
    yPos -= 40;

    // Organization table
    page.drawRectangle({ x: margin, y: yPos - 55, width: tableWidth, height: 55, borderColor: rgb(0, 0, 0), borderWidth: 1 });
    page.drawLine({ start: { x: margin, y: yPos - 27.5 }, end: { x: margin + tableWidth, y: yPos - 27.5 }, thickness: 1, color: rgb(0, 0, 0) });
    page.drawLine({ start: { x: margin + 120, y: yPos }, end: { x: margin + 120, y: yPos - 55 }, thickness: 1, color: rgb(0, 0, 0) });
    
    drawText(page, 'Organization:', margin + 5, yPos - 17, { size: 10, bold: true });
    drawText(page, inspection.organization, margin + 125, yPos - 17, { size: 10 });
    drawText(page, 'Location:', margin + 5, yPos - 44, { size: 10, bold: true });
    drawText(page, inspection.location, margin + 125, yPos - 44, { size: 10 });
    yPos -= 65;

    const inspectorName = profile ? `${profile.first_name || ''} ${profile.last_name || ''}`.trim() : 'Unknown';
    
    page.drawRectangle({ x: margin, y: yPos - 82.5, width: tableWidth, height: 82.5, borderColor: rgb(0, 0, 0), borderWidth: 1 });
    page.drawLine({ start: { x: margin, y: yPos - 27.5 }, end: { x: margin + tableWidth, y: yPos - 27.5 }, thickness: 1, color: rgb(0, 0, 0) });
    page.drawLine({ start: { x: margin, y: yPos - 55 }, end: { x: margin + tableWidth, y: yPos - 55 }, thickness: 1, color: rgb(0, 0, 0) });
    page.drawLine({ start: { x: margin + 120, y: yPos }, end: { x: margin + 120, y: yPos - 82.5 }, thickness: 1, color: rgb(0, 0, 0) });
    
    drawText(page, 'Inspector:', margin + 5, yPos - 17, { size: 10, bold: true });
    drawText(page, inspectorName, margin + 125, yPos - 17, { size: 10 });
    drawText(page, 'Inspection Date:', margin + 5, yPos - 44, { size: 10, bold: true });
    drawText(page, formatDate(inspection.inspection_date), margin + 125, yPos - 44, { size: 10 });
    drawText(page, 'Onsite Contact:', margin + 5, yPos - 71, { size: 10, bold: true });
    drawText(page, inspection.onsite_contact || 'N/A', margin + 125, yPos - 71, { size: 10 });
    yPos -= 100;

    // Known Course History
    drawText(page, 'Known Course History:', margin, yPos, { size: 11, bold: true });
    yPos -= 15;
    yPos = drawText(page, inspection.course_history || 'No prior history on file', margin, yPos, { size: 9, maxWidth: tableWidth });
    yPos -= 25;

    // Reminders and Requirements
    drawText(page, 'Reminders and Requirements:', margin, yPos, { size: 11, bold: true });
    yPos -= 15;
    drawText(page, '• All operating systems, ziplines, and equipment have been evaluated according to ACCT standards', margin + 10, yPos, { size: 9 });
    yPos -= 15;
    drawText(page, '• This report includes recommendations for immediate action and ongoing maintenance', margin + 10, yPos, { size: 9 });
    yPos -= 15;
    drawText(page, '• Next inspection should occur within 12 months from inspection date', margin + 10, yPos, { size: 9 });

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

    // Systems Page
    page = addPage();
    yPos = pageHeight - 80;
    drawText(page, 'Systems Inspection', margin, yPos, { size: 16, bold: true });
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

    // Ziplines Page
    page = addPage();
    yPos = pageHeight - 80;
    drawText(page, 'Ziplines Inspection', margin, yPos, { size: 16, bold: true });
    yPos -= 20;

    // Zipline KEYs
    drawText(page, 'Cable Type KEY: G=Galvanized | S=Stainless Steel', margin, yPos, { size: 8 });
    yPos -= 15;
    drawText(page, 'Braking System KEY: BS=Bungee Spring | CM=Compression | FR=Friction | HS=Hydraulic Spring', margin, yPos, { size: 8 });
    yPos -= 15;
    drawText(page, 'EAD System KEY: SA=Self Arresting | ZP=Zip Pole | BL=Belay Line | NO=None', margin, yPos, { size: 8 });
    yPos -= 25;

    const ziplineTableHeader = ['Zipline Name', 'Cable', 'Braking', 'EAD', 'Result', 'Comments'];
    const ziplineColumnWidths = [100, 50, 50, 50, 60, tableWidth - 310];
    const ziplineColumnX = [margin, margin + 100, margin + 150, margin + 200, margin + 250, margin + 310];

    // Draw table header
    page.drawRectangle({ x: margin, y: yPos - 20, width: tableWidth, height: 20, color: rgb(0.8, 0.8, 0.8) });
    ziplineTableHeader.forEach((header, i) => {
      drawText(page, header, ziplineColumnX[i] + 5, yPos - 14, { size: 10, bold: true });
    });
    yPos -= 20;

    // Draw table rows (filtered for populated rows)
    ziplines.filter(z => z.zipline_name && z.result).forEach(zipline => {
      const rowHeight = 60;
      drawHighlightedTableRow(page, margin, yPos - rowHeight, tableWidth, rowHeight, zipline.result);

      drawText(page, zipline.zipline_name, margin + 5, yPos - 17, { size: 9, maxWidth: ziplineColumnWidths[0] - 10 });
      drawText(page, zipline.cable_type || 'N/A', margin + 105, yPos - 17, { size: 9, maxWidth: ziplineColumnWidths[1] - 10 });
      drawText(page, zipline.braking_system || 'N/A', margin + 155, yPos - 17, { size: 9, maxWidth: ziplineColumnWidths[2] - 10 });
      drawText(page, zipline.ead_system || 'N/A', margin + 205, yPos - 17, { size: 9, maxWidth: ziplineColumnWidths[3] - 10 });
      drawText(page, zipline.result, margin + 255, yPos - 17, { size: 9, maxWidth: ziplineColumnWidths[4] - 10 });
      yPos = drawText(page, zipline.comments || 'N/A', margin + 315, yPos - 17, { size: 9, maxWidth: ziplineColumnWidths[5] - 10 });

      yPos -= rowHeight - 20;
    });

    // Equipment Page
    page = addPage();
    yPos = pageHeight - 80;
    drawText(page, 'Equipment Inspection', margin, yPos, { size: 16, bold: true });
    yPos -= 20;
    
    // Equipment Warning
    drawText(page, '⚠ WARNING: Failed equipment must be retired or repaired before use', margin, yPos, { size: 10, bold: true, color: rgb(0.94, 0.27, 0.27) });
    yPos -= 25;

    const equipmentTableHeader = ['Equipment Type', 'Production Year', 'Quantity', 'Result', 'Comments'];
    const equipmentColumnWidths = [150, 80, 60, 80, tableWidth - 370];
    const equipmentColumnX = [margin, margin + 150, margin + 230, margin + 290, margin + 370];

    // Draw table header
    page.drawRectangle({ x: margin, y: yPos - 20, width: tableWidth, height: 20, color: rgb(0.8, 0.8, 0.8) });
    equipmentTableHeader.forEach((header, i) => {
      drawText(page, header, equipmentColumnX[i] + 5, yPos - 14, { size: 10, bold: true });
    });
    yPos -= 20;

    // Draw table rows (filtered for populated rows)
    equipment.filter(e => e.equipment_type && e.result).forEach(equip => {
      const rowHeight = 60;
      drawHighlightedTableRow(page, margin, yPos - rowHeight, tableWidth, rowHeight, equip.result);

      drawText(page, equip.equipment_type, margin + 5, yPos - 17, { size: 9, maxWidth: equipmentColumnWidths[0] - 10 });
      drawText(page, equip.production_year?.toString() || 'N/A', margin + 155, yPos - 17, { size: 9, maxWidth: equipmentColumnWidths[1] - 10 });
      drawText(page, equip.quantity?.toString() || 'N/A', margin + 235, yPos - 17, { size: 9, maxWidth: equipmentColumnWidths[2] - 10 });
      drawText(page, equip.result, margin + 295, yPos - 17, { size: 9, maxWidth: equipmentColumnWidths[3] - 10 });
      yPos = drawText(page, equip.comments || 'N/A', margin + 375, yPos - 17, { size: 9, maxWidth: equipmentColumnWidths[4] - 10 });

      yPos -= rowHeight - 20;
    });

    // Standards Page
    page = addPage();
    yPos = pageHeight - 80;
    drawText(page, 'Standards Inspection', margin, yPos, { size: 16, bold: true });
    yPos -= 20;

    const standardTableHeader = ['Standard', 'Result', 'Notes'];
    const standardColumnWidths = [200, 80, tableWidth - 200 - 80];
    const standardColumnX = [margin, margin + 200, margin + 200 + 80];

    // Draw table header
    page.drawRectangle({ x: margin, y: yPos - 20, width: tableWidth, height: 20, color: rgb(0.8, 0.8, 0.8) });
    standardTableHeader.forEach((header, i) => {
      drawText(page, header, standardColumnX[i] + 5, yPos - 14, { size: 10, bold: true });
    });
    yPos -= 20;

    // Draw table rows
    standards.forEach(standard => {
      const rowHeight = 60;
      const hasDoc = standard.has_documentation ? 'Pass' : 'Fail';
      drawHighlightedTableRow(page, margin, yPos - rowHeight, tableWidth, rowHeight, hasDoc);

      drawText(page, standard.standard_name, margin + 5, yPos - 17, { size: 10, maxWidth: standardColumnWidths[0] - 10 });
      drawText(page, hasDoc, margin + 205, yPos - 17, { size: 10, maxWidth: standardColumnWidths[1] - 10 });
      yPos = drawText(page, standard.comments || 'N/A', margin + 285, yPos - 17, { size: 10, maxWidth: standardColumnWidths[2] - 10 });

      yPos -= rowHeight - 20;
    });

    // Summary Page
    page = addPage();
    yPos = pageHeight - 80;
    drawText(page, 'Summary', margin, yPos, { size: 16, bold: true });
    yPos -= 20;

    if (summary) {
      // Repairs & Alterations
      drawText(page, 'Repairs & Alterations Performed:', margin, yPos, { size: 12, bold: true });
      yPos -= 15;
      yPos = drawText(page, summary.repairs_performed || 'None reported', margin, yPos, { size: 10, maxWidth: tableWidth });
      yPos -= 25;

      // Critical Actions - RED BORDERED BOX
      const boxHeight = 80;
      page.drawRectangle({
        x: margin - 5,
        y: yPos - boxHeight,
        width: tableWidth + 10,
        height: boxHeight,
        borderColor: rgb(0.94, 0.27, 0.27),
        borderWidth: 2,
      });
      drawText(page, '⚠ CRITICAL ACTIONS REQUIRED', margin, yPos - 15, { size: 11, bold: true, color: rgb(0.94, 0.27, 0.27) });
      yPos = drawText(page, summary.critical_actions || 'None identified', margin, yPos - 30, { size: 10, maxWidth: tableWidth - 10 });
      yPos -= boxHeight - 30 + 20;

      // Future Considerations
      drawText(page, 'Future Considerations:', margin, yPos, { size: 12, bold: true });
      yPos -= 15;
      yPos = drawText(page, summary.future_considerations || 'None noted', margin, yPos, { size: 10, maxWidth: tableWidth });
      yPos -= 25;

      // Next Inspection Date
      drawText(page, 'Next Inspection Date:', margin, yPos, { size: 12, bold: true });
      yPos -= 15;
      drawText(page, formatDate(summary.next_inspection_date) + ' (within 12 months)', margin, yPos, { size: 10 });
    } else {
      drawText(page, 'No summary available.', margin, yPos, { size: 10 });
    }
    
    // Add footer to all pages
    const pages = pdfDoc.getPages();
    pages.forEach((p, idx) => {
      p.drawText('Rope Works Inc., PO Box 1074, Dripping Springs, TX 78620', {
        x: margin, y: 30, size: 8, font: helveticaFont, color: rgb(0.5, 0.5, 0.5)
      });
      p.drawText(`Page ${idx + 1} of ${pages.length}`, {
        x: pageWidth - margin - 60, y: 30, size: 8, font: helveticaFont, color: rgb(0.5, 0.5, 0.5)
      });
      if (idx > 0) {
        p.drawText('The information contained in this report has been documented by a Qualified Professional', {
          x: margin, y: 15, size: 7, font: helveticaFont, color: rgb(0.6, 0.6, 0.6)
        });
      }
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
