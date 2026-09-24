-- Seed the vehicle maintenance job catalogue (`veh_issue_types`) — 24 jobs across
-- the 5 maintenance categories — and CLEAR whatever was there before.
--
-- Apply to BOTH the local and the Cloudflare D1 (the same content, the same ids):
--
--   npx wrangler d1 execute mff-sys-db --local  --file scripts/seed-veh-issue-types.sql
--   npx wrangler d1 execute mff-sys-db --remote --file scripts/seed-veh-issue-types.sql
--
-- IDEMPOTENT: it deletes the catalogue and re-inserts exactly these rows, so a re-run
-- is a reset, never a duplicate. The category ids are FIXED (both environments already
-- share Engine & Gear Box / Suspension & Steering by id), so the two stay comparable.
-- Categories that already exist are REUSED (matched by name_en); the ones missing in an
-- environment are created here, with `issues_type = 1` (the flag that marks a category
-- as a maintenance-job group — see shared/hooks/use-mro-masters.ts).

-- 1. The 5 categories this catalogue groups by.
INSERT INTO cms_mro_item_categories (id, name_en, name_mm, issues_type, doc_status, created_by, updated_by, created_at, updated_at)
SELECT 'e9d134cd-126b-446e-8c71-a87ea4117760', 'Engine & Gear Box', 'အင်ဂျင်ပိုင်း', 1, 'draft', '00000000-0000-4000-8000-000000000000', '00000000-0000-4000-8000-000000000000', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM cms_mro_item_categories WHERE name_en = 'Engine & Gear Box');
INSERT INTO cms_mro_item_categories (id, name_en, name_mm, issues_type, doc_status, created_by, updated_by, created_at, updated_at)
SELECT '45950b20-6ffb-4b75-9beb-1c642a11f7b4', 'Suspension & Steering', 'အောက်ပိုင်း', 1, 'draft', '00000000-0000-4000-8000-000000000000', '00000000-0000-4000-8000-000000000000', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM cms_mro_item_categories WHERE name_en = 'Suspension & Steering');
INSERT INTO cms_mro_item_categories (id, name_en, name_mm, issues_type, doc_status, created_by, updated_by, created_at, updated_at)
SELECT 'd4204b2a-4552-45ea-9038-66c7045ba074', 'Tyre & Alloy', 'တာယာ၊ဂွေ', 1, 'draft', '00000000-0000-4000-8000-000000000000', '00000000-0000-4000-8000-000000000000', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM cms_mro_item_categories WHERE name_en = 'Tyre & Alloy');
INSERT INTO cms_mro_item_categories (id, name_en, name_mm, issues_type, doc_status, created_by, updated_by, created_at, updated_at)
SELECT 'fc1419db-dfbe-4453-ab21-4f5b81a1443e', 'Electric & Lighting', 'မီးသီး၊လျှပ်စစ်', 1, 'draft', '00000000-0000-4000-8000-000000000000', '00000000-0000-4000-8000-000000000000', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM cms_mro_item_categories WHERE name_en = 'Electric & Lighting');
INSERT INTO cms_mro_item_categories (id, name_en, name_mm, issues_type, doc_status, created_by, updated_by, created_at, updated_at)
SELECT 'bf732ef0-feb8-4042-ad8c-d3a55f968d34', 'Body and Paint', 'ဆေးဘော်ဒီ', 1, 'draft', '00000000-0000-4000-8000-000000000000', '00000000-0000-4000-8000-000000000000', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM cms_mro_item_categories WHERE name_en = 'Body and Paint');

-- …and the flag is aligned on the ones that already existed (a category used by an
-- issue type is a maintenance-job group, whatever it was marked before).
UPDATE cms_mro_item_categories SET issues_type = 1 WHERE name_en IN ('Engine & Gear Box', 'Suspension & Steering', 'Tyre & Alloy', 'Electric & Lighting', 'Body and Paint');

-- 2. CLEAR the catalogue. (The maintenance logs that cited the three baseline jobs are
--    re-pointed below, so no log is left with a dangling job reference.)
DELETE FROM cms_veh_issue_types;

-- 3. The 24 jobs, in the order they were given. `job_code` is left empty — the source
--    list carries none; the app prefers `name_en` and simply omits the code chip.
INSERT INTO cms_veh_issue_types (id, name_en, name_mm, job_code, category, doc_status, created_by, updated_by, created_at, updated_at) VALUES
	('2f34c7e3-cac6-4bc4-b2a8-a5d4a5eb3e95', 'Engine Oil & Servicing', 'အင်ဂျင်ဝိုင်နှင့် ပုံမှန်ပြုပြင်ထိန်းသိမ်းမှု', '', 'e9d134cd-126b-446e-8c71-a87ea4117760', 'draft', '00000000-0000-4000-8000-000000000000', '00000000-0000-4000-8000-000000000000', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
	('bfd7ff9b-eed7-4f85-9c74-5397bd948968', 'Cooling System', 'ရေတိုင်ကီနှင့် အင်ဂျင်အအေးခံစနစ် ဆိုင်ရာ', '', 'e9d134cd-126b-446e-8c71-a87ea4117760', 'draft', '00000000-0000-4000-8000-000000000000', '00000000-0000-4000-8000-000000000000', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
	('8bd09af6-07d7-486d-b20f-aeb1723da4df', 'Fuel System', 'ဆီတိုင်ကီစနစ် ဆိုင်ရာ', '', 'e9d134cd-126b-446e-8c71-a87ea4117760', 'draft', '00000000-0000-4000-8000-000000000000', '00000000-0000-4000-8000-000000000000', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
	('a5111fd0-5552-4955-bc1f-d0cb09d64180', 'Transmission & Clutch', 'ဂီယာနှင့် ကလပ်စနစ် ဆိုင်ရာ', '', 'e9d134cd-126b-446e-8c71-a87ea4117760', 'draft', '00000000-0000-4000-8000-000000000000', '00000000-0000-4000-8000-000000000000', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
	('0688ef3b-d71c-4169-afe7-601d5f1eed7d', 'Exhaust & Turbocharger', 'အိတ်ဇောနှင့် တာဘိုစနစ် ဆိုင်ရာ', '', 'e9d134cd-126b-446e-8c71-a87ea4117760', 'draft', '00000000-0000-4000-8000-000000000000', '00000000-0000-4000-8000-000000000000', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
	('b821c9ae-facf-4b36-9b8e-30941b708266', 'Leaf Springs & Shock Absorbers', 'လေးနှင့် ရှော့ဘားစနစ် ဆိုင်ရာ', '', '45950b20-6ffb-4b75-9beb-1c642a11f7b4', 'draft', '00000000-0000-4000-8000-000000000000', '00000000-0000-4000-8000-000000000000', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
	('0ded7c13-0f3a-483d-8f1a-91509d61b2df', 'Steering System', 'စတီယာရင်စနစ် ဆိုင်ရာ', '', '45950b20-6ffb-4b75-9beb-1c642a11f7b4', 'draft', '00000000-0000-4000-8000-000000000000', '00000000-0000-4000-8000-000000000000', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
	('72200248-234b-4637-b95d-1726b4297a77', 'Braking System', 'ဘရိတ်စနစ် ဆိုင်ရာ', '', '45950b20-6ffb-4b75-9beb-1c642a11f7b4', 'draft', '00000000-0000-4000-8000-000000000000', '00000000-0000-4000-8000-000000000000', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
	('a35a728f-fbf4-42ca-a310-d497fd848fed', 'Axles & Bearings', 'အက်ဆယ်တန်းနှင့် ဘော ဘယ်ယာရင် ဆိုင်ရာ', '', '45950b20-6ffb-4b75-9beb-1c642a11f7b4', 'draft', '00000000-0000-4000-8000-000000000000', '00000000-0000-4000-8000-000000000000', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
	('5d7ec79b-01e7-42c6-8ecb-c2967ee6888c', 'Tyre Replacement', 'တာယာအသစ်လဲလှယ်ခြင်း ဆိုင်ရာ', '', 'd4204b2a-4552-45ea-9038-66c7045ba074', 'draft', '00000000-0000-4000-8000-000000000000', '00000000-0000-4000-8000-000000000000', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
	('76daf638-cd51-4ac2-bd37-8da39a85bc31', 'Tyre Retreading', 'တာယာကွန်ပေါင်းတင်ခြင်း ဆိုင်ရာ', '', 'd4204b2a-4552-45ea-9038-66c7045ba074', 'draft', '00000000-0000-4000-8000-000000000000', '00000000-0000-4000-8000-000000000000', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
	('5942515f-ab55-4920-9806-637bb48bf779', 'Tyre Repair & Maintenance', 'တာယာဖာခြင်းနှင့် ပြုပြင်ခြင်း ဆိုင်ရာ', '', 'd4204b2a-4552-45ea-9038-66c7045ba074', 'draft', '00000000-0000-4000-8000-000000000000', '00000000-0000-4000-8000-000000000000', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
	('dbed4abc-3151-4617-90bc-1b16350835d6', 'Wheel Alignment & Balancing', 'အလိုင်းမင်း နှင့် ဘီးချိန်ခြင်းဆိုင်ရာ', '', 'd4204b2a-4552-45ea-9038-66c7045ba074', 'draft', '00000000-0000-4000-8000-000000000000', '00000000-0000-4000-8000-000000000000', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
	('0a8763f9-94a3-4ca8-977b-8d9fb5e3ae93', 'Rims & Hardware', 'ဘီးဂွေ နှင့် မူလီ၊နပ် ဆိုင်ရာ', '', 'd4204b2a-4552-45ea-9038-66c7045ba074', 'draft', '00000000-0000-4000-8000-000000000000', '00000000-0000-4000-8000-000000000000', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
	('74ce430a-8da7-4cb3-b7fd-baefb85c510d', 'Battery System', 'ဘက်ထရီစနစ် ဆိုင်ရာ', '', 'fc1419db-dfbe-4453-ab21-4f5b81a1443e', 'draft', '00000000-0000-4000-8000-000000000000', '00000000-0000-4000-8000-000000000000', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
	('f9e3e778-b72c-49f7-94dc-99c52e6eee24', 'Starter & Alternator', 'မော်တာနှင့် ဒိုင်နမို ဆိုင်ရာ', '', 'fc1419db-dfbe-4453-ab21-4f5b81a1443e', 'draft', '00000000-0000-4000-8000-000000000000', '00000000-0000-4000-8000-000000000000', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
	('1dbac3a9-4f04-4613-88de-3400aa3e4a4e', 'External & Safety Lighting', 'ကားမီးစနစ် ဆိုင်ရာ', '', 'fc1419db-dfbe-4453-ab21-4f5b81a1443e', 'draft', '00000000-0000-4000-8000-000000000000', '00000000-0000-4000-8000-000000000000', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
	('6b011f71-280c-4aa6-af3d-e49062619d54', 'Wiring & Electrical Protection', 'ဝါယာကြိုးနှင့် ဖျူးစ်စနစ် ဆိုင်ရာ', '', 'fc1419db-dfbe-4453-ab21-4f5b81a1443e', 'draft', '00000000-0000-4000-8000-000000000000', '00000000-0000-4000-8000-000000000000', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
	('cd009fbe-06e8-41c3-92e2-ef2aba6c719e', 'Telematics & Instruments', 'GPS နှင့် ဒိုင်ခွက်စနစ် ဆိုင်ရာ', '', 'fc1419db-dfbe-4453-ab21-4f5b81a1443e', 'draft', '00000000-0000-4000-8000-000000000000', '00000000-0000-4000-8000-000000000000', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
	('a7fbc860-93eb-4da6-8b98-9d536925ae47', 'Cargo Container / Trailer', 'ကုန်သေတ္တာနှင့် နောက်တွဲ ဆိုင်ရာ', '', 'bf732ef0-feb8-4042-ad8c-d3a55f968d34', 'draft', '00000000-0000-4000-8000-000000000000', '00000000-0000-4000-8000-000000000000', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
	('98c12bbb-f98a-4a5e-95e4-8110a7fd202b', 'Cabin & Driver Area', 'ဒရိုင်ဘာခန်းနှင့် ခေါင်းပိုင်း ဆိုင်ရာ', '', 'bf732ef0-feb8-4042-ad8c-d3a55f968d34', 'draft', '00000000-0000-4000-8000-000000000000', '00000000-0000-4000-8000-000000000000', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
	('31b1ae05-415d-4677-ab38-774df6fe1461', 'Denting & Painting', 'ကားဘော်ဒီ နှင် ဆေးပိုင်းဆိုင်ရာ', '', 'bf732ef0-feb8-4042-ad8c-d3a55f968d34', 'draft', '00000000-0000-4000-8000-000000000000', '00000000-0000-4000-8000-000000000000', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
	('23185cec-d100-4d58-8382-cbb8fc3de2da', 'Windshield & Glass', 'ရှေ့မှန်နှင့် ဝိုက်ဘာ', '', 'bf732ef0-feb8-4042-ad8c-d3a55f968d34', 'draft', '00000000-0000-4000-8000-000000000000', '00000000-0000-4000-8000-000000000000', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
	('179e6815-b0c1-4ef8-90f6-784cc1b21206', 'Chassis & Frame', 'ကားဖရိန် နှင့် ချက်စစ်', '', 'bf732ef0-feb8-4042-ad8c-d3a55f968d34', 'draft', '00000000-0000-4000-8000-000000000000', '00000000-0000-4000-8000-000000000000', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

-- 4. Re-point the maintenance logs that cited the replaced baseline jobs.
UPDATE cms_veh_maintenance_logs SET issues_type = '2f34c7e3-cac6-4bc4-b2a8-a5d4a5eb3e95' WHERE issues_type = '83b7b92f-5ead-48fa-b9e4-6feeb8b170dc';
UPDATE cms_veh_maintenance_logs SET issues_type = 'b821c9ae-facf-4b36-9b8e-30941b708266' WHERE issues_type = 'cb2e2004-8558-4715-ab7f-fdb7b2834c27';
UPDATE cms_veh_maintenance_logs SET issues_type = '1dbac3a9-4f04-4613-88de-3400aa3e4a4e' WHERE issues_type = 'd3e1efc5-ae70-471b-ac78-2aa6a4efd3a4';
