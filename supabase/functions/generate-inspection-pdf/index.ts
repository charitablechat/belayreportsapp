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
    const helveticaFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    
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

    // Page dimensions and styling constants
    const pageWidth = 612;
    const pageHeight = 792;
    const margin = 50;
    const topMargin = 120;
    const bottomMargin = 90;
    
    // Color palette
    const darkGray = rgb(0.2, 0.2, 0.2);
    const mediumGray = rgb(0.4, 0.4, 0.4);
    const lightGray = rgb(0.7, 0.7, 0.7);
    const veryLightGray = rgb(0.9, 0.9, 0.9);
    const black = rgb(0, 0, 0);

    // Convert HTML to plain text with formatting markers
    const htmlToText = (html: string | null | undefined): string => {
      if (!html) return '';
      let text = String(html);
      
      // Handle bold tags
      text = text.replace(/<strong>(.*?)<\/strong>/gi, '**$1**');
      text = text.replace(/<b>(.*?)<\/b>/gi, '**$1**');
      
      // Handle italic tags
      text = text.replace(/<em>(.*?)<\/em>/gi, '*$1*');
      text = text.replace(/<i>(.*?)<\/i>/gi, '*$1*');
      
      // Handle bullet lists
      text = text.replace(/<ul>/gi, '\n');
      text = text.replace(/<\/ul>/gi, '\n');
      text = text.replace(/<li>(.*?)<\/li>/gi, '• $1\n');
      
      // Handle paragraphs
      text = text.replace(/<p>(.*?)<\/p>/gi, '$1\n');
      text = text.replace(/<br\s*\/?>/gi, '\n');
      
      // Remove any remaining HTML tags
      text = text.replace(/<[^>]*>/g, '');
      
      // Decode HTML entities
      text = text.replace(/&nbsp;/g, ' ');
      text = text.replace(/&amp;/g, '&');
      text = text.replace(/&lt;/g, '<');
      text = text.replace(/&gt;/g, '>');
      text = text.replace(/&quot;/g, '"');
      
      return text;
    };

    const sanitizeText = (text: string | null | undefined): string => {
      if (!text) return '';
      
      // First convert HTML to text with formatting markers
      text = htmlToText(text);
      
      return String(text)
        .replace(/\r\n/g, ' ')  // Replace Windows newlines (except from bullet lists)
        .replace(/○/g, '•')
        .replace(/[^\x00-\xFF\n]/g, ' ')  // Keep newlines for bullet lists
        .replace(/\s+/g, ' ')    // Replace multiple spaces with single space
        .trim();
    };

    const formatDate = (dateStr: string | null): string => {
      if (!dateStr) return '';
      const date = new Date(dateStr);
      return date.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
    };

    // Enhanced text drawing with support for bold/italic and proper wrapping
    const drawWrappedText = (
      page: any,
      text: string,
      x: number,
      y: number,
      maxWidth: number,
      options: {
        size?: number;
        font?: any;
        color?: any;
        lineHeight?: number;
        align?: 'left' | 'center' | 'right';
      } = {}
    ): number => {
      const fontSize = options.size || 10;
      let font = options.font || helveticaFont;
      const color = options.color || black;
      const lineHeight = options.lineHeight || fontSize * 1.4;
      const align = options.align || 'left';

      text = sanitizeText(text);
      
      // Split by newlines first (for bullet lists)
      const paragraphs = text.split('\n').filter(p => p.trim());
      
      let currentY = y;
      
      for (const paragraph of paragraphs) {
        // Parse text with formatting markers
        const segments: Array<{ text: string; bold: boolean; italic: boolean }> = [];
        let remainingText = paragraph;
        
        while (remainingText.length > 0) {
          // Check for bold markers
          const boldMatch = remainingText.match(/^\*\*(.*?)\*\*/);
          if (boldMatch) {
            segments.push({ text: boldMatch[1], bold: true, italic: false });
            remainingText = remainingText.slice(boldMatch[0].length);
            continue;
          }
          
          // Check for italic markers
          const italicMatch = remainingText.match(/^\*(.*?)\*/);
          if (italicMatch) {
            segments.push({ text: italicMatch[1], bold: false, italic: true });
            remainingText = remainingText.slice(italicMatch[0].length);
            continue;
          }
          
          // Regular text until next marker
          const nextMarker = remainingText.search(/\*{1,2}/);
          if (nextMarker === -1) {
            segments.push({ text: remainingText, bold: false, italic: false });
            break;
          } else {
            segments.push({ text: remainingText.slice(0, nextMarker), bold: false, italic: false });
            remainingText = remainingText.slice(nextMarker);
          }
        }
        
        // Now wrap and draw the segments
        const words: Array<{ text: string; font: any }> = [];
        for (const segment of segments) {
          const segmentFont = segment.bold ? helveticaBold : helveticaFont;
          const segmentWords = segment.text.split(' ').map(w => ({ text: w, font: segmentFont }));
          words.push(...segmentWords);
        }
        
        const lines: Array<Array<{ text: string; font: any }>> = [];
        let currentLine: Array<{ text: string; font: any }> = [];
        let currentLineWidth = 0;
        
        for (const word of words) {
          const wordWidth = word.font.widthOfTextAtSize(word.text, fontSize);
          const spaceWidth = word.font.widthOfTextAtSize(' ', fontSize);
          const testWidth = currentLineWidth + (currentLine.length > 0 ? spaceWidth : 0) + wordWidth;
          
          if (testWidth > maxWidth && currentLine.length > 0) {
            lines.push(currentLine);
            currentLine = [word];
            currentLineWidth = wordWidth;
          } else {
            currentLine.push(word);
            currentLineWidth = testWidth;
          }
        }
        if (currentLine.length > 0) lines.push(currentLine);
        
        // Draw each line with proper formatting
        for (const line of lines) {
          let drawX = x;
          
          for (let i = 0; i < line.length; i++) {
            const word = line[i];
            const wordText = i === 0 ? word.text : ' ' + word.text;
            
            page.drawText(wordText, {
              x: drawX,
              y: currentY,
              size: fontSize,
              font: word.font,
              color: color,
            });
            
            drawX += word.font.widthOfTextAtSize(wordText, fontSize);
          }
          
          currentY -= lineHeight;
        }
      }

      return currentY;
    };

    // Professional header with dual logos
    const drawHeader = (page: any) => {
      // Rope Works text on left
      page.drawText('ROPE WORKS', {
        x: margin,
        y: pageHeight - 60,
        size: 14,
        font: helveticaBold,
        color: darkGray,
      });
      page.drawText('ROPES/CHALLENGE COURSE', {
        x: margin,
        y: pageHeight - 76,
        size: 8,
        font: helveticaFont,
        color: mediumGray,
      });

      // ACCT badge on right
      if (acctLogoImage) {
        const logoSize = 60;
        page.drawImage(acctLogoImage, {
          x: pageWidth - margin - logoSize,
          y: pageHeight - 80,
          width: logoSize,
          height: logoSize,
        });
      } else {
        // Text fallback
        page.drawText('ACCT', {
          x: pageWidth - margin - 100,
          y: pageHeight - 60,
          size: 12,
          font: helveticaBold,
          color: darkGray,
        });
        page.drawText('ACCREDITED VENDOR', {
          x: pageWidth - margin - 100,
          y: pageHeight - 74,
          size: 7,
          font: helveticaFont,
          color: mediumGray,
        });
      }
    };

    // Professional footer with separator line
    const drawFooter = (page: any, pageNumber: number) => {
      // Horizontal separator line
      page.drawLine({
        start: { x: margin, y: bottomMargin + 25 },
        end: { x: pageWidth - margin, y: bottomMargin + 25 },
        thickness: 1,
        color: lightGray,
      });

      // Footer text
      const footerLine1 = "The information contained in this report has been documented by a Qualified Professional. This report is effective for one year from the date of inspection.";
      const footerLine2 = "Issued by: Rope Works Inc., PO Box 1074, Dripping Springs, TX 78620";
      
      drawWrappedText(page, footerLine1, margin, bottomMargin - 10, pageWidth - 2 * margin, {
        size: 7,
        color: mediumGray,
        align: 'center',
        lineHeight: 10,
      });
      
      drawWrappedText(page, footerLine2, margin, bottomMargin - 35, pageWidth - 2 * margin, {
        size: 7,
        font: helveticaBold,
        color: mediumGray,
        align: 'center',
      });

      // Page number
      page.drawText(`${pageNumber}`, {
        x: pageWidth / 2 - 5,
        y: 30,
        size: 8,
        font: helveticaFont,
        color: mediumGray,
      });
    };

    // Draw professional table with proper formatting
    const drawTable = (
      page: any,
      startY: number,
      headers: string[],
      rows: string[][],
      columnWidths: number[],
      options: { rowHeight?: number; headerBg?: any } = {}
    ): number => {
      const rowHeight = options.rowHeight || 25;
      const headerBg = options.headerBg || veryLightGray;
      const tableWidth = columnWidths.reduce((a, b) => a + b, 0);
      let yPos = startY;

      // Draw header row
      page.drawRectangle({
        x: margin,
        y: yPos - rowHeight,
        width: tableWidth,
        height: rowHeight,
        color: headerBg,
        borderColor: black,
        borderWidth: 1.5,
      });

      let xPos = margin;
      for (let i = 0; i < headers.length; i++) {
        if (i > 0) {
          page.drawLine({
            start: { x: xPos, y: yPos },
            end: { x: xPos, y: yPos - rowHeight },
            thickness: 1,
            color: mediumGray,
          });
        }

        drawWrappedText(page, headers[i], xPos + 8, yPos - 16, columnWidths[i] - 16, {
          size: 10,
          font: helveticaBold,
          align: 'center',
        });

        xPos += columnWidths[i];
      }

      yPos -= rowHeight;

      // Draw data rows
      for (const row of rows) {
        page.drawRectangle({
          x: margin,
          y: yPos - rowHeight,
          width: tableWidth,
          height: rowHeight,
          borderColor: lightGray,
          borderWidth: 0.5,
        });

        xPos = margin;
        for (let i = 0; i < row.length; i++) {
          if (i > 0) {
            page.drawLine({
              start: { x: xPos, y: yPos },
              end: { x: xPos, y: yPos - rowHeight },
              thickness: 0.5,
              color: lightGray,
            });
          }

          drawWrappedText(page, row[i], xPos + 6, yPos - 14, columnWidths[i] - 12, {
            size: 9,
            lineHeight: 12,
          });

          xPos += columnWidths[i];
        }

        yPos -= rowHeight;
      }

      return yPos;
    };

    // ======================
    // PAGE 1: COVER PAGE
    // ======================
    const page1 = pdfDoc.addPage([pageWidth, pageHeight]);
    drawHeader(page1);

    // Main title - large, centered, bold
    page1.drawText('Professional Inspection for Aerial Adventure Programs', {
      x: pageWidth / 2 - helveticaBold.widthOfTextAtSize('Professional Inspection for Aerial Adventure Programs', 18) / 2,
      y: pageHeight - topMargin - 20,
      size: 18,
      font: helveticaBold,
      color: darkGray,
    });

    let yPos = pageHeight - topMargin - 60;

    // Inspection details form table
    const detailsTableWidth = pageWidth - 2 * margin;
    const col1Width = detailsTableWidth * 0.33;
    const col2Width = detailsTableWidth * 0.33;
    const col3Width = detailsTableWidth * 0.34;

    const inspectorName = inspectorProfile 
      ? `${inspectorProfile.first_name || ''} ${inspectorProfile.last_name || ''}`.trim()
      : '';

    // Row 1
    page1.drawRectangle({
      x: margin,
      y: yPos - 30,
      width: detailsTableWidth,
      height: 30,
      borderColor: mediumGray,
      borderWidth: 1,
    });
    
    let xPos = margin;
    ['Organization:', 'Location:', 'Onsite Contact:'].forEach((label, i) => {
      const colWidth = i === 0 ? col1Width : i === 1 ? col2Width : col3Width;
      page1.drawText(label, { x: xPos + 5, y: yPos - 12, size: 8, font: helveticaBold, color: mediumGray });
      page1.drawText(sanitizeText(i === 0 ? inspection.organization : i === 1 ? inspection.location : inspection.onsite_contact), {
        x: xPos + 5,
        y: yPos - 24,
        size: 9,
        font: helveticaFont,
      });
      if (i < 2) {
        page1.drawLine({
          start: { x: xPos + colWidth, y: yPos },
          end: { x: xPos + colWidth, y: yPos - 30 },
          thickness: 0.5,
          color: lightGray,
        });
      }
      xPos += colWidth;
    });

    yPos -= 30;

    // Row 2
    page1.drawRectangle({
      x: margin,
      y: yPos - 30,
      width: detailsTableWidth,
      height: 30,
      borderColor: mediumGray,
      borderWidth: 1,
    });
    
    xPos = margin;
    page1.drawText('Inspected by:', { x: xPos + 5, y: yPos - 12, size: 8, font: helveticaBold, color: mediumGray });
    page1.drawText(sanitizeText(inspectorName), { x: xPos + 5, y: yPos - 24, size: 9, font: helveticaFont });
    
    page1.drawLine({
      start: { x: margin + col1Width, y: yPos },
      end: { x: margin + col1Width, y: yPos - 30 },
      thickness: 0.5,
      color: lightGray,
    });
    
    xPos = margin + col1Width + col2Width;
    page1.drawLine({
      start: { x: xPos, y: yPos },
      end: { x: xPos, y: yPos - 30 },
      thickness: 0.5,
      color: lightGray,
    });
    
    page1.drawText('Date of Inspection:', { x: xPos + 5, y: yPos - 12, size: 8, font: helveticaBold, color: mediumGray });
    page1.drawText(formatDate(inspection.inspection_date), { x: xPos + 5, y: yPos - 24, size: 9, font: helveticaFont });

    yPos -= 30;

    // Row 3
    page1.drawRectangle({
      x: margin,
      y: yPos - 30,
      width: detailsTableWidth,
      height: 30,
      borderColor: mediumGray,
      borderWidth: 1,
    });
    
    xPos = margin;
    page1.drawText('Previous Inspector:', { x: xPos + 5, y: yPos - 12, size: 8, font: helveticaBold, color: mediumGray });
    page1.drawText(sanitizeText(inspection.previous_inspector), { x: xPos + 5, y: yPos - 24, size: 9, font: helveticaFont });
    
    page1.drawLine({
      start: { x: margin + col1Width, y: yPos },
      end: { x: margin + col1Width, y: yPos - 30 },
      thickness: 0.5,
      color: lightGray,
    });
    
    xPos = margin + col1Width + col2Width;
    page1.drawLine({
      start: { x: xPos, y: yPos },
      end: { x: xPos, y: yPos - 30 },
      thickness: 0.5,
      color: lightGray,
    });
    
    page1.drawText('Prev. Inspection Date:', { x: xPos + 5, y: yPos - 12, size: 8, font: helveticaBold, color: mediumGray });
    page1.drawText(formatDate(inspection.previous_inspection_date), { x: xPos + 5, y: yPos - 24, size: 9, font: helveticaFont });

    yPos -= 50;

    // Known Course History bordered box
    page1.drawText('Known Course History:', {
      x: margin,
      y: yPos,
      size: 11,
      font: helveticaBold,
      color: darkGray,
    });
    
    yPos -= 20;
    
    page1.drawRectangle({
      x: margin,
      y: yPos - 100,
      width: detailsTableWidth,
      height: 100,
      borderColor: mediumGray,
      borderWidth: 1.5,
    });

    drawWrappedText(page1, inspection.course_history || '', margin + 10, yPos - 15, detailsTableWidth - 20, {
      size: 9,
      lineHeight: 13,
    });

    yPos -= 120;

    // Inspection Criteria section
    page1.drawText('Inspection Criteria', {
      x: pageWidth / 2 - helveticaBold.widthOfTextAtSize('Inspection Criteria', 16) / 2,
      y: yPos,
      size: 16,
      font: helveticaBold,
      color: darkGray,
    });

    yPos -= 30;

    const criteriaItems = [
      { label: 'Acceptable', desc: 'The item or element has no discernible flaws and meets manufacturer standards' },
      { label: 'Acceptable with Comments', desc: 'The item has been noted by the inspector and should be monitored more closely' },
      { label: 'Needs Repair', desc: 'The item requires repair or maintenance prior to resuming normal operations' },
      { label: 'Critical Action Required', desc: 'The item requires immediate attention and cannot be used until repaired or replaced' }
    ];

    for (const item of criteriaItems) {
      page1.drawText(`${item.label}:`, {
        x: margin,
        y: yPos,
        size: 10,
        font: helveticaBold,
        color: black,
      });
      yPos = drawWrappedText(page1, item.desc, margin + 15, yPos - 14, pageWidth - 2 * margin - 15, {
        size: 9,
        lineHeight: 12,
      });
      yPos -= 8;
    }

    drawFooter(page1, 1);

    // ======================
    // PAGE 2: DEFINITIONS
    // ======================
    const page2 = pdfDoc.addPage([pageWidth, pageHeight]);
    drawHeader(page2);

    yPos = pageHeight - topMargin;

    page2.drawText('Inspection Definitions', {
      x: pageWidth / 2 - helveticaBold.widthOfTextAtSize('Inspection Definitions', 16) / 2,
      y: yPos,
      size: 16,
      font: helveticaBold,
      color: darkGray,
    });

    yPos -= 35;

    const definitions = [
      { term: 'Lifeline HDW', def: 'All hardware (pulleys, cable grabs, and trolleys) that connects the participant to the lifeline or zipline' },
      { term: 'Belay Device', def: 'Device used for lowering, arresting a fall, or belaying. Examples: Grigri, ATC, Figure 8' },
      { term: 'EAD', def: 'Energy Absorption Device' },
      { term: 'Kernmantle Rope', def: 'Rope with a braided sheath (mantle) over twisted parallel fibers (kern)' },
      { term: 'QCP', def: 'Qualified Course Professional - meets criteria outlined by ACCT' },
      { term: 'Tensioning System', def: 'Mechanical devices used to tighten cables on course and ziplines' }
    ];

    for (const def of definitions) {
      // Draw light background box
      const boxHeight = 35;
      page2.drawRectangle({
        x: margin,
        y: yPos - boxHeight,
        width: pageWidth - 2 * margin,
        height: boxHeight,
        color: rgb(0.97, 0.97, 0.97),
        borderColor: rgb(0.85, 0.85, 0.85),
        borderWidth: 0.5,
      });

      page2.drawText(def.term, {
        x: margin + 10,
        y: yPos - 15,
        size: 11,
        font: helveticaBold,
        color: darkGray,
      });

      drawWrappedText(page2, def.def, margin + 10, yPos - 28, pageWidth - 2 * margin - 20, {
        size: 9,
        lineHeight: 11,
      });

      yPos -= boxHeight + 5;
    }

    drawFooter(page2, 2);

    // ======================
    // PAGE 3: OPERATING SYSTEMS
    // ======================
    const page3 = pdfDoc.addPage([pageWidth, pageHeight]);
    drawHeader(page3);

    yPos = pageHeight - topMargin;

    page3.drawText('Operating Systems', {
      x: pageWidth / 2 - helveticaBold.widthOfTextAtSize('Operating Systems', 16) / 2,
      y: yPos,
      size: 16,
      font: helveticaBold,
      color: darkGray,
    });

    yPos -= 35;

    if (systems && systems.length > 0) {
      const systemRows = systems.map(s => [
        sanitizeText(s.system_name),
        sanitizeText(s.result),
        sanitizeText(s.comments)
      ]);

      yPos = drawTable(
        page3,
        yPos,
        ['System Name', 'Result', 'Comments'],
        systemRows,
        [180, 100, 232],
        { rowHeight: 30 }
      );
    } else {
      page3.drawText('No operating systems recorded', {
        x: margin,
        y: yPos,
        size: 10,
        font: helveticaFont,
        color: lightGray,
      });
    }

    yPos -= 30;

    page3.drawText('Disclaimer:', {
      x: margin,
      y: yPos,
      size: 9,
      font: helveticaBold,
      color: mediumGray,
    });
    yPos = drawWrappedText(page3, 'This inspection covers only the structural and operational components tested. Additional elements may exist that were not inspected.', margin, yPos - 12, pageWidth - 2 * margin, {
      size: 8,
      color: mediumGray,
      lineHeight: 11,
    });

    drawFooter(page3, 3);

    // ======================
    // PAGE 4: ZIPLINES
    // ======================
    const page4 = pdfDoc.addPage([pageWidth, pageHeight]);
    drawHeader(page4);

    yPos = pageHeight - topMargin;

    page4.drawText('Ziplines', {
      x: pageWidth / 2 - helveticaBold.widthOfTextAtSize('Ziplines', 16) / 2,
      y: yPos,
      size: 16,
      font: helveticaBold,
      color: darkGray,
    });

    yPos -= 35;

    if (ziplines && ziplines.length > 0) {
      const zipHeaders = ['Zipline', 'Length', 'Unload', 'Load', 'Result', 'Comments'];
      const zipColWidths = [90, 60, 60, 60, 70, 172];

      for (const zip of ziplines) {
        const row1 = [
          sanitizeText(zip.zipline_name),
          String(zip.cable_length || ''),
          String(zip.unload_tension || ''),
          String(zip.load_tension || ''),
          sanitizeText(zip.result),
          sanitizeText(zip.comments)
        ];

        yPos = drawTable(page4, yPos, zipHeaders, [row1], zipColWidths, { rowHeight: 28 });

        // Additional details row
        const detailText = `Cable: ${sanitizeText(zip.cable_type)} | Braking: ${sanitizeText(zip.braking_system)} | EAD: ${sanitizeText(zip.ead_system)}`;
        page4.drawRectangle({
          x: margin,
          y: yPos - 20,
          width: zipColWidths.reduce((a, b) => a + b, 0),
          height: 20,
          color: rgb(0.95, 0.95, 0.95),
          borderColor: lightGray,
          borderWidth: 0.5,
        });
        
        drawWrappedText(page4, detailText, margin + 6, yPos - 14, pageWidth - 2 * margin - 12, {
          size: 8,
          color: mediumGray,
        });

        yPos -= 25;
      }
    } else {
      page4.drawText('No ziplines recorded', {
        x: margin,
        y: yPos,
        size: 10,
        font: helveticaFont,
        color: lightGray,
      });
    }

    drawFooter(page4, 4);

    // ======================
    // PAGES 5-9: EQUIPMENT
    // ======================
    const equipmentCategories = [
      { name: 'HELMETS', category: 'Helmet' },
      { name: 'HARNESSES', category: 'Harness' },
      { name: 'LANYARDS', category: 'Lanyard' },
      { name: 'CONNECTORS (CARABINERS & QUICKLINKS)', category: 'Connector' },
      { name: 'KERNMANTLE ROPE', category: 'Rope' },
      { name: 'BELAY/DESCENT DEVICE', category: 'Belay Device' },
      { name: 'TROLLEYS AND PULLEYS', category: 'Trolley' },
      { name: 'OTHER EQUIPMENT', category: 'Other' }
    ];

    let currentPageNum = 5;
    let currentPage = pdfDoc.addPage([pageWidth, pageHeight]);
    drawHeader(currentPage);
    yPos = pageHeight - topMargin;

    for (const cat of equipmentCategories) {
      const items = equipment?.filter(e => e.equipment_category === cat.category) || [];

      // Check if we need a new page
      if (yPos < 200) {
        drawFooter(currentPage, currentPageNum);
        currentPageNum++;
        currentPage = pdfDoc.addPage([pageWidth, pageHeight]);
        drawHeader(currentPage);
        yPos = pageHeight - topMargin;
      }

      currentPage.drawText(cat.name, {
        x: margin,
        y: yPos,
        size: 14,
        font: helveticaBold,
        color: darkGray,
      });

      yPos -= 25;

      if (items.length > 0) {
        const equipRows = items.map(e => [
          sanitizeText(e.equipment_type),
          String(e.production_year || ''),
          String(e.quantity || ''),
          sanitizeText(e.result),
          sanitizeText(e.comments)
        ]);

        yPos = drawTable(
          currentPage,
          yPos,
          ['Type', 'Year', 'Qty', 'Result', 'Comments'],
          equipRows,
          [150, 50, 40, 90, 182],
          { rowHeight: 28 }
        );
      } else {
        currentPage.drawText('No items recorded', {
          x: margin,
          y: yPos,
          size: 9,
          font: helveticaFont,
          color: lightGray,
        });
        yPos -= 20;
      }

      yPos -= 20;
    }

    drawFooter(currentPage, currentPageNum);

    // ======================
    // PAGE 10: ACCT STANDARDS
    // ======================
    const page10 = pdfDoc.addPage([pageWidth, pageHeight]);
    drawHeader(page10);

    yPos = pageHeight - topMargin;

    page10.drawText('ACCT Operations Standards', {
      x: pageWidth / 2 - helveticaBold.widthOfTextAtSize('ACCT Operations Standards', 16) / 2,
      y: yPos,
      size: 16,
      font: helveticaBold,
      color: darkGray,
    });

    yPos -= 25;

    const instructionText = 'Indicate whether the following documentation is available and up to date:';
    yPos = drawWrappedText(page10, instructionText, margin, yPos, pageWidth - 2 * margin, {
      size: 10,
      lineHeight: 14,
    });

    yPos -= 25;

    const standardsList = [
      { name: 'Emergency Action Plans', ref: 'CH 1-4 P. 5' },
      { name: 'Challenge Course Use Logs', ref: 'CH 1-4 P. 5' },
      { name: 'Operations Manual specific to site', ref: 'CH 1-4 P. 6' },
      { name: 'Appropriate Signage', ref: 'CH 1-4 P. 6' },
      { name: 'Staff Training Logs', ref: 'CH 3-2 P. 46' },
      { name: 'Equipment Logs and Tracking', ref: 'CH 3-2 P. 46' },
      { name: 'Written Rescue Plan and Drill Schedule', ref: 'CH 3-3 P. 47-48' },
      { name: 'Pre Activity and Daily Inspection Logs', ref: 'CH 4-2 P. 58-59' },
      { name: 'Annual Inspection', ref: 'CH 4-2 P. 58-59' }
    ];

    const checkboxSize = 12;
    const rowHeight = 30;

    for (const std of standardsList) {
      const hasDoc = standards?.some(s => s.standard_name === std.name && s.has_documentation);

      // Draw row background
      page10.drawRectangle({
        x: margin,
        y: yPos - rowHeight,
        width: pageWidth - 2 * margin,
        height: rowHeight,
        borderColor: lightGray,
        borderWidth: 0.5,
      });

      // Standard name
      page10.drawText(std.name, {
        x: margin + 10,
        y: yPos - 18,
        size: 10,
        font: helveticaFont,
        color: black,
      });

      // Reference
      page10.drawText(std.ref, {
        x: margin + 260,
        y: yPos - 18,
        size: 8,
        font: helveticaFont,
        color: mediumGray,
      });

      // YES checkbox
      page10.drawRectangle({
        x: pageWidth - margin - 100,
        y: yPos - 20,
        width: checkboxSize,
        height: checkboxSize,
        borderColor: mediumGray,
        borderWidth: 1,
        color: hasDoc ? rgb(0, 0.6, 0) : undefined,
      });

      page10.drawText('YES', {
        x: pageWidth - margin - 82,
        y: yPos - 18,
        size: 9,
        font: helveticaFont,
      });

      // NO checkbox
      page10.drawRectangle({
        x: pageWidth - margin - 45,
        y: yPos - 20,
        width: checkboxSize,
        height: checkboxSize,
        borderColor: mediumGray,
        borderWidth: 1,
        color: !hasDoc ? rgb(0.7, 0.1, 0.1) : undefined,
      });

      page10.drawText('NO', {
        x: pageWidth - margin - 28,
        y: yPos - 18,
        size: 9,
        font: helveticaFont,
      });

      yPos -= rowHeight;
    }

    yPos -= 15;

    page10.drawText('Additional Comments:', {
      x: margin,
      y: yPos,
      size: 10,
      font: helveticaBold,
      color: darkGray,
    });

    yPos -= 15;

    const standardsComments = standards?.map(s => s.comments).filter(c => c).join('; ') || 'None';
    yPos = drawWrappedText(page10, standardsComments, margin, yPos, pageWidth - 2 * margin, {
      size: 9,
      lineHeight: 12,
    });

    yPos -= 20;

    const qcpNote = 'A QCP is a Qualified Course Professional that meets the criteria outlined by the ACCT. Operations & Emergency procedures must be written and specific to the site\'s local operations procedures.';
    yPos = drawWrappedText(page10, qcpNote, margin, yPos, pageWidth - 2 * margin, {
      size: 8,
      color: mediumGray,
      lineHeight: 11,
    });

    drawFooter(page10, 10);

    // ======================
    // PAGE 11: REPORT SUMMARY
    // ======================
    const page11 = pdfDoc.addPage([pageWidth, pageHeight]);
    drawHeader(page11);

    yPos = pageHeight - topMargin;

    page11.drawText('Report Summary', {
      x: pageWidth / 2 - helveticaBold.widthOfTextAtSize('Report Summary', 16) / 2,
      y: yPos,
      size: 16,
      font: helveticaBold,
      color: darkGray,
    });

    yPos -= 35;

    // Repairs performed
    page11.drawText('Repairs, Alterations performed during inspection:', {
      x: margin,
      y: yPos,
      size: 12,
      font: helveticaBold,
      color: darkGray,
    });

    yPos -= 18;

    yPos = drawWrappedText(page11, summary?.repairs_performed || 'None', margin, yPos, pageWidth - 2 * margin, {
      size: 10,
      lineHeight: 14,
    });

    yPos -= 25;

    // Critical actions
    page11.drawText('Critical Action Required:', {
      x: margin,
      y: yPos,
      size: 12,
      font: helveticaBold,
      color: darkGray,
    });

    yPos -= 18;

    yPos = drawWrappedText(page11, summary?.critical_actions || 'None', margin, yPos, pageWidth - 2 * margin, {
      size: 10,
      lineHeight: 14,
    });

    yPos -= 8;

    page11.drawText('*Critical Action = Required Changes Prior to use of Activity, Element, or Equipment', {
      x: margin,
      y: yPos,
      size: 8,
      font: helveticaFont,
      color: mediumGray,
    });

    yPos -= 25;

    // Future considerations
    page11.drawText('Future Considerations:', {
      x: margin,
      y: yPos,
      size: 12,
      font: helveticaBold,
      color: darkGray,
    });

    yPos -= 18;

    yPos = drawWrappedText(page11, summary?.future_considerations || 'None', margin, yPos, pageWidth - 2 * margin, {
      size: 10,
      lineHeight: 14,
    });

    yPos -= 25;

    // Next inspection date
    page11.drawText('Next inspection date:', {
      x: margin,
      y: yPos,
      size: 12,
      font: helveticaBold,
      color: darkGray,
    });

    yPos -= 18;

    page11.drawText(formatDate(summary?.next_inspection_date), {
      x: margin,
      y: yPos,
      size: 10,
      font: helveticaFont,
    });

    yPos -= 30;

    // Retirement guidelines
    page11.drawText('General Rope Works Inspection Retirement Guidelines:', {
      x: margin,
      y: yPos,
      size: 12,
      font: helveticaBold,
      color: darkGray,
    });

    yPos -= 18;

    page11.drawText('These are generalized and are not a substitute for the Pre use inspection.', {
      x: margin,
      y: yPos,
      size: 8,
      font: helveticaFont,
      color: mediumGray,
    });

    yPos -= 18;

    const guidelines = [
      'Harness: Manufacture maximum use or condition warranted at time of inspection',
      'Lanyards: Manufacture maximum use or condition warranted at time of inspection',
      'Kernmantle Rope = 5 years or 1000 loads when used with top rope systems',
      'Kernmantle Rope = 5 years or 300 loads, whichever comes first when used on aerial leap activities',
      'Helmets: Manufacture maximum use or condition warranted at time of inspection',
      'Pulleys, Trolleys, Carabiners, Belay/descent devices, Cable grabs: Manufacture maximum use or condition warranted at time of inspection'
    ];

    for (const guideline of guidelines) {
      page11.drawText('•', {
        x: margin,
        y: yPos,
        size: 10,
        font: helveticaFont,
      });

      yPos = drawWrappedText(page11, guideline, margin + 15, yPos, pageWidth - 2 * margin - 15, {
        size: 9,
        lineHeight: 13,
      });

      yPos -= 5;
    }

    drawFooter(page11, 11);

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
