-- Run this query in your Supabase SQL Editor to create the required tables for the project.

-- 1. Create user_credentials table
CREATE TABLE IF NOT EXISTS public.user_credentials (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    email text NOT NULL,
    mobile text,
    password text NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable RLS and create policies for user_credentials
ALTER TABLE public.user_credentials ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public insert" ON public.user_credentials FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow select for anon/authenticated" ON public.user_credentials FOR SELECT USING (true);
CREATE POLICY "Allow all operations for service role" ON public.user_credentials USING (true) WITH CHECK (true);

-- 2. Create applications table
CREATE TABLE IF NOT EXISTS public.applications (
    "appId" text PRIMARY KEY,
    data jsonb,
    status text,
    "userEmail" text,
    trn text,
    "createdAt" timestamp with time zone DEFAULT timezone('utc'::text, now())
);

-- Enable RLS and create policies for applications
ALTER TABLE public.applications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public insert" ON public.applications FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow select for anon/authenticated" ON public.applications FOR SELECT USING (true);
CREATE POLICY "Allow update for anon/authenticated" ON public.applications FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations for service role" ON public.applications USING (true) WITH CHECK (true);
