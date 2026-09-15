import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { bodyMeasurementListResponseSchema, bodyMeasurementSchema, mealPhotoAnalysisSchema, nutritionTargetsResponseSchema, type VisionEvidence } from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createMemoryRedis, type RedisLike } from "../src/redis.js";
import { quotaKey } from "../src/modules/quotas/service.js";
import { RETAKE_TTL_SECONDS } from "../src/modules/nutrition/service.js";
import { VisionProviderError, type VisionProvider, type VisionResult } from "../src/modules/nutrition/vision.adapter.js";
import { createOpenFoodFactsProvider, type FoodSearchProvider } from "../src/modules/nutrition/openfoodfacts.adapter.js";

// Sentry is only ever called, never reached: a test that sets SENTRY_DSN reads what the app sent it.
const sentry = vi.hoisted(() => ({ init: vi.fn(), captureException: vi.fn() }));
vi.mock("@sentry/node", () => sentry);

const url=process.env["DATABASE_URL"];const d=describe.skipIf(url===undefined||url==="");
const PASSWORD="p26a-safe-test-password-1"; // gitleaks:allow
const env={NODE_ENV:"test",DATABASE_URL:url??"",WEB_ORIGIN:"http://localhost:5173",JWT_SECRET:"p26a-test-secret-0123456789abcdef-32",LOG_LEVEL:"error",GROQ_API_KEY:"p26a-fake-provider-key"}; // gitleaks:allow
type App=Awaited<ReturnType<typeof buildApp>>;
const goodEvidence:VisionEvidence={meal_name:"Dal and roti",items:[{name:"Dal",canonical_hint:"dal",container:"standard_katori",fill_level:.75,size_class:null,count:null},{name:"Roti",canonical_hint:"roti",container:null,fill_level:null,size_class:null,count:2}],unknown_items:[],photo_quality:"good"};
function fakeVision():VisionProvider&{queue:VisionEvidence[];calls:number}{const queue:VisionEvidence[]=[];return{queue,calls:0,analyze(){this.calls++;const evidence=queue.shift()??goodEvidence;return Promise.resolve({evidence,tokensIn:100,tokensOut:200} satisfies VisionResult);}};}
const noExternal:FoodSearchProvider={search:()=>Promise.resolve([])};
const jpeg=(()=>{const bytes=Buffer.alloc(1200,1);bytes[0]=0xff;bytes[1]=0xd8;bytes[2]=0xff;return bytes.toString("base64");})();

d("nutrition + body routes (real Postgres, fake providers)",()=>{
  const sql=postgres(url??"",{prepare:false,max:5});const redis=createMemoryRedis();const vision=fakeVision();let app:App|undefined;let cookieA="",cookieB="",userA="";
  const api=():App=>{if(app===undefined)throw new Error("beforeAll did not run");return app;};
  const inject=(method:"GET"|"POST"|"PUT"|"PATCH"|"DELETE",path:string,access:string,body?:unknown)=>api().inject({method,url:path,cookies:access===""?{}:{accessToken:access},headers:body===undefined?{}:{"content-type":"application/json"},...(body===undefined?{}:{payload:JSON.stringify(body)})});
  async function session(email:string){const reg=await inject("POST","/v1/auth/register","",{email,password:PASSWORD,displayName:"P26a Fixture"});if(reg.statusCode!==201)throw new Error(reg.body);const userId=reg.json<{userId:string}>().userId;const login=await inject("POST","/v1/auth/login","",{email,password:PASSWORD});return{userId,access:login.cookies.find((c)=>c.name==="accessToken")?.value??""};}
  beforeAll(async()=>{await sql`DELETE FROM meal_logs WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'p26a-%@example.com')`;await sql`DELETE FROM body_measurements WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'p26a-%@example.com')`;await sql`DELETE FROM user_dishware WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'p26a-%@example.com')`;await sql`DELETE FROM api_cost_events WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'p26a-%@example.com')`;await sql`DELETE FROM users WHERE email LIKE 'p26a-%@example.com'`;app=await buildApp(loadConfig(env),{redis,nutrition:{visionProvider:vision,foodSearchProvider:noExternal}});const a=await session("p26a-alice@example.com");userA=a.userId;cookieA=a.access;cookieB=(await session("p26a-bob@example.com")).access;},60_000);
  afterAll(async()=>{if(app!==undefined)await app.close();await sql.end({timeout:5});});

  it("auth and validation run before quota",async()=>{expect((await inject("POST","/v1/nutrition/analyze-photo","",{imageBase64:jpeg,mimeType:"image/jpeg"})).statusCode).toBe(401);for(let i=0;i<3;i++)expect((await inject("POST","/v1/nutrition/analyze-photo",cookieA,{imageBase64:"bad",mimeType:"image/jpeg"})).statusCode).toBe(400);const key=quotaKey("meal_scan",userA,"day",new Date());expect(await redis.get(key)).toBeNull();},30_000);

  let scanToken="",mealId="",dishId="",measurementId="";
  it("poor parse grants one single-use retake without a second quota unit",async()=>{vision.queue.push({...goodEvidence,photo_quality:"poor"},goodEvidence);const poor=await inject("POST","/v1/nutrition/analyze-photo",cookieA,{imageBase64:jpeg,mimeType:"image/jpeg"});expect(poor.statusCode).toBe(422);const retakeToken=poor.json<{retakeToken:string}>().retakeToken;const good=await inject("POST","/v1/nutrition/analyze-photo",cookieA,{imageBase64:jpeg,mimeType:"image/jpeg",retakeToken});expect(good.statusCode).toBe(200);scanToken=good.json<{scanToken:string}>().scanToken;expect(await redis.get(quotaKey("meal_scan",userA,"day",new Date()))).toBe("1");expect((await inject("POST","/v1/nutrition/analyze-photo",cookieA,{imageBase64:jpeg,mimeType:"image/jpeg",retakeToken})).statusCode).toBe(400);},30_000);

  it("confirms a photo meal, records ledger, and fires photo badge",async()=>{const scanResponse=await inject("POST","/v1/nutrition/analyze-photo",cookieA,{imageBase64:jpeg,mimeType:"image/jpeg"});expect(scanResponse.statusCode,scanResponse.body).toBe(200);const scan=scanResponse.json<{scanToken:string;items:{canonical:string}[]}>();scanToken=scan.scanToken;const confirmed=await inject("POST","/v1/nutrition/meals",cookieA,{scanToken,takenAt:new Date().toISOString(),items:scan.items.map((i)=>({canonical:i.canonical,grams:100}))});expect(confirmed.statusCode,confirmed.body).toBe(201);const meal=confirmed.json<{meal:{id:string;origin:string}}>().meal;mealId=meal.id;expect(meal.origin).toBe("photo");const [counts]=await sql<{photo:string;costs:string}[]>`SELECT (SELECT count(*) FROM meal_logs WHERE user_id=${userA} AND origin='photo') AS photo,(SELECT count(*) FROM api_cost_events WHERE user_id=${userA} AND feature='meal_scan') AS costs`;expect(counts?.photo).toBe("1");expect(Number(counts?.costs)).toBeGreaterThanOrEqual(2);const earned=await sql<{code:string}[]>`SELECT code FROM user_achievements WHERE user_id=${userA}`;expect(earned.map((v)=>v.code)).toEqual(expect.arrayContaining(["first_meal","photo_meal"]));},30_000);

  it("the ledger row names the configured scanner and prices it at that model's own list price (RULINGS 2026-09-15)",async()=>{
    // The fake provider reports 100 in + 200 out; the config's default model is Gemini 3.5 Flash-Lite ($0.30 / $2.50 per 1M): 30 + 500 micro-USD.
    const rows=await sql<{provider:string;units:string;unit_type:string;cost_micro:string}[]>`SELECT provider, units, unit_type, cost_micro FROM api_cost_events WHERE user_id=${userA} AND feature='meal_scan' ORDER BY at DESC LIMIT 1`;
    expect(rows[0]?.provider).toBe("gemini:gemini-3.5-flash-lite");
    expect(rows[0]?.unit_type).toBe("tokens");
    expect(Number(rows[0]?.units)).toBe(300);
    expect(String(rows[0]?.cost_micro)).toBe("530");
  },30_000);

  it("PATCH preserves originals in meal_log_corrections; foreign user gets 404",async()=>{const patch=await inject("PATCH",`/v1/nutrition/meals/${mealId}`,cookieA,{mealName:"Corrected meal"});expect(patch.statusCode).toBe(200);const rows=await sql<{field:string;original:unknown;corrected:unknown}[]>`SELECT field,original,corrected FROM meal_log_corrections WHERE meal_log_id=${mealId}`;expect(rows.some((r)=>r.field==="meal_name"&&r.original==="Dal and roti"&&r.corrected==="Corrected meal")).toBe(true);expect((await inject("GET",`/v1/nutrition/meals/${mealId}`,cookieB)).statusCode).toBe(404);expect((await inject("PATCH",`/v1/nutrition/meals/${mealId}`,cookieB,{mealName:"stolen"})).statusCode).toBe(404);},30_000);

  it("manual meal (GAP-2): no scanToken, items via food search, origin=manual, badge fires without photo badge",async()=>{const m=await session("p26a-manual@example.com");const created=await inject("POST","/v1/nutrition/meals",m.access,{mealName:"Lunch dal and rice",takenAt:new Date().toISOString(),items:[{canonical:"dal_lentil_curry",grams:150},{canonical:"rice_white_cooked",grams:200}]});expect(created.statusCode,created.body).toBe(201);const meal=created.json<{meal:{origin:string;totals:{kcalPoint:number};items:{nutritionSource:string}[]}}>().meal;expect(meal.origin).toBe("manual");const exact=(kcalPer100:number,grams:number):number=>Math.round(kcalPer100*grams/100);expect(meal.totals.kcalPoint).toBe(exact(145,150)+exact(130,200));expect(meal.items.every((i)=>i.nutritionSource==="curated")).toBe(true);const earned=await sql<{code:string}[]>`SELECT code FROM user_achievements WHERE user_id=${m.userId}`;const codes=earned.map((v)=>v.code);expect(codes).toContain("first_meal");expect(codes).not.toContain("photo_meal");const unknown=await inject("POST","/v1/nutrition/meals",m.access,{mealName:"Mystery",takenAt:new Date().toISOString(),items:[{canonical:"definitely_not_a_food_xyz",grams:100}]});expect(unknown.statusCode).toBe(400);},30_000);

  // Preview endpoint (Kd-approved 2026-07-16 at the Card-5a smoke): the SERVER
  // answers "what would these grams be?" live, without saving — the client
  // never computes nutrition (2B). No quota (curated-table math, no AI spend).
  it("preview computes server-side nutrition without persisting or metering",async()=>{const before=await sql<{n:string}[]>`SELECT count(*) AS n FROM meal_logs WHERE user_id=${userA}`;const res=await inject("POST","/v1/nutrition/meals/preview",cookieA,{items:[{canonical:"dal_lentil_curry",grams:150},{canonical:"rice_white_cooked",grams:200}]});expect(res.statusCode,res.body).toBe(200);const preview=res.json<{items:{kcalPoint:number;proteinG:number}[];totals:{kcalPoint:number}}>();const exact=(kcalPer100:number,grams:number):number=>Math.round(kcalPer100*grams/100);expect(preview.totals.kcalPoint).toBe(exact(145,150)+exact(130,200));expect(preview.items).toHaveLength(2);const after=await sql<{n:string}[]>`SELECT count(*) AS n FROM meal_logs WHERE user_id=${userA}`;expect(after[0]?.n).toBe(before[0]?.n);},30_000);
  it("preview consumes no meal_scan quota in either window",async()=>{const read=async()=>[await redis.get(quotaKey("meal_scan",userA,"day",new Date())),await redis.get(quotaKey("meal_scan",userA,"month",new Date()))];const before=await read();expect((await inject("POST","/v1/nutrition/meals/preview",cookieA,{items:[{canonical:"dal_lentil_curry",grams:100}]})).statusCode).toBe(200);expect(await read()).toEqual(before);},30_000);
  it("preview: unknown food is 400, unauthenticated is 401, .strict() boundary rejects extra keys and bad grams",async()=>{expect((await inject("POST","/v1/nutrition/meals/preview",cookieA,{items:[{canonical:"definitely_not_a_food_xyz",grams:100}]})).statusCode).toBe(400);expect((await inject("POST","/v1/nutrition/meals/preview","",{items:[{canonical:"dal_lentil_curry",grams:100}]})).statusCode).toBe(401);expect((await inject("POST","/v1/nutrition/meals/preview",cookieA,{items:[{canonical:"dal_lentil_curry",grams:100}],smuggled:true})).statusCode).toBe(400);expect((await inject("POST","/v1/nutrition/meals/preview",cookieA,{items:[{canonical:"dal_lentil_curry",grams:-1}]})).statusCode).toBe(400);},30_000);

  // T3 finding (nutrition-preview): for OFF-sourced photo items the preview
  // MUST equal what confirm saves — both must read the same draft snapshot,
  // and previewing must not consume the single-use draft.
  it("preview with scanToken matches the confirmed meal exactly for an OFF-sourced draft item",async()=>{
    const offFood={canonical:"off_test_dish",name:"Test Dish",kcal:200,proteinG:10,carbsG:20,fatG:5,fiberG:0,serving:100,unit:"g",source:"openfoodfacts" as const};
    const offVision=fakeVision();offVision.queue.push({...goodEvidence,meal_name:"Test dish plate",items:[{name:"Test Dish",canonical_hint:"test dish",container:null,fill_level:null,size_class:null,count:1}]});
    const app3=await buildApp(loadConfig(env),{redis:createMemoryRedis(),nutrition:{visionProvider:offVision,foodSearchProvider:{search:()=>Promise.resolve([offFood])}}});
    try{
      const login=async(email:string)=>{await app3.inject({method:"POST",url:"/v1/auth/register",headers:{"content-type":"application/json"},payload:JSON.stringify({email,password:PASSWORD,displayName:"P26a OFF"})});const l=await app3.inject({method:"POST",url:"/v1/auth/login",headers:{"content-type":"application/json"},payload:JSON.stringify({email,password:PASSWORD})});return l.cookies.find((c)=>c.name==="accessToken")?.value??"";};
      const access=await login("p26a-off@example.com");
      const call=(url:string,body:unknown)=>app3.inject({method:"POST",url,headers:{"content-type":"application/json"},cookies:{accessToken:access},payload:JSON.stringify(body)});
      const scan=await call("/v1/nutrition/analyze-photo",{imageBase64:jpeg,mimeType:"image/jpeg"});
      expect(scan.statusCode,scan.body).toBe(200);
      const draft=scan.json<{scanToken:string;items:{canonical:string}[]}>();
      expect(draft.items[0]?.canonical).toBe("off_test_dish");
      const items=[{canonical:"off_test_dish",grams:250}];
      const preview=await call("/v1/nutrition/meals/preview",{scanToken:draft.scanToken,items});
      expect(preview.statusCode,preview.body).toBe(200);
      const previewed=preview.json<{items:{kcalPoint:number;portionSource:string}[];totals:Record<string,number>}>();
      // Previewing must NOT consume the draft: confirm still succeeds after it.
      const confirmed=await call("/v1/nutrition/meals",{scanToken:draft.scanToken,takenAt:new Date().toISOString(),items});
      expect(confirmed.statusCode,confirmed.body).toBe(201);
      const meal=confirmed.json<{meal:{items:{kcalPoint:number;portionSource:string}[];totals:Record<string,number>}}>().meal;
      expect(previewed.totals).toEqual(meal.totals);
      expect(previewed.items[0]?.kcalPoint).toBe(meal.items[0]?.kcalPoint);
      expect(previewed.items[0]?.portionSource).toBe(meal.items[0]?.portionSource);
    }finally{await app3.close();}
  },30_000);

  // Card-5b smoke finding: an OFF food shown by /v1/nutrition/foods could not
  // be LOGGED manually — findFood full-text-searched the canonical slug and
  // missed. Search results must stay resolvable by canonical afterwards.
  it("a food returned by search is manually loggable by its canonical (OFF slug)",async()=>{
    const offFood={canonical:"off_moong_dal_x",name:"Moong Dal",kcal:476,proteinG:21,carbsG:51,fatG:21,fiberG:0,serving:100,unit:"g",source:"openfoodfacts" as const};
    // Provider answers ONLY the human query — a canonical-slug query misses,
    // exactly like the real OFF full-text search.
    const provider={search:(q:string)=>Promise.resolve(q==="moong dal"?[offFood]:[])};
    const app4=await buildApp(loadConfig(env),{redis:createMemoryRedis(),nutrition:{visionProvider:fakeVision(),foodSearchProvider:provider}});
    try{
      await app4.inject({method:"POST",url:"/v1/auth/register",headers:{"content-type":"application/json"},payload:JSON.stringify({email:"p26a-off2@example.com",password:PASSWORD,displayName:"P26a OFF2"})});
      const l=await app4.inject({method:"POST",url:"/v1/auth/login",headers:{"content-type":"application/json"},payload:JSON.stringify({email:"p26a-off2@example.com",password:PASSWORD})});
      const access=l.cookies.find((c)=>c.name==="accessToken")?.value??"";
      const searched=await app4.inject({method:"GET",url:"/v1/nutrition/foods?q=moong%20dal",cookies:{accessToken:access}});
      expect(searched.statusCode).toBe(200);
      expect(searched.json<{items:{canonical:string}[]}>().items.some((f)=>f.canonical==="off_moong_dal_x")).toBe(true);
      const items=[{canonical:"off_moong_dal_x",grams:150}];
      const preview=await app4.inject({method:"POST",url:"/v1/nutrition/meals/preview",headers:{"content-type":"application/json"},cookies:{accessToken:access},payload:JSON.stringify({items})});
      expect(preview.statusCode,preview.body).toBe(200);
      const created=await app4.inject({method:"POST",url:"/v1/nutrition/meals",headers:{"content-type":"application/json"},cookies:{accessToken:access},payload:JSON.stringify({mealName:"Moong Dal",takenAt:new Date().toISOString(),items})});
      expect(created.statusCode,created.body).toBe(201);
      const meal=created.json<{meal:{totals:{kcalPoint:number}}}>().meal;
      expect(meal.totals.kcalPoint).toBe(Math.round(476*150/100));
    }finally{await app4.close();}
  },30_000);

  // Saving re-finds each food by its canonical, and a canonical holding another
  // food's (peanut_butter holds butter, pineapple holds apple) is still its own food.
  it("a food picked in the search box is the food priced, even when its canonical holds another food's",async()=>{
    const picked=["peanut_butter","almond_butter","orange_juice","apple_juice","pineapple","sweet_potato_baked","butter_chicken"];
    const res=await inject("POST","/v1/nutrition/meals/preview",cookieA,{items:picked.map((canonical)=>({canonical,grams:100}))});
    expect(res.statusCode,res.body).toBe(200);
    expect(res.json<{items:{canonical:string}[]}>().items.map((i)=>i.canonical)).toEqual(picked);
  },30_000);

  // A photo's count: pieces times the food's own piece (the Appendix B piece for a
  // hint that ends in it), vessels times one of what the photo shows them in, and
  // a serving by weight or a count of cut bits never multiplied.
  it("a photo's count multiplies pieces and vessels, never a weight or cut bits, and what matches no food is named",async()=>{
    const counted=fakeVision();
    const item=(canonical_hint:string,count:number,container:string|null=null)=>({name:canonical_hint,canonical_hint,container,fill_level:container===null?null:1,size_class:null,count});
    counted.queue.push({...goodEvidence,meal_name:"Counted plate",unknown_items:["Mystery sauce","  ","MYSTERY  sauce "],items:[item("chicken nuggets",6),item("chicken nugget pieces",6),item("pizza pieces",3),item("roti pieces",3),item("veggie burger",1),item("eggplant",1),item("apple",2),item("grapes",10),item("banana bread",2),item("boiled eggs",2),item("roti",3),item("banana slices",10),item("spring rolls",2),item("chapati flatbread",2),item("beer",2,"pint_glass"),item("bottles of beer",3),item("yogurt cups",2),item("beer",3,"mug"),item("beer mugs",3,"mug"),item("hot dog pieces",8),item("beef stew chunks",6),item("mugs of coffee",2),item("cans of coke",3),item("ramen bowl",25),{...item("mango_lassi",1),name:"  Mango  Lassi "},{...item("black_garlic_relish",1),name:"   "},item("mystery sauce",1)]});
    const a=await buildApp(loadConfig(env),{redis:createMemoryRedis(),nutrition:{visionProvider:counted,foodSearchProvider:noExternal}});
    try{
      const email="p26a-counted@example.com";
      await a.inject({method:"POST",url:"/v1/auth/register",headers:{"content-type":"application/json"},payload:JSON.stringify({email,password:PASSWORD,displayName:"P26a Counted"})});
      const login=await a.inject({method:"POST",url:"/v1/auth/login",headers:{"content-type":"application/json"},payload:JSON.stringify({email,password:PASSWORD})});
      const access=login.cookies.find((c)=>c.name==="accessToken")?.value??"";
      const call=(url:string,body:unknown)=>a.inject({method:"POST",url,cookies:{accessToken:access},headers:{"content-type":"application/json"},payload:JSON.stringify(body)});
      const dish=await call("/v1/nutrition/dishware",{label:"My pint glass",containerClass:"pint_glass",volumeMl:568});
      expect(dish.statusCode,dish.body).toBe(201);
      const scan=await call("/v1/nutrition/analyze-photo",{imageBase64:jpeg,mimeType:"image/jpeg"});
      expect(scan.statusCode,scan.body).toBe(200);
      const draft=mealPhotoAnalysisSchema.parse(scan.json());
      expect(draft.items.map((i)=>[i.canonical,i.gramsPoint,i.portionSource,i.pieces])).toEqual([
        ["chicken_nuggets",96,"default",6], // six 16 g nuggets, not one
        ["chicken_nuggets",96,"default",6], // six nugget pieces are six nuggets
        ["pizza_cheese",321,"default",3], // three slices, not one
        ["roti_chapati",120,"regional_prior",3], // three rotis, as "roti ×3" is
        ["veggie_burger",100,"default",1], // its own patty, not an egg's 50 g
        ["eggplant_cooked",100,"default",null], // a serving by weight, not an egg
        ["apple",360,"default",2],
        ["grapes",100,"default",null], // ten grapes are not ten 100 g servings
        ["banana_bread",120,"default",2], // two slices, not two bananas
        ["egg_hard_boiled",100,"regional_prior",2],
        ["roti_chapati",120,"regional_prior",3],
        ["banana",120,"default",null], // ten slices are one banana's serving, not ten bananas
        ["spring_roll",128,"default",2], // the egg roll, the closest entry, not dropped
        ["roti_chapati",80,"default",2], // the homemade roti, not the store-bought one
        ["beer_regular",1136,"user_dishware",2], // two of the person's own 568 ml pint glasses, not one
        ["beer_regular",1050,"default",3], // three bottles, not one
        ["yogurt_plain_low_fat",340,"default",2], // two pots, not one
        ["beer_regular",975,"regional_prior",3], // three mugs
        ["beer_regular",975,"regional_prior",3], // three mugs, however the hint names them
        ["hot_dog",102,"default",null], // pieces cut from one hot dog, not eight hot dogs
        ["beef_stew",255,"default",null], // chunks of one cup of stew, not six cups
        ["coffee_black",650,"regional_prior",2], // two mugs, as the hint names them
        ["coke_cola",1110,"default",3], // three 370 g cans
        ["ramen_bowl",490,"default",null], // 25 bowls would pass what one item may weigh
      ]);
      // What matches no food is named beside what the model could not identify, once
      // each, by its name as written (a blank name by its hint), never a blank entry.
      expect(draft.unknownItems).toEqual(["Mystery sauce","Mango Lassi","black garlic relish"]);
      // The stored draft still loads: the count of pieces is the sheet's, never the draft's.
      const confirmed=await call("/v1/nutrition/meals",{scanToken:draft.scanToken,takenAt:new Date().toISOString(),items:draft.items.map((i)=>({canonical:i.canonical,grams:i.gramsPoint}))});
      expect(confirmed.statusCode,confirmed.body).toBe(201);
    }finally{await a.close();}
  },30_000);

  // A packaged product prices a scanned item (§3.5) only where its name holds every
  // word of the item's hint: the search's top product for other words is another
  // food, so the item is named as not on the list instead of priced as that food.
  it("a scanned item takes a packaged product only when the product's name holds every word of its hint",async()=>{
    // Open Food Facts' own reply shape, through the real adapter: the search's top
    // product for every query, and Yakult's label, "1 bottle (65 ml)".
    const hit=(code:string,product_name:string,serving_size:string)=>({code,product_name,serving_size,nutriments:{"energy-kcal_100g":65}});
    const top=(q:string)=>q.includes("yakult")?hit("4901392000034","Yakult Original","1 bottle (65 ml)"):q.includes("noodles")?hit("4902105000001","Cup Noodles Chicken","1 cup (64 g)"):hit("1","Mystery","30 g");
    const answersEverything=createOpenFoodFactsProvider((input)=>Promise.resolve(new Response(JSON.stringify({hits:[top(input instanceof URL?(input.searchParams.get("q")??"").toLowerCase():"")]}),{status:200})));
    const scanned=fakeVision();
    const item=(name:string,canonical_hint:string,count:number|null=null)=>({name,canonical_hint,container:null,fill_level:null,size_class:null,count});
    scanned.queue.push({...goodEvidence,meal_name:"Packaged plate",unknown_items:[],items:[item("Mystery sauce","mystery sauce"),item("Yakult","bottles of yakult",3),item("Chips","chips"),item("Glass noodles","glass noodles")]});
    const a=await buildApp(loadConfig(env),{redis:createMemoryRedis(),nutrition:{visionProvider:scanned,foodSearchProvider:answersEverything}});
    try{
      const email="p26a-packaged@example.com";
      await a.inject({method:"POST",url:"/v1/auth/register",headers:{"content-type":"application/json"},payload:JSON.stringify({email,password:PASSWORD,displayName:"P26a Packaged"})});
      const login=await a.inject({method:"POST",url:"/v1/auth/login",headers:{"content-type":"application/json"},payload:JSON.stringify({email,password:PASSWORD})});
      const access=login.cookies.find((c)=>c.name==="accessToken")?.value??"";
      const scan=await a.inject({method:"POST",url:"/v1/nutrition/analyze-photo",cookies:{accessToken:access},headers:{"content-type":"application/json"},payload:JSON.stringify({imageBase64:jpeg,mimeType:"image/jpeg"})});
      expect(scan.statusCode,scan.body).toBe(200);
      const draft=mealPhotoAnalysisSchema.parse(scan.json());
      // Three 65 g bottles, by the label's own pack.
      expect(draft.items.map((i)=>[i.canonical,i.gramsPoint,i.pieces])).toEqual([["off_4901392000034",195,3]]);
      // Cup Noodles is no glass noodles: "glass" is the food's own word, not a measure.
      expect(draft.unknownItems).toEqual(["Mystery sauce","Chips","Glass noodles"]);
    }finally{await a.close();}
  },30_000);

  // The curated list carries each food's diet and citation for the server's own
  // use; the search box receives the fields every food has, as before.
  it("search sends a curated food's reference fields, never the list's diet or citation",async()=>{
    const res=await inject("GET","/v1/nutrition/foods?q=ham&limit=3",cookieA);
    expect(res.statusCode,res.body).toBe(200);
    const items=res.json<{items:Record<string,unknown>[]}>().items;
    expect(items[0]?.["canonical"]).toBe("ham_sliced");
    expect(items.length).toBeGreaterThan(0);
    for(const item of items)expect(Object.keys(item).sort()).toEqual(["canonical","carbsG","fatG","fiberG","kcal","name","proteinG","serving","source","unit"]);
  },30_000);

  // T3 (manual-off-foods) violation 1: an OFF slug EMBEDDING a curated
  // canonical (off_banana_chips ⊃ banana) must save the OFF macros the search
  // displayed — never hijack to curated banana via the fuzzy substring match.
  it("an off_ canonical embedding a curated slug saves the OFF food, not the curated hijack",async()=>{
    const chips={canonical:"off_banana_chips",name:"Banana Chips",kcal:519,proteinG:2.3,carbsG:58,fatG:34,fiberG:7.7,serving:30,unit:"g",source:"openfoodfacts" as const};
    const provider={search:(q:string)=>Promise.resolve(q==="banana chips"?[chips]:[])};
    const app5=await buildApp(loadConfig(env),{redis:createMemoryRedis(),nutrition:{visionProvider:fakeVision(),foodSearchProvider:provider}});
    try{
      await app5.inject({method:"POST",url:"/v1/auth/register",headers:{"content-type":"application/json"},payload:JSON.stringify({email:"p26a-off3@example.com",password:PASSWORD,displayName:"P26a OFF3"})});
      const l=await app5.inject({method:"POST",url:"/v1/auth/login",headers:{"content-type":"application/json"},payload:JSON.stringify({email:"p26a-off3@example.com",password:PASSWORD})});
      const access=l.cookies.find((c)=>c.name==="accessToken")?.value??"";
      await app5.inject({method:"GET",url:"/v1/nutrition/foods?q=banana%20chips",cookies:{accessToken:access}});
      const created=await app5.inject({method:"POST",url:"/v1/nutrition/meals",headers:{"content-type":"application/json"},cookies:{accessToken:access},payload:JSON.stringify({mealName:"Chips",takenAt:new Date().toISOString(),items:[{canonical:"off_banana_chips",grams:100}]})});
      expect(created.statusCode,created.body).toBe(201);
      const meal=created.json<{meal:{totals:{kcalPoint:number};items:{nutritionSource:string}[]}}>().meal;
      expect(meal.totals.kcalPoint).toBe(519); // OFF chips, NOT curated banana's 89
      expect(meal.items[0]?.nutritionSource).toBe("openfoodfacts");
    }finally{await app5.close();}
  },30_000);

  // Kd ruling 2026-07-17: mealType is a user-chosen label; takenAt stays the
  // exact real time. Nullable; PATCH null clears; invalid values 400.
  it("mealType: stored on create, patchable, clearable, invalid rejected",async()=>{
    const m=await session("p26a-mealtype@example.com");
    const created=await inject("POST","/v1/nutrition/meals",m.access,{mealName:"Late dal",takenAt:new Date().toISOString(),mealType:"dinner",items:[{canonical:"dal_lentil_curry",grams:150}]});
    expect(created.statusCode,created.body).toBe(201);
    const meal=created.json<{meal:{id:string;mealType:string|null}}>().meal;
    expect(meal.mealType).toBe("dinner");
    const relabeled=await inject("PATCH",`/v1/nutrition/meals/${meal.id}`,m.access,{mealType:"lunch"});
    expect(relabeled.json<{meal:{mealType:string|null}}>().meal.mealType).toBe("lunch");
    // takenAt edit does NOT disturb the label (the whole point of the ruling).
    const timeEdit=await inject("PATCH",`/v1/nutrition/meals/${meal.id}`,m.access,{takenAt:new Date(Date.now()-3600_000).toISOString()});
    expect(timeEdit.json<{meal:{mealType:string|null}}>().meal.mealType).toBe("lunch");
    const cleared=await inject("PATCH",`/v1/nutrition/meals/${meal.id}`,m.access,{mealType:null});
    expect(cleared.json<{meal:{mealType:string|null}}>().meal.mealType).toBeNull();
    expect((await inject("POST","/v1/nutrition/meals",m.access,{mealName:"Bad",takenAt:new Date().toISOString(),mealType:"brunch",items:[{canonical:"dal_lentil_curry",grams:100}]})).statusCode).toBe(400);
    // Unlabeled create stays null (no default invented).
    const plain=await inject("POST","/v1/nutrition/meals",m.access,{mealName:"Plain",takenAt:new Date().toISOString(),items:[{canonical:"dal_lentil_curry",grams:100}]});
    expect(plain.json<{meal:{mealType:string|null}}>().meal.mealType).toBeNull();
  },30_000);

  it("takenAt more than 24h in the future is a 400 (GAP-3)",async()=>{const future=new Date(Date.now()+25*60*60*1000).toISOString();const res=await inject("POST","/v1/nutrition/meals",cookieA,{mealName:"Time travel",takenAt:future,items:[{canonical:"dal_lentil_curry",grams:100}]});expect(res.statusCode).toBe(400);},30_000);

  // Card 5c — meal composition. These run on FRESH app instances (own
  // in-memory rate limiter + redis, the OFF-test precedent above) so they cost
  // nothing against the shared per-IP auth budget (DECISIONS 2026-07-11 GAP-4).
  async function freshApp(email:string){const a=await buildApp(loadConfig(env),{redis:createMemoryRedis(),nutrition:{visionProvider:fakeVision(),foodSearchProvider:noExternal}});await a.inject({method:"POST",url:"/v1/auth/register",headers:{"content-type":"application/json"},payload:JSON.stringify({email,password:PASSWORD,displayName:"P26a Comp"})});const l=await a.inject({method:"POST",url:"/v1/auth/login",headers:{"content-type":"application/json"},payload:JSON.stringify({email,password:PASSWORD})});const access=l.cookies.find((c)=>c.name==="accessToken")?.value??"";const call=(method:"GET"|"POST"|"PATCH"|"DELETE",url:string,body?:unknown)=>a.inject({method,url,cookies:{accessToken:access},headers:body===undefined?{}:{"content-type":"application/json"},...(body===undefined?{}:{payload:JSON.stringify(body)})});return{app:a,call};}

  // A photo CONFIRM may carry EXTRA items the user added by search beyond the
  // scan draft (the oats-with-milk case). The extra resolves via findFood at
  // rung 'default'; the originalItems-vs-items diff records the addition as a
  // Stage-5 correction (no new plumbing). Preview reads the same draft so live
  // math == what is saved; the draft survives the preview.
  it("confirm/preview accept an EXTRA item beyond the scan draft; addition is a Stage-5 correction",async()=>{
    const {app:a,call}=await freshApp("p26a-comp1@example.com");
    try{
      const scan=await call("POST","/v1/nutrition/analyze-photo",{imageBase64:jpeg,mimeType:"image/jpeg"});
      expect(scan.statusCode,scan.body).toBe(200);
      const draft=scan.json<{scanToken:string;items:{canonical:string;gramsPoint:number}[]}>();
      // draft = dal + roti; the user adds milk (curated, NOT in the draft).
      const items=[...draft.items.map((i)=>({canonical:i.canonical,grams:120})),{canonical:"milk_whole",grams:200}];
      // Preview includes the extra and does NOT consume the single-use draft.
      const preview=await call("POST","/v1/nutrition/meals/preview",{scanToken:draft.scanToken,items});
      expect(preview.statusCode,preview.body).toBe(200);
      const previewed=preview.json<{totals:Record<string,number>;items:{canonical:string}[]}>();
      expect(previewed.items.map((i)=>i.canonical)).toContain("milk_whole");
      const confirmed=await call("POST","/v1/nutrition/meals",{scanToken:draft.scanToken,takenAt:new Date().toISOString(),items});
      expect(confirmed.statusCode,confirmed.body).toBe(201);
      const meal=confirmed.json<{meal:{id:string;totals:Record<string,number>;items:{canonical:string;portionSource:string}[]}}>().meal;
      expect(meal.items).toHaveLength(3);
      expect(meal.items.map((i)=>i.canonical)).toContain("milk_whole");
      // added item is rung 'default' (it had no draft estimate).
      expect(meal.items.find((i)=>i.canonical==="milk_whole")?.portionSource).toBe("default");
      // preview equals what confirm saved.
      expect(previewed.totals).toEqual(meal.totals);
    }finally{await a.close();}
  },30_000);

  // T3 finding 2, degenerate case: a confirm whose items are ALL additions
  // (every drafted item deselected) estimated nothing, so there is no
  // correction and no rung to stamp. Without the guard, worst([]) falls through
  // every .some() and fabricates the BEST rung ('user_dishware') — a row
  // claiming user-dishware produced a corrected-away estimate that never was.
  it("an all-additions confirm writes NO correction row (worst([]) can never fabricate a rung)",async()=>{
    const {app:a,call}=await freshApp("p26a-comp4@example.com");
    try{
      const scan=await call("POST","/v1/nutrition/analyze-photo",{imageBase64:jpeg,mimeType:"image/jpeg"});
      const draft=scan.json<{scanToken:string}>();
      const confirmed=await call("POST","/v1/nutrition/meals",{scanToken:draft.scanToken,takenAt:new Date().toISOString(),items:[{canonical:"milk_whole",grams:200}]});
      expect(confirmed.statusCode,confirmed.body).toBe(201);
      const meal=confirmed.json<{meal:{id:string;items:{canonical:string}[]}}>().meal;
      expect(meal.items.map((i)=>i.canonical)).toEqual(["milk_whole"]);
      const corr=await sql<{portion_source:string|null}[]>`SELECT portion_source FROM meal_log_corrections WHERE meal_log_id=${meal.id}`;
      expect(corr).toHaveLength(0);
    }finally{await a.close();}
  },30_000);

  // T3 Card 5c F3: the confirm classification branch must NOT discard a draft
  // that take() successfully recovers. Simulate a Redis flap where get() is
  // momentarily blind (returns null) but take()'s Lua GET+DEL still sees the
  // key — confirmMeal must build from the recovered draft, not 400 it away.
  it("a confirm whose readDraft.get is blind but take() recovers the draft still succeeds (F3 flap)",async()=>{
    const base=createMemoryRedis();
    let blindGets=1; // blind for exactly the confirm's first draft get, then normal
    const flaky:RedisLike={
      incrWithTtl:(k,t)=>base.incrWithTtl(k,t),
      // The draft key (`meal-scan:`) reads null once — the "Redis momentarily
      // down" moment. take() below still sees it: the flap recovered.
      get:(k)=>k.startsWith("meal-scan:")&&blindGets-->0?Promise.resolve(null):base.get(k),
      setex:(k,t,v)=>base.setex(k,t,v),
      take:(k)=>base.take(k),
      del:(k)=>base.del(k),
      close:()=>base.close(),
    };
    const app6=await buildApp(loadConfig(env),{redis:flaky,nutrition:{visionProvider:fakeVision(),foodSearchProvider:noExternal}});
    try{
      await app6.inject({method:"POST",url:"/v1/auth/register",headers:{"content-type":"application/json"},payload:JSON.stringify({email:"p26a-flap@example.com",password:PASSWORD,displayName:"P26a Flap"})});
      const l=await app6.inject({method:"POST",url:"/v1/auth/login",headers:{"content-type":"application/json"},payload:JSON.stringify({email:"p26a-flap@example.com",password:PASSWORD})});
      const access=l.cookies.find((c)=>c.name==="accessToken")?.value??"";
      const c=(url:string,body:unknown)=>app6.inject({method:"POST",url,headers:{"content-type":"application/json"},cookies:{accessToken:access},payload:JSON.stringify(body)});
      const scan=await c("/v1/nutrition/analyze-photo",{imageBase64:jpeg,mimeType:"image/jpeg"});
      const draft=scan.json<{scanToken:string;items:{canonical:string}[]}>();
      const confirmed=await c("/v1/nutrition/meals",{scanToken:draft.scanToken,takenAt:new Date().toISOString(),items:draft.items.map((i)=>({canonical:i.canonical,grams:100}))});
      // The blind get would have 400'd on the old code; the recovered take saves it.
      expect(confirmed.statusCode,confirmed.body).toBe(201);
    }finally{await app6.close();}
  },30_000);

  // The other half of T3 finding 2: when the user BOTH corrects the estimate
  // and adds an item, the correction row covers the estimated items ONLY —
  // stamped with the rung that produced the corrected-away number.
  it("a corrected estimate + an added item: the correction records the estimate only, never the addition",async()=>{
    const {app:a,call}=await freshApp("p26a-comp3@example.com");
    try{
      const scan=await call("POST","/v1/nutrition/analyze-photo",{imageBase64:jpeg,mimeType:"image/jpeg"});
      const draft=scan.json<{scanToken:string;items:{canonical:string;gramsPoint:number}[]}>();
      const items=[...draft.items.map((i)=>({canonical:i.canonical,grams:i.gramsPoint+37})),{canonical:"milk_whole",grams:200}];
      const confirmed=await call("POST","/v1/nutrition/meals",{scanToken:draft.scanToken,takenAt:new Date().toISOString(),items});
      expect(confirmed.statusCode,confirmed.body).toBe(201);
      const meal=confirmed.json<{meal:{id:string;items:unknown[]}}>().meal;
      expect(meal.items).toHaveLength(3);
      const rows=await sql<{field:string;original:{canonical:string}[];corrected:{canonical:string}[];portion_source:string|null}[]>`
        SELECT field,original,corrected,portion_source FROM meal_log_corrections WHERE meal_log_id=${meal.id} AND field='items'`;
      expect(rows).toHaveLength(1);
      const row=rows[0];
      // Both sides carry the 2 ESTIMATED items; milk appears on neither.
      expect(row?.original.map((i)=>i.canonical)).toEqual(draft.items.map((i)=>i.canonical));
      expect(row?.corrected.map((i)=>i.canonical)).toEqual(draft.items.map((i)=>i.canonical));
      expect(row?.corrected.some((i)=>i.canonical==="milk_whole")).toBe(false);
      // stamped with the ESTIMATE's rung (dal/roti resolve via regional priors),
      // never the added item's 'default'.
      expect(row?.portion_source).toBe("regional_prior");
    }finally{await a.close();}
  },30_000);

  // T3 Card 5c: a rejected confirm must NOT consume the scan. takeDraft is
  // destructive, so resolving items after it meant one unresolvable ingredient
  // killed the scanToken outright — the user's only way back was another photo
  // (a fresh vision call + another quota unit) to fix one bad item.
  it("an EXTRA item with an unknown canonical 400s the confirm WITHOUT burning the scan; mealType persists through a photo confirm (5b T3 advisory)",async()=>{
    const {app:a,call}=await freshApp("p26a-comp2@example.com");
    try{
      const scan=await call("POST","/v1/nutrition/analyze-photo",{imageBase64:jpeg,mimeType:"image/jpeg"});
      const d=scan.json<{scanToken:string;items:{canonical:string}[]}>();
      const good=d.items.map((i)=>({canonical:i.canonical,grams:100}));
      // 1) unknown extra → 400 (never a silent drop).
      const bad=[...good,{canonical:"definitely_not_a_food_xyz",grams:100}];
      expect((await call("POST","/v1/nutrition/meals",{scanToken:d.scanToken,takenAt:new Date().toISOString(),items:bad})).statusCode).toBe(400);
      // 2) …and the SAME scanToken still works once the bad item is dropped —
      //    the whole point: fixing a typo must not cost another photo. This
      //    doubles as the mealType-through-photo-confirm assertion.
      const confirmed=await call("POST","/v1/nutrition/meals",{scanToken:d.scanToken,takenAt:new Date().toISOString(),mealType:"breakfast",items:good});
      expect(confirmed.statusCode,confirmed.body).toBe(201);
      expect(confirmed.json<{meal:{mealType:string|null}}>().meal.mealType).toBe("breakfast");
      // 3) the draft IS single-use: a replay of the now-consumed token 400s.
      expect((await call("POST","/v1/nutrition/meals",{scanToken:d.scanToken,takenAt:new Date().toISOString(),items:good})).statusCode).toBe(400);
    }finally{await a.close();}
  },30_000);

  it("Redis down: meal_scan fails CLOSED with 503 and the provider is never called (quotas.py doctrine)",async()=>{const downRedis=createMemoryRedis();const vision2=fakeVision();const app2=await buildApp(loadConfig(env),{redis:downRedis,nutrition:{visionProvider:vision2,foodSearchProvider:noExternal}});try{const login=await app2.inject({method:"POST",url:"/v1/auth/login",headers:{"content-type":"application/json"},payload:JSON.stringify({email:"p26a-alice@example.com",password:PASSWORD})});const access=login.cookies.find((c)=>c.name==="accessToken")?.value??"";downRedis.down=true;const res=await app2.inject({method:"POST",url:"/v1/nutrition/analyze-photo",headers:{"content-type":"application/json"},cookies:{accessToken:access},payload:JSON.stringify({imageBase64:jpeg,mimeType:"image/jpeg"})});expect(res.statusCode).toBe(503);expect(vision2.calls).toBe(0);}finally{await app2.close();}},30_000);

  it("cross-user: B cannot DELETE A's meal, confirm a foreign scanToken, or spend a foreign retake token (T3 R9 gap)",async()=>{
    // Fresh scanner C so this test never leans on A's quota budget.
    const c=await session("p26a-scanner@example.com");
    // B tries to delete A's meal.
    expect((await inject("DELETE",`/v1/nutrition/meals/${mealId}`,cookieB)).statusCode).toBe(404);
    // C scans; B tries to confirm C's scanToken → invalid (drafts are user-bound).
    const scan=await inject("POST","/v1/nutrition/analyze-photo",c.access,{imageBase64:jpeg,mimeType:"image/jpeg"});
    expect(scan.statusCode,scan.body).toBe(200);
    const foreignConfirm=await inject("POST","/v1/nutrition/meals",cookieB,{scanToken:scan.json<{scanToken:string}>().scanToken,takenAt:new Date().toISOString(),items:[{canonical:"dal_lentil_curry",grams:100}]});
    expect(foreignConfirm.statusCode).toBe(400);
    // C earns a retake; B tries to spend it → invalid (token keys are user-bound).
    vision.queue.push({...goodEvidence,photo_quality:"poor"});
    const poor=await inject("POST","/v1/nutrition/analyze-photo",c.access,{imageBase64:jpeg,mimeType:"image/jpeg"});
    expect(poor.statusCode,poor.body).toBe(422);
    const stolen=await inject("POST","/v1/nutrition/analyze-photo",cookieB,{imageBase64:jpeg,mimeType:"image/jpeg",retakeToken:poor.json<{retakeToken:string}>().retakeToken});
    expect(stolen.statusCode).toBe(400);
  },60_000);

  it("corrections written for items and taken_at edits too; confirm-time originalItems diff recorded (T3 R9 gap)",async()=>{
    // Fresh user E: scan → confirm (meal 1, changed grams → confirm-time
    // correction), then PATCH items+taken_at (edit-time corrections). 2 scans
    // total — inside the free 3/month budget.
    const e=await session("p26a-corrections@example.com");
    const scan1=await inject("POST","/v1/nutrition/analyze-photo",e.access,{imageBase64:jpeg,mimeType:"image/jpeg"});
    expect(scan1.statusCode,scan1.body).toBe(200);
    const body1=scan1.json<{scanToken:string;items:{canonical:string;gramsPoint:number}[]}>();
    const confirmed=await inject("POST","/v1/nutrition/meals",e.access,{scanToken:body1.scanToken,takenAt:new Date().toISOString(),items:body1.items.map((i)=>({canonical:i.canonical,grams:i.gramsPoint+37}))});
    expect(confirmed.statusCode,confirmed.body).toBe(201);
    const eMealId=confirmed.json<{meal:{id:string}}>().meal.id;
    // Confirm-time originalItems diff, stamped with the ORIGINAL rung.
    const conf=await sql<{field:string;portion_source:string|null}[]>`SELECT field,portion_source FROM meal_log_corrections WHERE meal_log_id=${eMealId}`;
    expect(conf.some((r)=>r.field==="items"&&r.portion_source==="regional_prior")).toBe(true);
    // Edit-time: items + taken_at PATCH each write a correction row.
    const newTime=new Date(Date.now()-60*60*1000).toISOString();
    const patch=await inject("PATCH",`/v1/nutrition/meals/${eMealId}`,e.access,{takenAt:newTime,items:[{canonical:"dal_lentil_curry",grams:250}]});
    expect(patch.statusCode,patch.body).toBe(200);
    const fields=await sql<{field:string}[]>`SELECT field FROM meal_log_corrections WHERE meal_log_id=${eMealId}`;
    const names=fields.map((f)=>f.field);
    expect(names).toContain("taken_at");
    expect(names.filter((n)=>n==="items").length).toBeGreaterThanOrEqual(2);
  },60_000);

  it("kcal display: exact integers (Kd 2026-07-16, supersedes §3.3 round-to-10) and point INSIDE its range",async()=>{
    const m=await session("p26a-round@example.com");
    // chicken breast 165 kcal/100g → exact collapsed range [165,165], point 165.
    const created=await inject("POST","/v1/nutrition/meals",m.access,{mealName:"Chicken",takenAt:new Date().toISOString(),items:[{canonical:"chicken_breast_cooked",grams:100}]});
    expect(created.statusCode,created.body).toBe(201);
    const item=created.json<{meal:{items:{kcalPoint:number;kcalLow:number;kcalHigh:number}[]}}>().meal.items[0];
    expect(item?.kcalLow).toBe(165);
    expect(item?.kcalHigh).toBe(165);
    expect(item?.kcalPoint).toBe(165);
    expect((item?.kcalPoint??0)>=(item?.kcalLow??0)&&(item?.kcalPoint??0)<=(item?.kcalHigh??1)).toBe(true);
  },30_000);

  // The profile's weight IS the newest weight-bearing measurement by date, and a
  // typed weight (PATCH /v1/users/me) is a measurement of its own — so deleting
  // the last weigh-in falls back to what was typed, never to a blank. The
  // weigh-in is dated one second after the TYPED row (read back, not assumed),
  // so it outranks it by date and not by this process's clock. Emptying the
  // number is its own request, made at the end.
  it("dishware and body measurement CRUD are tenant-scoped; a measurement sets current weight",async()=>{const dish=await inject("POST","/v1/nutrition/dishware",cookieA,{label:"My katori",containerClass:"standard_katori",volumeMl:180});dishId=dish.json<{dishware:{id:string}}>().dishware.id;expect((await inject("PATCH",`/v1/nutrition/dishware/${dishId}`,cookieB,{volumeMl:999})).statusCode).toBe(404);const weightOf=async()=>(await inject("GET","/v1/users/me",cookieA)).json<{user:{weightKg:number|null}}>().user.weightKg;expect((await inject("PATCH","/v1/users/me",cookieA,{weightKg:70})).statusCode).toBe(200);expect(await weightOf()).toBe(70);const typedAt=(await sql<{measured_at:Date}[]>`SELECT measured_at FROM body_measurements WHERE user_id=${userA} AND source='self_reported' ORDER BY measured_at DESC LIMIT 1`)[0]?.measured_at;if(typedAt===undefined)throw new Error("the typed weight wrote no row");const measurement=await inject("POST","/v1/nutrition/body-measurements",cookieA,{measuredAt:new Date(typedAt.getTime()+1000).toISOString(),weightKg:72.5,metrics:{waist_cm:80}});measurementId=measurement.json<{measurement:{id:string}}>().measurement.id;expect(await weightOf()).toBe(72.5);expect((await inject("DELETE",`/v1/nutrition/body-measurements/${measurementId}`,cookieB)).statusCode).toBe(404);expect((await inject("DELETE",`/v1/nutrition/body-measurements/${measurementId}`,cookieA)).statusCode).toBe(204);expect(await weightOf()).toBe(70);expect((await inject("PATCH","/v1/users/me",cookieA,{weightKg:null})).statusCode).toBe(200);expect(await weightOf()).toBeNull();},30_000);

  // A typed row must stay a typed row: the PATCH refuses `source` (and any
  // other key it does not know) as a 400 at the boundary, never as a silent drop.
  // A stranger's edit is a 404 that changes nothing, and every row the routes
  // send matches the shared contract — createdAt included, which the web
  // needs to date a typed row.
  it("PATCH body-measurement: source and stray keys are 400, a stranger's edit is 404, a real edit is 200",async()=>{
    const created=await inject("POST","/v1/nutrition/body-measurements",cookieA,{measuredAt:new Date().toISOString(),weightKg:75});
    expect(created.statusCode,created.body).toBe(201);
    const id=bodyMeasurementSchema.parse(created.json<{measurement:unknown}>().measurement).id;
    expect((await inject("PATCH",`/v1/nutrition/body-measurements/${id}`,cookieA,{source:"manual"})).statusCode).toBe(400);
    expect((await inject("PATCH",`/v1/nutrition/body-measurements/${id}`,cookieA,{weightKg:76,source:"self_reported"})).statusCode).toBe(400);
    expect((await inject("PATCH",`/v1/nutrition/body-measurements/${id}`,cookieA,{weightKg:76,smuggled:true})).statusCode).toBe(400);
    const edited=await inject("PATCH",`/v1/nutrition/body-measurements/${id}`,cookieA,{weightKg:76});
    expect(edited.statusCode,edited.body).toBe(200);
    expect(bodyMeasurementSchema.parse(edited.json<{measurement:unknown}>().measurement)).toMatchObject({weightKg:76,source:"manual"});
    expect((await inject("PATCH",`/v1/nutrition/body-measurements/${id}`,cookieB,{weightKg:99})).statusCode).toBe(404);
    const [still]=await sql<{weight_kg:string|null}[]>`SELECT weight_kg FROM body_measurements WHERE id=${id}`;
    expect(still?.weight_kg).toBe("76.00");
    const list=await inject("GET","/v1/nutrition/body-measurements?limit=100",cookieA);
    expect(list.statusCode).toBe(200);
    expect(bodyMeasurementListResponseSchema.parse(list.json()).items.find((m)=>m.id===id)).toMatchObject({weightKg:76,source:"manual"});
    const theirs=await inject("GET","/v1/nutrition/body-measurements?limit=100",cookieB);
    expect(bodyMeasurementListResponseSchema.parse(theirs.json()).items.some((m)=>m.id===id)).toBe(false);
    expect((await inject("DELETE",`/v1/nutrition/body-measurements/${id}`,cookieA)).statusCode).toBe(204);
  },30_000);

  // Card 5c2 — dishware portions: an item's amount can be "my dish, this full"
  // instead of grams; the SERVER computes grams (volume × fill × density) at
  // rung 'user_dishware', the same math the scan resolver uses.
  it("a manual/preview item measured with saved dishware is server-priced at rung user_dishware",async()=>{
    const {app:a,call}=await freshApp("p26a-dish1@example.com");
    try{
      // dal density = medium (1.0); 180 ml × 0.75 full × 1.0 = 135 g.
      const dish=await call("POST","/v1/nutrition/dishware",{label:"My dal katori",containerClass:"standard_katori",volumeMl:180});
      const dishwareId=dish.json<{dishware:{id:string}}>().dishware.id;
      const item={canonical:"dal_lentil_curry",dishwareId,fillLevel:0.75};
      // preview must equal what save writes (the standing trust rule).
      const preview=await call("POST","/v1/nutrition/meals/preview",{items:[item]});
      expect(preview.statusCode,preview.body).toBe(200);
      const pv=preview.json<{items:{gramsPoint:number;portionSource:string;kcalPoint:number}[]}>().items[0];
      expect(pv?.gramsPoint).toBe(135);
      expect(pv?.portionSource).toBe("user_dishware");
      expect(pv?.kcalPoint).toBe(Math.round(145*135/100)); // dal 145 kcal/100g
      const created=await call("POST","/v1/nutrition/meals",{mealName:"Dal",takenAt:new Date().toISOString(),items:[item]});
      expect(created.statusCode,created.body).toBe(201);
      const saved=created.json<{meal:{items:{gramsPoint:number;portionSource:string;kcalPoint:number}[]}}>().meal.items[0];
      expect(saved).toEqual(pv);
    }finally{await a.close();}
  },30_000);

  it("dishware arm: foreign dishwareId 400s (tenancy); a hybrid grams+dishware item is rejected",async()=>{
    const owner=await freshApp("p26a-dish2@example.com");
    const stranger=await freshApp("p26a-dish3@example.com");
    try{
      const dish=await owner.call("POST","/v1/nutrition/dishware",{label:"mine",containerClass:"standard_katori",volumeMl:200});
      const dishwareId=dish.json<{dishware:{id:string}}>().dishware.id;
      // the STRANGER cannot resolve the owner's dishware → 400, not someone else's grams.
      const foreign=await stranger.call("POST","/v1/nutrition/meals",{mealName:"x",takenAt:new Date().toISOString(),items:[{canonical:"dal_lentil_curry",dishwareId,fillLevel:0.5}]});
      expect(foreign.statusCode).toBe(400);
      // a hybrid item ({canonical,grams,dishwareId}) matches NEITHER strict arm → 400.
      const hybrid=await owner.call("POST","/v1/nutrition/meals",{mealName:"x",takenAt:new Date().toISOString(),items:[{canonical:"dal_lentil_curry",grams:100,dishwareId,fillLevel:0.5}]});
      expect(hybrid.statusCode).toBe(400);
      // fillLevel out of (0,1] → 400.
      const badFill=await owner.call("POST","/v1/nutrition/meals",{mealName:"x",takenAt:new Date().toISOString(),items:[{canonical:"dal_lentil_curry",dishwareId,fillLevel:1.5}]});
      expect(badFill.statusCode).toBe(400);
    }finally{await owner.app.close();await stranger.app.close();}
  },30_000);

  it("dishware arm is bounds-symmetric with the grams arm: a round-to-0 and an >10000g result both 400 (T3 F1)",async()=>{
    const {app:a,call}=await freshApp("p26a-dish5@example.com");
    try{
      // 1 ml dish × 0.25 fill → rounds to 0 g → would breach mealItemSchema.positive.
      const tiny=await call("POST","/v1/nutrition/dishware",{label:"thimble",containerClass:"x",volumeMl:1});
      const tinyId=tiny.json<{dishware:{id:string}}>().dishware.id;
      expect((await call("POST","/v1/nutrition/meals",{mealName:"z",takenAt:new Date().toISOString(),items:[{canonical:"dal_lentil_curry",dishwareId:tinyId,fillLevel:0.25}]})).statusCode).toBe(400);
      // 10000 ml × full × thick(1.1) = 11000 g → over the grams arm's 10000 cap.
      const huge=await call("POST","/v1/nutrition/dishware",{label:"vat",containerClass:"x",volumeMl:10000});
      const hugeId=huge.json<{dishware:{id:string}}>().dishware.id;
      expect((await call("POST","/v1/nutrition/meals",{mealName:"z",takenAt:new Date().toISOString(),items:[{canonical:"dry_sabzi",dishwareId:hugeId,fillLevel:1}]})).statusCode).toBe(400);
    }finally{await a.close();}
  },30_000);

  it("PATCH re-measures a saved meal's item with dishware → grams recomputed, rung user_dishware (T3 F2)",async()=>{
    const {app:a,call}=await freshApp("p26a-dish6@example.com");
    try{
      const dish=await call("POST","/v1/nutrition/dishware",{label:"My katori",containerClass:"standard_katori",volumeMl:200});
      const dishwareId=dish.json<{dishware:{id:string}}>().dishware.id;
      // start with a grams-based manual meal, then PATCH the item to a dishware measure.
      const created=await call("POST","/v1/nutrition/meals",{mealName:"Dal",takenAt:new Date().toISOString(),items:[{canonical:"dal_lentil_curry",grams:150}]});
      const mealId=created.json<{meal:{id:string}}>().meal.id;
      const patched=await call("PATCH",`/v1/nutrition/meals/${mealId}`,{items:[{canonical:"dal_lentil_curry",dishwareId,fillLevel:0.5}]});
      expect(patched.statusCode,patched.body).toBe(200);
      const item=patched.json<{meal:{items:{gramsPoint:number;portionSource:string}[]}}>().meal.items[0];
      expect(item?.gramsPoint).toBe(Math.round(200*0.5*1.0)); // 100 g
      expect(item?.portionSource).toBe("user_dishware");
      // a foreign dishwareId on PATCH is denied too (tenancy holds on this path).
      const stranger=await freshApp("p26a-dish7@example.com");
      try{
        const s=await stranger.call("POST","/v1/nutrition/dishware",{label:"theirs",containerClass:"x",volumeMl:300});
        const sId=s.json<{dishware:{id:string}}>().dishware.id;
        expect((await call("PATCH",`/v1/nutrition/meals/${mealId}`,{items:[{canonical:"dal_lentil_curry",dishwareId:sId,fillLevel:0.5}]})).statusCode).toBe(400);
      }finally{await stranger.app.close();}
    }finally{await a.close();}
  },30_000);

  it("photo confirm accepts a dishware-arm item on a drafted food (in-flow bowl measure)",async()=>{
    const {app:a,call}=await freshApp("p26a-dish4@example.com");
    try{
      const dish=await call("POST","/v1/nutrition/dishware",{label:"My katori",containerClass:"standard_katori",volumeMl:200});
      const dishwareId=dish.json<{dishware:{id:string}}>().dishware.id;
      const scan=await call("POST","/v1/nutrition/analyze-photo",{imageBase64:jpeg,mimeType:"image/jpeg"});
      const draft=scan.json<{scanToken:string;items:{canonical:string}[]}>();
      // measure the drafted "dal" with the katori, keep the roti in grams.
      const items=draft.items.map((i)=>i.canonical==="dal_lentil_curry"
        ? {canonical:i.canonical,dishwareId,fillLevel:0.5}
        : {canonical:i.canonical,grams:80});
      const confirmed=await call("POST","/v1/nutrition/meals",{scanToken:draft.scanToken,takenAt:new Date().toISOString(),items});
      expect(confirmed.statusCode,confirmed.body).toBe(201);
      const dal=confirmed.json<{meal:{items:{canonical:string;gramsPoint:number;portionSource:string}[]}}>().meal.items.find((i)=>i.canonical==="dal_lentil_curry");
      expect(dal?.gramsPoint).toBe(Math.round(200*0.5*1.0)); // 100 g
      expect(dal?.portionSource).toBe("user_dishware");
    }finally{await a.close();}
  },30_000);

  // The macro rings (ROADMAP 4a-iii): the person's own PLAN — the number the
  // onboarding screens show, from the same stored answers — or the plan's own
  // list of the questions still open. Never a number built from a default.
  it("serves the plan's own numbers, names the questions still open, and never crosses users",async()=>{
    const t=await session("p26a-targets@example.com");
    expect((await inject("GET","/v1/nutrition/targets","")).statusCode).toBe(401);

    // A brand-new user: no number, and every core answer of the plan missing.
    const empty=await inject("GET","/v1/nutrition/targets",t.access);
    expect(empty.statusCode,empty.body).toBe(200);
    expect(empty.json()).toEqual({targets:null,missing:["goal","age","gender","heightCm","weightKg","dayActivity","trainingDays","sessionMinutes"],targetWrongSide:false});

    // Someone who finished the OLD form: it never asked the weight choice or
    // "your day", so the rings name exactly those two, however complete the
    // rest is. The weight lives in the weigh-in history, so this read spans
    // both tables.
    expect((await inject("PUT","/v1/users/me/fitness-profile",t.access,{age:30,gender:"female",heightCm:165,exerciseFrequency:3,sessionDurationMin:45,fitnessGoals:["flexibility"]})).statusCode).toBe(200);
    // The old form finished setup before today's questions existed. The route
    // refuses that finish now (4b-ii), so the row is stamped the way it left it.
    await sql`UPDATE user_fitness_profiles SET onboarding_completed = true WHERE user_id = ${t.userId}`;
    expect((await inject("PATCH","/v1/users/me",t.access,{weightKg:70})).statusCode).toBe(200);
    const old=await inject("GET","/v1/nutrition/targets",t.access);
    expect(old.json()).toEqual({targets:null,missing:["goal","dayActivity"],targetWrongSide:false});

    // Answered on the onboarding screens, the rings carry the plan: the golden
    // of users.onboarding.routes.test.ts, and field by field what that route says.
    for(const answers of [{weightGoal:"lose"},{targetWeightKg:65,pace:"steady"},{dayActivity:"sitting"}])
      expect((await inject("PATCH","/v1/users/me/onboarding",t.access,answers)).statusCode).toBe(200);
    type Plan={restingBurnKcal:number;dailyBurnKcal:number;targetKcal:number;proteinG:number;carbsG:number;fatG:number};
    const planOf=async(access:string)=>(await inject("GET","/v1/users/me/onboarding",access)).json<{plan:Plan}>().plan;
    const ringsOf=(p:Plan)=>({bmr:p.restingBurnKcal,tdee:p.dailyBurnKcal,kcal:p.targetKcal,proteinG:p.proteinG,carbsG:p.carbsG,fatG:p.fatG,noCalorieCut:false});
    const done=await inject("GET","/v1/nutrition/targets",t.access);
    expect(done.json()).toEqual({targets:{bmr:1420,tdee:1817,kcal:1267,proteinG:140,carbsG:98,fatG:35,noCalorieCut:false},missing:[],targetWrongSide:false});
    expect(done.json<{targets:unknown}>().targets).toEqual(ringsOf(await planOf(t.access)));

    // R7.2 (T3 finding): every arm is parsed through the SHARED contract, so
    // the route's shape and the client's types cannot drift apart silently.
    // .strict() means an extra key here would fail, not be quietly carried.
    for(const res of [done,old,empty])expect(nutritionTargetsResponseSchema.safeParse(res.json()).success).toBe(true);

    // Tenancy: this route takes no id, so the proof is that a second person gets
    // THEIR plan and neither leaks into the other. Their body is heavy (120 kg
    // at 175 cm), so their protein is counted on the BMI-30 weight, 91.88 kg.
    const u=await session("p26a-targets2@example.com");
    expect((await inject("PATCH","/v1/users/me/onboarding",u.access,{weightGoal:"lose",age:35,gender:"male",heightCm:175,weightKg:120,targetWeightKg:90,pace:"steady",dayActivity:"sitting",trainingDays:3,sessionMinutes:45})).statusCode).toBe(200);
    const theirs=await inject("GET","/v1/nutrition/targets",u.access);
    expect(theirs.json()).toEqual({targets:{bmr:2124,tdee:2742,kcal:2192,proteinG:184,carbsG:227,fatG:61,noCalorieCut:false},missing:[],targetWrongSide:false});
    expect(theirs.json<{targets:unknown}>().targets).toEqual(ringsOf(await planOf(u.access)));
    expect((await inject("GET","/v1/nutrition/targets",t.access)).json<{targets:{kcal:number}}>().targets.kcal).toBe(1267);
  },30_000);

  // ── What a failed scan costs the person, and what they are told ─────────────
  /** A scanner that plays its steps in order: evidence, or a failure it throws. */
  const scripted=(...steps:(VisionEvidence|Error)[]):VisionProvider=>({analyze(){const step=steps.shift()??goodEvidence;return step instanceof Error?Promise.reject(step):Promise.resolve({evidence:step,tokensIn:100,tokensOut:200} satisfies VisionResult);}});
  /** An app of its own on this database, signed in as a new person. `fetchForScanner`
   *  is the global fetch while the app is built, which is when the real scanner takes it. */
  async function scanApp(email:string,options:{env?:Record<string,string>;vision?:VisionProvider;fetchForScanner?:typeof fetch;clock?:()=>number}={}){
    const scanRedis=createMemoryRedis(options.clock);
    if(options.fetchForScanner!==undefined)vi.stubGlobal("fetch",options.fetchForScanner);
    let built:App;
    try{built=await buildApp(loadConfig({...env,...options.env}),{redis:scanRedis,nutrition:{...(options.vision===undefined?{}:{visionProvider:options.vision}),foodSearchProvider:noExternal}});}
    finally{vi.unstubAllGlobals();}
    const post=(url:string,body:unknown,access?:string)=>built.inject({method:"POST",url,headers:{"content-type":"application/json"},...(access===undefined?{}:{cookies:{accessToken:access}}),payload:JSON.stringify(body)});
    /** A new person signed in on this app, sharing its scanner and its Redis. */
    const person=async(personEmail:string)=>{
      const reg=await post("/v1/auth/register",{email:personEmail,password:PASSWORD,displayName:"P26a Scan"});
      if(reg.statusCode!==201)throw new Error(reg.body);
      const userId=reg.json<{userId:string}>().userId;
      const access=(await post("/v1/auth/login",{email:personEmail,password:PASSWORD})).cookies.find((c)=>c.name==="accessToken")?.value??"";
      return{
        userId,
        scan:(retakeToken?:string)=>post("/v1/nutrition/analyze-photo",{imageBase64:jpeg,mimeType:"image/jpeg",...(retakeToken===undefined?{}:{retakeToken})},access),
        scansUsed:()=>scanRedis.get(quotaKey("meal_scan",userId,"day",new Date())),
        costRows:async()=>(await sql<{provider:string;units:string|number;cost_micro:string|number}[]>`SELECT provider, units, cost_micro FROM api_cost_events WHERE user_id=${userId} AND feature='meal_scan' ORDER BY at`).map((r)=>({provider:r.provider,units:Number(r.units),costMicro:String(r.cost_micro)})),
      };
    };
    return{app:built,person,...(await person(email))};
  }
  type Failed={error:string;message:string;retakeToken?:string;requestId:string};
  type Scanned=Awaited<ReturnType<Awaited<ReturnType<typeof scanApp>>["scan"]>>;
  const loggedFailures=(calls:unknown[][])=>calls.map((c)=>c[0]).filter((o)=>typeof o==="object"&&o!==null&&"event" in o&&o.event==="nutrition.scan_failed");
  /** The free retry a failed scan came back with; a test that expects one fails here without it. */
  const freeRetryOf=(res:Scanned):string=>{const t=res.json<Failed>().retakeToken;if(t===undefined)throw new Error(`no free retry: ${res.body}`);return t;};
  const BUSY="Meal scanning is busy right now. Please try again in a minute.";
  const UNAVAILABLE={error:"nutrition_unavailable",message:"Meal scanning is temporarily unavailable."};
  /** A failed scan's body without its request id, which is checked to be there. */
  const bodyOf=(res:Scanned)=>{const{requestId,...body}=res.json<Failed>();expect(typeof requestId).toBe("string");return body;};
  const googleReply=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json"}});

  it("a scanner outage is never blamed on the photo: busy with a free retry, at most three in ten minutes; nothing ledgered; a log line each",async()=>{
    let now=Date.now();
    const s=await scanApp("p26a-outage@example.com",{clock:()=>now,vision:scripted(
      new VisionProviderError("vision HTTP 429","unavailable"),
      new VisionProviderError("vision network failure","unavailable"),
      new VisionProviderError("vision malformed completion","unavailable"),
      new VisionProviderError("vision HTTP 503","unavailable"),
      new VisionProviderError("vision HTTP 429","unavailable"),
      new VisionProviderError("vision network failure","unavailable"),
      goodEvidence,
    )});
    try{
      const logged=vi.spyOn(s.app.log,"error").mockImplementation(()=>undefined);
      // A counted scan meets the outage, and so do its first, second and third free retries.
      const first=await s.scan();
      const second=await s.scan(freeRetryOf(first));
      const third=await s.scan(freeRetryOf(second));
      const fourth=await s.scan(freeRetryOf(third));
      for(const res of [first,second,third,fourth]){
        expect(res.statusCode,res.body).toBe(503);
        expect(res.json<Failed>()).toMatchObject({error:"scanner_unavailable",message:BUSY});
      }
      expect(new Set([first,second,third].map(freeRetryOf)).size).toBe(3);
      // The third free retry is the last in ten minutes: still busy, with no fourth.
      expect(fourth.json<Failed>()).not.toHaveProperty("retakeToken");
      expect(await s.scansUsed()).toBe("1");
      // The limit is this person's: someone else meeting the same outage still gets their free retry.
      const other=await s.person("p26a-outage-other@example.com");
      const theirs=await other.scan();
      expect(theirs.json<Failed>()).toMatchObject({error:"scanner_unavailable",message:BUSY});
      freeRetryOf(theirs);
      // Ten minutes on, the next try is a scan of its own, and its outage earns a free retry again.
      now+=RETAKE_TTL_SECONDS*1000;
      const fifth=await s.scan();
      expect(fifth.json<Failed>()).toMatchObject({error:"scanner_unavailable",message:BUSY});
      expect(await s.scansUsed()).toBe("2");
      const good=await s.scan(freeRetryOf(fifth));
      expect(good.statusCode,good.body).toBe(200);
      expect(await s.scansUsed()).toBe("2");
      const line=(res:Scanned,reason:string,userId=s.userId)=>({event:"nutrition.scan_failed",userId,model:"gemini-3.5-flash-lite",kind:"unavailable",reason,requestId:res.json<Failed>().requestId});
      expect(loggedFailures(logged.mock.calls)).toEqual([
        line(first,"vision HTTP 429"),line(second,"vision network failure"),line(third,"vision malformed completion"),line(fourth,"vision HTTP 503"),
        line(theirs,"vision HTTP 429",other.userId),line(fifth,"vision network failure"),
      ]);
      // An outage brings back no usage, so the one row is the good scan's.
      expect((await s.costRows()).map((r)=>r.units)).toEqual([300]);
    }finally{await s.app.close();}
  },30_000);

  it("a photo Google refuses is never sent for nothing: every try is a counted scan with no free retry, until the day's scans run out",async()=>{
    // The review's case: a file that starts with JPEG bytes and is no picture, which Google answers 400.
    let calls=0;
    const refuses:typeof fetch=()=>{calls++;return Promise.resolve(googleReply(400,{error:{code:400,message:"Unable to process input image.",status:"INVALID_ARGUMENT"}}));};
    const s=await scanApp("p26a-refused@example.com",{env:{GEMINI_API_KEY:"p26a-gemini-test-key"},fetchForScanner:refuses}); // gitleaks:allow
    try{
      const logged=vi.spyOn(s.app.log,"error").mockImplementation(()=>undefined);
      const tries:Scanned[]=[];
      for(let i=0;i<5;i++)tries.push(await s.scan());
      expect(tries.map((r)=>r.statusCode)).toEqual([503,503,429,429,429]);
      for(const res of tries.slice(0,2))expect(bodyOf(res)).toEqual(UNAVAILABLE);
      expect(tries.every((r)=>!("retakeToken" in r.json<object>()))).toBe(true);
      expect(calls).toBe(2);
      expect(loggedFailures(logged.mock.calls)).toEqual(tries.slice(0,2).map((res)=>({event:"nutrition.scan_failed",userId:s.userId,model:"gemini-3.5-flash-lite",kind:"refused",reason:"vision HTTP 400",requestId:res.json<Failed>().requestId})));
      expect(await s.costRows()).toEqual([]);
    }finally{await s.app.close();}
  },30_000);

  it("through the real scanner, Google's 429 and a reply that is not Google's are busy with a free retry, and neither is ledgered",async()=>{
    const answers=[
      googleReply(429,{error:{code:429,status:"RESOURCE_EXHAUSTED"}}),
      googleReply(200,{candidates:"not Gemini's"}),
      googleReply(200,{candidates:[{content:{parts:[{text:JSON.stringify(goodEvidence)}]}}],usageMetadata:{promptTokenCount:400,candidatesTokenCount:100}}),
    ];
    const google:typeof fetch=()=>{const next=answers.shift();return next===undefined?Promise.reject(new Error("no answer left")):Promise.resolve(next);};
    const s=await scanApp("p26a-google-busy@example.com",{env:{GEMINI_API_KEY:"p26a-gemini-test-key"},fetchForScanner:google}); // gitleaks:allow
    try{
      vi.spyOn(s.app.log,"error").mockImplementation(()=>undefined);
      const limited=await s.scan();
      expect(limited.json<Failed>()).toMatchObject({error:"scanner_unavailable",message:BUSY});
      const broken=await s.scan(freeRetryOf(limited));
      expect(broken.json<Failed>()).toMatchObject({error:"scanner_unavailable",message:BUSY});
      const good=await s.scan(freeRetryOf(broken));
      expect(good.statusCode,good.body).toBe(200);
      expect(answers).toEqual([]);
      expect(await s.scansUsed()).toBe("1");
      expect(await s.costRows()).toEqual([{provider:"gemini:gemini-3.5-flash-lite",units:500,costMicro:"370"}]);
    }finally{await s.app.close();}
  },30_000);

  it("a fault in the scanner is never called busy: temporarily unavailable with no free retry, logged with its error and sent to Sentry with the request id; a refusal is not sent",async()=>{
    const fault=new TypeError("Cannot read properties of undefined (reading 'parts')");
    const s=await scanApp("p26a-fault@example.com",{env:{SENTRY_DSN:"https://public@sentry.example.com/1"},vision:scripted(fault,new VisionProviderError("vision HTTP 403","refused"))});
    try{
      sentry.captureException.mockClear();
      const logged=vi.spyOn(s.app.log,"error").mockImplementation(()=>undefined);
      const res=await s.scan();
      expect(res.statusCode,res.body).toBe(503);
      expect(bodyOf(res)).toEqual(UNAVAILABLE);
      const body=res.json<Failed>();
      expect(sentry.captureException.mock.calls).toEqual([[fault,{extra:{requestId:body.requestId}}]]);
      const refused=await s.scan();
      expect(bodyOf(refused)).toEqual(UNAVAILABLE);
      expect(sentry.captureException).toHaveBeenCalledTimes(1);
      expect(await s.scansUsed()).toBe("2");
      expect(loggedFailures(logged.mock.calls)).toEqual([
        {event:"nutrition.scan_failed",userId:s.userId,model:"gemini-3.5-flash-lite",kind:"fault",reason:"TypeError",requestId:body.requestId,err:fault},
        {event:"nutrition.scan_failed",userId:s.userId,model:"gemini-3.5-flash-lite",kind:"refused",reason:"vision HTTP 403",requestId:refused.json<Failed>().requestId},
      ]);
      expect(await s.costRows()).toEqual([]);
    }finally{await s.app.close();}
  },30_000);

  it("a reply the model sent that cannot be used keeps the photo's wording and ONE free retake, ledgers its spend, and logs a warning",async()=>{
    const unusable=()=>new VisionProviderError("vision malformed evidence shape","unreadable",{tokensIn:10,tokensOut:20});
    const s=await scanApp("p26a-unusable@example.com",{vision:scripted(unusable(),unusable())});
    try{
      const warned=vi.spyOn(s.app.log,"warn").mockImplementation(()=>undefined);
      const photo="We could not read that photo. Please retake it with the full plate in frame.";
      const first=await s.scan();
      expect(first.statusCode,first.body).toBe(422);
      expect(first.json<Failed>()).toMatchObject({error:"retake_required",message:photo});expect(typeof first.json<Failed>().retakeToken).toBe("string");
      const second=await s.scan(first.json<Failed>().retakeToken);
      expect(second.statusCode,second.body).toBe(422);
      expect(second.json<Failed>()).toMatchObject({error:"retake_required",message:photo});
      expect(second.json<Failed>()).not.toHaveProperty("retakeToken");
      expect(await s.scansUsed()).toBe("1");
      const warning=(res:Scanned)=>({event:"nutrition.scan_failed",userId:s.userId,model:"gemini-3.5-flash-lite",kind:"unreadable",reason:"vision malformed evidence shape",requestId:res.json<Failed>().requestId});
      expect(loggedFailures(warned.mock.calls)).toEqual([warning(first),warning(second)]);
      expect((await s.costRows()).map((r)=>r.units)).toEqual([30,30]);
    }finally{await s.app.close();}
  },30_000);

  it("a reply that identifies no food is a poor photo: a free retake, never a charged draft with nothing on it",async()=>{
    const s=await scanApp("p26a-nofood@example.com",{vision:scripted(
      {meal_name:null,items:[],unknown_items:[],photo_quality:"good"},
      {meal_name:"Plate",items:[],unknown_items:["something green"],photo_quality:"good"},
    )});
    try{
      const first=await s.scan();
      expect(first.statusCode,first.body).toBe(422);
      expect(first.json<Failed>()).toMatchObject({error:"retake_required",message:"Please retake the photo in better light with the full plate visible."});expect(typeof first.json<Failed>().retakeToken).toBe("string");
      const second=await s.scan(first.json<Failed>().retakeToken);
      expect(second.statusCode,second.body).toBe(422);
      expect(second.json<Failed>()).not.toHaveProperty("retakeToken");
      expect(await s.scansUsed()).toBe("1");
    }finally{await s.app.close();}
  },30_000);

  it("a good photo the model did not name is the meal \"Meal\"",async()=>{
    const s=await scanApp("p26a-unnamed@example.com",{vision:scripted({...goodEvidence,meal_name:null})});
    try{
      const res=await s.scan();
      expect(res.statusCode,res.body).toBe(200);
      expect(res.json<{mealName:string;items:unknown[]}>()).toMatchObject({mealName:"Meal",items:[expect.anything(),expect.anything()]});
    }finally{await s.app.close();}
  },30_000);

  it("the real scanner is wired in: with no key the scan answers 503 before a scan is counted; with a key it calls Gemini",async()=>{
    // The test config sets no GEMINI_API_KEY, and Gemini is the default model.
    const off=await scanApp("p26a-nokey@example.com");
    try{
      const res=await off.scan();
      expect(res.statusCode,res.body).toBe(503);
      expect(res.json<Failed>()).toMatchObject({error:"nutrition_unavailable",message:"Meal scanning is temporarily unavailable."});
      expect(await off.scansUsed()).toBeNull();
    }finally{await off.app.close();}

    const calls:{url:string;key:string|null}[]=[];
    const gemini:typeof fetch=(input,init)=>{
      calls.push({url:typeof input==="string"?input:input instanceof URL?input.href:input.url,key:new Headers(init?.headers).get("x-goog-api-key")});
      const reply={candidates:[{content:{parts:[{text:JSON.stringify(goodEvidence)}]}}],usageMetadata:{promptTokenCount:400,candidatesTokenCount:100}};
      return Promise.resolve(new Response(JSON.stringify(reply),{status:200,headers:{"content-type":"application/json"}}));
    };
    const on=await scanApp("p26a-realkey@example.com",{env:{GEMINI_API_KEY:"p26a-gemini-test-key"},fetchForScanner:gemini}); // gitleaks:allow
    try{
      const res=await on.scan();
      expect(res.statusCode,res.body).toBe(200);
      expect(calls).toEqual([{url:"https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent",key:"p26a-gemini-test-key"}]); // gitleaks:allow
      expect(await on.scansUsed()).toBe("1");
      // 400 in at $0.30 and 100 out at $2.50 per 1M: 120 + 250 micro-USD.
      expect(await on.costRows()).toEqual([{provider:"gemini:gemini-3.5-flash-lite",units:500,costMicro:"370"}]);
    }finally{await on.app.close();}
  },30_000);

  it("the spare model names and prices its own ledger rows when MEAL_VISION_MODEL picks it",async()=>{
    const s=await scanApp("p26a-spare@example.com",{env:{MEAL_VISION_MODEL:"qwen/qwen3.6-27b"},vision:scripted(goodEvidence)});
    try{
      expect((await s.scan()).statusCode).toBe(200);
      // 100 in at $0.60 and 200 out at $3.00 per 1M: 60 + 600 micro-USD.
      expect(await s.costRows()).toEqual([{provider:"groq:qwen/qwen3.6-27b",units:300,costMicro:"660"}]);
    }finally{await s.app.close();}
  },30_000);
});
