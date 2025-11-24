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

    console.log('Loading PDF template from storage...');

    // Load the template from storage
    const { data: templateData, error: downloadError } = await supabase.storage
      .from('pdf-templates')
      .download('inspection-template.pdf');
    
    if (downloadError || !templateData) {
      console.error('Template not found in storage:', downloadError);
      throw new Error(
        'PDF template not found. Please upload the template first by going to the Super Admin Dashboard and clicking "Upload PDF Template".'
      );
    }
    
    const templateBytes = await templateData.arrayBuffer();
    console.log('Template loaded from storage successfully');
    
    const pdfDoc = await PDFDocument.load(templateBytes);

    // Get the form from the PDF
    const form = pdfDoc.getForm();
    const fields = form.getFields();
    
    console.log(`Found ${fields.length} form fields in template`);

    // Helper to safely set text field
    const setTextField = (fieldName: string, value: string | null | undefined) => {
      try {
        const field = form.getTextField(fieldName);
        field.setText(value || '');
      } catch (e) {
        console.log(`Field not found or error: ${fieldName}`);
      }
    };

    // Helper to format date
    const formatDate = (dateString: string | null | undefined) => {
      if (!dateString) return '';
      const date = new Date(dateString);
      return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    };

    // Get inspector name
    const inspectorName = inspectorProfile 
      ? `${inspectorProfile.first_name || ''} ${inspectorProfile.last_name || ''}`.trim() || 'Inspector'
      : 'Inspector';

    // Fill in the form fields
    // Header information
    setTextField('facility_name', inspection.organization);
    setTextField('location', inspection.location);
    setTextField('inspection_date', formatDate(inspection.inspection_date));
    setTextField('inspector_name', inspectorName);
    setTextField('onsite_contact', inspection.onsite_contact);
    setTextField('previous_inspection_date', formatDate(inspection.previous_inspection_date));
    setTextField('previous_inspector', inspection.previous_inspector);
    setTextField('course_history', inspection.course_history);

    // Operating Systems
    if (systems && systems.length > 0) {
      systems.forEach((system, index) => {
        setTextField(`system_${index + 1}_name`, system.system_name);
        setTextField(`system_${index + 1}_result`, system.result);
        setTextField(`system_${index + 1}_comments`, system.comments);
      });
    }

    // Ziplines
    if (ziplines && ziplines.length > 0) {
      ziplines.forEach((zipline, index) => {
        setTextField(`zipline_${index + 1}_name`, zipline.zipline_name);
        setTextField(`zipline_${index + 1}_cable_type`, zipline.cable_type);
        setTextField(`zipline_${index + 1}_cable_length`, zipline.cable_length?.toString());
        setTextField(`zipline_${index + 1}_cable_result`, zipline.cable_result);
        setTextField(`zipline_${index + 1}_braking_system`, zipline.braking_system);
        setTextField(`zipline_${index + 1}_braking_result`, zipline.braking_result);
        setTextField(`zipline_${index + 1}_ead_system`, zipline.ead_system);
        setTextField(`zipline_${index + 1}_ead_result`, zipline.ead_result);
        setTextField(`zipline_${index + 1}_load_tension`, zipline.load_tension?.toString());
        setTextField(`zipline_${index + 1}_unload_tension`, zipline.unload_tension?.toString());
        setTextField(`zipline_${index + 1}_result`, zipline.result);
        setTextField(`zipline_${index + 1}_comments`, zipline.comments);
      });
    }

    // Equipment
    if (equipment && equipment.length > 0) {
      equipment.forEach((item, index) => {
        setTextField(`equipment_${index + 1}_category`, item.equipment_category);
        setTextField(`equipment_${index + 1}_type`, item.equipment_type);
        setTextField(`equipment_${index + 1}_quantity`, item.quantity?.toString());
        setTextField(`equipment_${index + 1}_year`, item.production_year?.toString());
        setTextField(`equipment_${index + 1}_result`, item.result);
        setTextField(`equipment_${index + 1}_comments`, item.comments);
      });
    }

    // Standards
    if (standards && standards.length > 0) {
      standards.forEach((standard, index) => {
        setTextField(`standard_${index + 1}_name`, standard.standard_name);
        setTextField(`standard_${index + 1}_documentation`, standard.has_documentation ? 'Yes' : 'No');
        setTextField(`standard_${index + 1}_comments`, standard.comments);
      });
    }

    // Summary
    if (summary) {
      setTextField('repairs_performed', summary.repairs_performed);
      setTextField('critical_actions', summary.critical_actions);
      setTextField('future_considerations', summary.future_considerations);
      setTextField('next_inspection_date', formatDate(summary.next_inspection_date));
    }

    // Flatten the form to make it non-editable
    form.flatten();

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

