import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PDFDocument, StandardFonts, rgb, PDFPage } from "https://esm.sh/pdf-lib@1.17.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('Missing authorization header');
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      throw new Error('Unauthorized');
    }

    const { inspectionId } = await req.json();

    if (!inspectionId) {
      throw new Error('Inspection ID is required');
    }

    console.log('Fetching inspection data for:', inspectionId);

    // Fetch all data in parallel
    const [
      { data: inspection, error: inspectionError },
      { data: systems, error: systemsError },
      { data: ziplines, error: ziplinesError },
      { data: equipment, error: equipmentError },
      { data: standards, error: standardsError },
      { data: summary, error: summaryError },
      { data: inspectorProfile, error: profileError }
    ] = await Promise.all([
      supabase.from('inspections').select('*').eq('id', inspectionId).single(),
      supabase.from('inspection_systems').select('*').eq('inspection_id', inspectionId),
      supabase.from('inspection_ziplines').select('*').eq('inspection_id', inspectionId),
      supabase.from('inspection_equipment').select('*').eq('inspection_id', inspectionId),
      supabase.from('inspection_standards').select('*').eq('inspection_id', inspectionId),
      supabase.from('inspection_summary').select('*').eq('inspection_id', inspectionId).maybeSingle(),
      supabase.from('profiles').select('*').eq('id', user.id).single()
    ]);

    if (inspectionError) throw inspectionError;

    // Authorization check
    const isSuperAdmin = await supabase.from('user_roles').select('role').eq('user_id', user.id).eq('role', 'super_admin').single();
    if (!isSuperAdmin.data && inspection.inspector_id !== user.id) {
      throw new Error('Unauthorized to generate this report');
    }

    console.log('Generating PDF with pdf-lib...');

    // Generate PDF
    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const inspectorName = inspectorProfile 
      ? `${inspectorProfile.first_name || ''} ${inspectorProfile.last_name || ''}`.trim() || 'Inspector'
      : 'Inspector';

    // Create PDF helper
    const pdf = new PDFHelper(pdfDoc, font, boldFont);

    // Generate pages
    await pdf.createCoverPage(inspection, inspectorName);
    await pdf.createDefinitionsPage();
    await pdf.createSystemsPage(systems || []);
    
    if (ziplines && ziplines.length > 0) {
      await pdf.createZiplinesPage(ziplines);
    }
    
    if (equipment && equipment.length > 0) {
      await pdf.createEquipmentPage(equipment);
    }
    
    await pdf.createStandardsPage(standards || []);
    await pdf.createSummaryPage(summary, inspection);

    const pdfBytes = await pdfDoc.save();

    console.log('PDF generated, uploading to storage...');

    // Upload to storage
    const fileName = `inspection-${inspectionId}-${Date.now()}.pdf`;
    const { error: uploadError } = await supabase.storage
      .from('inspection-reports')
      .upload(fileName, pdfBytes, {
        contentType: 'application/pdf',
        upsert: true
      });

    if (uploadError) throw uploadError;

    // Create signed URL for secure access (expires in 1 hour)
    const { data: signedUrlData, error: signedUrlError } = await supabase.storage
      .from('inspection-reports')
      .createSignedUrl(fileName, 3600);

    if (signedUrlError) throw signedUrlError;
    const signedUrl = signedUrlData.signedUrl;

    // Save to database
    const { data: reportData, error: reportError } = await supabase
      .from('inspection_reports')
      .insert({
        inspection_id: inspectionId,
        pdf_url: fileName,
        generated_by: user.id,
        file_size_bytes: pdfBytes.length
      })
      .select()
      .single();

    if (reportError) throw reportError;

    console.log('Report saved successfully');

    return new Response(
      JSON.stringify({ pdfUrl: signedUrl }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    );

  } catch (error) {
    console.error('Error generating PDF:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500 
      }
    );
  }
});

// PDF Helper Class with reusable functions
class PDFHelper {
  private doc: PDFDocument;
  private font: any;
  private boldFont: any;
  private currentPage: PDFPage | null = null;
  private y: number = 0;
  
  // Layout constants
  private readonly MARGIN = 50;
  private readonly PAGE_WIDTH = 612; // Letter size width
  private readonly PAGE_HEIGHT = 792; // Letter size height
  private readonly CONTENT_WIDTH = 512; // PAGE_WIDTH - (MARGIN * 2)
  
  constructor(doc: PDFDocument, font: any, boldFont: any) {
    this.doc = doc;
    this.font = font;
    this.boldFont = boldFont;
  }

  private addPage(): PDFPage {
    this.currentPage = this.doc.addPage([this.PAGE_WIDTH, this.PAGE_HEIGHT]);
    this.y = this.PAGE_HEIGHT - this.MARGIN;
    return this.currentPage!;
  }

  private drawHeader(page: PDFPage) {
    // Draw header line
    page.drawLine({
      start: { x: this.MARGIN, y: this.PAGE_HEIGHT - 70 },
      end: { x: this.PAGE_WIDTH - this.MARGIN, y: this.PAGE_HEIGHT - 70 },
      thickness: 1,
      color: rgb(0.6, 0.6, 0.6),
    });

    // Center text
    page.drawText('ROPES/CHALLENGE COURSE', {
      x: this.PAGE_WIDTH / 2 - 80,
      y: this.PAGE_HEIGHT - 60,
      size: 10,
      font: this.font,
      color: rgb(0.4, 0.4, 0.4),
    });

    this.y = this.PAGE_HEIGHT - 90;
  }

  private drawFooter(page: PDFPage) {
    const footerText = 'The information contained in this report has been documented by a Qualified Professional. This report is effective for one year from the date of inspection. Issued by: Rope Works Inc., PO Box 1074, Dripping Springs, TX 78620';
    
    page.drawLine({
      start: { x: this.MARGIN, y: 40 },
      end: { x: this.PAGE_WIDTH - this.MARGIN, y: 40 },
      thickness: 1,
      color: rgb(0.8, 0.8, 0.8),
    });

    this.drawWrappedText(page, footerText, this.MARGIN, 30, this.CONTENT_WIDTH, 7, this.font);
  }

  private drawWrappedText(
    page: PDFPage, 
    text: string, 
    x: number, 
    y: number, 
    maxWidth: number, 
    size: number, 
    font: any,
    lineHeight: number = size * 1.3
  ): number {
    const sanitized = this.sanitizeText(text);
    const words = sanitized.split(' ');
    let line = '';
    let currentY = y;

    for (let i = 0; i < words.length; i++) {
      const testLine = line + words[i] + ' ';
      const width = font.widthOfTextAtSize(testLine, size);

      if (width > maxWidth && line.length > 0) {
        page.drawText(line.trim(), { x, y: currentY, size, font, color: rgb(0, 0, 0) });
        line = words[i] + ' ';
        currentY -= lineHeight;
      } else {
        line = testLine;
      }
    }

    if (line.trim().length > 0) {
      page.drawText(line.trim(), { x, y: currentY, size, font, color: rgb(0, 0, 0) });
    }

    return currentY - lineHeight;
  }

  private checkSpace(requiredSpace: number): PDFPage {
    if (!this.currentPage || this.y - requiredSpace < 60) {
      const newPage = this.addPage();
      this.drawHeader(newPage);
      this.drawFooter(newPage);
      return newPage;
    }
    return this.currentPage;
  }

  async createCoverPage(inspection: any, inspectorName: string) {
    const page = this.addPage();
    this.drawHeader(page);

    // Title
    page.drawText('Professional Inspection for Aerial Adventure Programs', {
      x: this.MARGIN + 30,
      y: this.y,
      size: 13,
      font: this.boldFont,
      color: rgb(0, 0, 0),
    });
    this.y -= 30;

    // Form fields helper
    const drawFormField = (label: string, value: string, x: number, width: number) => {
      page.drawText(label, {
        x,
        y: this.y,
        size: 9,
        font: this.font,
        color: rgb(0, 0, 0),
      });

      page.drawLine({
        start: { x, y: this.y - 15 },
        end: { x: x + width, y: this.y - 15 },
        thickness: 1,
        color: rgb(0, 0, 0),
      });

      page.drawText(this.sanitizeText(value), {
        x: x + 5,
        y: this.y - 12,
        size: 9,
        font: this.font,
        color: rgb(0, 0, 0),
      });
    };

    // Row 1: Organization, Location, Onsite Contact
    const fieldWidth = 150;
    drawFormField('Organization:', inspection.organization || '', this.MARGIN, fieldWidth);
    drawFormField('Location:', inspection.location || '', this.MARGIN + fieldWidth + 20, fieldWidth);
    drawFormField('Onsite Contact:', inspection.onsite_contact || '', this.MARGIN + (fieldWidth + 20) * 2, 130);
    this.y -= 35;

    // Row 2: Inspector, Inspection Date
    drawFormField('Inspected by:', inspectorName, this.MARGIN, 240);
    drawFormField('Date of Inspection:', this.formatDate(inspection.inspection_date), this.MARGIN + 260, 240);
    this.y -= 35;

    // Row 3: Previous Inspector, Previous Date
    drawFormField('Previously Inspector:', inspection.previous_inspector || '', this.MARGIN, 240);
    drawFormField('Prev. Inspection Date:', inspection.previous_inspection_date ? this.formatDate(inspection.previous_inspection_date) : 'N/A', this.MARGIN + 260, 240);
    this.y -= 40;

    // Course History Box
    page.drawText('Known Course History', {
      x: this.MARGIN,
      y: this.y,
      size: 10,
      font: this.boldFont,
      color: rgb(0, 0, 0),
    });
    this.y -= 15;

    page.drawRectangle({
      x: this.MARGIN,
      y: this.y - 55,
      width: this.CONTENT_WIDTH,
      height: 60,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });

    if (inspection.course_history) {
      this.drawWrappedText(page, inspection.course_history, this.MARGIN + 5, this.y - 10, this.CONTENT_WIDTH - 10, 9, this.font);
    }
    this.y -= 75;

    // Disclaimer
    const disclaimer = 'This report covers the condition of the aerial adventure site for the date of inspection reflected on this form. The inspection provided is strictly an evaluation of the structural condition of the course elements and equipment. The inspection does not include training on how to operate the equipment, nor how to operate the course. The inspection only verifies the existence of written local operating procedures (LOP), an emergency action plan (EAP), and training documentation. The inspection does not perform a review or evaluate the LOP, EAP and training documentation. Potential problems can occur afterwards due to vandalism, improper use, weather, etc. Rope Works Inc. is not responsible for modifications or repairs made to the challenge course by anyone other than a Rope Works Inc. employee. We recommend you conduct your own periodic internal monitoring at a minimum on a quarterly basis. At a minimum an annual professional inspection is required by a qualified professional to be in compliance with the Association for Challenge Course Technology ANSI/ACCT current published standards.';
    this.y = this.drawWrappedText(page, disclaimer, this.MARGIN, this.y, this.CONTENT_WIDTH, 8, this.font, 10);
    this.y -= 15;

    // Reminders
    page.drawText('Reminders and Requirements', {
      x: this.MARGIN,
      y: this.y,
      size: 10,
      font: this.boldFont,
      color: rgb(0, 0, 0),
    });
    this.y -= 15;

    const reminders = [
      'Employers are required to issue staff appropriate fall protection for the duties to be performed.',
      'A Periodic Internal Monitoring of the aerial activities on your site shall be conducted by qualified personnel.',
      'Proper identification, tracking, and documentation of ALL equipment used for operations shall be kept and available at your annual professional inspection.',
      'Proper staff training should be provided for the operation of all aerial activities and equipment on your site.',
      'Operational Reviews shall be conducted once every five years.'
    ];

    for (const reminder of reminders) {
      page.drawText('•', {
        x: this.MARGIN,
        y: this.y,
        size: 8,
        font: this.font,
        color: rgb(0, 0, 0),
      });
      this.y = this.drawWrappedText(page, reminder, this.MARGIN + 15, this.y, this.CONTENT_WIDTH - 15, 8, this.font, 10);
      this.y -= 5;
    }

    this.drawFooter(page);
  }

  async createDefinitionsPage() {
    const page = this.addPage();
    this.drawHeader(page);

    page.drawText('All inspections include the following when applicable:', {
      x: this.MARGIN,
      y: this.y,
      size: 11,
      font: this.boldFont,
      color: rgb(0, 0, 0),
    });
    this.y -= 20;

    const definitions = [
      {
        term: 'Lifeline HDW',
        def: 'Represents all hardware associated with the Life Safety System including but not limited to: wire rope, bolts, wire rope terminations, & redundant terminations.'
      },
      {
        term: 'Activity HDW',
        def: 'Represents all hardware associated with the element execution. This includes but is not limited to: foot cables, platforms, hand ropes/cables, boards, etc.'
      },
      {
        term: 'Environment',
        def: 'This represents the surrounding area of the activity/element. This includes but is not limited to: ground cover, trees, rocks, & terrain.'
      },
      {
        term: 'Equipment',
        def: 'This represents the equipment utilized in the operation of the course activities. This includes but is not limited to: rope, carabiners, helmets, belay devices, pulleys, trolleys, lanyards, etc.'
      },
      {
        term: 'Pass/Pass with Provisions/Fail',
        def: 'This represents the overall rating for the system based on the condition of the items inspected on the day of the inspection. Rope Works Inc. inspects all challenge course and canopy/zip line tours to the standards set forth by the ACCT. Any deviation from the ACCT standards in regards to the inspection criteria will be addressed in the Comment section.'
      }
    ];

    for (const { term, def } of definitions) {
      const page = this.checkSpace(50);
      
      page.drawText(term, {
        x: this.MARGIN,
        y: this.y,
        size: 10,
        font: this.boldFont,
        color: rgb(0, 0, 0),
      });
      this.y -= 13;

      this.y = this.drawWrappedText(page, def, this.MARGIN, this.y, this.CONTENT_WIDTH, 9, this.font, 11);
      this.y -= 15;
    }

    this.y -= 10;
    page.drawText('Inspection Key', {
      x: this.MARGIN,
      y: this.y,
      size: 11,
      font: this.boldFont,
      color: rgb(0, 0, 0),
    });
    this.y -= 20;

    const inspectionKey = [
      {
        term: 'Pass',
        def: 'The equipment or operating system meets all manufacturer specifications, industry standards, and operational safety requirements at the time of inspection. No corrective actions are necessary. The item is approved for continued use until the next scheduled inspection.'
      },
      {
        term: 'Pass with Provisions',
        def: 'The equipment or operating system is generally in acceptable condition but requires minor corrective action, repair, or follow-up maintenance that does not pose an immediate safety concern.'
      },
      {
        term: 'Fail',
        def: 'The equipment or operating system does not meet current safety standards or manufacturer specifications and poses a potential safety risk. Immediate corrective action is required before the item can be returned to service.'
      }
    ];

    for (const { term, def } of inspectionKey) {
      const page = this.checkSpace(50);
      
      page.drawText(term, {
        x: this.MARGIN,
        y: this.y,
        size: 10,
        font: this.boldFont,
        color: rgb(0, 0, 0),
      });
      this.y -= 13;

      this.y = this.drawWrappedText(page, def, this.MARGIN, this.y, this.CONTENT_WIDTH, 9, this.font, 11);
      this.y -= 15;
    }

    this.drawFooter(this.currentPage!);
  }

  async createSystemsPage(systems: any[]) {
    let page = this.addPage();
    this.drawHeader(page);

    page.drawText('Operating Systems', {
      x: this.MARGIN,
      y: this.y,
      size: 11,
      font: this.boldFont,
      color: rgb(0, 0, 0),
    });
    this.y -= 20;

    if (systems.length === 0) {
      page.drawText('No operating systems recorded for this inspection.', {
        x: this.MARGIN,
        y: this.y,
        size: 9,
        font: this.font,
        color: rgb(0, 0, 0),
      });
    } else {
      // Table headers
      const colWidths = [150, 100, 262];
      const colX = [this.MARGIN, this.MARGIN + colWidths[0], this.MARGIN + colWidths[0] + colWidths[1]];
      const rowHeight = 25;

      // Draw header row
      page.drawRectangle({
        x: this.MARGIN,
        y: this.y - rowHeight,
        width: this.CONTENT_WIDTH,
        height: rowHeight,
        color: rgb(0.91, 0.91, 0.91),
        borderColor: rgb(0.6, 0.6, 0.6),
        borderWidth: 1,
      });

      page.drawText('System Name', {
        x: colX[0] + 5,
        y: this.y - 17,
        size: 9,
        font: this.boldFont,
        color: rgb(0, 0, 0),
      });

      page.drawText('Result', {
        x: colX[1] + 5,
        y: this.y - 17,
        size: 9,
        font: this.boldFont,
        color: rgb(0, 0, 0),
      });

      page.drawText('Comments', {
        x: colX[2] + 5,
        y: this.y - 17,
        size: 9,
        font: this.boldFont,
        color: rgb(0, 0, 0),
      });

      this.y -= rowHeight;

      // Draw data rows
      for (const sys of systems) {
        page = this.checkSpace(rowHeight + 10);

        page.drawRectangle({
          x: this.MARGIN,
          y: this.y - rowHeight,
          width: colWidths[0],
          height: rowHeight,
          borderColor: rgb(0.6, 0.6, 0.6),
          borderWidth: 1,
        });

        page.drawRectangle({
          x: colX[1],
          y: this.y - rowHeight,
          width: colWidths[1],
          height: rowHeight,
          borderColor: rgb(0.6, 0.6, 0.6),
          borderWidth: 1,
        });

        page.drawRectangle({
          x: colX[2],
          y: this.y - rowHeight,
          width: colWidths[2],
          height: rowHeight,
          borderColor: rgb(0.6, 0.6, 0.6),
          borderWidth: 1,
        });

        page.drawText(this.truncate(sys.system_name || sys.name, 25), {
          x: colX[0] + 5,
          y: this.y - 17,
          size: 9,
          font: this.font,
          color: rgb(0, 0, 0),
        });

        page.drawText(this.truncate(sys.result, 15), {
          x: colX[1] + 5,
          y: this.y - 17,
          size: 9,
          font: this.font,
          color: rgb(0, 0, 0),
        });

        page.drawText(this.truncate(sys.comments || '', 40), {
          x: colX[2] + 5,
          y: this.y - 17,
          size: 9,
          font: this.font,
          color: rgb(0, 0, 0),
        });

        this.y -= rowHeight;
      }
    }

    this.drawFooter(this.currentPage!);
  }

  async createZiplinesPage(ziplines: any[]) {
    let page = this.addPage();
    this.drawHeader(page);

    page.drawText('Ziplines', {
      x: this.MARGIN,
      y: this.y,
      size: 11,
      font: this.boldFont,
      color: rgb(0, 0, 0),
    });
    this.y -= 20;

    // Simplified table for ziplines
    const rowHeight = 25;

    // Header
    page.drawRectangle({
      x: this.MARGIN,
      y: this.y - rowHeight,
      width: this.CONTENT_WIDTH,
      height: rowHeight,
      color: rgb(0.91, 0.91, 0.91),
      borderColor: rgb(0.6, 0.6, 0.6),
      borderWidth: 1,
    });

    page.drawText('Name', { x: this.MARGIN + 5, y: this.y - 17, size: 8, font: this.boldFont });
    page.drawText('Cable Type', { x: this.MARGIN + 100, y: this.y - 17, size: 8, font: this.boldFont });
    page.drawText('Result', { x: this.MARGIN + 200, y: this.y - 17, size: 8, font: this.boldFont });
    page.drawText('Comments', { x: this.MARGIN + 280, y: this.y - 17, size: 8, font: this.boldFont });

    this.y -= rowHeight;

    for (const zip of ziplines) {
      page = this.checkSpace(rowHeight + 10);

      page.drawRectangle({
        x: this.MARGIN,
        y: this.y - rowHeight,
        width: this.CONTENT_WIDTH,
        height: rowHeight,
        borderColor: rgb(0.6, 0.6, 0.6),
        borderWidth: 1,
      });

      page.drawText(this.truncate(zip.zipline_name, 15), { x: this.MARGIN + 5, y: this.y - 17, size: 8, font: this.font });
      page.drawText(this.truncate(zip.cable_type || '', 15), { x: this.MARGIN + 100, y: this.y - 17, size: 8, font: this.font });
      page.drawText(this.truncate(zip.result, 12), { x: this.MARGIN + 200, y: this.y - 17, size: 8, font: this.font });
      page.drawText(this.truncate(zip.comments || '', 35), { x: this.MARGIN + 280, y: this.y - 17, size: 8, font: this.font });

      this.y -= rowHeight;
    }

    this.drawFooter(this.currentPage!);
  }

  async createEquipmentPage(equipment: any[]) {
    let page = this.addPage();
    this.drawHeader(page);

    page.drawText('Equipment', {
      x: this.MARGIN,
      y: this.y,
      size: 11,
      font: this.boldFont,
      color: rgb(0, 0, 0),
    });
    this.y -= 20;

    // Group by category
    const categories = [...new Set(equipment.map(e => e.equipment_category))];

    for (const category of categories) {
      page = this.checkSpace(100);

      page.drawText(this.sanitizeText(category), {
        x: this.MARGIN,
        y: this.y,
        size: 10,
        font: this.boldFont,
        color: rgb(0, 0, 0),
      });
      this.y -= 18;

      const items = equipment.filter(e => e.equipment_category === category);
      const rowHeight = 25;

      // Header
      page.drawRectangle({
        x: this.MARGIN,
        y: this.y - rowHeight,
        width: this.CONTENT_WIDTH,
        height: rowHeight,
        color: rgb(0.91, 0.91, 0.91),
        borderColor: rgb(0.6, 0.6, 0.6),
        borderWidth: 1,
      });

      page.drawText('Type', { x: this.MARGIN + 5, y: this.y - 17, size: 9, font: this.boldFont });
      page.drawText('Qty', { x: this.MARGIN + 200, y: this.y - 17, size: 9, font: this.boldFont });
      page.drawText('Year', { x: this.MARGIN + 250, y: this.y - 17, size: 9, font: this.boldFont });
      page.drawText('Result', { x: this.MARGIN + 310, y: this.y - 17, size: 9, font: this.boldFont });

      this.y -= rowHeight;

      for (const item of items) {
        page = this.checkSpace(rowHeight + 10);

        page.drawRectangle({
          x: this.MARGIN,
          y: this.y - rowHeight,
          width: this.CONTENT_WIDTH,
          height: rowHeight,
          borderColor: rgb(0.6, 0.6, 0.6),
          borderWidth: 1,
        });

        page.drawText(this.truncate(item.equipment_type, 30), { x: this.MARGIN + 5, y: this.y - 17, size: 9, font: this.font });
        page.drawText(String(item.quantity || 'N/A'), { x: this.MARGIN + 200, y: this.y - 17, size: 9, font: this.font });
        page.drawText(String(item.production_year || 'N/A'), { x: this.MARGIN + 250, y: this.y - 17, size: 9, font: this.font });
        page.drawText(this.truncate(item.result, 15), { x: this.MARGIN + 310, y: this.y - 17, size: 9, font: this.font });

        this.y -= rowHeight;
      }

      this.y -= 10;
    }

    this.drawFooter(this.currentPage!);
  }

  async createStandardsPage(standards: any[]) {
    let page = this.addPage();
    this.drawHeader(page);

    page.drawText('ACCT Standards', {
      x: this.MARGIN,
      y: this.y,
      size: 11,
      font: this.boldFont,
      color: rgb(0, 0, 0),
    });
    this.y -= 20;

    if (standards.length === 0) {
      page.drawText('No standards recorded for this inspection.', {
        x: this.MARGIN,
        y: this.y,
        size: 9,
        font: this.font,
        color: rgb(0, 0, 0),
      });
    } else {
      const rowHeight = 25;

      // Header
      page.drawRectangle({
        x: this.MARGIN,
        y: this.y - rowHeight,
        width: this.CONTENT_WIDTH,
        height: rowHeight,
        color: rgb(0.91, 0.91, 0.91),
        borderColor: rgb(0.6, 0.6, 0.6),
        borderWidth: 1,
      });

      page.drawText('Standard Name', { x: this.MARGIN + 5, y: this.y - 17, size: 9, font: this.boldFont });
      page.drawText('Documentation', { x: this.MARGIN + 220, y: this.y - 17, size: 9, font: this.boldFont });
      page.drawText('Comments', { x: this.MARGIN + 330, y: this.y - 17, size: 9, font: this.boldFont });

      this.y -= rowHeight;

      for (const std of standards) {
        page = this.checkSpace(rowHeight + 10);

        page.drawRectangle({
          x: this.MARGIN,
          y: this.y - rowHeight,
          width: this.CONTENT_WIDTH,
          height: rowHeight,
          borderColor: rgb(0.6, 0.6, 0.6),
          borderWidth: 1,
        });

        page.drawText(this.truncate(std.standard_name, 30), { x: this.MARGIN + 5, y: this.y - 17, size: 9, font: this.font });
        page.drawText(std.has_documentation ? 'Yes' : 'No', { x: this.MARGIN + 255, y: this.y - 17, size: 9, font: this.font });
        page.drawText(this.truncate(std.comments || '', 25), { x: this.MARGIN + 330, y: this.y - 17, size: 9, font: this.font });

        this.y -= rowHeight;
      }
    }

    this.drawFooter(this.currentPage!);
  }

  async createSummaryPage(summary: any, inspection: any) {
    let page = this.addPage();
    this.drawHeader(page);

    page.drawText('Summary', {
      x: this.MARGIN,
      y: this.y,
      size: 11,
      font: this.boldFont,
      color: rgb(0, 0, 0),
    });
    this.y -= 20;

    // Repairs Performed
    page.drawText('Repairs Performed', {
      x: this.MARGIN,
      y: this.y,
      size: 10,
      font: this.boldFont,
      color: rgb(0, 0, 0),
    });
    this.y -= 15;

    page.drawRectangle({
      x: this.MARGIN,
      y: this.y - 55,
      width: this.CONTENT_WIDTH,
      height: 60,
      borderColor: rgb(0.6, 0.6, 0.6),
      borderWidth: 1,
    });

    if (summary?.repairs_performed) {
      this.drawWrappedText(page, summary.repairs_performed, this.MARGIN + 5, this.y - 10, this.CONTENT_WIDTH - 10, 9, this.font);
    }
    this.y -= 75;

    // Critical Actions
    page = this.checkSpace(100);
    page.drawText('Critical Actions', {
      x: this.MARGIN,
      y: this.y,
      size: 10,
      font: this.boldFont,
      color: rgb(0, 0, 0),
    });
    this.y -= 15;

    page.drawRectangle({
      x: this.MARGIN,
      y: this.y - 55,
      width: this.CONTENT_WIDTH,
      height: 60,
      borderColor: rgb(0.6, 0.6, 0.6),
      borderWidth: 1,
    });

    if (summary?.critical_actions) {
      this.drawWrappedText(page, summary.critical_actions, this.MARGIN + 5, this.y - 10, this.CONTENT_WIDTH - 10, 9, this.font);
    }
    this.y -= 75;

    // Future Considerations
    page = this.checkSpace(100);
    page.drawText('Future Considerations', {
      x: this.MARGIN,
      y: this.y,
      size: 10,
      font: this.boldFont,
      color: rgb(0, 0, 0),
    });
    this.y -= 15;

    page.drawRectangle({
      x: this.MARGIN,
      y: this.y - 55,
      width: this.CONTENT_WIDTH,
      height: 60,
      borderColor: rgb(0.6, 0.6, 0.6),
      borderWidth: 1,
    });

    if (summary?.future_considerations) {
      this.drawWrappedText(page, summary.future_considerations, this.MARGIN + 5, this.y - 10, this.CONTENT_WIDTH - 10, 9, this.font);
    }
    this.y -= 75;

    // Next Inspection Date
    page = this.checkSpace(40);
    page.drawText('Next Inspection Date:', {
      x: this.MARGIN,
      y: this.y,
      size: 9,
      font: this.font,
      color: rgb(0, 0, 0),
    });

    page.drawLine({
      start: { x: this.MARGIN, y: this.y - 15 },
      end: { x: this.PAGE_WIDTH - this.MARGIN, y: this.y - 15 },
      thickness: 1,
      color: rgb(0, 0, 0),
    });

    page.drawText(summary?.next_inspection_date ? this.formatDate(summary.next_inspection_date) : 'Not specified', {
      x: this.MARGIN + 5,
      y: this.y - 12,
      size: 9,
      font: this.font,
      color: rgb(0, 0, 0),
    });

    this.drawFooter(this.currentPage!);
  }

  private formatDate(dateString: string): string {
    if (!dateString) return '';
    const date = new Date(dateString);
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const year = date.getFullYear();
    return `${month}/${day}/${year}`;
  }

  private truncate(text: string, maxLength: number): string {
    if (!text) return '';
    const sanitized = this.sanitizeText(text);
    return sanitized.length > maxLength ? sanitized.substring(0, maxLength - 3) + '...' : sanitized;
  }

  private sanitizeText(text: string): string {
    if (!text) return '';
    // Replace newlines, tabs, and other control characters with spaces
    // Also replace any other characters that WinAnsi can't encode
    return text
      .replace(/[\n\r\t]/g, ' ')  // Replace newlines and tabs with spaces
      .replace(/[^\x20-\x7E\xA0-\xFF]/g, '')  // Remove characters outside WinAnsi range
      .replace(/\s+/g, ' ')  // Collapse multiple spaces
      .trim();
  }
}
