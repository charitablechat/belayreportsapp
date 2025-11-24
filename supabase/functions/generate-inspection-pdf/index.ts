import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// @ts-ignore - pdfmake types are incomplete
import pdfMake from "https://esm.sh/pdfmake@0.2.7/build/pdfmake.js";
// @ts-ignore - pdfmake types are incomplete
import pdfFonts from "https://esm.sh/pdfmake@0.2.7/build/vfs_fonts.js";

// Configure pdfMake fonts
// @ts-ignore - pdfmake types are incomplete
pdfMake.vfs = pdfFonts.pdfMake?.vfs || pdfFonts.vfs;

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

    console.log('Building PDF document definition...');

    // Build document content
    const content: any[] = [
      // Header
      {
        text: 'Challenge Course Inspection Report',
        style: 'header',
        alignment: 'center'
      },
      {
        text: 'Association for Challenge Course Technology (ACCT) Standards',
        style: 'subheader',
        alignment: 'center',
        margin: [0, 0, 0, 5]
      },
      {
        text: 'ACCT Accredited Vendor  •  Rope Works LLC',
        alignment: 'center',
        bold: true,
        color: '#003366',
        margin: [0, 0, 0, 20]
      },
      
      // Facility Information
      {
        text: 'Facility Information',
        style: 'sectionHeader'
      },
      {
        columns: [
          { width: 120, text: 'Facility Name:', bold: true },
          { width: '*', text: inspection.organization || 'N/A' }
        ],
        margin: [0, 0, 0, 5]
      },
      {
        columns: [
          { width: 120, text: 'Location:', bold: true },
          { width: '*', text: inspection.location || 'N/A' }
        ],
        margin: [0, 0, 0, 5]
      },
      {
        columns: [
          { width: 120, text: 'Onsite Contact:', bold: true },
          { width: '*', text: inspection.onsite_contact || 'N/A' }
        ],
        margin: [0, 0, 0, 5]
      },
      {
        columns: [
          { width: 120, text: 'Inspection Date:', bold: true },
          { width: '*', text: formatDate(inspection.inspection_date) }
        ],
        margin: [0, 0, 0, 5]
      },
      {
        columns: [
          { width: 120, text: 'Inspector:', bold: true },
          { width: '*', text: inspectorName }
        ],
        margin: [0, 0, 0, 5]
      },
      {
        columns: [
          { width: 120, text: 'Previous Inspection:', bold: true },
          { width: '*', text: `${formatDate(inspection.previous_inspection_date)} by ${inspection.previous_inspector || 'N/A'}` }
        ],
        margin: [0, 0, 0, 15]
      }
    ];

    // Course History
    if (inspection.course_history) {
      content.push(
        {
          text: 'Course History',
          style: 'sectionHeader',
          pageBreak: 'before'
        },
        {
          text: stripHtml(inspection.course_history),
          margin: [0, 0, 0, 15]
        }
      );
    }

    // Operating Systems
    if (systems && systems.length > 0) {
      content.push(
        {
          text: 'Operating Systems',
          style: 'sectionHeader',
          pageBreak: 'before'
        },
        {
          table: {
            headerRows: 1,
            widths: ['30%', '20%', '50%'],
            body: [
              [
                { text: 'System Name', style: 'tableHeader' },
                { text: 'Result', style: 'tableHeader' },
                { text: 'Comments', style: 'tableHeader' }
              ],
              ...systems.map(sys => [
                sys.system_name || sys.name || 'N/A',
                {
                  text: sys.result || 'N/A',
                  color: sys.result === 'Pass' ? '#2d5016' : sys.result === 'Fail' ? '#8b0000' : '#cc6600',
                  bold: true
                },
                stripHtml(sys.comments) || '-'
              ])
            ]
          },
          layout: {
            fillColor: function (rowIndex: number) {
              return rowIndex === 0 ? '#003366' : (rowIndex % 2 === 0 ? '#f9f9f9' : null);
            }
          },
          margin: [0, 0, 0, 15]
        }
      );
    }

    // Ziplines
    if (ziplines && ziplines.length > 0) {
      content.push(
        {
          text: 'Ziplines',
          style: 'sectionHeader',
          pageBreak: 'before'
        },
        {
          table: {
            headerRows: 1,
            widths: ['15%', '12%', '10%', '15%', '12%', '12%', '24%'],
            body: [
              [
                { text: 'Name', style: 'tableHeader' },
                { text: 'Cable Type', style: 'tableHeader' },
                { text: 'Length', style: 'tableHeader' },
                { text: 'Braking', style: 'tableHeader' },
                { text: 'EAD', style: 'tableHeader' },
                { text: 'Result', style: 'tableHeader' },
                { text: 'Comments', style: 'tableHeader' }
              ],
              ...ziplines.map(zip => [
                zip.zipline_name || 'N/A',
                zip.cable_type || 'N/A',
                zip.cable_length ? `${zip.cable_length}ft` : 'N/A',
                zip.braking_system || 'N/A',
                zip.ead_system || 'N/A',
                {
                  text: zip.result || 'N/A',
                  color: zip.result === 'Pass' ? '#2d5016' : zip.result === 'Fail' ? '#8b0000' : '#cc6600',
                  bold: true
                },
                stripHtml(zip.comments) || '-'
              ])
            ]
          },
          layout: {
            fillColor: function (rowIndex: number) {
              return rowIndex === 0 ? '#003366' : (rowIndex % 2 === 0 ? '#f9f9f9' : null);
            }
          },
          margin: [0, 0, 0, 15]
        }
      );
    }

    // Equipment by Category
    if (equipment && equipment.length > 0) {
      content.push({
        text: 'Equipment',
        style: 'sectionHeader',
        pageBreak: 'before'
      });

      const categories = ['PPE', 'Hardware', 'Software', 'Belay Devices'];
      
      for (const category of categories) {
        const items = equipment.filter(e => e.equipment_category === category);
        if (items.length === 0) continue;

        content.push(
          {
            text: category,
            style: 'categoryHeader',
            margin: [0, 10, 0, 5]
          },
          {
            table: {
              headerRows: 1,
              widths: ['25%', '15%', '15%', '15%', '30%'],
              body: [
                [
                  { text: 'Type', style: 'tableHeader' },
                  { text: 'Quantity', style: 'tableHeader' },
                  { text: 'Year', style: 'tableHeader' },
                  { text: 'Result', style: 'tableHeader' },
                  { text: 'Comments', style: 'tableHeader' }
                ],
                ...items.map(eq => [
                  eq.equipment_type || 'N/A',
                  eq.quantity?.toString() || 'N/A',
                  eq.production_year?.toString() || 'N/A',
                  {
                    text: eq.result || 'N/A',
                    color: eq.result === 'Pass' ? '#2d5016' : eq.result === 'Fail' ? '#8b0000' : '#cc6600',
                    bold: true
                  },
                  stripHtml(eq.comments) || '-'
                ])
              ]
            },
            layout: {
              fillColor: function (rowIndex: number) {
                return rowIndex === 0 ? '#003366' : (rowIndex % 2 === 0 ? '#f9f9f9' : null);
              }
            },
            margin: [0, 0, 0, 10]
          }
        );
      }
    }

    // Standards
    if (standards && standards.length > 0) {
      content.push(
        {
          text: 'Standards Compliance',
          style: 'sectionHeader',
          pageBreak: 'before'
        },
        {
          table: {
            headerRows: 1,
            widths: ['50%', '20%', '30%'],
            body: [
              [
                { text: 'Standard', style: 'tableHeader' },
                { text: 'Documentation', style: 'tableHeader' },
                { text: 'Comments', style: 'tableHeader' }
              ],
              ...standards.map(std => [
                std.standard_name || 'N/A',
                std.has_documentation ? '✓ Yes' : '✗ No',
                stripHtml(std.comments) || '-'
              ])
            ]
          },
          layout: {
            fillColor: function (rowIndex: number) {
              return rowIndex === 0 ? '#003366' : (rowIndex % 2 === 0 ? '#f9f9f9' : null);
            }
          },
          margin: [0, 0, 0, 15]
        }
      );
    }

    // Summary
    if (summary) {
      content.push({
        text: 'Summary',
        style: 'sectionHeader',
        pageBreak: 'before'
      });

      if (summary.critical_actions) {
        content.push(
          {
            text: 'Critical Actions Required:',
            bold: true,
            color: '#8b0000',
            margin: [0, 0, 0, 5]
          },
          {
            text: stripHtml(summary.critical_actions),
            margin: [0, 0, 0, 10]
          }
        );
      }

      if (summary.repairs_performed) {
        content.push(
          {
            text: 'Repairs Performed:',
            bold: true,
            margin: [0, 0, 0, 5]
          },
          {
            text: stripHtml(summary.repairs_performed),
            margin: [0, 0, 0, 10]
          }
        );
      }

      if (summary.future_considerations) {
        content.push(
          {
            text: 'Future Considerations:',
            bold: true,
            margin: [0, 0, 0, 5]
          },
          {
            text: stripHtml(summary.future_considerations),
            margin: [0, 0, 0, 10]
          }
        );
      }

      if (summary.next_inspection_date) {
        content.push({
          columns: [
            { width: 150, text: 'Next Inspection Due:', bold: true },
            { width: '*', text: formatDate(summary.next_inspection_date) }
          ],
          margin: [0, 10, 0, 0]
        });
      }
    }

    // Disclaimer
    content.push(
      {
        text: '',
        pageBreak: 'before'
      },
      {
        text: [
          { text: 'DISCLAIMER: ', bold: true },
          { text: 'This inspection report is based on visual observation and testing of the equipment and facilities at the time of inspection. The inspector makes no warranty, expressed or implied, that all defects have been discovered or that no defects exist other than those noted. This report does not constitute approval or acceptance of the facilities for any particular use.' }
        ],
        background: '#fff3cd',
        margin: [0, 0, 0, 20],
        padding: 10
      }
    );

    // Footer
    content.push({
      text: [
        { text: 'Rope Works LLC\n', bold: true },
        'ACCT Accredited Vendor\n',
        `Report Generated: ${formatDate(new Date().toISOString())}`
      ],
      alignment: 'center',
      fontSize: 9,
      color: '#666',
      margin: [0, 20, 0, 0]
    });

    // Document definition
    const docDefinition = {
      content,
      styles: {
        header: {
          fontSize: 18,
          bold: true,
          color: '#003366',
          margin: [0, 0, 0, 5] as [number, number, number, number]
        },
        subheader: {
          fontSize: 12,
          color: '#666'
        },
        sectionHeader: {
          fontSize: 14,
          bold: true,
          color: '#003366',
          margin: [0, 15, 0, 10] as [number, number, number, number]
        },
        categoryHeader: {
          fontSize: 12,
          bold: true,
          color: '#003366'
        },
        tableHeader: {
          color: 'white',
          fillColor: '#003366',
          bold: true
        }
      },
      defaultStyle: {
        fontSize: 10,
        lineHeight: 1.3
      },
      pageMargins: [54, 54, 54, 54] as [number, number, number, number]
    };

    console.log('Generating PDF with pdfMake...');

    // Generate PDF
    const pdfDocGenerator = pdfMake.createPdf(docDefinition);
    
    const pdfBytes = await new Promise<Uint8Array>((resolve, reject) => {
      pdfDocGenerator.getBuffer((buffer: Uint8Array) => {
        resolve(buffer);
      });
    });

    console.log('PDF generated, uploading to storage...');

    // Upload to storage
    const fileName = `inspection-${inspection.organization?.replace(/[^a-z0-9]/gi, '_')}-${Date.now()}.pdf`;
    const { error: uploadError } = await supabase.storage
      .from('inspection-reports')
      .upload(fileName, pdfBytes, {
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
        file_size_bytes: pdfBytes.length
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
