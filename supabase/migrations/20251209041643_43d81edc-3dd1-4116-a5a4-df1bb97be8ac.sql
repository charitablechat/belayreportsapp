-- Make the contact-attachments bucket private
UPDATE storage.buckets 
SET public = false 
WHERE id = 'contact-attachments';