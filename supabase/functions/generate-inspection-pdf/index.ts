import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import puppeteer from "https://deno.land/x/puppeteer@16.2.0/mod.ts";

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

    const escapeHtml = (text: string) => {
      return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    };

    const inspectorName = `${inspectorProfile?.first_name || ''} ${inspectorProfile?.last_name || ''}`.trim() || 'Inspector';

    console.log('Generating HTML template...');

    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    @page { margin: 0.75in; size: letter; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { 
      font-family: Arial, sans-serif; 
      font-size: 10pt; 
      line-height: 1.4; 
      color: #000;
    }
    .header { 
      text-align: center; 
      margin-bottom: 20px; 
      padding-bottom: 15px;
      border-bottom: 3px solid #003366;
    }
    .header h1 { 
      font-size: 18pt; 
      color: #003366; 
      margin-bottom: 8px;
      font-weight: bold;
    }
    .header .subtitle { 
      font-size: 12pt; 
      color: #666; 
      margin-bottom: 12px;
    }
    .logos {
      display: flex;
      justify-content: center;
      gap: 30px;
      margin: 15px 0;
      font-weight: bold;
      color: #003366;
    }
    .section { 
      margin-bottom: 25px; 
      page-break-inside: avoid;
    }
    .section-title { 
      font-size: 14pt; 
      font-weight: bold; 
      color: #003366; 
      margin-bottom: 10px;
      padding-bottom: 5px;
      border-bottom: 2px solid #003366;
    }
    .info-grid { 
      display: grid; 
      grid-template-columns: 150px 1fr; 
      gap: 8px 15px; 
      margin-bottom: 15px;
    }
    .info-label { 
      font-weight: bold; 
      color: #333;
    }
    .info-value { 
      color: #000;
    }
    table { 
      width: 100%; 
      border-collapse: collapse; 
      margin: 10px 0;
      page-break-inside: auto;
    }
    th { 
      background-color: #003366; 
      color: white; 
      padding: 8px; 
      text-align: left; 
      font-weight: bold;
      font-size: 10pt;
    }
    td { 
      padding: 8px; 
      border: 1px solid #ddd;
      vertical-align: top;
    }
    tr { 
      page-break-inside: avoid;
    }
    tr:nth-child(even) { 
      background-color: #f9f9f9; 
    }
    .pass { color: #2d5016; font-weight: bold; }
    .fail { color: #8b0000; font-weight: bold; }
    .attention { color: #cc6600; font-weight: bold; }
    .comment { 
      font-style: italic; 
      color: #555; 
      font-size: 9pt;
      margin-top: 4px;
    }
    .footer { 
      margin-top: 30px; 
      padding-top: 15px; 
      border-top: 2px solid #003366; 
      text-align: center;
      font-size: 9pt;
      color: #666;
    }
    .disclaimer {
      background-color: #fff3cd;
      border: 1px solid #ffc107;
      padding: 12px;
      margin: 15px 0;
      font-size: 9pt;
      page-break-inside: avoid;
    }
    .page-break { page-break-after: always; }
    .category-heading {
      font-size: 12pt;
      font-weight: bold;
      color: #003366;
      margin: 20px 0 10px;
      padding-top: 15px;
      border-top: 1px solid #ccc;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>Challenge Course Inspection Report</h1>
    <div class="subtitle">Association for Challenge Course Technology (ACCT) Standards</div>
    <div class="logos">
      <div>ACCT Accredited Vendor</div>
      <div>•</div>
      <div>Rope Works LLC</div>
    </div>
  </div>

  <div class="section">
    <div class="section-title">Facility Information</div>
    <div class="info-grid">
      <div class="info-label">Facility Name:</div>
      <div class="info-value">${escapeHtml(inspection.organization || 'N/A')}</div>
      <div class="info-label">Location:</div>
      <div class="info-value">${escapeHtml(inspection.location || 'N/A')}</div>
      <div class="info-label">Onsite Contact:</div>
      <div class="info-value">${escapeHtml(inspection.onsite_contact || 'N/A')}</div>
      <div class="info-label">Inspection Date:</div>
      <div class="info-value">${formatDate(inspection.inspection_date)}</div>
      <div class="info-label">Inspector:</div>
      <div class="info-value">${escapeHtml(inspectorName)}</div>
      <div class="info-label">Previous Inspection:</div>
      <div class="info-value">${formatDate(inspection.previous_inspection_date)} by ${escapeHtml(inspection.previous_inspector || 'N/A')}</div>
    </div>
  </div>

  ${inspection.course_history ? `
  <div class="section">
    <div class="section-title">Course History</div>
    <div>${escapeHtml(stripHtml(inspection.course_history))}</div>
  </div>
  ` : ''}

  <div class="page-break"></div>

  ${systems && systems.length > 0 ? `
  <div class="section">
    <div class="section-title">Operating Systems</div>
    <table>
      <thead>
        <tr>
          <th style="width: 30%;">System Name</th>
          <th style="width: 20%;">Result</th>
          <th style="width: 50%;">Comments</th>
        </tr>
      </thead>
      <tbody>
        ${systems.map(sys => `
        <tr>
          <td>${escapeHtml(sys.system_name || sys.name || 'N/A')}</td>
          <td class="${sys.result === 'Pass' ? 'pass' : sys.result === 'Fail' ? 'fail' : 'attention'}">
            ${escapeHtml(sys.result || 'N/A')}
          </td>
          <td>${escapeHtml(stripHtml(sys.comments) || '-')}</td>
        </tr>
        `).join('')}
      </tbody>
    </table>
  </div>
  ` : ''}

  ${ziplines && ziplines.length > 0 ? `
  <div class="section">
    <div class="section-title">Ziplines</div>
    <table>
      <thead>
        <tr>
          <th>Zipline Name</th>
          <th>Cable Type</th>
          <th>Length (ft)</th>
          <th>Braking System</th>
          <th>EAD System</th>
          <th>Result</th>
          <th>Comments</th>
        </tr>
      </thead>
      <tbody>
        ${ziplines.map(zip => `
        <tr>
          <td>${escapeHtml(zip.zipline_name || 'N/A')}</td>
          <td>${escapeHtml(zip.cable_type || 'N/A')}</td>
          <td>${zip.cable_length || 'N/A'}</td>
          <td>${escapeHtml(zip.braking_system || 'N/A')}</td>
          <td>${escapeHtml(zip.ead_system || 'N/A')}</td>
          <td class="${zip.result === 'Pass' ? 'pass' : zip.result === 'Fail' ? 'fail' : 'attention'}">
            ${escapeHtml(zip.result || 'N/A')}
          </td>
          <td>${escapeHtml(stripHtml(zip.comments) || '-')}</td>
        </tr>
        `).join('')}
      </tbody>
    </table>
  </div>
  ` : ''}

  ${equipment && equipment.length > 0 ? `
  <div class="page-break"></div>
  <div class="section">
    <div class="section-title">Equipment</div>
    ${['PPE', 'Hardware', 'Software', 'Belay Devices'].map(category => {
      const items = equipment.filter(e => e.equipment_category === category);
      if (items.length === 0) return '';
      return `
      <div class="category-heading">${category}</div>
      <table>
        <thead>
          <tr>
            <th>Type</th>
            <th>Quantity</th>
            <th>Year</th>
            <th>Result</th>
            <th>Comments</th>
          </tr>
        </thead>
        <tbody>
          ${items.map(eq => `
          <tr>
            <td>${escapeHtml(eq.equipment_type || 'N/A')}</td>
            <td>${eq.quantity || 'N/A'}</td>
            <td>${eq.production_year || 'N/A'}</td>
            <td class="${eq.result === 'Pass' ? 'pass' : eq.result === 'Fail' ? 'fail' : 'attention'}">
              ${escapeHtml(eq.result || 'N/A')}
            </td>
            <td>${escapeHtml(stripHtml(eq.comments) || '-')}</td>
          </tr>
          `).join('')}
        </tbody>
      </table>
      `;
    }).join('')}
  </div>
  ` : ''}

  ${standards && standards.length > 0 ? `
  <div class="page-break"></div>
  <div class="section">
    <div class="section-title">Standards Compliance</div>
    <table>
      <thead>
        <tr>
          <th style="width: 50%;">Standard</th>
          <th style="width: 20%;">Documentation</th>
          <th style="width: 30%;">Comments</th>
        </tr>
      </thead>
      <tbody>
        ${standards.map(std => `
        <tr>
          <td>${escapeHtml(std.standard_name || 'N/A')}</td>
          <td>${std.has_documentation ? '✓ Yes' : '✗ No'}</td>
          <td>${escapeHtml(stripHtml(std.comments) || '-')}</td>
        </tr>
        `).join('')}
      </tbody>
    </table>
  </div>
  ` : ''}

  ${summary ? `
  <div class="page-break"></div>
  <div class="section">
    <div class="section-title">Summary</div>
    
    ${summary.critical_actions ? `
    <div style="margin-bottom: 15px;">
      <strong style="color: #8b0000;">Critical Actions Required:</strong>
      <div style="margin-top: 5px;">${escapeHtml(stripHtml(summary.critical_actions))}</div>
    </div>
    ` : ''}
    
    ${summary.repairs_performed ? `
    <div style="margin-bottom: 15px;">
      <strong>Repairs Performed:</strong>
      <div style="margin-top: 5px;">${escapeHtml(stripHtml(summary.repairs_performed))}</div>
    </div>
    ` : ''}
    
    ${summary.future_considerations ? `
    <div style="margin-bottom: 15px;">
      <strong>Future Considerations:</strong>
      <div style="margin-top: 5px;">${escapeHtml(stripHtml(summary.future_considerations))}</div>
    </div>
    ` : ''}
    
    ${summary.next_inspection_date ? `
    <div class="info-grid" style="margin-top: 20px;">
      <div class="info-label">Next Inspection Due:</div>
      <div class="info-value">${formatDate(summary.next_inspection_date)}</div>
    </div>
    ` : ''}
  </div>
  ` : ''}

  <div class="disclaimer">
    <strong>DISCLAIMER:</strong> This inspection report is based on visual observation and testing of the equipment and facilities at the time of inspection. The inspector makes no warranty, expressed or implied, that all defects have been discovered or that no defects exist other than those noted. This report does not constitute approval or acceptance of the facilities for any particular use.
  </div>

  <div class="footer">
    <div><strong>Rope Works LLC</strong></div>
    <div>ACCT Accredited Vendor</div>
    <div style="margin-top: 8px;">Report Generated: ${formatDate(new Date().toISOString())}</div>
  </div>
</body>
</html>
    `.trim();

    console.log('Launching headless browser...');
    const browser = await puppeteer.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });

    const page = await browser.newPage();
    await page.setContent(htmlContent, { waitUntil: 'networkidle0' });

    console.log('Converting HTML to PDF...');
    const pdfBytes = await page.pdf({
      format: 'Letter',
      printBackground: true,
      margin: {
        top: '0.75in',
        right: '0.75in',
        bottom: '0.75in',
        left: '0.75in',
      },
    });

    await browser.close();
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
