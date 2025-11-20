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

    // Definitions Page
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

    const systemTableHeader = ['System', 'Standard', 'Result', 'Notes'];
    const systemColumnWidths = [150, 150, 80, tableWidth - 150 - 150 - 80];
    const systemColumnX = [margin, margin + 150, margin + 150 + 150, margin + 150 + 150 + 80];

    // Draw table header
    page.drawRectangle({ x: margin, y: yPos - 20, width: tableWidth, height: 20, color: rgb(0.8, 0.8, 0.8) });
    systemTableHeader.forEach((header, i) => {
      drawText(page, header, systemColumnX[i] + 5, yPos - 14, { size: 10, bold: true });
    });
    yPos -= 20;

    // Draw table rows
    systems.forEach(system => {
      const rowHeight = 60;
      drawHighlightedTableRow(page, margin, yPos - rowHeight, tableWidth, rowHeight, system.result);

      drawText(page, system.name, margin + 5, yPos - 17, { size: 10, maxWidth: systemColumnWidths[0] - 10 });
      drawText(page, system.standard, margin + 155, yPos - 17, { size: 10, maxWidth: systemColumnWidths[1] - 10 });
      drawText(page, system.result, margin + 305, yPos - 17, { size: 10, maxWidth: systemColumnWidths[2] - 10 });
      yPos = drawText(page, system.notes || 'N/A', margin + 385, yPos - 17, { size: 10, maxWidth: systemColumnWidths[3] - 10 });

      yPos -= rowHeight - 20;
    });

    // Ziplines Page
    page = addPage();
    yPos = pageHeight - 80;
    drawText(page, 'Ziplines Inspection', margin, yPos, { size: 16, bold: true });
    yPos -= 20;

    const ziplineTableHeader = ['Zipline', 'Standard', 'Result', 'Notes'];
    const ziplineColumnWidths = [150, 150, 80, tableWidth - 150 - 150 - 80];
    const ziplineColumnX = [margin, margin + 150, margin + 150 + 150, margin + 150 + 150 + 80];

    // Draw table header
    page.drawRectangle({ x: margin, y: yPos - 20, width: tableWidth, height: 20, color: rgb(0.8, 0.8, 0.8) });
    ziplineTableHeader.forEach((header, i) => {
      drawText(page, header, ziplineColumnX[i] + 5, yPos - 14, { size: 10, bold: true });
    });
    yPos -= 20;

    // Draw table rows
    ziplines.forEach(zipline => {
      const rowHeight = 60;
      drawHighlightedTableRow(page, margin, yPos - rowHeight, tableWidth, rowHeight, zipline.result);

      drawText(page, zipline.name, margin + 5, yPos - 17, { size: 10, maxWidth: ziplineColumnWidths[0] - 10 });
      drawText(page, zipline.standard, margin + 155, yPos - 17, { size: 10, maxWidth: ziplineColumnWidths[1] - 10 });
      drawText(page, zipline.result, margin + 305, yPos - 17, { size: 10, maxWidth: ziplineColumnWidths[2] - 10 });
      yPos = drawText(page, zipline.notes || 'N/A', margin + 385, yPos - 17, { size: 10, maxWidth: ziplineColumnWidths[3] - 10 });

      yPos -= rowHeight - 20;
    });

    // Equipment Page
    page = addPage();
    yPos = pageHeight - 80;
    drawText(page, 'Equipment Inspection', margin, yPos, { size: 16, bold: true });
    yPos -= 20;

    const equipmentTableHeader = ['Equipment', 'Standard', 'Result', 'Notes'];
    const equipmentColumnWidths = [150, 150, 80, tableWidth - 150 - 150 - 80];
    const equipmentColumnX = [margin, margin + 150, margin + 150 + 150, margin + 150 + 150 + 80];

    // Draw table header
    page.drawRectangle({ x: margin, y: yPos - 20, width: tableWidth, height: 20, color: rgb(0.8, 0.8, 0.8) });
    equipmentTableHeader.forEach((header, i) => {
      drawText(page, header, equipmentColumnX[i] + 5, yPos - 14, { size: 10, bold: true });
    });
    yPos -= 20;

    // Draw table rows
    equipment.forEach(equipment => {
      const rowHeight = 60;
      drawHighlightedTableRow(page, margin, yPos - rowHeight, tableWidth, rowHeight, equipment.result);

      drawText(page, equipment.name, margin + 5, yPos - 17, { size: 10, maxWidth: equipmentColumnWidths[0] - 10 });
      drawText(page, equipment.standard, margin + 155, yPos - 17, { size: 10, maxWidth: equipmentColumnWidths[1] - 10 });
      drawText(page, equipment.result, margin + 305, yPos - 17, { size: 10, maxWidth: equipmentColumnWidths[2] - 10 });
      yPos = drawText(page, equipment.notes || 'N/A', margin + 385, yPos - 17, { size: 10, maxWidth: equipmentColumnWidths[3] - 10 });

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
      drawHighlightedTableRow(page, margin, yPos - rowHeight, tableWidth, rowHeight, standard.result);

      drawText(page, standard.name, margin + 5, yPos - 17, { size: 10, maxWidth: standardColumnWidths[0] - 10 });
      drawText(page, standard.result, margin + 205, yPos - 17, { size: 10, maxWidth: standardColumnWidths[1] - 10 });
      yPos = drawText(page, standard.notes || 'N/A', margin + 285, yPos - 17, { size: 10, maxWidth: standardColumnWidths[2] - 10 });

      yPos -= rowHeight - 20;
    });

    // Summary Page
    page = addPage();
    yPos = pageHeight - 80;
    drawText(page, 'Summary', margin, yPos, { size: 16, bold: true });
    yPos -= 20;

    if (summary) {
      drawText(page, 'General Notes:', margin, yPos, { size: 12, bold: true });
      yPos -= 15;
      yPos = drawText(page, summary.general_notes || 'N/A', margin, yPos, { size: 10 });
      yPos -= 20;

      drawText(page, 'Recommendations:', margin, yPos, { size: 12, bold: true });
      yPos -= 15;
      yPos = drawText(page, summary.recommendations || 'N/A', margin, yPos, { size: 10 });
      yPos -= 20;

      drawText(page, 'Overall Result:', margin, yPos, { size: 12, bold: true });
      yPos -= 15;
      drawText(page, summary.overall_result || 'N/A', margin, yPos, { size: 10 });
    } else {
      drawText(page, 'No summary available.', margin, yPos, { size: 10 });
    }
    
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
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
