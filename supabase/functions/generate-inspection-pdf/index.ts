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
      supabase.from('inspection_summary').select('*').eq('inspection_id', inspectionId).single(),
      supabase.from('profiles').select('first_name, last_name').eq('id', inspection.inspector_id).single()
    ]);

    const pdfDoc = await PDFDocument.create();
    const helveticaFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    
    // Fetch and embed ACCT logo from public bucket
    let logoImage = null;
    try {
      const { data: logoFile } = await supabase.storage
        .from('inspection-photos')
        .download('acct-logo.jpg');
      
      if (logoFile) {
        const logoBytes = await logoFile.arrayBuffer();
        logoImage = await pdfDoc.embedJpg(new Uint8Array(logoBytes));
      }
    } catch (logoError) {
      console.error('Failed to load logo, will use text-only header:', logoError);
    }
    
    const pageWidth = 612;
    const pageHeight = 792;
    const margin = 50;

    const sanitizeText = (text: string): string => {
      if (!text) return '';
      return text
        .replace(/○/g, '•')
        .replace(/[^\x00-\xFF]/g, '?');
    };

    const drawText = (page: any, text: string, x: number, y: number, options: any = {}) => {
      text = sanitizeText(text);
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
        currentY -= (options.lineHeight || 14);
      }
      
      return currentY;
    };

    const drawPageFooter = (page: any, pageNumber: number) => {
      const footerText = "The information contained in this report has been documented by a Qualified Professional. This report is effective for one year from the date of inspection. Issued by:";
      const addressText = "Rope Works Inc., PO Box 1074, Dripping Springs, TX 78620";
      
      drawText(page, footerText, margin, 70, { size: 8, maxWidth: pageWidth - 2 * margin });
      drawText(page, addressText, margin, 50, { size: 8, bold: true });
      drawText(page, `${pageNumber}`, pageWidth / 2, 30, { size: 8 });
    };

    const drawACCTHeader = (page: any) => {
      // Draw logo if available
      if (logoImage) {
        const logoWidth = 40;
        const logoHeight = 40;
        page.drawImage(logoImage, {
          x: margin,
          y: pageHeight - margin - logoHeight,
          width: logoWidth,
          height: logoHeight,
        });
        
        // Position text next to logo
        page.drawText('ACCT', { x: margin + logoWidth + 10, y: pageHeight - margin - 10, size: 10, font: helveticaBold });
        page.drawText('ACCREDITED VENDOR', { x: margin + logoWidth + 10, y: pageHeight - margin - 24, size: 8, font: helveticaFont });
        page.drawText('ROPES/CHALLENGE COURSE', { x: margin + logoWidth + 10, y: pageHeight - margin - 36, size: 8, font: helveticaFont });
      } else {
        // Fallback to text-only header
        page.drawText('ACCT', { x: margin, y: pageHeight - margin - 10, size: 10, font: helveticaBold });
        page.drawText('ACCREDITED VENDOR', { x: margin, y: pageHeight - margin - 24, size: 8, font: helveticaFont });
        page.drawText('ROPES/CHALLENGE COURSE', { x: margin, y: pageHeight - margin - 36, size: 8, font: helveticaFont });
      }
    };

    const formatDate = (dateStr: string | null): string => {
      if (!dateStr) return '';
      const date = new Date(dateStr);
      return date.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
    };

    const inspectorName = inspectorProfile 
      ? `${inspectorProfile.first_name || ''} ${inspectorProfile.last_name || ''}`.trim() 
      : 'Unknown';

    // PAGE 1 - COVER PAGE
    const page1 = pdfDoc.addPage([pageWidth, pageHeight]);
    drawACCTHeader(page1);
    
    page1.drawText('Professional Inspection for Aerial Adventure Programs', {
      x: margin,
      y: pageHeight - 120,
      size: 16,
      font: helveticaBold,
    });

    let yPos = pageHeight - 160;
    const labelWidth = 180;
    const valueX = margin + labelWidth;

    page1.drawText('Organization:', { x: margin, y: yPos, size: 10, font: helveticaBold });
    page1.drawText(sanitizeText(inspection.organization || ''), { x: valueX, y: yPos, size: 10, font: helveticaFont });
    yPos -= 20;

    page1.drawText('Location:', { x: margin, y: yPos, size: 10, font: helveticaBold });
    page1.drawText(sanitizeText(inspection.location || ''), { x: valueX, y: yPos, size: 10, font: helveticaFont });
    yPos -= 20;

    page1.drawText('Onsite Contact:', { x: margin, y: yPos, size: 10, font: helveticaBold });
    page1.drawText(sanitizeText(inspection.onsite_contact || ''), { x: valueX, y: yPos, size: 10, font: helveticaFont });
    yPos -= 20;

    page1.drawText('Inspected by:', { x: margin, y: yPos, size: 10, font: helveticaBold });
    page1.drawText(sanitizeText(inspectorName), { x: valueX, y: yPos, size: 10, font: helveticaFont });
    yPos -= 20;

    page1.drawText('Date of Inspection:', { x: margin, y: yPos, size: 10, font: helveticaBold });
    page1.drawText(formatDate(inspection.inspection_date), { x: valueX, y: yPos, size: 10, font: helveticaFont });
    yPos -= 20;

    page1.drawText('Previously Inspector:', { x: margin, y: yPos, size: 10, font: helveticaBold });
    page1.drawText(sanitizeText(inspection.previous_inspector || ''), { x: valueX, y: yPos, size: 10, font: helveticaFont });
    yPos -= 20;

    page1.drawText('Prev. Inspection Date:', { x: margin, y: yPos, size: 10, font: helveticaBold });
    page1.drawText(formatDate(inspection.previous_inspection_date), { x: valueX, y: yPos, size: 10, font: helveticaFont });
    yPos -= 30;

    page1.drawText('Known Course History', { x: margin, y: yPos, size: 12, font: helveticaBold });
    yPos -= 20;
    yPos = drawText(page1, inspection.course_history || '', margin, yPos, { size: 9, lineHeight: 12 });
    yPos -= 20;

    const disclaimer = "This report covers the condition of the aerial adventure site for the date of inspection reflected on this form. The inspection provided is strictly an evaluation of the structural condition of the course elements and equipment. The inspection does not include training on how to operate the equipment, nor how to operate the course. The inspection only verifies the existence of written local operating procedures (LOP), an emergency action plan (EAP), and training documentation. The inspection does not perform a review or evaluate the LOP, EAP and training documentation. Potential problems can occur afterwards due to vandalism, improper use, weather, etc. Rope Works Inc. is not responsible for modifications or repairs made to the challenge course by anyone other than a Rope Works Inc. employee. We recommend you conduct your own periodic internal monitoring at a minimum on a quarterly basis. At a minimum an annual professional inspection is required by a qualified professional to be in compliance with the Association for Challenge Course Technology ANSI/ACCT current published standards.";
    yPos = drawText(page1, disclaimer, margin, yPos, { size: 8, lineHeight: 11 });
    yPos -= 20;

    page1.drawText('Reminders and Requirements', { x: margin, y: yPos, size: 11, font: helveticaBold });
    yPos -= 16;
    const reminders = [
      'Employers are required to issue staff appropriate fall protection for the duties to be performed.',
      'A Periodic Internal Monitoring of the aerial activities on your site shall be conducted by qualified personnel.',
      'Proper identification, tracking, and documentation of ALL equipment used for operations shall be kept and available at your annual professional inspection.',
      'Proper staff training should be provided for the operation of all aerial activities and equipment on your site.',
      'Operational Reviews shall be conducted once every five years.'
    ];
    for (const reminder of reminders) {
      page1.drawText('•', { x: margin, y: yPos, size: 10, font: helveticaFont });
      yPos = drawText(page1, reminder, margin + 15, yPos, { size: 8, lineHeight: 11, maxWidth: pageWidth - 2 * margin - 15 });
      yPos -= 5;
    }

    drawPageFooter(page1, 1);

    // PAGE 2 - INSPECTION CRITERIA
    const page2 = pdfDoc.addPage([pageWidth, pageHeight]);
    drawACCTHeader(page2);
    
    yPos = pageHeight - 80;
    page2.drawText('All inspections include the following when applicable:', { x: margin, y: yPos, size: 12, font: helveticaBold });
    yPos -= 25;

    const criteria = [
      { title: 'Lifeline HDW', text: 'Represents all hardware associated with the Life Safety System including but not limited to: wire rope, bolts, wire rope terminations, & redundant terminations.' },
      { title: 'Activity HDW', text: 'Represents all hardware associated with the element execution. This includes but is not limited to: foot cables, platforms, hand ropes/cables, boards, etc.' },
      { title: 'Environment', text: 'This represents the surrounding area of the activity/element. This includes but is not limited to: ground cover, trees, rocks, & terrain.' },
      { title: 'Equipment', text: 'This represents the equipment utilized in the operation of the course activities. This includes but is not limited to: rope, carabiners, helmets, belay devices, pulleys, trolleys, lanyards, etc.' }
    ];

    for (const item of criteria) {
      page2.drawText(item.title, { x: margin, y: yPos, size: 11, font: helveticaBold });
      yPos -= 16;
      yPos = drawText(page2, item.text, margin, yPos, { size: 9, lineHeight: 12 });
      yPos -= 18;
    }

    const ratingText = "This represents the overall rating for the system based on the condition of the items inspected on the day of the inspection. Rope Works Inc. inspects all challenge course and canopy/zip line tours to the standards set forth by the ACCT. Any deviation from the ACCT standards in regards to the inspection criteria will be addressed in the Comment section.";
    page2.drawText('Pass/Pass with Provisions/Fail', { x: margin, y: yPos, size: 11, font: helveticaBold });
    yPos -= 16;
    yPos = drawText(page2, ratingText, margin, yPos, { size: 9, lineHeight: 12 });
    yPos -= 20;

    page2.drawText('Inspection Key', { x: margin, y: yPos, size: 12, font: helveticaBold });
    yPos -= 20;

    const keyDefinitions = [
      { title: 'Pass', text: 'The equipment or operating system meets all manufacturer specifications, industry standards, and operational safety requirements at the time of inspection. No corrective actions are necessary. The item is approved for continued use until the next scheduled inspection.' },
      { 
        title: 'Pass with Provisions', 
        text: 'The equipment or operating system is generally in acceptable condition but requires minor corrective action, repair, or follow-up maintenance that does not pose an immediate safety concern.',
        bullets: [
          'A written comment will accompany any Pass with Provisions rating, detailing the issue and recommended corrective action.',
          'If the provision is not resolved or verified as corrected by time indicated or the next annual inspection, the item will be reclassified as a Fail until compliance is achieved.'
        ]
      },
      { title: 'Fail', text: 'The equipment or operating system does not meet minimum safety or operational standards and presents a potential or immediate hazard. The item must be removed from service and repaired, replaced, or corrected before being used again. Documentation of corrective actions is required prior to reinspection and approval for use.' },
      { title: 'N/A', text: 'Not applicable, Not inspected, or inaccessible/not available at the time of inspection.' }
    ];

    for (const def of keyDefinitions) {
      page2.drawText(def.title, { x: margin, y: yPos, size: 11, font: helveticaBold });
      yPos -= 16;
      yPos = drawText(page2, def.text, margin, yPos, { size: 9, lineHeight: 12 });
      
      if (def.bullets) {
        yPos -= 8;
        for (const bullet of def.bullets) {
          page2.drawText('•', { x: margin, y: yPos, size: 9, font: helveticaFont });
          yPos = drawText(page2, bullet, margin + 15, yPos, { size: 8, lineHeight: 11, maxWidth: pageWidth - 2 * margin - 15 });
          yPos -= 5;
        }
      }
      yPos -= 12;
    }

    drawPageFooter(page2, 2);

    // PAGE 3 - OPERATING SYSTEMS
    const page3 = pdfDoc.addPage([pageWidth, pageHeight]);
    drawACCTHeader(page3);
    
    yPos = pageHeight - 80;
    page3.drawText('Operating Systems', { x: margin, y: yPos, size: 14, font: helveticaBold });
    yPos -= 25;

    const tableStartY = yPos;
    const colWidths = [200, 120, 242];
    const rowHeight = 20;

    page3.drawRectangle({ x: margin, y: yPos - rowHeight, width: colWidths[0] + colWidths[1] + colWidths[2], height: rowHeight, borderColor: rgb(0, 0, 0), borderWidth: 1 });
    page3.drawText('Operating System Name', { x: margin + 5, y: yPos - 15, size: 10, font: helveticaBold });
    page3.drawRectangle({ x: margin + colWidths[0], y: yPos - rowHeight, width: colWidths[1], height: rowHeight, borderColor: rgb(0, 0, 0), borderWidth: 1 });
    page3.drawText('Result', { x: margin + colWidths[0] + 5, y: yPos - 15, size: 10, font: helveticaBold });
    page3.drawRectangle({ x: margin + colWidths[0] + colWidths[1], y: yPos - rowHeight, width: colWidths[2], height: rowHeight, borderColor: rgb(0, 0, 0), borderWidth: 1 });
    page3.drawText('Comments or Required Changes', { x: margin + colWidths[0] + colWidths[1] + 5, y: yPos - 15, size: 10, font: helveticaBold });
    
    yPos -= rowHeight;

    if (systems && systems.length > 0) {
      for (const system of systems) {
        page3.drawRectangle({ x: margin, y: yPos - rowHeight, width: colWidths[0], height: rowHeight, borderColor: rgb(0, 0, 0), borderWidth: 1 });
        page3.drawText(sanitizeText(system.system_name || ''), { x: margin + 5, y: yPos - 15, size: 9, font: helveticaFont });
        page3.drawRectangle({ x: margin + colWidths[0], y: yPos - rowHeight, width: colWidths[1], height: rowHeight, borderColor: rgb(0, 0, 0), borderWidth: 1 });
        page3.drawText(sanitizeText(system.result || ''), { x: margin + colWidths[0] + 5, y: yPos - 15, size: 9, font: helveticaFont });
        page3.drawRectangle({ x: margin + colWidths[0] + colWidths[1], y: yPos - rowHeight, width: colWidths[2], height: rowHeight, borderColor: rgb(0, 0, 0), borderWidth: 1 });
        page3.drawText(sanitizeText(system.comments || ''), { x: margin + colWidths[0] + colWidths[1] + 5, y: yPos - 15, size: 8, font: helveticaFont });
        yPos -= rowHeight;
      }
    }

    drawPageFooter(page3, 3);

    // PAGE 4 - ZIPLINES
    const page4 = pdfDoc.addPage([pageWidth, pageHeight]);
    drawACCTHeader(page4);
    
    yPos = pageHeight - 80;
    page4.drawText('SYSTEMS - ZIPLINES', { x: margin, y: yPos, size: 14, font: helveticaBold });
    yPos -= 20;

    const keys = [
      'Cable Type KEY: GAC = Galvanized Aircraft Cable, SS = Super Swaged',
      'Braking System KEY: ZS = Zip Stop, FB = Friction Break, SB = Spring Bank, G = Gravity',
      'EAD System KEY: ZS = Zip Step, AP = Auto P'
    ];
    for (const key of keys) {
      page4.drawText(key, { x: margin, y: yPos, size: 8, font: helveticaFont });
      yPos -= 12;
    }
    yPos -= 10;

    const zipColWidths = [80, 60, 70, 70, 80, 152];
    page4.drawRectangle({ x: margin, y: yPos - rowHeight, width: zipColWidths[0], height: rowHeight, borderColor: rgb(0, 0, 0), borderWidth: 1 });
    page4.drawText('Zip Line', { x: margin + 5, y: yPos - 15, size: 8, font: helveticaBold });
    page4.drawRectangle({ x: margin + zipColWidths[0], y: yPos - rowHeight, width: zipColWidths[1], height: rowHeight, borderColor: rgb(0, 0, 0), borderWidth: 1 });
    page4.drawText('Length', { x: margin + zipColWidths[0] + 5, y: yPos - 15, size: 8, font: helveticaBold });
    page4.drawRectangle({ x: margin + zipColWidths[0] + zipColWidths[1], y: yPos - rowHeight, width: zipColWidths[2], height: rowHeight, borderColor: rgb(0, 0, 0), borderWidth: 1 });
    page4.drawText('Unload', { x: margin + zipColWidths[0] + zipColWidths[1] + 5, y: yPos - 15, size: 8, font: helveticaBold });
    page4.drawRectangle({ x: margin + zipColWidths[0] + zipColWidths[1] + zipColWidths[2], y: yPos - rowHeight, width: zipColWidths[3], height: rowHeight, borderColor: rgb(0, 0, 0), borderWidth: 1 });
    page4.drawText('Load', { x: margin + zipColWidths[0] + zipColWidths[1] + zipColWidths[2] + 5, y: yPos - 15, size: 8, font: helveticaBold });
    page4.drawRectangle({ x: margin + zipColWidths[0] + zipColWidths[1] + zipColWidths[2] + zipColWidths[3], y: yPos - rowHeight, width: zipColWidths[4], height: rowHeight, borderColor: rgb(0, 0, 0), borderWidth: 1 });
    page4.drawText('Result', { x: margin + zipColWidths[0] + zipColWidths[1] + zipColWidths[2] + zipColWidths[3] + 5, y: yPos - 15, size: 8, font: helveticaBold });
    page4.drawRectangle({ x: margin + zipColWidths[0] + zipColWidths[1] + zipColWidths[2] + zipColWidths[3] + zipColWidths[4], y: yPos - rowHeight, width: zipColWidths[5], height: rowHeight, borderColor: rgb(0, 0, 0), borderWidth: 1 });
    page4.drawText('Comments', { x: margin + zipColWidths[0] + zipColWidths[1] + zipColWidths[2] + zipColWidths[3] + zipColWidths[4] + 5, y: yPos - 15, size: 8, font: helveticaBold });
    
    yPos -= rowHeight;

    if (ziplines && ziplines.length > 0) {
      for (const zip of ziplines) {
        const doubleRowHeight = rowHeight * 2;
        page4.drawRectangle({ x: margin, y: yPos - doubleRowHeight, width: zipColWidths[0], height: doubleRowHeight, borderColor: rgb(0, 0, 0), borderWidth: 1 });
        page4.drawText(sanitizeText(zip.zipline_name || ''), { x: margin + 5, y: yPos - 15, size: 8, font: helveticaFont });
        page4.drawRectangle({ x: margin + zipColWidths[0], y: yPos - doubleRowHeight, width: zipColWidths[1], height: doubleRowHeight, borderColor: rgb(0, 0, 0), borderWidth: 1 });
        page4.drawText((zip.cable_length || '').toString(), { x: margin + zipColWidths[0] + 5, y: yPos - 15, size: 8, font: helveticaFont });
        page4.drawRectangle({ x: margin + zipColWidths[0] + zipColWidths[1], y: yPos - doubleRowHeight, width: zipColWidths[2], height: doubleRowHeight, borderColor: rgb(0, 0, 0), borderWidth: 1 });
        page4.drawText((zip.unload_tension || '').toString(), { x: margin + zipColWidths[0] + zipColWidths[1] + 5, y: yPos - 15, size: 8, font: helveticaFont });
        page4.drawRectangle({ x: margin + zipColWidths[0] + zipColWidths[1] + zipColWidths[2], y: yPos - doubleRowHeight, width: zipColWidths[3], height: doubleRowHeight, borderColor: rgb(0, 0, 0), borderWidth: 1 });
        page4.drawText((zip.load_tension || '').toString(), { x: margin + zipColWidths[0] + zipColWidths[1] + zipColWidths[2] + 5, y: yPos - 15, size: 8, font: helveticaFont });
        page4.drawRectangle({ x: margin + zipColWidths[0] + zipColWidths[1] + zipColWidths[2] + zipColWidths[3], y: yPos - doubleRowHeight, width: zipColWidths[4], height: doubleRowHeight, borderColor: rgb(0, 0, 0), borderWidth: 1 });
        page4.drawText(sanitizeText(zip.result || ''), { x: margin + zipColWidths[0] + zipColWidths[1] + zipColWidths[2] + zipColWidths[3] + 5, y: yPos - 15, size: 8, font: helveticaFont });
        page4.drawRectangle({ x: margin + zipColWidths[0] + zipColWidths[1] + zipColWidths[2] + zipColWidths[3] + zipColWidths[4], y: yPos - doubleRowHeight, width: zipColWidths[5], height: doubleRowHeight, borderColor: rgb(0, 0, 0), borderWidth: 1 });
        page4.drawText(sanitizeText(zip.comments || ''), { x: margin + zipColWidths[0] + zipColWidths[1] + zipColWidths[2] + zipColWidths[3] + zipColWidths[4] + 5, y: yPos - 15, size: 7, font: helveticaFont });
        
        // Second row for cable/braking/ead
        page4.drawText('Cable:', { x: margin + 5, y: yPos - 35, size: 7, font: helveticaBold });
        page4.drawText(sanitizeText(zip.cable_type || ''), { x: margin + 35, y: yPos - 35, size: 7, font: helveticaFont });
        page4.drawText('Braking:', { x: margin + zipColWidths[0] + 5, y: yPos - 35, size: 7, font: helveticaBold });
        page4.drawText(sanitizeText(zip.braking_system || ''), { x: margin + zipColWidths[0] + 45, y: yPos - 35, size: 7, font: helveticaFont });
        page4.drawText('EAD:', { x: margin + zipColWidths[0] + zipColWidths[1] + 5, y: yPos - 35, size: 7, font: helveticaBold });
        page4.drawText(sanitizeText(zip.ead_system || ''), { x: margin + zipColWidths[0] + zipColWidths[1] + 30, y: yPos - 35, size: 7, font: helveticaFont });
        
        yPos -= doubleRowHeight;
      }
    }

    drawPageFooter(page4, 4);

    // EQUIPMENT PAGES (5-9)
    const equipmentCategories = [
      { name: 'HELMETS', category: 'Helmet', page: 5 },
      { name: 'HARNESSES', category: 'Harness', page: 6 },
      { name: 'LANYARDS', category: 'Lanyard', page: 7 },
      { name: 'CONNECTORS (CARABINERS & QUICKLINKS)', category: 'Connector', page: 7 },
      { name: 'KERNMANTLE ROPE', category: 'Rope', page: 7 },
      { name: 'BELAY/DESCENT DEVICE', category: 'Belay Device', page: 8 },
      { name: 'TROLLEYS AND PULLEYS', category: 'Trolley', page: 8 },
      { name: 'OTHER EQUIPMENT', category: 'Other', page: 9 }
    ];

    // Initialize first equipment page
    let currentPageNum = 5;
    let currentPage = pdfDoc.addPage([pageWidth, pageHeight]);
    drawACCTHeader(currentPage);
    let pageYPos = pageHeight - 80;

    for (const cat of equipmentCategories) {
      const items = equipment?.filter(e => e.equipment_category === cat.category) || [];
      
      if (cat.page !== currentPageNum) {
        drawPageFooter(currentPage, currentPageNum);
        currentPageNum = cat.page;
        currentPage = pdfDoc.addPage([pageWidth, pageHeight]);
        drawACCTHeader(currentPage);
        pageYPos = pageHeight - 80;
      }

      if (pageYPos < 150) {
        drawPageFooter(currentPage, currentPageNum);
        currentPageNum++;
        currentPage = pdfDoc.addPage([pageWidth, pageHeight]);
        drawACCTHeader(currentPage);
        pageYPos = pageHeight - 80;
      }

      currentPage.drawText(`EQUIPMENT - ${cat.name}`, { x: margin, y: pageYPos, size: 11, font: helveticaBold });
      pageYPos -= 20;

      const eqColWidths = [140, 80, 60, 80, 152];
      currentPage.drawRectangle({ x: margin, y: pageYPos - rowHeight, width: eqColWidths[0], height: rowHeight, borderColor: rgb(0, 0, 0), borderWidth: 1 });
      currentPage.drawText('Type', { x: margin + 5, y: pageYPos - 15, size: 9, font: helveticaBold });
      currentPage.drawRectangle({ x: margin + eqColWidths[0], y: pageYPos - rowHeight, width: eqColWidths[1], height: rowHeight, borderColor: rgb(0, 0, 0), borderWidth: 1 });
      currentPage.drawText('Prod. Year', { x: margin + eqColWidths[0] + 5, y: pageYPos - 15, size: 9, font: helveticaBold });
      currentPage.drawRectangle({ x: margin + eqColWidths[0] + eqColWidths[1], y: pageYPos - rowHeight, width: eqColWidths[2], height: rowHeight, borderColor: rgb(0, 0, 0), borderWidth: 1 });
      currentPage.drawText('Qty', { x: margin + eqColWidths[0] + eqColWidths[1] + 5, y: pageYPos - 15, size: 9, font: helveticaBold });
      currentPage.drawRectangle({ x: margin + eqColWidths[0] + eqColWidths[1] + eqColWidths[2], y: pageYPos - rowHeight, width: eqColWidths[3], height: rowHeight, borderColor: rgb(0, 0, 0), borderWidth: 1 });
      currentPage.drawText('Result', { x: margin + eqColWidths[0] + eqColWidths[1] + eqColWidths[2] + 5, y: pageYPos - 15, size: 9, font: helveticaBold });
      currentPage.drawRectangle({ x: margin + eqColWidths[0] + eqColWidths[1] + eqColWidths[2] + eqColWidths[3], y: pageYPos - rowHeight, width: eqColWidths[4], height: rowHeight, borderColor: rgb(0, 0, 0), borderWidth: 1 });
      currentPage.drawText('Comments', { x: margin + eqColWidths[0] + eqColWidths[1] + eqColWidths[2] + eqColWidths[3] + 5, y: pageYPos - 15, size: 9, font: helveticaBold });
      pageYPos -= rowHeight;

      for (const item of items) {
        if (pageYPos < 120) {
          drawPageFooter(currentPage, currentPageNum);
          currentPageNum++;
          currentPage = pdfDoc.addPage([pageWidth, pageHeight]);
          drawACCTHeader(currentPage);
          pageYPos = pageHeight - 80;
        }

        currentPage.drawRectangle({ x: margin, y: pageYPos - rowHeight, width: eqColWidths[0], height: rowHeight, borderColor: rgb(0, 0, 0), borderWidth: 1 });
        currentPage.drawText(sanitizeText(item.equipment_type || ''), { x: margin + 5, y: pageYPos - 15, size: 8, font: helveticaFont });
        currentPage.drawRectangle({ x: margin + eqColWidths[0], y: pageYPos - rowHeight, width: eqColWidths[1], height: rowHeight, borderColor: rgb(0, 0, 0), borderWidth: 1 });
        currentPage.drawText((item.production_year || '').toString(), { x: margin + eqColWidths[0] + 5, y: pageYPos - 15, size: 8, font: helveticaFont });
        currentPage.drawRectangle({ x: margin + eqColWidths[0] + eqColWidths[1], y: pageYPos - rowHeight, width: eqColWidths[2], height: rowHeight, borderColor: rgb(0, 0, 0), borderWidth: 1 });
        currentPage.drawText((item.quantity || '').toString(), { x: margin + eqColWidths[0] + eqColWidths[1] + 5, y: pageYPos - 15, size: 8, font: helveticaFont });
        currentPage.drawRectangle({ x: margin + eqColWidths[0] + eqColWidths[1] + eqColWidths[2], y: pageYPos - rowHeight, width: eqColWidths[3], height: rowHeight, borderColor: rgb(0, 0, 0), borderWidth: 1 });
        currentPage.drawText(sanitizeText(item.result || ''), { x: margin + eqColWidths[0] + eqColWidths[1] + eqColWidths[2] + 5, y: pageYPos - 15, size: 8, font: helveticaFont });
        currentPage.drawRectangle({ x: margin + eqColWidths[0] + eqColWidths[1] + eqColWidths[2] + eqColWidths[3], y: pageYPos - rowHeight, width: eqColWidths[4], height: rowHeight, borderColor: rgb(0, 0, 0), borderWidth: 1 });
        currentPage.drawText(sanitizeText(item.comments || ''), { x: margin + eqColWidths[0] + eqColWidths[1] + eqColWidths[2] + eqColWidths[3] + 5, y: pageYPos - 15, size: 7, font: helveticaFont });
        pageYPos -= rowHeight;
      }

      pageYPos -= 10;
    }

    drawPageFooter(currentPage, currentPageNum);

    // PAGE 10 - ACCT STANDARDS
    const page10 = pdfDoc.addPage([pageWidth, pageHeight]);
    drawACCTHeader(page10);
    
    yPos = pageHeight - 80;
    page10.drawText('ACCT Operations Standards Criteria', { x: margin, y: yPos, size: 13, font: helveticaBold });
    yPos -= 20;

    const standardsText = "The following documentation is currently required by the ANSI/ACCT 03-2019 Operations Standards. If your program does not have the following in existence it is noted below. It is your responsibility to ensure these are located or created and available. If these documents have been made available during the professional inspection it is noted below. It is important to recognize these documents are not reviewed by the professional inspector for content. They are only verified of their existence for program operations.";
    yPos = drawText(page10, standardsText, margin, yPos, { size: 9, lineHeight: 12 });
    yPos -= 20;

    const standardsList = [
      { name: 'Local Written Operations Procedures (CHPT 2. ANSI/ACCT B.2.4)', ref: 'Local Written Operations Procedures' },
      { name: 'Local Written Emergency Action Plan (CHPT 2 ANSI/ACCT B.2.5)', ref: 'Local Written Emergency Action Plan' },
      { name: 'Minimum Annual Training (CHPT 3 ANSI/ACCT B.1.2)', ref: 'Minimum Annual Training' },
      { name: 'Written Pre-Use Inspection in Use (CHPT 2 ANSI/ACCT B.2.13)', ref: 'Written Pre-Use Inspection' },
      { name: 'Inventory Tracking System in Use (CHPT 1 ANSI/ACCT I.3.2.1)', ref: 'Inventory Tracking System' },
      { name: 'Operational Review Every 5 Years (CHPT 2 ANSI/ACCT B.2.7)', ref: 'Operational Review' }
    ];

    const stdColWidths = [350, 50, 50];
    page10.drawRectangle({ x: margin, y: yPos - rowHeight, width: stdColWidths[0], height: rowHeight, borderColor: rgb(0, 0, 0), borderWidth: 1 });
    page10.drawText('Standard', { x: margin + 5, y: yPos - 15, size: 9, font: helveticaBold });
    page10.drawRectangle({ x: margin + stdColWidths[0], y: yPos - rowHeight, width: stdColWidths[1], height: rowHeight, borderColor: rgb(0, 0, 0), borderWidth: 1 });
    page10.drawText('YES', { x: margin + stdColWidths[0] + 10, y: yPos - 15, size: 9, font: helveticaBold });
    page10.drawRectangle({ x: margin + stdColWidths[0] + stdColWidths[1], y: yPos - rowHeight, width: stdColWidths[2], height: rowHeight, borderColor: rgb(0, 0, 0), borderWidth: 1 });
    page10.drawText('NO', { x: margin + stdColWidths[0] + stdColWidths[1] + 12, y: yPos - 15, size: 9, font: helveticaBold });
    yPos -= rowHeight;

    for (const std of standardsList) {
      const stdData = standards?.find(s => s.standard_name === std.ref);
      const hasDoc = stdData?.has_documentation || false;

      page10.drawRectangle({ x: margin, y: yPos - rowHeight, width: stdColWidths[0], height: rowHeight, borderColor: rgb(0, 0, 0), borderWidth: 1 });
      page10.drawText(std.name, { x: margin + 5, y: yPos - 15, size: 8, font: helveticaFont });
      page10.drawRectangle({ x: margin + stdColWidths[0], y: yPos - rowHeight, width: stdColWidths[1], height: rowHeight, borderColor: rgb(0, 0, 0), borderWidth: 1 });
      if (hasDoc) {
        page10.drawText('X', { x: margin + stdColWidths[0] + 18, y: yPos - 15, size: 10, font: helveticaBold });
      }
      page10.drawRectangle({ x: margin + stdColWidths[0] + stdColWidths[1], y: yPos - rowHeight, width: stdColWidths[2], height: rowHeight, borderColor: rgb(0, 0, 0), borderWidth: 1 });
      if (!hasDoc) {
        page10.drawText('X', { x: margin + stdColWidths[0] + stdColWidths[1] + 18, y: yPos - 15, size: 10, font: helveticaBold });
      }
      yPos -= rowHeight;
    }

    drawPageFooter(page10, 10);

    // PAGE 11 - REPORT SUMMARY
    const page11 = pdfDoc.addPage([pageWidth, pageHeight]);
    drawACCTHeader(page11);
    
    yPos = pageHeight - 80;
    const qcpText = "A QCP is a Qualified Course Professional that meets the criteria outlined by the ACCT. Operations & Emergency procedures must be written and specific to the site's local operations procedures.";
    yPos = drawText(page11, qcpText, margin, yPos, { size: 9, lineHeight: 12 });
    yPos -= 20;

    page11.drawText('Report Summary', { x: margin, y: yPos, size: 14, font: helveticaBold });
    yPos -= 25;

    page11.drawText('Repairs, Alterations performed during inspection:', { x: margin, y: yPos, size: 11, font: helveticaBold });
    yPos -= 16;
    yPos = drawText(page11, summary?.repairs_performed || '', margin, yPos, { size: 9, lineHeight: 12 });
    yPos -= 20;

    page11.drawText('Critical Action Required:', { x: margin, y: yPos, size: 11, font: helveticaBold });
    yPos -= 16;
    yPos = drawText(page11, summary?.critical_actions || '', margin, yPos, { size: 9, lineHeight: 12 });
    yPos -= 5;
    page11.drawText('*Critical Action = Required Changes Prior to use of Activity, Element, or Equipment', { x: margin, y: yPos, size: 8, font: helveticaFont });
    yPos -= 20;

    page11.drawText('Future Considerations:', { x: margin, y: yPos, size: 11, font: helveticaBold });
    yPos -= 16;
    yPos = drawText(page11, summary?.future_considerations || '', margin, yPos, { size: 9, lineHeight: 12 });
    yPos -= 20;

    page11.drawText('Next inspection date:', { x: margin, y: yPos, size: 11, font: helveticaBold });
    yPos -= 16;
    page11.drawText(formatDate(summary?.next_inspection_date), { x: margin, y: yPos, size: 10, font: helveticaFont });
    yPos -= 25;

    page11.drawText('General Rope Works Inspection Retirement Guidelines:', { x: margin, y: yPos, size: 11, font: helveticaBold });
    yPos -= 16;
    page11.drawText('These are generalized and are not a substitute for the Pre use inspection.', { x: margin, y: yPos, size: 8, font: helveticaFont });
    yPos -= 14;

    const guidelines = [
      'Harness: Manufacture maximum use or condition warranted at time of inspection',
      'Lanyards: Manufacture maximum use or condition warranted at time of inspection',
      'Kernmantle Rope = 5 years or 1000 loads when used with top rope systems',
      'Kernmantle Rope = 5 years or 300 loads, whichever comes first when used on aerial leap activities',
      'Helmets: Manufacture maximum use or condition warranted at time of inspection',
      'Pulleys, Trolleys, Carabiners, Belay/descent devices, Cable grabs: Manufacture maximum use or condition warranted at time of inspection'
    ];

    for (const guideline of guidelines) {
      page11.drawText('•', { x: margin, y: yPos, size: 9, font: helveticaFont });
      yPos = drawText(page11, guideline, margin + 15, yPos, { size: 8, lineHeight: 11, maxWidth: pageWidth - 2 * margin - 15 });
      yPos -= 5;
    }

    drawPageFooter(page11, 11);

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
        pdf: base64Pdf,
        fileName,
        size: pdfBytes.length,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (error) {
    console.error('Error generating PDF:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
