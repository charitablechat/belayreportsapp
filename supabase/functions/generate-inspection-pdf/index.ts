import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { jsPDF } from "https://esm.sh/jspdf@2.5.1";
import "https://esm.sh/jspdf-autotable@3.8.2";

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

    // Helper functions
    const formatDate = (dateStr: string | null) => {
      if (!dateStr) return 'N/A';
      const date = new Date(dateStr);
      return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    };

    const stripHtml = (html: string | null) => {
      if (!html) return '';
      return html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
    };

    const inspectorName = `${inspectorProfile?.first_name || ''} ${inspectorProfile?.last_name || ''}`.trim() || 'Inspector';

    console.log('Creating PDF document with jsPDF...');

    // Create PDF
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'letter'
    });

    let yPos = 20;
    const leftMargin = 20;
    const rightMargin = 196;
    const pageWidth = 216;
    const pageHeight = 279;

    // Helper to add new page if needed
    const checkPageBreak = (spaceNeeded: number) => {
      if (yPos + spaceNeeded > pageHeight - 20) {
        doc.addPage();
        yPos = 20;
      }
    };

    // Helper to wrap text
    const addWrappedText = (text: string, x: number, maxWidth: number, fontSize: number = 10) => {
      doc.setFontSize(fontSize);
      const lines = doc.splitTextToSize(text, maxWidth);
      lines.forEach((line: string) => {
        checkPageBreak(7);
        doc.text(line, x, yPos);
        yPos += 5;
      });
    };

    // Header
    doc.setFontSize(18);
    doc.setTextColor(0, 51, 102);
    doc.setFont('helvetica', 'bold');
    doc.text('Challenge Course Inspection Report', pageWidth / 2, yPos, { align: 'center' });
    yPos += 8;

    doc.setFontSize(12);
    doc.setTextColor(102, 102, 102);
    doc.setFont('helvetica', 'normal');
    doc.text('Association for Challenge Course Technology (ACCT) Standards', pageWidth / 2, yPos, { align: 'center' });
    yPos += 6;

    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text('ACCT Accredited Vendor  •  Rope Works LLC', pageWidth / 2, yPos, { align: 'center' });
    yPos += 10;

    // Line separator
    doc.setDrawColor(0, 51, 102);
    doc.setLineWidth(0.5);
    doc.line(leftMargin, yPos, rightMargin, yPos);
    yPos += 8;

    // Facility Information
    doc.setFontSize(14);
    doc.setTextColor(0, 51, 102);
    doc.setFont('helvetica', 'bold');
    doc.text('Facility Information', leftMargin, yPos);
    yPos += 8;

    doc.setFontSize(10);
    doc.setTextColor(0, 0, 0);
    
    const facilityInfo = [
      ['Facility Name:', inspection.organization || 'N/A'],
      ['Location:', inspection.location || 'N/A'],
      ['Onsite Contact:', inspection.onsite_contact || 'N/A'],
      ['Inspection Date:', formatDate(inspection.inspection_date)],
      ['Inspector:', inspectorName],
      ['Previous Inspection:', `${formatDate(inspection.previous_inspection_date)} by ${inspection.previous_inspector || 'N/A'}`]
    ];

    facilityInfo.forEach(([label, value]) => {
      doc.setFont('helvetica', 'bold');
      doc.text(label, leftMargin, yPos);
      doc.setFont('helvetica', 'normal');
      const lines = doc.splitTextToSize(value, 120);
      lines.forEach((line: string, index: number) => {
        doc.text(line, leftMargin + 45, yPos + (index * 5));
      });
      yPos += Math.max(5, lines.length * 5);
    });

    // Course History
    if (inspection.course_history) {
      yPos += 5;
      checkPageBreak(20);
      doc.setFontSize(14);
      doc.setTextColor(0, 51, 102);
      doc.setFont('helvetica', 'bold');
      doc.text('Course History', leftMargin, yPos);
      yPos += 6;
      
      doc.setFontSize(10);
      doc.setTextColor(0, 0, 0);
      doc.setFont('helvetica', 'normal');
      addWrappedText(stripHtml(inspection.course_history), leftMargin, rightMargin - leftMargin);
      yPos += 5;
    }

    // Operating Systems
    if (systems && systems.length > 0) {
      doc.addPage();
      yPos = 20;
      
      doc.setFontSize(14);
      doc.setTextColor(0, 51, 102);
      doc.setFont('helvetica', 'bold');
      doc.text('Operating Systems', leftMargin, yPos);
      yPos += 8;

      // @ts-ignore - autoTable is added via plugin
      doc.autoTable({
        startY: yPos,
        head: [['System Name', 'Result', 'Comments']],
        body: systems.map(sys => [
          sys.system_name || sys.name || 'N/A',
          sys.result || 'N/A',
          stripHtml(sys.comments) || '-'
        ]),
        styles: { fontSize: 9, cellPadding: 3 },
        headStyles: { fillColor: [0, 51, 102], textColor: 255, fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [249, 249, 249] },
        columnStyles: {
          0: { cellWidth: 50 },
          1: { cellWidth: 30 },
          2: { cellWidth: 'auto' }
        },
        didParseCell: function (data: any) {
          if (data.section === 'body' && data.column.index === 1) {
            const result = data.cell.raw;
            if (result === 'Pass') data.cell.styles.textColor = [45, 80, 22];
            else if (result === 'Fail') data.cell.styles.textColor = [139, 0, 0];
            else data.cell.styles.textColor = [204, 102, 0];
            data.cell.styles.fontStyle = 'bold';
          }
        }
      });

      // @ts-ignore
      yPos = doc.lastAutoTable.finalY + 10;
    }

    // Ziplines
    if (ziplines && ziplines.length > 0) {
      checkPageBreak(40);
      if (yPos > pageHeight - 80) {
        doc.addPage();
        yPos = 20;
      }
      
      doc.setFontSize(14);
      doc.setTextColor(0, 51, 102);
      doc.setFont('helvetica', 'bold');
      doc.text('Ziplines', leftMargin, yPos);
      yPos += 8;

      // @ts-ignore
      doc.autoTable({
        startY: yPos,
        head: [['Name', 'Cable', 'Length', 'Braking', 'EAD', 'Result', 'Comments']],
        body: ziplines.map(zip => [
          zip.zipline_name || 'N/A',
          zip.cable_type || 'N/A',
          zip.cable_length ? `${zip.cable_length}ft` : 'N/A',
          zip.braking_system || 'N/A',
          zip.ead_system || 'N/A',
          zip.result || 'N/A',
          stripHtml(zip.comments) || '-'
        ]),
        styles: { fontSize: 8, cellPadding: 2 },
        headStyles: { fillColor: [0, 51, 102], textColor: 255, fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [249, 249, 249] },
        columnStyles: {
          0: { cellWidth: 25 },
          1: { cellWidth: 20 },
          2: { cellWidth: 15 },
          3: { cellWidth: 20 },
          4: { cellWidth: 15 },
          5: { cellWidth: 18 },
          6: { cellWidth: 'auto' }
        },
        didParseCell: function (data: any) {
          if (data.section === 'body' && data.column.index === 5) {
            const result = data.cell.raw;
            if (result === 'Pass') data.cell.styles.textColor = [45, 80, 22];
            else if (result === 'Fail') data.cell.styles.textColor = [139, 0, 0];
            else data.cell.styles.textColor = [204, 102, 0];
            data.cell.styles.fontStyle = 'bold';
          }
        }
      });

      // @ts-ignore
      yPos = doc.lastAutoTable.finalY + 10;
    }

    // Equipment by Category
    if (equipment && equipment.length > 0) {
      doc.addPage();
      yPos = 20;
      
      doc.setFontSize(14);
      doc.setTextColor(0, 51, 102);
      doc.setFont('helvetica', 'bold');
      doc.text('Equipment', leftMargin, yPos);
      yPos += 8;

      const categories = ['PPE', 'Hardware', 'Software', 'Belay Devices'];
      
      for (const category of categories) {
        const items = equipment.filter(e => e.equipment_category === category);
        if (items.length === 0) continue;

        checkPageBreak(40);
        
        doc.setFontSize(12);
        doc.setTextColor(0, 51, 102);
        doc.setFont('helvetica', 'bold');
        doc.text(category, leftMargin, yPos);
        yPos += 6;

        // @ts-ignore
        doc.autoTable({
          startY: yPos,
          head: [['Type', 'Qty', 'Year', 'Result', 'Comments']],
          body: items.map(eq => [
            eq.equipment_type || 'N/A',
            eq.quantity?.toString() || 'N/A',
            eq.production_year?.toString() || 'N/A',
            eq.result || 'N/A',
            stripHtml(eq.comments) || '-'
          ]),
          styles: { fontSize: 9, cellPadding: 2 },
          headStyles: { fillColor: [0, 51, 102], textColor: 255, fontStyle: 'bold' },
          alternateRowStyles: { fillColor: [249, 249, 249] },
          columnStyles: {
            0: { cellWidth: 40 },
            1: { cellWidth: 15 },
            2: { cellWidth: 15 },
            3: { cellWidth: 25 },
            4: { cellWidth: 'auto' }
          },
          didParseCell: function (data: any) {
            if (data.section === 'body' && data.column.index === 3) {
              const result = data.cell.raw;
              if (result === 'Pass') data.cell.styles.textColor = [45, 80, 22];
              else if (result === 'Fail') data.cell.styles.textColor = [139, 0, 0];
              else data.cell.styles.textColor = [204, 102, 0];
              data.cell.styles.fontStyle = 'bold';
            }
          }
        });

        // @ts-ignore
        yPos = doc.lastAutoTable.finalY + 8;
      }
    }

    // Standards
    if (standards && standards.length > 0) {
      doc.addPage();
      yPos = 20;
      
      doc.setFontSize(14);
      doc.setTextColor(0, 51, 102);
      doc.setFont('helvetica', 'bold');
      doc.text('Standards Compliance', leftMargin, yPos);
      yPos += 8;

      // @ts-ignore
      doc.autoTable({
        startY: yPos,
        head: [['Standard', 'Documentation', 'Comments']],
        body: standards.map(std => [
          std.standard_name || 'N/A',
          std.has_documentation ? 'Yes' : 'No',
          stripHtml(std.comments) || '-'
        ]),
        styles: { fontSize: 9, cellPadding: 3 },
        headStyles: { fillColor: [0, 51, 102], textColor: 255, fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [249, 249, 249] },
        columnStyles: {
          0: { cellWidth: 80 },
          1: { cellWidth: 35 },
          2: { cellWidth: 'auto' }
        }
      });

      // @ts-ignore
      yPos = doc.lastAutoTable.finalY + 10;
    }

    // Summary
    if (summary) {
      doc.addPage();
      yPos = 20;
      
      doc.setFontSize(14);
      doc.setTextColor(0, 51, 102);
      doc.setFont('helvetica', 'bold');
      doc.text('Summary', leftMargin, yPos);
      yPos += 8;

      if (summary.critical_actions) {
        doc.setFontSize(10);
        doc.setTextColor(139, 0, 0);
        doc.setFont('helvetica', 'bold');
        doc.text('Critical Actions Required:', leftMargin, yPos);
        yPos += 6;
        doc.setTextColor(0, 0, 0);
        doc.setFont('helvetica', 'normal');
        addWrappedText(stripHtml(summary.critical_actions), leftMargin, rightMargin - leftMargin);
        yPos += 5;
      }

      if (summary.repairs_performed) {
        checkPageBreak(20);
        doc.setFontSize(10);
        doc.setTextColor(0, 0, 0);
        doc.setFont('helvetica', 'bold');
        doc.text('Repairs Performed:', leftMargin, yPos);
        yPos += 6;
        doc.setFont('helvetica', 'normal');
        addWrappedText(stripHtml(summary.repairs_performed), leftMargin, rightMargin - leftMargin);
        yPos += 5;
      }

      if (summary.future_considerations) {
        checkPageBreak(20);
        doc.setFont('helvetica', 'bold');
        doc.text('Future Considerations:', leftMargin, yPos);
        yPos += 6;
        doc.setFont('helvetica', 'normal');
        addWrappedText(stripHtml(summary.future_considerations), leftMargin, rightMargin - leftMargin);
        yPos += 5;
      }

      if (summary.next_inspection_date) {
        checkPageBreak(10);
        doc.setFont('helvetica', 'bold');
        doc.text('Next Inspection Due:', leftMargin, yPos);
        doc.setFont('helvetica', 'normal');
        doc.text(formatDate(summary.next_inspection_date), leftMargin + 50, yPos);
        yPos += 8;
      }
    }

    // Disclaimer
    doc.addPage();
    yPos = 20;
    
    doc.setFillColor(255, 243, 205);
    doc.rect(leftMargin - 2, yPos - 5, rightMargin - leftMargin + 4, 30, 'F');
    
    doc.setFontSize(9);
    doc.setTextColor(0, 0, 0);
    doc.setFont('helvetica', 'bold');
    doc.text('DISCLAIMER:', leftMargin, yPos);
    yPos += 5;
    doc.setFont('helvetica', 'normal');
    const disclaimerText = 'This inspection report is based on visual observation and testing of the equipment and facilities at the time of inspection. The inspector makes no warranty, expressed or implied, that all defects have been discovered or that no defects exist other than those noted. This report does not constitute approval or acceptance of the facilities for any particular use.';
    const disclaimerLines = doc.splitTextToSize(disclaimerText, rightMargin - leftMargin - 2);
    disclaimerLines.forEach((line: string) => {
      doc.text(line, leftMargin, yPos);
      yPos += 4;
    });

    // Footer
    yPos += 15;
    doc.setFontSize(9);
    doc.setTextColor(102, 102, 102);
    doc.setFont('helvetica', 'bold');
    doc.text('Rope Works LLC', pageWidth / 2, yPos, { align: 'center' });
    yPos += 4;
    doc.setFont('helvetica', 'normal');
    doc.text('ACCT Accredited Vendor', pageWidth / 2, yPos, { align: 'center' });
    yPos += 4;
    doc.text(`Report Generated: ${formatDate(new Date().toISOString())}`, pageWidth / 2, yPos, { align: 'center' });

    console.log('PDF generated, converting to bytes...');

    // Get PDF as ArrayBuffer
    const pdfBytes = doc.output('arraybuffer');
    const pdfUint8Array = new Uint8Array(pdfBytes);

    console.log('Uploading to storage...');

    // Upload to storage
    const fileName = `inspection-${inspection.organization?.replace(/[^a-z0-9]/gi, '_')}-${Date.now()}.pdf`;
    const { error: uploadError } = await supabase.storage
      .from('inspection-reports')
      .upload(fileName, pdfUint8Array, {
        contentType: 'application/pdf',
        upsert: true
      });

    if (uploadError) throw uploadError;

    // Create signed URL
    const { data: signedUrlData, error: signedUrlError } = await supabase.storage
      .from('inspection-reports')
      .createSignedUrl(fileName, 3600);

    if (signedUrlError) throw signedUrlError;

    // Save to database
    await supabase
      .from('inspection_reports')
      .insert({
        inspection_id: inspectionId,
        pdf_url: fileName,
        generated_by: user.id,
        file_size_bytes: pdfUint8Array.length
      });

    console.log('Report saved successfully');

    return new Response(
      JSON.stringify({ pdfUrl: signedUrlData.signedUrl }),
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
