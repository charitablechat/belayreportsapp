import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
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
    const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    
    const authHeader = req.headers.get('Authorization')!;
    const token = authHeader.replace('Bearer ', '');
    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { inspectionId, regenerate = false } = await req.json();

    const { data: inspection, error: inspectionError } = await supabase
      .from('inspections')
      .select('*')
      .eq('id', inspectionId)
      .single();

    if (inspectionError || !inspection) {
      return new Response(JSON.stringify({ error: 'Inspection not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: userRoles } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id);

    const isSuperAdmin = userRoles?.some(r => r.role === 'super_admin');
    const isAssignedInspector = inspection.inspector_id === user.id;

    if (!isSuperAdmin && !isAssignedInspector) {
      return new Response(JSON.stringify({ error: 'Unauthorized to generate this report' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!regenerate) {
      const { data: existingReport } = await supabase
        .from('inspection_reports')
        .select('pdf_url')
        .eq('inspection_id', inspectionId)
        .order('generated_at', { ascending: false })
        .limit(1)
        .single();

      if (existingReport?.pdf_url) {
        const { data: signedUrl } = await supabase.storage
          .from('inspection-reports')
          .createSignedUrl(existingReport.pdf_url.split('/').pop()!, 3600);

        if (signedUrl) {
          return new Response(JSON.stringify({ url: signedUrl.signedUrl }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      }
    }

    const [
      { data: systems },
      { data: ziplines },
      { data: equipment },
      { data: standards },
      { data: summary },
      { data: inspectorProfile }
    ] = await Promise.all([
      supabase.from('inspection_systems').select('*').eq('inspection_id', inspectionId),
      supabase.from('inspection_ziplines').select('*').eq('inspection_id', inspectionId),
      supabase.from('inspection_equipment').select('*').eq('inspection_id', inspectionId),
      supabase.from('inspection_standards').select('*').eq('inspection_id', inspectionId),
      supabase.from('inspection_summary').select('*').eq('inspection_id', inspectionId).maybeSingle(),
      supabase.from('profiles').select('first_name, last_name').eq('id', inspection.inspector_id).maybeSingle()
    ]);

    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    
    // Fetch and embed ACCT logo from public bucket
    let acctLogoImage = null;
    try {
      const { data: logoFile } = await supabase.storage
        .from('inspection-photos')
        .download('acct-logo.jpg');
      
      if (logoFile) {
        const logoBytes = await logoFile.arrayBuffer();
        acctLogoImage = await pdfDoc.embedJpg(new Uint8Array(logoBytes));
      }
    } catch (logoError) {
      console.error('Failed to load ACCT logo:', logoError);
    }

    const pageWidth = 612;
    const pageHeight = 792;

    // Convert HTML to plain text with formatting markers
    const htmlToText = (html: string | null | undefined): string => {
      if (!html) return '';
      let text = String(html);
      
      text = text.replace(/<strong>(.*?)<\/strong>/gi, '**$1**');
      text = text.replace(/<b>(.*?)<\/b>/gi, '**$1**');
      text = text.replace(/<em>(.*?)<\/em>/gi, '*$1*');
      text = text.replace(/<i>(.*?)<\/i>/gi, '*$1*');
      text = text.replace(/<ul>/gi, '\n');
      text = text.replace(/<\/ul>/gi, '\n');
      text = text.replace(/<li>(.*?)<\/li>/gi, '• $1\n');
      text = text.replace(/<p>(.*?)<\/p>/gi, '$1\n');
      text = text.replace(/<br\s*\/?>/gi, '\n');
      text = text.replace(/<[^>]*>/g, '');
      text = text.replace(/&nbsp;/g, ' ');
      text = text.replace(/&amp;/g, '&');
      text = text.replace(/&lt;/g, '<');
      text = text.replace(/&gt;/g, '>');
      text = text.replace(/&quot;/g, '"');
      
      return text;
    };

    const sanitizeText = (text: string | null | undefined): string => {
      if (!text) return '';
      text = htmlToText(text);
      return String(text)
        .replace(/\r\n/g, ' ')
        .replace(/\n/g, ' ')
        .replace(/\r/g, ' ')
        .replace(/○/g, '•')
        .replace(/[^\x00-\xFF]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    };

    const formatDate = (dateStr: string | null): string => {
      if (!dateStr) return '';
      const date = new Date(dateStr);
      return date.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
    };

    const drawWrappedText = (text: string, x: number, y: number, maxWidth: number, fontSize: number, currentFont: any, maxHeight: number = 1000): number => {
      const sanitized = sanitizeText(text);
      const words = sanitized.split(' ');
      const lines: string[] = [];
      let currentLine = '';

      for (const word of words) {
        const testLine = currentLine ? `${currentLine} ${word}` : word;
        const testWidth = currentFont.widthOfTextAtSize(testLine, fontSize);

        if (testWidth > maxWidth && currentLine) {
          lines.push(currentLine);
          currentLine = word;
        } else {
          currentLine = testLine;
        }
      }
      if (currentLine) lines.push(currentLine);

      let yPos = y;
      for (const line of lines) {
        if (y - yPos > maxHeight) break;
        pdfDoc.getPages()[pdfDoc.getPageCount() - 1].drawText(line, {
          x,
          y: yPos,
          size: fontSize,
          font: currentFont,
          color: rgb(0, 0, 0),
        });
        yPos -= fontSize * 1.2;
      }

      return yPos;
    };

    const drawHeader = (page: any) => {
      page.drawText('ROPE WORKS', {
        x: 50,
        y: pageHeight - 50,
        size: 14,
        font: boldFont,
        color: rgb(0.2, 0.2, 0.2),
      });
      page.drawText('ROPES/CHALLENGE COURSE', {
        x: 50,
        y: pageHeight - 65,
        size: 8,
        font: font,
        color: rgb(0.4, 0.4, 0.4),
      });

      if (acctLogoImage) {
        page.drawImage(acctLogoImage, {
          x: pageWidth - 110,
          y: pageHeight - 80,
          width: 60,
          height: 60,
        });
      } else {
        page.drawText('ACCT', {
          x: pageWidth - 110,
          y: pageHeight - 50,
          size: 12,
          font: boldFont,
          color: rgb(0.2, 0.2, 0.2),
        });
        page.drawText('ACCREDITED VENDOR', {
          x: pageWidth - 110,
          y: pageHeight - 64,
          size: 7,
          font: font,
          color: rgb(0.4, 0.4, 0.4),
        });
      }
    };

    const drawFooter = (page: any, pageNumber: number) => {
      const footerText = "The information contained in this report has been documented by a Qualified Professional. This report is effective for one year from the date of inspection. Issued by: Rope Works Inc., PO Box 1074, Dripping Springs, TX 78620";
      drawWrappedText(footerText, 50, 50, pageWidth - 100, 7, font, 40);
      
      page.drawText(`${pageNumber}`, {
        x: pageWidth / 2 - 5,
        y: 30,
        size: 8,
        font: font,
        color: rgb(0.4, 0.4, 0.4),
      });
    };

    // PAGE 1: COVER PAGE
    let page = pdfDoc.addPage([pageWidth, pageHeight]);
    let yPos = pageHeight - 80;

    drawHeader(page);

    pdfDoc.drawText('Professional Inspection for Aerial Adventure Programs', {
      x: pageWidth / 2 - 215,
      y: yPos,
      size: 16,
      font: boldFont,
      color: rgb(0, 0, 0),
    });

    yPos -= 40;

    const inspectorName = inspectorProfile 
      ? `${inspectorProfile.first_name || ''} ${inspectorProfile.last_name || ''}`.trim()
      : '';

    // Inspection details table
    const tableWidth = pageWidth - 100;
    const col1 = tableWidth * 0.33;
    const col2 = tableWidth * 0.33;
    const col3 = tableWidth * 0.34;

    // Row 1
    pdfDoc.drawRectangle({
      x: 50,
      y: yPos - 30,
      width: tableWidth,
      height: 30,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    
    pdfDoc.drawText('Organization:', { x: 55, y: yPos - 12, size: 8, font: boldFont });
    pdfDoc.drawText(sanitizeText(inspection.organization), { x: 55, y: yPos - 24, size: 9, font: font });
    pdfDoc.drawLine({ start: { x: 50 + col1, y: yPos }, end: { x: 50 + col1, y: yPos - 30 }, thickness: 1, color: rgb(0, 0, 0) });
    
    pdfDoc.drawText('Location:', { x: 55 + col1, y: yPos - 12, size: 8, font: boldFont });
    pdfDoc.drawText(sanitizeText(inspection.location), { x: 55 + col1, y: yPos - 24, size: 9, font: font });
    pdfDoc.drawLine({ start: { x: 50 + col1 + col2, y: yPos }, end: { x: 50 + col1 + col2, y: yPos - 30 }, thickness: 1, color: rgb(0, 0, 0) });
    
    pdfDoc.drawText('Onsite Contact:', { x: 55 + col1 + col2, y: yPos - 12, size: 8, font: boldFont });
    pdfDoc.drawText(sanitizeText(inspection.onsite_contact), { x: 55 + col1 + col2, y: yPos - 24, size: 9, font: font });

    yPos -= 30;

    // Row 2
    pdfDoc.drawRectangle({
      x: 50,
      y: yPos - 30,
      width: tableWidth,
      height: 30,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    
    pdfDoc.drawText('Inspected by:', { x: 55, y: yPos - 12, size: 8, font: boldFont });
    pdfDoc.drawText(sanitizeText(inspectorName), { x: 55, y: yPos - 24, size: 9, font: font });
    pdfDoc.drawLine({ start: { x: 50 + col1 + col2, y: yPos }, end: { x: 50 + col1 + col2, y: yPos - 30 }, thickness: 1, color: rgb(0, 0, 0) });
    
    pdfDoc.drawText('Date of Inspection:', { x: 55 + col1 + col2, y: yPos - 12, size: 8, font: boldFont });
    pdfDoc.drawText(formatDate(inspection.inspection_date), { x: 55 + col1 + col2, y: yPos - 24, size: 9, font: font });

    yPos -= 30;

    // Row 3
    pdfDoc.drawRectangle({
      x: 50,
      y: yPos - 30,
      width: tableWidth,
      height: 30,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });
    
    pdfDoc.drawText('Previous Inspector:', { x: 55, y: yPos - 12, size: 8, font: boldFont });
    pdfDoc.drawText(sanitizeText(inspection.previous_inspector), { x: 55, y: yPos - 24, size: 9, font: font });
    pdfDoc.drawLine({ start: { x: 50 + col1 + col2, y: yPos }, end: { x: 50 + col1 + col2, y: yPos - 30 }, thickness: 1, color: rgb(0, 0, 0) });
    
    pdfDoc.drawText('Prev. Inspection Date:', { x: 55 + col1 + col2, y: yPos - 12, size: 8, font: boldFont });
    pdfDoc.drawText(formatDate(inspection.previous_inspection_date), { x: 55 + col1 + col2, y: yPos - 24, size: 9, font: font });

    yPos -= 50;

    // Course History
    pdfDoc.drawText('Known Course History', {
      x: 50,
      y: yPos,
      size: 14,
      font: boldFont,
      color: rgb(0, 0, 0),
    });

    yPos -= 25;
    
    pdfDoc.drawRectangle({
      x: 50,
      y: yPos - 80,
      width: tableWidth,
      height: 100,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });

    const historyText = sanitizeText(inspection.course_history) || 'No course history recorded';
    drawWrappedText(historyText, 55, yPos - 10, tableWidth - 10, 10, font, 80);

    yPos -= 110;

    // Disclaimer text
    const disclaimerText = 'This report covers the condition of the aerial adventure site for the date of inspection reflected on this form. The inspection provided is strictly an evaluation of the structural condition of the course elements and equipment. The inspection does not include training on how to operate the equipment, nor how to operate the course. The inspection only verifies the existence of written local operating procedures (LOP), an emergency action plan (EAP), and training documentation. The inspection does not perform a review or evaluate the LOP, EAP and training documentation. Potential problems can occur afterwards due to vandalism, improper use, weather, etc. Rope Works Inc. is not responsible for modifications or repairs made to the challenge course by anyone other than a Rope Works Inc. employee. We recommend you conduct your own periodic internal monitoring at a minimum on a quarterly basis. At a minimum an annual professional inspection is required by a qualified professional to be in compliance with the Association for Challenge Course Technology ANSI/ACCT current published standards.';
    yPos = drawWrappedText(disclaimerText, 50, yPos, pageWidth - 100, 9, font, 500);

    yPos -= 30;

    // Reminders and Requirements
    pdfDoc.drawText('Reminders and Requirements', {
      x: 50,
      y: yPos,
      size: 12,
      font: boldFont,
      color: rgb(0, 0, 0),
    });

    yPos -= 20;

    const reminders = [
      'Employers are required to issue staff appropriate fall protection for the duties to be performed.',
      'A Periodic Internal Monitoring of the aerial activities on your site shall be conducted by qualified personnel.',
      'Proper identification, tracking, and documentation of ALL equipment used for operations shall be kept and available at your annual professional inspection.',
      'Proper staff training should be provided for the operation of all aerial activities and equipment on your site.',
      'Operational Reviews shall be conducted once every five years.'
    ];

    for (const reminder of reminders) {
      pdfDoc.drawText('•', {
        x: 55,
        y: yPos,
        size: 10,
        font: font,
        color: rgb(0, 0, 0),
      });
      yPos = drawWrappedText(reminder, 70, yPos, pageWidth - 120, 10, font, 150);
      yPos -= 8;
    }

    drawFooter(page, 1);

    // PAGE 2: DEFINITIONS AND INSPECTION KEY
    page = pdfDoc.addPage([pageWidth, pageHeight]);
    yPos = pageHeight - 80;

    drawHeader(page);

    pdfDoc.drawText('All inspections include the following when applicable:', {
      x: pageWidth / 2 - 180,
      y: yPos,
      size: 14,
      font: boldFont,
      color: rgb(0, 0, 0),
    });

    yPos -= 40;

    const definitions = [
      {
        title: 'Lifeline HDW',
        description: 'Represents all hardware associated with the Life Safety System including but not limited to: wire rope, bolts, wire rope terminations, & redundant terminations.'
      },
      {
        title: 'Activity HDW',
        description: 'Represents all hardware associated with the element execution. This includes but is not limited to: foot cables, platforms, hand ropes/cables, boards, etc.'
      },
      {
        title: 'Environment',
        description: 'This represents the surrounding area of the activity/element. This includes but is not limited to: ground cover, trees, rocks, & terrain.'
      },
      {
        title: 'Equipment',
        description: 'This represents the equipment utilized in the operation of the course activities. This includes but is not limited to: rope, carabiners, helmets, belay devices, pulleys, trolleys, lanyards, etc.'
      },
      {
        title: 'Pass/Pass with Provisions/Fail',
        description: 'This represents the overall rating for the system based on the condition of the items inspected on the day of the inspection. Rope Works Inc. inspects all challenge course and canopy/zip line tours to the standards set forth by the ACCT. Any deviation from the ACCT standards in regards to the inspection criteria will be addressed in the Comment section.'
      }
    ];

    for (const def of definitions) {
      pdfDoc.drawText(def.title, {
        x: 50,
        y: yPos,
        size: 11,
        font: boldFont,
        color: rgb(0, 0, 0),
      });
      
      yPos -= 18;
      
      yPos = drawWrappedText(def.description, 50, yPos, pageWidth - 100, 10, font, 80);
      yPos -= 15;
    }

    yPos -= 20;

    // Inspection Key
    pdfDoc.drawText('Inspection Key', {
      x: 50,
      y: yPos,
      size: 12,
      font: boldFont,
      color: rgb(0, 0, 0),
    });

    yPos -= 25;

    const inspectionKey = [
      {
        title: 'Pass',
        description: 'The equipment or operating system meets all manufacturer specifications, industry standards, and operational safety requirements at the time of inspection. No corrective actions are necessary. The item is approved for continued use until the next scheduled inspection.'
      },
      {
        title: 'Pass with Provisions',
        description: 'The equipment or operating system is generally in acceptable condition but requires minor corrective action, repair, or follow-up maintenance that does not pose an immediate safety concern. A written comment will accompany any Pass with Provisions rating, detailing the issue and recommended corrective action. If the provision is not resolved or verified as corrected by time indicated or the next annual inspection, the item will be reclassified as a Fail until compliance is achieved.'
      },
      {
        title: 'Fail',
        description: 'The equipment or operating system does not meet minimum safety or operational standards and presents a potential or immediate hazard. The item must be removed from service and repaired, replaced, or corrected before being used again. Documentation of corrective actions is required prior to reinspection and approval for use.'
      },
      {
        title: 'N/A',
        description: 'Not applicable, Not inspected, or inaccessible/not available at the time of inspection.'
      }
    ];

    for (const key of inspectionKey) {
      pdfDoc.drawText(key.title, {
        x: 50,
        y: yPos,
        size: 11,
        font: boldFont,
        color: rgb(0, 0, 0),
      });
      
      yPos -= 18;
      
      yPos = drawWrappedText(key.description, 50, yPos, pageWidth - 100, 10, font, 100);
      yPos -= 15;
    }

    drawFooter(page, 2);

    // PAGE 3: OPERATING SYSTEMS
    page = pdfDoc.addPage([pageWidth, pageHeight]);
    yPos = pageHeight - 80;

    drawHeader(page);

    pdfDoc.drawText('OPERATING SYSTEMS', {
      x: pageWidth / 2 - 90,
      y: yPos,
      size: 16,
      font: boldFont,
      color: rgb(0, 0, 0),
    });

    yPos -= 40;

    // Operating Systems Table
    const sysColWidths = [180, 100, 232];
    const sysRowHeight = 25;
    const sysTableWidth = sysColWidths.reduce((a, b) => a + b, 0);

    // Header
    pdfDoc.drawRectangle({
      x: 50,
      y: yPos - sysRowHeight,
      width: sysTableWidth,
      height: sysRowHeight,
      color: rgb(0.9, 0.9, 0.9),
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });

    pdfDoc.drawText('System Name', { x: 55, y: yPos - 16, size: 10, font: boldFont });
    pdfDoc.drawText('Result', { x: 55 + sysColWidths[0], y: yPos - 16, size: 10, font: boldFont });
    pdfDoc.drawText('Comments', { x: 55 + sysColWidths[0] + sysColWidths[1], y: yPos - 16, size: 10, font: boldFont });

    yPos -= sysRowHeight;

    if (systems && systems.length > 0) {
      for (const sys of systems) {
        pdfDoc.drawRectangle({
          x: 50,
          y: yPos - sysRowHeight,
          width: sysTableWidth,
          height: sysRowHeight,
          borderColor: rgb(0, 0, 0),
          borderWidth: 0.5,
        });

        pdfDoc.drawText(sanitizeText(sys.system_name), { x: 55, y: yPos - 16, size: 9, font: font });
        pdfDoc.drawText(sanitizeText(sys.result), { x: 55 + sysColWidths[0], y: yPos - 16, size: 9, font: font });
        drawWrappedText(sanitizeText(sys.comments), 55 + sysColWidths[0] + sysColWidths[1], yPos - 10, sysColWidths[2] - 10, 9, font, sysRowHeight - 10);

        yPos -= sysRowHeight;
      }
    }

    drawFooter(page, 3);

    // PAGE 4: ZIPLINES
    if (ziplines && ziplines.length > 0) {
      page = pdfDoc.addPage([pageWidth, pageHeight]);
      yPos = pageHeight - 80;

      drawHeader(page);

      pdfDoc.drawText('ZIPLINES', {
        x: pageWidth / 2 - 50,
        y: yPos,
        size: 16,
        font: boldFont,
        color: rgb(0, 0, 0),
      });

      yPos -= 25;

      pdfDoc.drawText('SYSTEMS - ZIPLINES', {
        x: pageWidth / 2 - 70,
        y: yPos,
        size: 12,
        font: boldFont,
        color: rgb(0, 0, 0),
      });

      yPos -= 30;

      // KEY definitions
      const keyLines = [
        'Cable Type KEY: GAC = Galvanized Aircraft Cable, SS = Super Swaged',
        'Braking System KEY: ZS = Zip Stop, FB = Friction Break, SB = Spring Bank, G = Gravity',
        'EAD System KEY - ZS = Zip Step, AP = Auto P'
      ];

      for (const keyLine of keyLines) {
        pdfDoc.drawText(keyLine, {
          x: 50,
          y: yPos,
          size: 9,
          font: font,
          color: rgb(0, 0, 0),
        });
        yPos -= 15;
      }

      yPos -= 10;

      // Zipline table
      const zipColWidths = [90, 70, 70, 70, 70, 142];
      const zipRowHeight = 25;
      const zipTableWidth = zipColWidths.reduce((a, b) => a + b, 0);

      // Header
      pdfDoc.drawRectangle({
        x: 50,
        y: yPos - zipRowHeight,
        width: zipTableWidth,
        height: zipRowHeight,
        color: rgb(0.9, 0.9, 0.9),
        borderColor: rgb(0, 0, 0),
        borderWidth: 1,
      });

      const zipHeaders = ['Zipline', 'Length (ft)', 'Unload (lbf)', 'Load (lbf)', 'Result', 'Comments'];
      let xPos = 50;
      for (let i = 0; i < zipHeaders.length; i++) {
        pdfDoc.drawText(zipHeaders[i], { x: xPos + 5, y: yPos - 16, size: 9, font: boldFont });
        xPos += zipColWidths[i];
      }

      yPos -= zipRowHeight;

      for (const zip of ziplines) {
        // Row 1
        pdfDoc.drawRectangle({
          x: 50,
          y: yPos - zipRowHeight,
          width: zipTableWidth,
          height: zipRowHeight,
          borderColor: rgb(0, 0, 0),
          borderWidth: 0.5,
        });

        xPos = 50;
        pdfDoc.drawText(sanitizeText(zip.zipline_name), { x: xPos + 5, y: yPos - 16, size: 9, font: font });
        xPos += zipColWidths[0];
        pdfDoc.drawText(String(zip.cable_length || ''), { x: xPos + 5, y: yPos - 16, size: 9, font: font });
        xPos += zipColWidths[1];
        pdfDoc.drawText(String(zip.unload_tension || ''), { x: xPos + 5, y: yPos - 16, size: 9, font: font });
        xPos += zipColWidths[2];
        pdfDoc.drawText(String(zip.load_tension || ''), { x: xPos + 5, y: yPos - 16, size: 9, font: font });
        xPos += zipColWidths[3];
        pdfDoc.drawText(sanitizeText(zip.result), { x: xPos + 5, y: yPos - 16, size: 9, font: font });
        xPos += zipColWidths[4];
        drawWrappedText(sanitizeText(zip.comments), xPos + 5, yPos - 10, zipColWidths[5] - 10, 8, font, zipRowHeight - 10);

        yPos -= zipRowHeight;

        // Row 2 - Details
        pdfDoc.drawRectangle({
          x: 50,
          y: yPos - zipRowHeight,
          width: zipTableWidth,
          height: zipRowHeight,
          borderColor: rgb(0, 0, 0),
          borderWidth: 0.5,
        });

        const detailText = `Cable: ${sanitizeText(zip.cable_type)} | Braking System: ${sanitizeText(zip.braking_system)} | EAD System: ${sanitizeText(zip.ead_system)}`;
        pdfDoc.drawText(detailText, { x: 55, y: yPos - 16, size: 8, font: font });

        yPos -= zipRowHeight + 5;
      }

      yPos -= 30;

      // Program Equipment Inspected
      pdfDoc.drawText('Program Equipment Inspected', {
        x: 50,
        y: yPos,
        size: 12,
        font: boldFont,
        color: rgb(0, 0, 0),
      });

      yPos -= 25;

      const equipmentDisclaimer = 'Any equipment that FAILS must be immediately removed from service and no longer used as part of the current operational inventory. It is the responsibility of the client to read, understand, and follow all manufacturer guidelines, notices and recalls for the equipment used for your site\'s operations. This includes proper documentation and';
      drawWrappedText(equipmentDisclaimer, 50, yPos, pageWidth - 100, 9, font, 150);

      drawFooter(page, 4);
    }

    // PAGES 5-9: EQUIPMENT
    const equipmentCategories = [
      { title: 'HARNESSES', key: 'Harness' },
      { title: 'HELMETS', key: 'Helmet' },
      { title: 'LANYARDS', key: 'Lanyard' },
      { title: 'CONNECTORS (CARABINERS & QUICKLINKS)', key: 'Connector' },
      { title: 'KERNMANTLE ROPE', key: 'Rope' },
      { title: 'BELAY/DESCENT DEVICE', key: 'Belay Device' },
      { title: 'TROLLEYS AND PULLEYS', key: 'Trolley' },
      { title: 'OTHER EQUIPMENT', key: 'Other' }
    ];

    let pageNumber = 5;
    let isFirstEquipmentPage = true;

    for (const category of equipmentCategories) {
      page = pdfDoc.addPage([pageWidth, pageHeight]);
      yPos = pageHeight - 80;

      drawHeader(page);

      if (isFirstEquipmentPage) {
        const inventoryDisclaimer = 'Inventory tracking of each item used for course operations. This should be done according to a written checklist that is monitored by the course manager or other qualified person at your site. Records should be available at your annual inspection that include and indicate the date of purchase, date of first use and the equipment shall be identifiable by the serial number/tag or other unique identifier that matches your written documentation and the manufacturer retirement criteria. If you are unable to produce this information and tracking, it will be pulled from service and noted on the inspection report.';
        yPos = drawWrappedText(inventoryDisclaimer, 50, yPos, pageWidth - 100, 9, font, 150);
        yPos -= 30;
        isFirstEquipmentPage = false;
      }

      pdfDoc.drawText(`EQUIPMENT - ${category.title}`, {
        x: 50,
        y: yPos,
        size: 14,
        font: boldFont,
        color: rgb(0, 0, 0),
      });

      yPos -= 30;

      const items = equipment?.filter(e => e.equipment_category === category.key) || [];

      // Equipment table
      const eqColWidths = [150, 50, 40, 90, 182];
      const eqRowHeight = 25;
      const eqTableWidth = eqColWidths.reduce((a, b) => a + b, 0);

      // Header
      pdfDoc.drawRectangle({
        x: 50,
        y: yPos - eqRowHeight,
        width: eqTableWidth,
        height: eqRowHeight,
        color: rgb(0.9, 0.9, 0.9),
        borderColor: rgb(0, 0, 0),
        borderWidth: 1,
      });

      const eqHeaders = ['Type', 'Year', 'Qty', 'Result', 'Comments'];
      xPos = 50;
      for (let i = 0; i < eqHeaders.length; i++) {
        pdfDoc.drawText(eqHeaders[i], { x: xPos + 5, y: yPos - 16, size: 10, font: boldFont });
        xPos += eqColWidths[i];
      }

      yPos -= eqRowHeight;

      if (items.length > 0) {
        for (const item of items) {
          pdfDoc.drawRectangle({
            x: 50,
            y: yPos - eqRowHeight,
            width: eqTableWidth,
            height: eqRowHeight,
            borderColor: rgb(0, 0, 0),
            borderWidth: 0.5,
          });

          xPos = 50;
          drawWrappedText(sanitizeText(item.equipment_type), xPos + 5, yPos - 10, eqColWidths[0] - 10, 9, font, eqRowHeight - 10);
          xPos += eqColWidths[0];
          pdfDoc.drawText(String(item.production_year || ''), { x: xPos + 5, y: yPos - 16, size: 9, font: font });
          xPos += eqColWidths[1];
          pdfDoc.drawText(String(item.quantity || ''), { x: xPos + 5, y: yPos - 16, size: 9, font: font });
          xPos += eqColWidths[2];
          pdfDoc.drawText(sanitizeText(item.result), { x: xPos + 5, y: yPos - 16, size: 9, font: font });
          xPos += eqColWidths[3];
          drawWrappedText(sanitizeText(item.comments), xPos + 5, yPos - 10, eqColWidths[4] - 10, 8, font, eqRowHeight - 10);

          yPos -= eqRowHeight;
        }
      }

      drawFooter(page, pageNumber);
      pageNumber++;
    }

    // PAGE 10: ACCT STANDARDS
    page = pdfDoc.addPage([pageWidth, pageHeight]);
    yPos = pageHeight - 80;

    drawHeader(page);

    pdfDoc.drawText('ACCT Operations Standards Criteria', {
      x: pageWidth / 2 - 140,
      y: yPos,
      size: 16,
      font: boldFont,
      color: rgb(0, 0, 0),
    });

    yPos -= 30;

    const standardsIntro = 'The following documentation is currently required by the ANSI/ACCT 03-2019 Operations Standards. If your program does not have the following in existence it is noted below. It is your responsibility to ensure these are located or created and available. If these documents have been made available during the professional inspection it is noted below. It is important to recognize these documents are not reviewed by the professional inspector for content. They are only verified of their existence for program operations.';
    yPos = drawWrappedText(standardsIntro, 50, yPos, pageWidth - 100, 10, font, 120);

    yPos -= 30;

    // Standards table
    const stdColWidths = [320, 130, 25, 25];
    const stdRowHeight = 30;
    const stdTableWidth = stdColWidths.reduce((a, b) => a + b, 0);

    // Header
    pdfDoc.drawRectangle({
      x: 50,
      y: yPos - stdRowHeight,
      width: stdTableWidth,
      height: stdRowHeight,
      color: rgb(0.9, 0.9, 0.9),
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });

    pdfDoc.drawText('Standard', { x: 55, y: yPos - 18, size: 10, font: boldFont });
    pdfDoc.drawText('Reference', { x: 55 + stdColWidths[0], y: yPos - 18, size: 10, font: boldFont });
    pdfDoc.drawText('YES', { x: 55 + stdColWidths[0] + stdColWidths[1] + 2, y: yPos - 18, size: 9, font: boldFont });
    pdfDoc.drawText('NO', { x: 55 + stdColWidths[0] + stdColWidths[1] + stdColWidths[2] + 4, y: yPos - 18, size: 9, font: boldFont });

    yPos -= stdRowHeight;

    const standardsList = [
      { name: 'Local Written Operations Procedures', ref: '(CHPT 2. ANSI/ACCT B.2.4)' },
      { name: 'Local Written Emergency Action Plan', ref: '(CHPT 2 ANSI/ACCT B.2.5)' },
      { name: 'Minimum Annual Training', ref: '(CHPT 3 ANSI/ACCT B.1.2)' },
      { name: 'Written Pre-Use Inspection in Use', ref: '(CHPT 2 ANSI/ACCT B.2.13)' },
      { name: 'Inventory Tracking System in Use', ref: '(CHPT 1 ANSI/ACCT I.3.2.1)' },
      { name: 'Operational Review Every 5 Years', ref: '(CHPT 2 ANSI/ACCT B.2.7)' }
    ];

    for (const standard of standardsList) {
      const hasDoc = standards?.some(s => s.standard_name === standard.name && s.has_documentation) || false;

      pdfDoc.drawRectangle({
        x: 50,
        y: yPos - stdRowHeight,
        width: stdTableWidth,
        height: stdRowHeight,
        borderColor: rgb(0, 0, 0),
        borderWidth: 0.5,
      });

      drawWrappedText(standard.name, 55, yPos - 10, stdColWidths[0] - 10, 9, font, stdRowHeight - 10);

      pdfDoc.drawText(standard.ref, {
        x: 55 + stdColWidths[0],
        y: yPos - 15,
        size: 9,
        font: font,
        color: rgb(0, 0, 0),
      });

      // YES checkbox
      pdfDoc.drawRectangle({
        x: 55 + stdColWidths[0] + stdColWidths[1],
        y: yPos - 20,
        width: 20,
        height: 20,
        borderColor: rgb(0, 0, 0),
        borderWidth: 1,
        color: hasDoc ? rgb(0, 0.6, 0) : undefined,
      });

      // NO checkbox
      pdfDoc.drawRectangle({
        x: 55 + stdColWidths[0] + stdColWidths[1] + stdColWidths[2],
        y: yPos - 20,
        width: 20,
        height: 20,
        borderColor: rgb(0, 0, 0),
        borderWidth: 1,
        color: !hasDoc ? rgb(0.7, 0.1, 0.1) : undefined,
      });

      yPos -= stdRowHeight;
    }

    yPos -= 20;

    const standardsComments = standards?.map(s => s.comments).filter(c => c).join('; ') || 'None';
    yPos = drawWrappedText(`Comments: ${standardsComments}`, 50, yPos, pageWidth - 100, 9, font, 100);

    drawFooter(page, 10);

    // PAGE 11: SUMMARY
    page = pdfDoc.addPage([pageWidth, pageHeight]);
    yPos = pageHeight - 80;

    drawHeader(page);

    // QCP Note at top
    const qcpNote = 'A QCP is a Qualified Course Professional that meets the criteria outlined by the ACCT. Operations & Emergency procedures must be written and specific to the site\'s local operations procedures.';
    yPos = drawWrappedText(qcpNote, 50, yPos, pageWidth - 100, 9, font, 50);

    yPos -= 30;

    pdfDoc.drawText('REPORT SUMMARY', {
      x: pageWidth / 2 - 90,
      y: yPos,
      size: 16,
      font: boldFont,
      color: rgb(0, 0, 0),
    });

    yPos -= 40;

    // Repairs performed
    pdfDoc.drawText('Repairs, Alterations performed during inspection:', {
      x: 50,
      y: yPos,
      size: 11,
      font: boldFont,
      color: rgb(0, 0, 0),
    });

    yPos -= 20;

    pdfDoc.drawText('Comments:', {
      x: 50,
      y: yPos,
      size: 10,
      font: boldFont,
      color: rgb(0, 0, 0),
    });

    yPos -= 15;

    const repairsText = htmlToText(summary?.repairs_performed || 'None reported');
    yPos = drawWrappedText(repairsText, 50, yPos, pageWidth - 100, 10, font, 100);

    yPos -= 30;

    // Critical actions
    pdfDoc.drawText('Critical Actions Required', {
      x: 50,
      y: yPos,
      size: 11,
      font: boldFont,
      color: rgb(0, 0, 0),
    });

    yPos -= 15;

    pdfDoc.drawText('*Critical Action = Required Changes Prior to use of Activity, Element, or Equipment', {
      x: 50,
      y: yPos,
      size: 8,
      font: font,
      color: rgb(0.5, 0.5, 0.5),
    });

    yPos -= 15;

    pdfDoc.drawText('Comments:', {
      x: 50,
      y: yPos,
      size: 10,
      font: boldFont,
      color: rgb(0, 0, 0),
    });

    yPos -= 15;

    const criticalText = htmlToText(summary?.critical_actions || 'None identified');
    yPos = drawWrappedText(criticalText, 50, yPos, pageWidth - 100, 10, font, 100);

    yPos -= 30;

    // Future considerations
    pdfDoc.drawText('Future Considerations', {
      x: 50,
      y: yPos,
      size: 11,
      font: boldFont,
      color: rgb(0, 0, 0),
    });

    yPos -= 15;

    pdfDoc.drawText('(includes but not limited to age of course, recommended updates, suggestions, industry future)', {
      x: 50,
      y: yPos,
      size: 8,
      font: font,
      color: rgb(0.5, 0.5, 0.5),
    });

    yPos -= 15;

    pdfDoc.drawText('Comments:', {
      x: 50,
      y: yPos,
      size: 10,
      font: boldFont,
      color: rgb(0, 0, 0),
    });

    yPos -= 15;

    const futureText = htmlToText(summary?.future_considerations || 'None at this time');
    yPos = drawWrappedText(futureText, 50, yPos, pageWidth - 100, 10, font, 100);

    yPos -= 30;

    // Next inspection date
    pdfDoc.drawText('Next inspection date:', {
      x: 50,
      y: yPos,
      size: 11,
      font: boldFont,
      color: rgb(0, 0, 0),
    });

    yPos -= 15;

    pdfDoc.drawText(formatDate(summary?.next_inspection_date) || 'Not specified', {
      x: 50,
      y: yPos,
      size: 10,
      font: font,
    });

    yPos -= 30;

    // Retirement guidelines
    pdfDoc.drawText('General Rope Works Inspection Retirement Guidelines:', {
      x: 50,
      y: yPos,
      size: 12,
      font: boldFont,
      color: rgb(0, 0, 0),
    });

    yPos -= 18;

    pdfDoc.drawText('These are generalized and are not a substitute for the Pre use inspection.', {
      x: 50,
      y: yPos,
      size: 8,
      font: font,
      color: rgb(0.5, 0.5, 0.5),
    });

    yPos -= 25;

    // Desktop table view
    const guideColWidths = [180, 332];
    const guideRowHeight = 25;

    // Header
    pdfDoc.drawRectangle({
      x: 50,
      y: yPos - guideRowHeight,
      width: guideColWidths[0] + guideColWidths[1],
      height: guideRowHeight,
      color: rgb(0.85, 0.92, 0.98),
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });

    pdfDoc.drawText('Item', { x: 55, y: yPos - 16, size: 10, font: boldFont });
    pdfDoc.drawText('Retirement Guideline', { x: 55 + guideColWidths[0], y: yPos - 16, size: 10, font: boldFont });

    yPos -= guideRowHeight;

    const guidelineItems = [
      { item: 'Harness:', guideline: 'Manufacture maximum use or condition warranted at time of inspection' },
      { item: 'Lanyards:', guideline: 'Manufacture maximum use or condition warranted at time of inspection' },
      { item: 'Kernmantle Rope', guideline: '5 years or 1000 loads when used with top rope systems' },
      { item: 'Kernmantle Rope', guideline: '5 years or 300 loads, whichever comes first when used on aerial leap activities' },
      { item: 'Helmets:', guideline: 'Manufacture maximum use or condition warranted at time of inspection' },
      { item: 'Pulleys, Trolleys, Carabiners, Belay/descent devices, Cable grabs:', guideline: 'Manufacture maximum use or condition warranted at time of inspection' }
    ];

    for (const guide of guidelineItems) {
      pdfDoc.drawRectangle({
        x: 50,
        y: yPos - guideRowHeight,
        width: guideColWidths[0] + guideColWidths[1],
        height: guideRowHeight,
        borderColor: rgb(0, 0, 0),
        borderWidth: 0.5,
      });

      pdfDoc.drawText(guide.item, { x: 55, y: yPos - 16, size: 9, font: font });
      drawWrappedText(guide.guideline, 55 + guideColWidths[0], yPos - 10, guideColWidths[1] - 10, 9, font, guideRowHeight - 10);

      yPos -= guideRowHeight;
    }

    drawFooter(page, 11);

    // Save and upload PDF
    const pdfBytes = await pdfDoc.save();
    const fileName = `inspection_${inspectionId}_${Date.now()}.pdf`;
    
    const { error: uploadError } = await supabase.storage
      .from('inspection-reports')
      .upload(fileName, pdfBytes, {
        contentType: 'application/pdf',
        upsert: false,
      });

    if (uploadError) {
      console.error('Upload error:', uploadError);
      throw uploadError;
    }

    const { error: insertError } = await supabase
      .from('inspection_reports')
      .insert({
        inspection_id: inspectionId,
        pdf_url: fileName,
        generated_by: user.id,
        file_size_bytes: pdfBytes.length,
      });

    if (insertError) {
      console.error('Insert error:', insertError);
      throw insertError;
    }

    const base64Pdf = btoa(String.fromCharCode(...pdfBytes));

    return new Response(
      JSON.stringify({
        pdfData: base64Pdf,
        fileName,
        size: pdfBytes.length,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (error) {
    console.error('Error generating PDF:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to generate PDF';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
