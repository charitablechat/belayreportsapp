-- Create storage bucket for contact form attachments
insert into storage.buckets (id, name, public)
values ('contact-attachments', 'contact-attachments', true);

-- Allow authenticated users to upload contact attachments
create policy "Users can upload contact attachments"
on storage.objects for insert
to authenticated
with check (bucket_id = 'contact-attachments');

-- Allow public read access to contact attachments
create policy "Public can view contact attachments"
on storage.objects for select
to public
using (bucket_id = 'contact-attachments');