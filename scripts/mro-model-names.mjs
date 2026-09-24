/**
 * Bilingual display names for the MRO SKU catalog (`mro_item_model`).
 *
 * The KEY is the canonical English display name — the row's `name_en` field.
 * `name_en` mirrors that key, and `name_mm` is a BEST-EFFORT Burmese rendering:
 * edit freely in the Studio (`/app/items/:id`). A name absent from this map keeps
 * `name_en` as-is and leaves `name_mm` null, so partial coverage is always safe.
 *
 * TWO consumers, ONE table so they can never drift:
 *   - the seeds (`seed-mro-demo.mjs`, `seed-mro-all-stores.mjs`,
 *     `seed-mro-stock-outs.mjs`) tag every SKU they create;
 *   - `scripts/migrate-mro-model-names.mjs` backfills the rows that already exist.
 */

/** English display name → Burmese (`name_mm`). */
export const NAME_MM = {
	'Bolt M10 x 50': 'ဘော့လ် M10 x 50',
	'Engine Oil 10W-40': 'အင်ဂျင်ဆီ 10W-40',
	'Engine Oil 10W-40 (Batch)': 'အင်ဂျင်ဆီ 10W-40 (အသုတ်)',
	'Tyre 11R22.5': 'တာယာ 11R22.5',
	'Tyre 11R22.5 (Serial)': 'တာယာ 11R22.5 (စီးရီးယယ်လ်)',
	'Rear Brake Drum': 'နောက်ဘရိတ် ဒရမ်',
	'Fan Clutch': 'ပန်ကာကလပ်ချ်',
	'Wiper Linkage Arm': 'ဝိုက်ပါ ချိတ်ဆက်တံ',
	'Brake Master Cylinder Kit': 'ဘရိတ် မာစတာဆလင်ဒါ အစုံ',
	'Radiator Cap 1.1 bar': 'ရေတိုင်ကီအဖုံး 1.1 bar',
	'Transmission Fluid ATF-D2': 'ဂီယာဆီ ATF-D2',
	'Diesel Engine Oil 15W-40': 'ဒီဇယ်အင်ဂျင်ဆီ 15W-40',
	'Hydraulic Oil AW46 20L': 'ဟိုက်ဒရောလစ်ဆီ AW46 20L',
	'Cutting Fluid 5L': 'ဖြတ်ဆီ 5L',
	'Gear Oil 80W-90 20L': 'ဂီယာဆီ 80W-90 20L',
	'Chain Grease 400g': 'ဆီကြိုးချောဆီ 400g',
	'Engine Coolant 50/50': 'အင်ဂျင်အအေးခံရည် 50/50',
	'Filter Wrench (metal)': 'ဖီလ်တာဖွင့်ကရိယာ (သတ္တု)',
	'U-Joint Cross 27-73': 'ယူဂျွိုင့်ကြက်ခြေ 27-73',
	EMD: 'အီးအမ်ဒီ',
	'Battery Terminal Clamp': 'ဘက်ထရီ တာမင်နယ်ကလစ်',
	'Spark Plug NGK BKR6E': 'စပါ့ခ်ပလပ် NGK BKR6E',
	'Alternator 100A': 'အယ်လ်တာနေတာ 100A',
	'Starter Motor 12V': 'စတာတာမော်တာ 12V',
	'Shock Absorber (rear)': 'ရှော့ခ်အပ်ဆော့ဘာ (နောက်)',
	'Fan Belt 11A': 'ပန်ကာခါးပတ် 11A',
	'Wheel Hub Nut M22': 'ဘီးဟပ် မာနတ် M22',
	'Rear Axle Seal': 'နောက်အက်ဆယ် ဆီးရာဘာ',
	'Valve Cover Gasket': 'ဗားလ့်အဖုံး ဂက်စကတ်',
	'Cylinder Head Gasket': 'ဆလင်ဒါခေါင်း ဂက်စကတ်',
	'Fuse 20A (box of 10)': 'ဖျူး 20A (၁၀ လုံးအထုပ်)',
	'Fuse 10A (box of 10)': 'ဖျူး 10A (၁၀ လုံးအထုပ်)',
	'Indicator Bulb 12V': 'ဆိုင်းမီးလုံး 12V',
	'Headlight Bulb H4': 'မီးရှေ့မီးလုံး H4',
	'Clutch Disc 240mm': 'ကလပ်ချ်ဒစ် 240mm',
	'Brake Pad Set (front)': 'ဘရိတ်ပက်ဒ် အစုံ (အရှေ့)',
	'Power Steering Hose': 'ပါဝါစတီယာရင် ရော်ဘာပိုက်',
	'Radiator Hose 38mm': 'ရေတိုင်ကီ ရော်ဘာပိုက် 38mm',
	'Windscreen Wiper 600mm': 'ဝင်းရှိုးဝိုက်ပါ 600mm',
	'Antifreeze 50/50 5L': 'အန္တီဖရီး 50/50 5L',
	'Brake Fluid DOT-4 1L': 'ဘရိတ်ဆီ DOT-4 1L',
	'Lithium Grease 2kg': 'လစ်သီယမ်ချောဆီ 2kg',
	'Grease Pump Tube': 'ချောဆီပန့်ပြွန်',
	'Hydraulic Oil Filter': 'ဟိုက်ဒရောလစ်ဆီ ဖီလ်တာ',
	'Air Filter (panel)': 'လေစစ်ဖီလ်တာ (ပြားချပ်)',
	'Air Filter': 'လေစစ်ဖီလ်တာ',
	'Fuel Filter': 'ဆီစစ်ဖီလ်တာ',
	'Timing Belt 108 teeth': 'တိုင်းမင်းခါးပတ် ၁၀၈ သွား',
	'V-Belt B-52': 'ဗွီခါးပတ် B-52',
	'V-Belt A-38': 'ဗွီခါးပတ် A-38',
	'Ball Bearing 6208': 'ဘောလုံးဘီးရင်း 6208',
	'Ball Bearing 6204': 'ဘောလုံးဘီးရင်း 6204',
	Panus: 'ပါနပ်စ်',
	'22.8 R': '22.8 R',
	// Seed-only spares (not necessarily present in a given database).
	'Tie Rod End': 'တိုင်းရော့ဒ် အဖျား',
	'Handbrake Cable': 'ဟန်းဘရိတ်ကေဘယ်',
	'Dashboard Fuse Relay': 'ဒိုင်ခွက်ဖျူးရီလေး',
	'AC Compressor Clutch': 'အေစီကွန်ပရက်ဆာ ကလပ်ချ်',
	'Laser Collimator Kit': 'လေဆာကော်လီမေတာ အစုံ',
};

/**
 * The two name columns for a model display name — `name_en` mirrors the
 * canonical English key, `name_mm` the best-effort map (null when unmapped).
 */
export function modelNames(name) {
	return { name_en: name, name_mm: NAME_MM[name] ?? null };
}
