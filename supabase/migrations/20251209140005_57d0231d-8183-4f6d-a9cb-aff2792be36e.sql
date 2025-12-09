-- Fix 1: Add immutability protection to audit_logs table
-- Deny all UPDATE operations on audit_logs
CREATE POLICY "Deny all updates on audit_logs" 
ON public.audit_logs 
FOR UPDATE 
USING (false);

-- Deny all DELETE operations on audit_logs
CREATE POLICY "Deny all deletes on audit_logs" 
ON public.audit_logs 
FOR DELETE 
USING (false);

-- Fix 2: Remove public access policy from contact-attachments bucket
-- and replace with super admin only access
DROP POLICY IF EXISTS "Public can view contact attachments" ON storage.objects;

-- Allow super admins to view contact attachments
CREATE POLICY "Super admins can view contact attachments" 
ON storage.objects 
FOR SELECT 
USING (
  bucket_id = 'contact-attachments' 
  AND public.is_super_admin()
);