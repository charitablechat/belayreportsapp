import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

    console.log('Fetching inspection data for HTML generation:', inspectionId);

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
      let text = html.replace(/<[^>]*>/g, '');
      text = text.replace(/&amp;/g, '&');
      text = text.replace(/&lt;/g, '<');
      text = text.replace(/&gt;/g, '>');
      text = text.replace(/&quot;/g, '"');
      text = text.replace(/&#39;/g, "'");
      text = text.replace(/&nbsp;/g, ' ');
      return text.trim();
    };

    const inspectorName = `${inspectorProfile?.first_name || ''} ${inspectorProfile?.last_name || ''}`.trim() || 'Inspector';

    // Generate HTML
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Inspection Report - ${stripHtml(inspection.organization)}</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      line-height: 1.6;
      color: #333;
      background: #f5f5f5;
      padding: 20px;
    }
    .container {
      max-width: 1200px;
      margin: 0 auto;
      background: white;
      padding: 40px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.1);
    }
    .header {
      background: #1e40af;
      color: white;
      padding: 30px;
      text-align: center;
      margin: -40px -40px 30px -40px;
    }
    .logo {
      max-width: 150px;
      margin-bottom: 15px;
    }
    h1 {
      font-size: 32px;
      margin-bottom: 5px;
    }
    .subtitle {
      font-size: 18px;
      opacity: 0.9;
    }
    .section {
      margin-bottom: 30px;
    }
    .section-title {
      background: #1e40af;
      color: white;
      padding: 12px 20px;
      font-size: 18px;
      font-weight: 600;
      margin-bottom: 15px;
      border-radius: 4px;
    }
    .standards-box {
      background: #dbeafe;
      padding: 15px;
      border-radius: 4px;
      margin-bottom: 30px;
      color: #1e40af;
      font-size: 14px;
      line-height: 1.6;
    }
    .info-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 15px;
      margin-bottom: 15px;
    }
    .info-item {
      padding: 12px;
      background: #f8fafc;
      border-left: 3px solid #1e40af;
    }
    .info-label {
      font-weight: 600;
      color: #475569;
      font-size: 13px;
      margin-bottom: 4px;
    }
    .info-value {
      color: #1e293b;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 20px;
    }
    th {
      background: #1e40af;
      color: white;
      padding: 12px;
      text-align: left;
      font-weight: 600;
    }
    td {
      padding: 10px 12px;
      border-bottom: 1px solid #e2e8f0;
    }
    tr:nth-child(even) {
      background: #f8fafc;
    }
    .result-pass {
      color: #16a34a;
      font-weight: 600;
    }
    .result-fail {
      color: #dc2626;
      font-weight: 600;
    }
    .result-repair {
      color: #ea580c;
      font-weight: 600;
    }
    .text-content {
      padding: 15px;
      background: #f8fafc;
      border-radius: 4px;
      white-space: pre-wrap;
      line-height: 1.8;
      margin-bottom: 15px;
    }
    .critical-actions {
      background: #fee2e2;
      border-left: 4px solid #dc2626;
      padding: 15px;
      border-radius: 4px;
      margin-bottom: 20px;
    }
    .critical-title {
      color: #dc2626;
      font-weight: 700;
      margin-bottom: 10px;
      font-size: 16px;
    }
    .footer {
      margin-top: 40px;
      padding-top: 20px;
      border-top: 2px solid #e2e8f0;
      text-align: center;
      color: #64748b;
      font-size: 12px;
    }
    .category-title {
      color: #1e40af;
      font-size: 16px;
      font-weight: 600;
      margin: 20px 0 10px 0;
    }
    @media print {
      body {
        background: white;
        padding: 0;
      }
      .container {
        box-shadow: none;
        padding: 20px;
      }
    }
    @media (max-width: 768px) {
      .info-grid {
        grid-template-columns: 1fr;
      }
      .container {
        padding: 20px;
      }
      table {
        font-size: 14px;
      }
      th, td {
        padding: 8px;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <img src="https://ssgzcgvygnsrqalisshx.supabase.co/storage/v1/object/public/pdf-templates/rope-works-logo.png" alt="Rope Works Logo" class="logo">
      <h1>ROPE WORKS INC.</h1>
      <div class="subtitle">Challenge Course Inspection Report</div>
    </div>

    <div class="section">
      <div class="section-title">Facility Information</div>
      <div class="info-grid">
        <div class="info-item">
          <div class="info-label">Facility Name</div>
          <div class="info-value">${stripHtml(inspection.organization)}</div>
        </div>
        <div class="info-item">
          <div class="info-label">Location</div>
          <div class="info-value">${stripHtml(inspection.location)}</div>
        </div>
        <div class="info-item">
          <div class="info-label">Onsite Contact</div>
          <div class="info-value">${stripHtml(inspection.onsite_contact) || 'N/A'}</div>
        </div>
        <div class="info-item">
          <div class="info-label">Inspection Date</div>
          <div class="info-value">${formatDate(inspection.inspection_date)}</div>
        </div>
        <div class="info-item">
          <div class="info-label">Inspector</div>
          <div class="info-value">${inspectorName}</div>
        </div>
        <div class="info-item">
          <div class="info-label">Previous Inspection</div>
          <div class="info-value">${formatDate(inspection.previous_inspection_date)} by ${stripHtml(inspection.previous_inspector) || 'N/A'}</div>
        </div>
      </div>
      ${inspection.course_history ? `
        <div style="margin-top: 15px;">
          <div class="info-label" style="margin-bottom: 8px;">Course History</div>
          <div class="text-content">${stripHtml(inspection.course_history)}</div>
        </div>
      ` : ''}
    </div>

    <div class="standards-box">
      This inspection was conducted in accordance with Association for Challenge Course Technology (ACCT) Standards (ANSI/ACCT 03-2016 and ANSI/ACCT 03-2019) and industry best practices.
    </div>

    ${systems && systems.length > 0 ? `
    <div class="section">
      <div class="section-title">Operating Systems</div>
      <table>
        <thead>
          <tr>
            <th>System Name</th>
            <th>Result</th>
            <th>Comments</th>
          </tr>
        </thead>
        <tbody>
          ${systems.map(sys => `
            <tr>
              <td>${stripHtml(sys.system_name || sys.name)}</td>
              <td class="result-${sys.result?.toLowerCase()}">${sys.result || 'N/A'}</td>
              <td>${stripHtml(sys.comments) || '-'}</td>
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
            <th>Name</th>
            <th>Cable Type</th>
            <th>Length</th>
            <th>Braking</th>
            <th>EAD</th>
            <th>Result</th>
            <th>Comments</th>
          </tr>
        </thead>
        <tbody>
          ${ziplines.map(zip => `
            <tr>
              <td>${stripHtml(zip.zipline_name)}</td>
              <td>${stripHtml(zip.cable_type) || 'N/A'}</td>
              <td>${zip.cable_length ? zip.cable_length + 'ft' : 'N/A'}</td>
              <td>${stripHtml(zip.braking_system) || 'N/A'}</td>
              <td>${stripHtml(zip.ead_system) || 'N/A'}</td>
              <td class="result-${zip.result?.toLowerCase()}">${zip.result || 'N/A'}</td>
              <td>${stripHtml(zip.comments) || '-'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
    ` : ''}

    ${equipment && equipment.length > 0 ? `
    <div class="section">
      <div class="section-title">Equipment</div>
      ${['PPE', 'Hardware', 'Software', 'Belay Devices'].map(category => {
        const items = equipment.filter(e => e.equipment_category === category);
        if (items.length === 0) return '';
        return `
          <div class="category-title">${category}</div>
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
                  <td>${stripHtml(eq.equipment_type)}</td>
                  <td>${eq.quantity || 'N/A'}</td>
                  <td>${eq.production_year || 'N/A'}</td>
                  <td class="result-${eq.result?.toLowerCase()}">${eq.result || 'N/A'}</td>
                  <td>${stripHtml(eq.comments) || '-'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        `;
      }).join('')}
    </div>
    ` : ''}

    ${standards && standards.length > 0 ? `
    <div class="section">
      <div class="section-title">Standards Compliance</div>
      <table>
        <thead>
          <tr>
            <th>Standard</th>
            <th>Documentation</th>
            <th>Comments</th>
          </tr>
        </thead>
        <tbody>
          ${standards.map(std => `
            <tr>
              <td>${stripHtml(std.standard_name)}</td>
              <td>${std.has_documentation ? 'Yes' : 'No'}</td>
              <td>${stripHtml(std.comments) || '-'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
    ` : ''}

    ${summary ? `
    <div class="section">
      <div class="section-title">Summary</div>
      
      ${summary.critical_actions ? `
        <div class="critical-actions">
          <div class="critical-title">⚠ Critical Actions Required</div>
          <div class="text-content">${stripHtml(summary.critical_actions)}</div>
        </div>
      ` : ''}
      
      ${summary.repairs_performed ? `
        <div style="margin-bottom: 20px;">
          <div class="info-label" style="margin-bottom: 8px;">Repairs Performed</div>
          <div class="text-content">${stripHtml(summary.repairs_performed)}</div>
        </div>
      ` : ''}
      
      ${summary.future_considerations ? `
        <div style="margin-bottom: 20px;">
          <div class="info-label" style="margin-bottom: 8px;">Future Considerations</div>
          <div class="text-content">${stripHtml(summary.future_considerations)}</div>
        </div>
      ` : ''}
      
      ${summary.next_inspection_date ? `
        <div class="info-item" style="max-width: 300px;">
          <div class="info-label">Next Inspection Date</div>
          <div class="info-value">${formatDate(summary.next_inspection_date)}</div>
        </div>
      ` : ''}
    </div>
    ` : ''}

    <div class="footer">
      <p><strong>Rope Works Inc.</strong> - ACCT Accredited Vendor</p>
      ${inspectorProfile?.acct_number ? `<p>ACCT #: ${inspectorProfile.acct_number}</p>` : ''}
      <p style="margin-top: 10px;">Generated on ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
    </div>
  </div>
</body>
</html>`;

    return new Response(
      JSON.stringify({ html }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  } catch (error) {
    console.error('Error generating HTML report:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
});
