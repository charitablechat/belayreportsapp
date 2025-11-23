import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { PDFDocument, PDFPage, rgb, StandardFonts } from "https://esm.sh/pdf-lib@1.17.1";

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

    const calculateTextHeight = (text: string, maxWidth: number, fontSize: number, currentFont: any): number => {
      const sanitized = sanitizeText(text);
      if (!sanitized) return fontSize * 1.15;
      
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

      return Math.max(lines.length * fontSize * 1.15, fontSize * 1.15);
    };

    const drawWrappedText = (page: PDFPage, text: string, x: number, y: number, maxWidth: number, fontSize: number, currentFont: any, maxHeight: number = 1000): number => {
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
        page.drawText(line, {
          x,
          y: yPos,
          size: fontSize,
          font: currentFont,
          color: rgb(0, 0, 0),
        });
        yPos -= fontSize * 1.15;
      }

      return yPos;
    };

    const drawHeader = (page: PDFPage) => {
      page.drawText('ROPE WORKS', {
        x: 40,
        y: pageHeight - 38,
        size: 13,
        font: boldFont,
        color: rgb(0.2, 0.2, 0.2),
      });
      page.drawText('ROPES/CHALLENGE COURSE', {
        x: 40,
        y: pageHeight - 50,
        size: 7.5,
        font: font,
        color: rgb(0.4, 0.4, 0.4),
      });

      if (acctLogoImage) {
        page.drawImage(acctLogoImage, {
          x: pageWidth - 100,
          y: pageHeight - 65,
          width: 60,
          height: 60,
        });
      } else {
        page.drawText('ACCT', {
          x: pageWidth - 100,
          y: pageHeight - 38,
          size: 11,
          font: boldFont,
          color: rgb(0.2, 0.2, 0.2),
        });
        page.drawText('ACCREDITED VENDOR', {
          x: pageWidth - 100,
          y: pageHeight - 50,
          size: 6.5,
          font: font,
          color: rgb(0.4, 0.4, 0.4),
        });
      }
      
      page.drawLine({
        start: { x: 40, y: pageHeight - 70 },
        end: { x: pageWidth - 40, y: pageHeight - 70 },
        thickness: 0.5,
        color: rgb(0.7, 0.7, 0.7)
      });
    };

    const drawFooter = (page: PDFPage, pageNumber: number) => {
      page.drawLine({
        start: { x: 40, y: 55 },
        end: { x: pageWidth - 40, y: 55 },
        thickness: 0.5,
        color: rgb(0.7, 0.7, 0.7)
      });
      
      const footerText = "The information contained in this report has been documented by a Qualified Professional. This report is effective for one year from the date of inspection. Issued by: Rope Works Inc., PO Box 1074, Dripping Springs, TX 78620";
      drawWrappedText(page, footerText, 40, 50, pageWidth - 80, 6.5, font, 35);
      
      page.drawText(`${pageNumber}`, {
        x: pageWidth / 2 - 5,
        y: 28,
        size: 7.5,
        font: font,
        color: rgb(0.4, 0.4, 0.4),
      });
    };

    let pageNumber = 1;

    // PAGE 1: COVER PAGE
    let page = pdfDoc.addPage([pageWidth, pageHeight]);
    let yPos = pageHeight - 80;

    drawHeader(page);

    page.drawText('Professional Inspection for Aerial Adventure Programs', {
      x: pageWidth / 2 - 210,
      y: yPos,
      size: 15,
      font: boldFont,
      color: rgb(0, 0, 0),
    });

    yPos -= 20;

    const inspectorName = inspectorProfile 
      ? `${inspectorProfile.first_name || ''} ${inspectorProfile.last_name || ''}`.trim()
      : '';

    const tableWidth = pageWidth - 80;

    // Row 1: Organization, Location, Onsite Contact (form-style with underlines)
    const row1Y = yPos;
    
    // Organization
    page.drawText('Organization:', { x: 40, y: row1Y, size: 9, font: boldFont });
    page.drawLine({
      start: { x: 115, y: row1Y - 2 },
      end: { x: 195, y: row1Y - 2 },
      thickness: 0.5,
      color: rgb(0, 0, 0)
    });
    page.drawText(sanitizeText(inspection.organization), { x: 118, y: row1Y - 1, size: 9, font: font });

    // Location
    page.drawText('Location:', { x: 205, y: row1Y, size: 9, font: boldFont });
    page.drawLine({
      start: { x: 260, y: row1Y - 2 },
      end: { x: 350, y: row1Y - 2 },
      thickness: 0.5,
      color: rgb(0, 0, 0)
    });
    page.drawText(sanitizeText(inspection.location), { x: 263, y: row1Y - 1, size: 9, font: font });

    // Onsite Contact
    page.drawText('Onsite Contact:', { x: 360, y: row1Y, size: 9, font: boldFont });
    page.drawLine({
      start: { x: 445, y: row1Y - 2 },
      end: { x: pageWidth - 40, y: row1Y - 2 },
      thickness: 0.5,
      color: rgb(0, 0, 0)
    });
    page.drawText(sanitizeText(inspection.onsite_contact || 'N/A'), { x: 448, y: row1Y - 1, size: 9, font: font });

    yPos = row1Y - 28;

    // Row 2: Inspected by, Date of Inspection
    const row2Y = yPos;

    // Inspected by
    page.drawText('Inspected by:', { x: 40, y: row2Y, size: 9, font: boldFont });
    page.drawLine({
      start: { x: 115, y: row2Y - 2 },
      end: { x: 270, y: row2Y - 2 },
      thickness: 0.5,
      color: rgb(0, 0, 0)
    });
    page.drawText(sanitizeText(inspectorName || 'N/A'), { x: 118, y: row2Y - 1, size: 9, font: font });

    // Date of Inspection
    page.drawText('Date of Inspection:', { x: 290, y: row2Y, size: 9, font: boldFont });
    page.drawLine({
      start: { x: 395, y: row2Y - 2 },
      end: { x: pageWidth - 40, y: row2Y - 2 },
      thickness: 0.5,
      color: rgb(0, 0, 0)
    });
    page.drawText(formatDate(inspection.inspection_date), { x: 398, y: row2Y - 1, size: 9, font: font });

    yPos = row2Y - 28;

    // Row 3: Previous Inspector, Prev. Inspection Date
    const row3Y = yPos;

    // Previous Inspector
    page.drawText('Previous Inspector:', { x: 40, y: row3Y, size: 9, font: boldFont });
    page.drawLine({
      start: { x: 145, y: row3Y - 2 },
      end: { x: 270, y: row3Y - 2 },
      thickness: 0.5,
      color: rgb(0, 0, 0)
    });
    page.drawText(sanitizeText(inspection.previous_inspector || 'N/A'), { x: 148, y: row3Y - 1, size: 9, font: font });

    // Prev. Inspection Date
    page.drawText('Prev. Inspection Date:', { x: 290, y: row3Y, size: 9, font: boldFont });
    page.drawLine({
      start: { x: 415, y: row3Y - 2 },
      end: { x: pageWidth - 40, y: row3Y - 2 },
      thickness: 0.5,
      color: rgb(0, 0, 0)
    });
    page.drawText((inspection.previous_inspection_date ? formatDate(inspection.previous_inspection_date) : 'N/A'), { x: 418, y: row3Y - 1, size: 9, font: font });

    yPos = row3Y - 28;

    // Course History
    page.drawText('Known Course History', {
      x: 40,
      y: yPos,
      size: 13,
      font: boldFont,
      color: rgb(0, 0, 0),
    });

    yPos -= 16;
    
    const historyText = sanitizeText(inspection.course_history) || 'No course history recorded';
    const historyHeight = Math.min(Math.max(calculateTextHeight(historyText, tableWidth - 10, 9, font) + 10, 60), 80);
    
    page.drawRectangle({
      x: 40,
      y: yPos - historyHeight,
      width: tableWidth,
      height: historyHeight,
      borderColor: rgb(0, 0, 0),
      borderWidth: 0.75,
    });

    drawWrappedText(page, historyText, 44, yPos - 8, tableWidth - 8, 9, font, historyHeight - 10);

    yPos -= historyHeight + 15;

    // Disclaimer
    const disclaimerText = 'This report covers the condition of the aerial adventure site for the date of inspection reflected on this form. The inspection provided is strictly an evaluation of the structural condition of the course elements and equipment. The inspection does not include training on how to operate the equipment, nor how to operate the course. The inspection only verifies the existence of written local operating procedures (LOP), an emergency action plan (EAP), and training documentation. The inspection does not perform a review or evaluate the LOP, EAP and training documentation. Potential problems can occur afterwards due to vandalism, improper use, weather, etc. Rope Works Inc. is not responsible for modifications or repairs made to the challenge course by anyone other than a Rope Works Inc. employee. We recommend you conduct your own periodic internal monitoring at a minimum on a quarterly basis. At a minimum an annual professional inspection is required by a qualified professional to be in compliance with the Association for Challenge Course Technology ANSI/ACCT current published standards.';
    yPos = drawWrappedText(page, disclaimerText, 40, yPos, pageWidth - 80, 8.5, font, 500);

    yPos -= 15;

    // Reminders
    page.drawText('Reminders and Requirements', {
      x: 40,
      y: yPos,
      size: 11,
      font: boldFont,
      color: rgb(0, 0, 0),
    });

    yPos -= 12;

    const reminders = [
      'Employers are required to issue staff appropriate fall protection for the duties to be performed.',
      'A Periodic Internal Monitoring of the aerial activities on your site shall be conducted by qualified personnel.',
      'Proper identification, tracking, and documentation of ALL equipment used for operations shall be kept and available at your annual professional inspection.',
      'Proper staff training should be provided for the operation of all aerial activities and equipment on your site.',
      'Operational Reviews shall be conducted once every five years.'
    ];

    for (const reminder of reminders) {
      page.drawText('•', {
        x: 44,
        y: yPos,
        size: 9,
        font: font,
        color: rgb(0, 0, 0),
      });
      yPos = drawWrappedText(page, reminder, 58, yPos, pageWidth - 100, 9, font, 150);
      yPos -= 4;
    }

    drawFooter(page, pageNumber++);

    // PAGE 2: DEFINITIONS AND KEY (CONSOLIDATED)
    page = pdfDoc.addPage([pageWidth, pageHeight]);
    yPos = pageHeight - 80;
    drawHeader(page);

    page.drawText('All inspections include the following when applicable:', {
      x: pageWidth / 2 - 175,
      y: yPos,
      size: 13,
      font: boldFont,
      color: rgb(0, 0, 0),
    });

    yPos -= 18;

    const definitions = [
      { title: 'Lifeline HDW', description: 'Represents all hardware associated with the Life Safety System including but not limited to: wire rope, bolts, wire rope terminations, & redundant terminations.' },
      { title: 'Activity HDW', description: 'Represents all hardware associated with the element execution. This includes but is not limited to: foot cables, platforms, hand ropes/cables, boards, etc.' },
      { title: 'Environment', description: 'This represents the surrounding area of the activity/element. This includes but is not limited to: ground cover, trees, rocks, & terrain.' },
      { title: 'Equipment', description: 'This represents the equipment utilized in the operation of the course activities. This includes but is not limited to: rope, carabiners, helmets, belay devices, pulleys, trolleys, lanyards, etc.' },
      { title: 'Pass/Pass with Provisions/Fail', description: 'This represents the overall rating for the system based on the condition of the items inspected on the day of the inspection. Rope Works Inc. inspects all challenge course and canopy/zip line tours to the standards set forth by the ACCT. Any deviation from the ACCT standards in regards to the inspection criteria will be addressed in the Comment section.' }
    ];

    for (const def of definitions) {
      page.drawText(def.title, { x: 40, y: yPos, size: 9.5, font: boldFont });
      yPos -= 10;
      yPos = drawWrappedText(page, def.description, 40, yPos, pageWidth - 80, 8.5, font, 60);
      yPos -= 8;
    }

    yPos -= 10;

    // Inspection Key
    page.drawText('Inspection Key', { x: 40, y: yPos, size: 10.5, font: boldFont });
    yPos -= 12;

    const inspectionKey = [
      { title: 'Pass', description: 'The equipment or operating system meets all manufacturer specifications, industry standards, and operational safety requirements at the time of inspection.' },
      { title: 'Pass with Provisions', description: 'The equipment or operating system is generally in acceptable condition but requires minor corrective action, repair, or follow-up maintenance that does not pose an immediate safety concern.' },
      { title: 'Fail', description: 'The equipment or operating system does not meet minimum safety or operational standards and presents a potential or immediate hazard. The item must be removed from service.' },
      { title: 'N/A', description: 'Not applicable, Not inspected, or inaccessible/not available at the time of inspection.' }
    ];

    for (const key of inspectionKey) {
      page.drawText(key.title, { x: 40, y: yPos, size: 9.5, font: boldFont });
      yPos -= 10;
      yPos = drawWrappedText(page, key.description, 40, yPos, pageWidth - 80, 8.5, font, 60);
      yPos -= 10;
    }

    drawFooter(page, pageNumber++);

    // PAGE 3: OPERATING SYSTEMS
    if (systems && systems.length > 0) {
      page = pdfDoc.addPage([pageWidth, pageHeight]);
      yPos = pageHeight - 80;
      drawHeader(page);

      page.drawText('OPERATING SYSTEMS', { x: pageWidth / 2 - 85, y: yPos, size: 15, font: boldFont });
      yPos -= 22;

      const sysColWidths = [180, 95, 257];
      const sysTableWidth = sysColWidths.reduce((a, b) => a + b, 0);

      page.drawRectangle({
        x: 40,
        y: yPos - 16,
        width: sysTableWidth,
        height: 16,
        color: rgb(0.9, 0.9, 0.9),
        borderColor: rgb(0, 0, 0),
        borderWidth: 0.75,
      });

      page.drawText('System Name', { x: 44, y: yPos - 11, size: 8.5, font: boldFont });
      page.drawText('Result', { x: 44 + sysColWidths[0], y: yPos - 11, size: 8.5, font: boldFont });
      page.drawText('Comments', { x: 44 + sysColWidths[0] + sysColWidths[1], y: yPos - 11, size: 8.5, font: boldFont });
      yPos -= 16;

      for (const sys of systems) {
        const commentHeight = calculateTextHeight(sys.comments || '', sysColWidths[2] - 10, 8, font);
        const rowHeight = Math.max(16, Math.min(commentHeight + 8, 40));

        page.drawRectangle({
          x: 40,
          y: yPos - rowHeight,
          width: sysTableWidth,
          height: rowHeight,
          borderColor: rgb(0, 0, 0),
          borderWidth: 0.5,
        });

        const systemName = sys.name ? `${sanitizeText(sys.system_name)} (${sanitizeText(sys.name)})` : sanitizeText(sys.system_name);
        page.drawText(systemName, { x: 44, y: yPos - 11, size: 8, font: font });
        page.drawText(sanitizeText(sys.result), { x: 44 + sysColWidths[0], y: yPos - 11, size: 8, font: font });
        drawWrappedText(page, sanitizeText(sys.comments), 44 + sysColWidths[0] + sysColWidths[1], yPos - 7, sysColWidths[2] - 10, 8, font, rowHeight - 8);
        yPos -= rowHeight;
      }

      drawFooter(page, pageNumber++);
    }

    // PAGE 4: ZIPLINES (CONDITIONAL)
    if (ziplines && ziplines.length > 0) {
      page = pdfDoc.addPage([pageWidth, pageHeight]);
      yPos = pageHeight - 80;
      drawHeader(page);

      page.drawText('ZIPLINES', { x: pageWidth / 2 - 45, y: yPos, size: 15, font: boldFont });
      yPos -= 18;
      page.drawText('SYSTEMS - ZIPLINES', { x: pageWidth / 2 - 65, y: yPos, size: 11, font: boldFont });
      yPos -= 20;

      const keyLines = [
        'Cable Type KEY: GAC = Galvanized Aircraft Cable, SS = Super Swaged',
        'Braking System KEY: ZS = Zip Stop, FB = Friction Break, SB = Spring Bank, G = Gravity',
        'EAD System KEY - ZS = Zip Step, AP = Auto P'
      ];

      for (const keyLine of keyLines) {
        page.drawText(keyLine, { x: 40, y: yPos, size: 7.5, font: font });
        yPos -= 8;
      }

      yPos -= 8;

      const zipColWidths = [88, 68, 68, 68, 68, 172];
      const zipTableWidth = zipColWidths.reduce((a, b) => a + b, 0);

      page.drawRectangle({
        x: 40,
        y: yPos - 16,
        width: zipTableWidth,
        height: 16,
        color: rgb(0.9, 0.9, 0.9),
        borderColor: rgb(0, 0, 0),
        borderWidth: 0.75,
      });

      const zipHeaders = ['Zipline', 'Length (ft)', 'Unload (lbf)', 'Load (lbf)', 'Result', 'Comments'];
      let xPos = 40;
      for (let i = 0; i < zipHeaders.length; i++) {
        page.drawText(zipHeaders[i], { x: xPos + 4, y: yPos - 11, size: 7.5, font: boldFont });
        xPos += zipColWidths[i];
      }

      yPos -= 16;

      for (const zip of ziplines) {
        const commentHeight = calculateTextHeight(zip.comments || '', zipColWidths[5] - 8, 7.5, font);
        const rowHeight = Math.max(18, Math.min(commentHeight + 8, 35));

        page.drawRectangle({
          x: 40,
          y: yPos - rowHeight,
          width: zipTableWidth,
          height: rowHeight,
          borderColor: rgb(0, 0, 0),
          borderWidth: 0.5,
        });

        xPos = 40;
        page.drawText(sanitizeText(zip.zipline_name), { x: xPos + 4, y: yPos - 11, size: 7.5, font: font });
        xPos += zipColWidths[0];
        page.drawText(String(zip.cable_length || ''), { x: xPos + 4, y: yPos - 11, size: 7.5, font: font });
        xPos += zipColWidths[1];
        page.drawText(String(zip.unload_tension || ''), { x: xPos + 4, y: yPos - 11, size: 7.5, font: font });
        xPos += zipColWidths[2];
        page.drawText(String(zip.load_tension || ''), { x: xPos + 4, y: yPos - 11, size: 7.5, font: font });
        xPos += zipColWidths[3];
        page.drawText(sanitizeText(zip.result), { x: xPos + 4, y: yPos - 11, size: 7.5, font: font });
        xPos += zipColWidths[4];
        drawWrappedText(page, sanitizeText(zip.comments), xPos + 4, yPos - 7, zipColWidths[5] - 8, 7.5, font, rowHeight - 8);

        yPos -= rowHeight;

        page.drawRectangle({
          x: 40,
          y: yPos - 15,
          width: zipTableWidth,
          height: 15,
          borderColor: rgb(0, 0, 0),
          borderWidth: 0.5,
        });

        const detailText = `Cable: ${sanitizeText(zip.cable_type)} | Braking System: ${sanitizeText(zip.braking_system)} | EAD System: ${sanitizeText(zip.ead_system)}`;
        page.drawText(detailText, { x: 44, y: yPos - 10, size: 6.5, font: font });
        yPos -= 15;
      }

      drawFooter(page, pageNumber++);
    }

    // EQUIPMENT PAGES (CONSOLIDATED)
    if (equipment && equipment.length > 0) {
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

      page = pdfDoc.addPage([pageWidth, pageHeight]);
      yPos = pageHeight - 80;
      drawHeader(page);

      const inventoryDisclaimer = 'Inventory tracking of each item used for course operations. This should be done according to a written checklist that is monitored by the course manager or other qualified person at your site. Records should be available at your annual inspection that include and indicate the date of purchase, date of first use and the equipment shall be identifiable by the serial number/tag or other unique identifier that matches your written documentation and the manufacturer retirement criteria.';
      yPos = drawWrappedText(page, inventoryDisclaimer, 40, yPos, pageWidth - 80, 7.5, font, 80);
      yPos -= 15;

      for (const category of equipmentCategories) {
        const items = equipment.filter(e => e.equipment_category === category.key);
        if (items.length === 0) continue;

        if (yPos < 200) {
          drawFooter(page, pageNumber++);
          page = pdfDoc.addPage([pageWidth, pageHeight]);
          yPos = pageHeight - 80;
          drawHeader(page);
        }

        page.drawText(`EQUIPMENT - ${category.title}`, { x: 40, y: yPos, size: 11, font: boldFont });
        yPos -= 16;

        const eqColWidths = [148, 48, 38, 88, 210];
        const eqTableWidth = eqColWidths.reduce((a, b) => a + b, 0);

        page.drawRectangle({
          x: 40,
          y: yPos - 15,
          width: eqTableWidth,
          height: 15,
          color: rgb(0.9, 0.9, 0.9),
          borderColor: rgb(0, 0, 0),
          borderWidth: 0.75,
        });

        const eqHeaders = ['Type', 'Year', 'Qty', 'Result', 'Comments'];
        let xPos = 40;
        for (let i = 0; i < eqHeaders.length; i++) {
          page.drawText(eqHeaders[i], { x: xPos + 4, y: yPos - 10, size: 8.5, font: boldFont });
          xPos += eqColWidths[i];
        }

        yPos -= 15;

        for (const item of items) {
          const commentHeight = calculateTextHeight(item.comments || '', eqColWidths[4] - 8, 7.5, font);
          const rowHeight = Math.max(18, Math.min(commentHeight + 8, 35));

          if (yPos - rowHeight < 80) {
            drawFooter(page, pageNumber++);
            page = pdfDoc.addPage([pageWidth, pageHeight]);
            yPos = pageHeight - 80;
            drawHeader(page);
          }

          page.drawRectangle({
            x: 40,
            y: yPos - rowHeight,
            width: eqTableWidth,
            height: rowHeight,
            borderColor: rgb(0, 0, 0),
            borderWidth: 0.5,
          });

          xPos = 40;
          drawWrappedText(page, sanitizeText(item.equipment_type), xPos + 4, yPos - 7, eqColWidths[0] - 8, 7.5, font, rowHeight - 8);
          xPos += eqColWidths[0];
          page.drawText(String(item.production_year || ''), { x: xPos + 4, y: yPos - 11, size: 7.5, font: font });
          xPos += eqColWidths[1];
          page.drawText(String(item.quantity || ''), { x: xPos + 4, y: yPos - 11, size: 7.5, font: font });
          xPos += eqColWidths[2];
          page.drawText(sanitizeText(item.result), { x: xPos + 4, y: yPos - 11, size: 7.5, font: font });
          xPos += eqColWidths[3];
          drawWrappedText(page, sanitizeText(item.comments), xPos + 4, yPos - 7, eqColWidths[4] - 8, 7.5, font, rowHeight - 8);

          yPos -= rowHeight;
        }

        yPos -= 10;
      }

      drawFooter(page, pageNumber++);
    }

    // ACCT STANDARDS PAGE
    page = pdfDoc.addPage([pageWidth, pageHeight]);
    yPos = pageHeight - 80;
    drawHeader(page);

    page.drawText('ACCT Operations Standards Criteria', { x: pageWidth / 2 - 135, y: yPos, size: 15, font: boldFont });
    yPos -= 20;

    const standardsIntro = 'The following documentation is currently required by the ANSI/ACCT 03-2019 Operations Standards. If your program does not have the following in existence it is noted below. It is your responsibility to ensure these are located or created and available.';
    yPos = drawWrappedText(page, standardsIntro, 40, yPos, pageWidth - 80, 8.5, font, 70);
    yPos -= 15;

    const stdColWidths = [325, 125, 22, 22];
    const stdTableWidth = stdColWidths.reduce((a, b) => a + b, 0);

    page.drawRectangle({
      x: 40,
      y: yPos - 20,
      width: stdTableWidth,
      height: 20,
      color: rgb(0.9, 0.9, 0.9),
      borderColor: rgb(0, 0, 0),
      borderWidth: 0.75,
    });

    page.drawText('Standard', { x: 44, y: yPos - 13, size: 8.5, font: boldFont });
    page.drawText('Reference', { x: 44 + stdColWidths[0], y: yPos - 13, size: 8.5, font: boldFont });
    page.drawText('YES', { x: 44 + stdColWidths[0] + stdColWidths[1] + 2, y: yPos - 13, size: 7.5, font: boldFont });
    page.drawText('NO', { x: 44 + stdColWidths[0] + stdColWidths[1] + stdColWidths[2] + 2, y: yPos - 13, size: 7.5, font: boldFont });
    yPos -= 20;

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

      page.drawRectangle({
        x: 40,
        y: yPos - 20,
        width: stdTableWidth,
        height: 20,
        borderColor: rgb(0, 0, 0),
        borderWidth: 0.5,
      });

      drawWrappedText(page, standard.name, 44, yPos - 7, stdColWidths[0] - 10, 7.5, font, 18);
      page.drawText(standard.ref, { x: 44 + stdColWidths[0], y: yPos - 12, size: 7.5, font: font });

      page.drawRectangle({
        x: 44 + stdColWidths[0] + stdColWidths[1],
        y: yPos - 15,
        width: 15,
        height: 15,
        borderColor: rgb(0, 0, 0),
        borderWidth: 0.75,
        color: hasDoc ? rgb(0, 0.6, 0) : undefined,
      });

      page.drawRectangle({
        x: 44 + stdColWidths[0] + stdColWidths[1] + stdColWidths[2],
        y: yPos - 15,
        width: 15,
        height: 15,
        borderColor: rgb(0, 0, 0),
        borderWidth: 0.75,
        color: !hasDoc ? rgb(0.7, 0.1, 0.1) : undefined,
      });

      yPos -= 20;
    }

    yPos -= 12;
    const standardsComments = standards?.map(s => s.comments).filter(c => c).join('; ') || 'None';
    yPos = drawWrappedText(page, `Comments: ${standardsComments}`, 40, yPos, pageWidth - 80, 8.5, font, 60);

    drawFooter(page, pageNumber++);

    // SUMMARY PAGE
    page = pdfDoc.addPage([pageWidth, pageHeight]);
    yPos = pageHeight - 80;
    drawHeader(page);

    const qcpNote = 'A QCP is a Qualified Course Professional that meets the criteria outlined by the ACCT. Operations & Emergency procedures must be written and specific to the site\'s local operations procedures.';
    yPos = drawWrappedText(page, qcpNote, 40, yPos, pageWidth - 80, 7.5, font, 30);
    yPos -= 15;

    page.drawText('REPORT SUMMARY', { x: pageWidth / 2 - 85, y: yPos, size: 15, font: boldFont });
    yPos -= 20;

    page.drawText('Repairs, Alterations performed during inspection:', { x: 40, y: yPos, size: 9.5, font: boldFont });
    yPos -= 8;
    page.drawText('Comments:', { x: 40, y: yPos, size: 8.5, font: boldFont });
    yPos -= 10;
    const repairsText = htmlToText(summary?.repairs_performed || 'None reported');
    yPos = drawWrappedText(page, repairsText, 40, yPos, pageWidth - 80, 8.5, font, 60);
    yPos -= 15;

    page.drawText('Critical Actions Required', { x: 40, y: yPos, size: 9.5, font: boldFont });
    yPos -= 8;
    page.drawText('*Critical Action = Required Changes Prior to use of Activity, Element, or Equipment', {
      x: 40, y: yPos, size: 6.5, font: font, color: rgb(0.5, 0.5, 0.5)
    });
    yPos -= 10;
    page.drawText('Comments:', { x: 40, y: yPos, size: 8.5, font: boldFont });
    yPos -= 10;
    const criticalText = htmlToText(summary?.critical_actions || 'None identified');
    yPos = drawWrappedText(page, criticalText, 40, yPos, pageWidth - 80, 8.5, font, 60);
    yPos -= 15;

    page.drawText('Future Considerations', { x: 40, y: yPos, size: 9.5, font: boldFont });
    yPos -= 8;
    page.drawText('(includes but not limited to age of course, recommended updates, suggestions, industry future)', {
      x: 40, y: yPos, size: 6.5, font: font, color: rgb(0.5, 0.5, 0.5)
    });
    yPos -= 10;
    page.drawText('Comments:', { x: 40, y: yPos, size: 8.5, font: boldFont });
    yPos -= 10;
    const futureText = htmlToText(summary?.future_considerations || 'None at this time');
    yPos = drawWrappedText(page, futureText, 40, yPos, pageWidth - 80, 8.5, font, 60);
    yPos -= 15;

    page.drawText('Next inspection date:', { x: 40, y: yPos, size: 9.5, font: boldFont });
    yPos -= 10;
    page.drawText(formatDate(summary?.next_inspection_date) || 'Not specified', { x: 40, y: yPos, size: 8.5, font: font });
    yPos -= 16;

    page.drawText('General Rope Works Inspection Retirement Guidelines:', { x: 40, y: yPos, size: 10.5, font: boldFont });
    yPos -= 10;
    page.drawText('These are generalized and are not a substitute for the Pre use inspection.', {
      x: 40, y: yPos, size: 6.5, font: font, color: rgb(0.5, 0.5, 0.5)
    });
    yPos -= 14;

    const guideColWidths = [175, 357];
    const guideRowHeight = 18;

    page.drawRectangle({
      x: 40,
      y: yPos - guideRowHeight,
      width: guideColWidths[0] + guideColWidths[1],
      height: guideRowHeight,
      color: rgb(0.85, 0.92, 0.98),
      borderColor: rgb(0, 0, 0),
      borderWidth: 0.75,
    });

    page.drawText('Item', { x: 44, y: yPos - 12, size: 8.5, font: boldFont });
    page.drawText('Retirement Criteria', { x: 44 + guideColWidths[0], y: yPos - 12, size: 8.5, font: boldFont });
    yPos -= guideRowHeight;

    const retirementGuidelines = [
      { item: 'Rope/Webbing', criteria: '10 years from first use' },
      { item: 'Harness/Lanyard', criteria: '10 years from first use' },
      { item: 'Helmet', criteria: '10 years from first use (verify with manufacturer)' },
      { item: 'Carabiners/Quicklinks', criteria: 'No specific lifespan - retire based on condition' },
      { item: 'Belay Devices/Pulleys', criteria: 'No specific lifespan - retire based on condition' },
      { item: 'Metal Equipment', criteria: 'Inspect for cracks, deformation, wear, corrosion' }
    ];

    for (const guide of retirementGuidelines) {
      page.drawRectangle({
        x: 40,
        y: yPos - guideRowHeight,
        width: guideColWidths[0] + guideColWidths[1],
        height: guideRowHeight,
        borderColor: rgb(0, 0, 0),
        borderWidth: 0.5,
      });

      page.drawText(guide.item, { x: 44, y: yPos - 12, size: 7.5, font: font });
      drawWrappedText(page, guide.criteria, 44 + guideColWidths[0], yPos - 7, guideColWidths[1] - 8, 7.5, font, guideRowHeight - 4);
      yPos -= guideRowHeight;
    }

    drawFooter(page, pageNumber++);

    const pdfBytes = await pdfDoc.save();
    const filename = `inspection-${inspectionId}-${Date.now()}.pdf`;

    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('inspection-reports')
      .upload(filename, pdfBytes, {
        contentType: 'application/pdf',
        upsert: true
      });

    if (uploadError) {
      throw uploadError;
    }

    const { data: publicUrl } = supabase.storage
      .from('inspection-reports')
      .getPublicUrl(filename);

    await supabase.from('inspection_reports').insert({
      inspection_id: inspectionId,
      pdf_url: publicUrl.publicUrl,
      generated_by: user.id,
      file_size_bytes: pdfBytes.length,
      version: 1
    });

    return new Response(
      JSON.stringify({ 
        url: publicUrl.publicUrl,
        pdfData: btoa(String.fromCharCode(...pdfBytes)),
        filename: filename,
        size: pdfBytes.length
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (error) {
    console.error('Error generating PDF:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
