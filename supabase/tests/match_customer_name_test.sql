-- Manual test script for match_customer_name — run in the SQL editor, not part of the migration chain.
-- Wrapped in a transaction that rolls back, so it leaves no test data behind.
begin;

insert into crm_customers (id, billing_name, category, is_active_calling, status)
values ('11111111-1111-1111-1111-111111111111', 'ZZTEST Shinde Dada Prabhakar', 'Silver', true, 'active');

-- Name is prefixed "ZZTEST " so it can't collide with the unique raw_name
-- constraint against real production aliases.
insert into customer_name_aliases (raw_name, customer_id, source)
values ('ZZTEST Shinde Dada Prabhakar', '11111111-1111-1111-1111-111111111111', 'manual');

-- 1. Exact match, different case/whitespace -> should return the customer id
select match_customer_name('  ZZTEST SHINDE DADA PRABHAKAR  ') as expect_match;

-- 2. Minor typo/variation -> should still match via trigram similarity
select match_customer_name('ZZTEST Shinde Dada Prabhkar') as expect_match_fuzzy;

-- 3. Same words, extra middle name -> borderline, check similarity score directly
select similarity(lower(trim('ZZTEST Shinde Dada Prabhakar')), lower(trim('ZZTEST Shinde D Prabhakar'))) as sim_score,
       match_customer_name('ZZTEST Shinde D Prabhakar') as maybe_match;

-- 4. Unrelated name -> should return NULL
select match_customer_name('Totally Unrelated Trading Co') as expect_null;

rollback;
