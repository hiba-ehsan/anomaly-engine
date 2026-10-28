-- Add unique constraint for filings table (required for on_conflict)
-- Run this in Supabase SQL Editor

ALTER TABLE filings 
ADD CONSTRAINT filings_company_filing_date_unique 
UNIQUE (company_id, filing_type, filing_date);