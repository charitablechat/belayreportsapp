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
    * { margin: 0; padding: 0; box-sizing: border-box; }
    
    @page { margin: 1in 0.75in 0.75in 0.75in; size: letter; }
    
    body {
      font-family: Georgia, 'Times New Roman', Times, serif;
      font-size: 11pt;
      line-height: 1.4;
      color: #000;
      background: #fff;
    }
    
    .page {
      max-width: 8.5in;
      margin: 0 auto;
      padding: 0 0.75in;
      background: white;
    }
    
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 20px 0;
      border-bottom: 2px solid #000;
      margin-bottom: 20px;
    }
    
    .header-left { flex: 1; }
    .header-left img { height: 60px; width: auto; }
    .header-right { flex: 0 0 auto; }
    .header-right img { height: 80px; width: auto; }
    
    .report-title {
      text-align: center;
      font-size: 16pt;
      font-weight: bold;
      margin: 15px 0 20px 0;
      font-family: Arial, sans-serif;
    }
    
    .footer {
      position: fixed;
      bottom: 0;
      left: 0.75in;
      right: 0.75in;
      border-top: 1px solid #000;
      padding-top: 8px;
      font-size: 9pt;
      line-height: 1.3;
    }
    
    .footer-text { margin-bottom: 3px; }
    
    @media print {
      .footer { position: fixed; bottom: 0.5in; }
    }
    
    .facility-info { margin-bottom: 25px; }
    
    .facility-row {
      display: flex;
      gap: 20px;
      margin-bottom: 12px;
      font-size: 11pt;
    }
    
    .facility-field {
      flex: 1;
      display: flex;
      align-items: baseline;
    }
    
    .facility-label {
      font-weight: bold;
      white-space: nowrap;
      margin-right: 5px;
    }
    
    .facility-value {
      flex: 1;
      border-bottom: 1px dotted #000;
      min-height: 20px;
      padding: 0 5px;
    }
    
    .course-history {
      border: 1px dotted #000;
      padding: 12px;
      margin-top: 15px;
      min-height: 80px;
    }
    
    .course-history-label {
      font-weight: bold;
      margin-bottom: 8px;
    }
    
    .section {
      margin-bottom: 25px;
      page-break-inside: avoid;
    }
    
    .section-title {
      font-size: 14pt;
      font-weight: bold;
      font-family: Arial, sans-serif;
      margin-bottom: 12px;
      color: #000;
    }
    
    .disclaimer {
      font-size: 10pt;
      line-height: 1.5;
      margin-bottom: 20px;
      text-align: justify;
    }
    
    .reminders { margin-top: 20px; }
    
    .reminders-title {
      font-size: 12pt;
      font-weight: bold;
      margin-bottom: 10px;
    }
    
    .reminders ul {
      margin-left: 25px;
      margin-bottom: 15px;
    }
    
    .reminders li {
      margin-bottom: 8px;
      line-height: 1.5;
    }
    
    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 15px;
      font-size: 10pt;
    }
    
    th, td {
      border: 1px solid #000;
      padding: 6px 8px;
      text-align: left;
    }
    
    th {
      background: #fff;
      font-weight: bold;
      font-family: Arial, sans-serif;
    }
    
    tr:nth-child(even) { background: #f9f9f9; }
    
    .key-table th { background: #e8e8e8; }
    
    .key-table td:first-child {
      font-weight: bold;
      width: 25%;
    }
    
    .page-break { page-break-after: always; }
    .no-break { page-break-inside: avoid; }
    
    .signature-section {
      margin-top: 40px;
      border-top: 2px solid #000;
      padding-top: 20px;
    }
    
    .signature-line {
      border-bottom: 1px solid #000;
      width: 300px;
      margin: 30px 0 5px 0;
    }
    
    .signature-label { font-size: 10pt; }
    
    @media screen {
      body {
        background: #e5e5e5;
        padding: 20px;
      }
      
      .page {
        box-shadow: 0 0 10px rgba(0,0,0,0.1);
        margin-bottom: 20px;
        padding: 0.75in;
      }
      
      .footer {
        position: relative;
        left: 0;
        right: 0;
        margin-top: 40px;
      }
    }
  </style>
</head>
<body>
  <div class="page">
    <div class="header">
      <div class="header-left">
        <img src="https://ssgzcgvygnsrqalisshx.supabase.co/storage/v1/object/public/pdf-templates/rope-works-logo.png" alt="Rope Works Logo">
      </div>
      <div class="header-right">
        <img src="https://ssgzcgvygnsrqalisshx.supabase.co/storage/v1/object/public/pdf-templates/acct-logo.jpg" alt="ACCT Accredited Vendor">
      </div>
    </div>
    
    <div class="report-title">Professional Inspection for Aerial Adventure Programs</div>

    <div class="facility-info">
      <div class="facility-row">
        <div class="facility-field">
          <span class="facility-label">Organization:</span>
          <span class="facility-value">${stripHtml(inspection.organization)}</span>
        </div>
        <div class="facility-field">
          <span class="facility-label">Location:</span>
          <span class="facility-value">${stripHtml(inspection.location)}</span>
        </div>
        <div class="facility-field">
          <span class="facility-label">Onsite Contact:</span>
          <span class="facility-value">${stripHtml(inspection.onsite_contact) || ''}</span>
        </div>
      </div>
      
      <div class="facility-row">
        <div class="facility-field">
          <span class="facility-label">Inspection Date:</span>
          <span class="facility-value">${formatDate(inspection.inspection_date)}</span>
        </div>
        <div class="facility-field">
          <span class="facility-label">Inspector:</span>
          <span class="facility-value">${inspectorName}</span>
        </div>
        <div class="facility-field">
          <span class="facility-label">ACCT #:</span>
          <span class="facility-value">${stripHtml(inspection.acct_number) || ''}</span>
        </div>
      </div>
      
      ${inspection.previous_inspection_date || inspection.previous_inspector ? `
      <div class="facility-row">
        ${inspection.previous_inspection_date ? `
        <div class="facility-field">
          <span class="facility-label">Previous Inspection:</span>
          <span class="facility-value">${formatDate(inspection.previous_inspection_date)}</span>
        </div>
        ` : ''}
        ${inspection.previous_inspector ? `
        <div class="facility-field">
          <span class="facility-label">Previous Inspector:</span>
          <span class="facility-value">${stripHtml(inspection.previous_inspector)}</span>
        </div>
        ` : ''}
      </div>
      ` : ''}
      
      ${inspection.course_history ? `
      <div class="course-history">
        <div class="course-history-label">Known Course History:</div>
        <div>${stripHtml(inspection.course_history)}</div>
      </div>
      ` : ''}
    </div>
    
    <div class="section">
      <div class="disclaimer">
        This professional inspection only covers activities/elements that are accessible and identifiable at the time of inspection. This inspection does not cover any life support (LOP) or system which was not accessible and/or identifiable at the time of inspection. The inspector assumes no liability with respect to LOP or systems which were not accessible and/or identifiable. Inspection does not include verification of Emergency Action Plans (EAP), nor was the training, qualifications and/or certifications of staff verified. Though this report may call attention to particular safety concerns, the inspector assumes no responsibility for vandalism and/or sabotage. It is recommended that quarterly monitoring protocols be implemented, and operational reviews are recommended for any system that is determined at a later time to require one or any system known to be five years or older. This report is effective for one year from the date of inspection. Annual inspections of aerial adventure programs are an industry standard in accordance with both ANSI and ACCT Standards.
      </div>
      
      <div class="reminders">
        <div class="reminders-title">Reminders and Requirements:</div>
        <ul>
          <li>Employers of those utilizing any form of fall protection, are required by federal and state law to provide adequate training and/or supervision in their use.</li>
          <li>Periodic Internal Monitoring should include both scheduled and unscheduled spot checks of equipment &amp; systems. Informal Internal Monitoring should be completed at the beginning of each day/program. Formal Internal Monitoring should be performed on an established schedule (typically weekly, biweekly or monthly).</li>
          <li>All life support hardware &amp; equipment should be tracked so as to allow for documentation of usage, inspection, maintenance and retirement. (ie Numbered and maintained on an inspection and maintenance log.)</li>
          <li>Staff should have documented adequate training in all aspects of the operations they are responsible for, including but not limited to rescue systems and emergency action plans.</li>
          <li>Programs are required to perform an Operational Review every five years or after any significant change to the operation or when recommended in any annual inspection. Operational reviews are more rigorous and thorough than an annual inspection. An operational review will address ALL aspects of the program operation.</li>
        </ul>
      </div>
    </div>
    
    <div class="page-break"></div>
    
    <div class="section">
      <h2 class="section-title">All inspections include the following when applicable:</h2>
      
      <table class="key-table">
        <tr>
          <th>Category</th>
          <th>Description</th>
        </tr>
        <tr>
          <td>Lifeline HDW</td>
          <td>Represents all hardware associated with the functioning of the life support system, Participants Direct Life Support (PDLS), including but not limited to: steel cable, hardware, anchors/attachment points, connections, terminations, and dynamic components.</td>
        </tr>
        <tr>
          <td>Activity HDW</td>
          <td>Represents all hardware associated with element execution, operational hardware, activity structure, and activity attachments, including but not limited to: wooden platforms, activity structure, ladder/stair construction, wooden handrails, and activity attachments.</td>
        </tr>
        <tr>
          <td>Environment</td>
          <td>This represents the surrounding area that could affect the operation of the element including but not limited to: trees used for PDLS and Activity Hardware, trees used for anchor, trees in the activity field, and natural hazards.</td>
        </tr>
        <tr>
          <td>Equipment</td>
          <td>This represents the equipment utilized in the operation of the element. Equipment is typically issued to the participant or group, but can also be a tool used for participant or facilitator management, including but not limited to: harnesses, helmets, trolleys, pulleys, ropes, and carabiners.</td>
        </tr>
      </table>
      
      <div style="margin-top: 20px; margin-bottom: 15px; line-height: 1.6;">
        <strong>Pass/Pass with Provisions/Fail:</strong> These are the overall ratings that can be assigned to an element, piece of equipment, or system. The overall rating is based upon the individual ratings assigned to the categories described above. In order for the overall rating to be a Pass, ALL categories must be rated as a Pass. If one or more categories are not rated as a Pass, the overall rating will be a Pass with Provisions or a Fail. ACCT Standards require that all Aerial Adventure programs be inspected on at least an annual basis by a qualified professional.
      </div>
      
      <h3 style="margin-top: 20px; margin-bottom: 10px; font-size: 12pt;">Inspection Key:</h3>
      
      <table class="key-table">
        <tr>
          <th>Rating</th>
          <th>Definition</th>
        </tr>
        <tr>
          <td>Pass</td>
          <td>Indicates the item inspected meets manufacturer specifications, industry standards, and all operational safety requirements at the time of this scheduled inspection.</td>
        </tr>
        <tr>
          <td>Pass with Provisions</td>
          <td>Indicates the item inspected is in acceptable condition however a minor corrective action, adjustment, or area in need of special monitoring has been identified.</td>
        </tr>
        <tr>
          <td>Fail</td>
          <td>Indicates the item inspected does not meet critical safety standards and should be immediately removed from service. The item should not be returned to service until repaired or replaced and verified by a qualified professional.</td>
        </tr>
        <tr>
          <td>N/A</td>
          <td>Indicates the criterion is not applicable to the element or item or the element or item was not accessible at time of inspection. In these cases the rating of N/A does not indicate a Pass or Fail for that criteria.</td>
        </tr>
      </table>
    </div>
    
    <div class="page-break"></div>

    ${systems && systems.length > 0 ? `
    <div class="section">
      <h2 class="section-title">Operating Systems</h2>
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
              <td>${sys.result || 'N/A'}</td>
              <td>${stripHtml(sys.comments) || '-'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
    ` : ''}

    ${ziplines && ziplines.length > 0 ? `
    <div class="section">
      <h2 class="section-title">Ziplines</h2>
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
              <td>${zip.result || 'N/A'}</td>
              <td>${stripHtml(zip.comments) || '-'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
    ` : ''}

    ${equipment && equipment.length > 0 ? `
    <div class="section">
      <h2 class="section-title">Equipment</h2>
      ${['PPE', 'Hardware', 'Software', 'Belay Devices'].map(category => {
        const items = equipment.filter(e => e.equipment_category === category);
        if (items.length === 0) return '';
        return `
          <h3 style="font-size: 11pt; font-weight: bold; margin: 15px 0 8px 0;">${category}</h3>
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
                  <td>${eq.result || 'N/A'}</td>
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
      <h2 class="section-title">Standards Compliance</h2>
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
    <div class="section no-break">
      <h2 class="section-title">Inspection Summary</h2>
      ${summary.repairs_performed ? `
      <div style="margin-bottom: 15px;">
        <h3 style="font-size: 11pt; font-weight: bold; margin-bottom: 8px;">Repairs Performed</h3>
        <div style="line-height: 1.5;">${stripHtml(summary.repairs_performed)}</div>
      </div>
      ` : ''}
      ${summary.critical_actions ? `
      <div style="margin-bottom: 15px;">
        <h3 style="font-size: 11pt; font-weight: bold; margin-bottom: 8px;">Critical Actions Required</h3>
        <div style="line-height: 1.5;">${stripHtml(summary.critical_actions)}</div>
      </div>
      ` : ''}
      ${summary.future_considerations ? `
      <div style="margin-bottom: 15px;">
        <h3 style="font-size: 11pt; font-weight: bold; margin-bottom: 8px;">Future Considerations</h3>
        <div style="line-height: 1.5;">${stripHtml(summary.future_considerations)}</div>
      </div>
      ` : ''}
      ${summary.next_inspection_date ? `
      <div style="margin-bottom: 15px;">
        <h3 style="font-size: 11pt; font-weight: bold; margin-bottom: 8px;">Next Inspection Date</h3>
        <div>${formatDate(summary.next_inspection_date)}</div>
      </div>
      ` : ''}
    </div>
    ` : ''}

    <div class="signature-section">
      <div class="signature-line"></div>
      <div class="signature-label">Inspector Signature</div>
      
      <div style="margin-top: 30px;">
        <div class="signature-line"></div>
        <div class="signature-label">Date</div>
      </div>
    </div>
  </div>
  
  <div class="footer">
    <div class="footer-text">
      The information contained in this report has been documented by a Qualified Professional. This report is effective for one year from the date of inspection. Issued by:
    </div>
    <div class="footer-text">
      Rope Works Inc., PO Box 1074, Dripping Springs, TX 78620
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
