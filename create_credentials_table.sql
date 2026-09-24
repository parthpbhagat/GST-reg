-- Run this query in your Supabase SQL Editor to create the table for storing passwords.
CREATE TABLE IF NOT EXISTS public.user_credentials (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    email text NOT NULL,
    password text NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable Insert for everyone (or you can disable RLS if you don't care about security here)
ALTER TABLE public.user_credentials ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public insert" ON public.user_credentials FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow select for anon/authenticated" ON public.user_credentials FOR SELECT USING (true);
