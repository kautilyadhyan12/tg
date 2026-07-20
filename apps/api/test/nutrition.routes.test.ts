import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createMemoryRedis, type RedisLike } from "../src/redis.js";
import { quotaKey } from "../src/modules/quotas/service.js";
import type { VisionEvidence, VisionProvider, VisionResult } from "../src/modules/nutrition/vision.adapter.js";
import type { FoodSearchProvider } from "../src/modules/nutrition/openfoodfacts.adapter.js";

const url=process.env["DATABASE_URL"];const d=describe.skipIf(url===undefined||url==="");
const PASSWORD="p26a-safe-test-password-1"; // gitleaks:allow
const env={NODE_ENV:"test",DATABASE_URL:url??"",WEB_ORIGIN:"http://localhost:5173",JWT_SECRET:"p26a-test-secret-0123456789abcdef-32",LOG_LEVEL:"error",GROQ_API_KEY:"p26a-fake-provider-key"}; // gitleaks:allow
type App=Awaited<ReturnType<typeof buildApp>>;
const goodEvidence:VisionEvidence={meal_name:"Dal and roti",cuisine_guess:"north_indian",items:[{name:"Dal",canonical_hint:"dal",container:"standard_katori",fill_level:.75,size_class:null,count:null,confidence:"high"},{name:"Roti",canonical_hint:"roti",container:null,fill_level:null,size_class:null,count:2,confidence:"high"}],scale_anchors:[],unknown_items:[],photo_quality:"good"};
function fakeVision():VisionProvider&{queue:VisionEvidence[];calls:number}{const queue:VisionEvidence[]=[];return{queue,calls:0,analyze(){this.calls++;const evidence=queue.shift()??goodEvidence;return Promise.resolve({evidence,model:"scout",tokensIn:100,tokensOut:200} satisfies VisionResult);}};}
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

  it("PATCH preserves originals in meal_log_corrections; foreign user gets 404",async()=>{const patch=await inject("PATCH",`/v1/nutrition/meals/${mealId}`,cookieA,{mealName:"Corrected meal"});expect(patch.statusCode).toBe(200);const rows=await sql<{field:string;original:unknown;corrected:unknown}[]>`SELECT field,original,corrected FROM meal_log_corrections WHERE meal_log_id=${mealId}`;expect(rows.some((r)=>r.field==="meal_name"&&r.original==="Dal and roti"&&r.corrected==="Corrected meal")).toBe(true);expect((await inject("GET",`/v1/nutrition/meals/${mealId}`,cookieB)).statusCode).toBe(404);expect((await inject("PATCH",`/v1/nutrition/meals/${mealId}`,cookieB,{mealName:"stolen"})).statusCode).toBe(404);},30_000);

  it("manual meal (GAP-2): no scanToken, items via food search, origin=manual, badge fires without photo badge",async()=>{const m=await session("p26a-manual@example.com");const created=await inject("POST","/v1/nutrition/meals",m.access,{mealName:"Lunch dal and rice",takenAt:new Date().toISOString(),items:[{canonical:"dal_lentil_curry",grams:150},{canonical:"rice_white_cooked",grams:200}]});expect(created.statusCode,created.body).toBe(201);const meal=created.json<{meal:{origin:string;totals:{kcalPoint:number};items:{nutritionSource:string}[]}}>().meal;expect(meal.origin).toBe("manual");const exact=(kcalPer100:number,grams:number):number=>Math.round(kcalPer100*grams/100);expect(meal.totals.kcalPoint).toBe(exact(110,150)+exact(130,200));expect(meal.items.every((i)=>i.nutritionSource==="curated")).toBe(true);const earned=await sql<{code:string}[]>`SELECT code FROM user_achievements WHERE user_id=${m.userId}`;const codes=earned.map((v)=>v.code);expect(codes).toContain("first_meal");expect(codes).not.toContain("photo_meal");const unknown=await inject("POST","/v1/nutrition/meals",m.access,{mealName:"Mystery",takenAt:new Date().toISOString(),items:[{canonical:"definitely_not_a_food_xyz",grams:100}]});expect(unknown.statusCode).toBe(400);},30_000);

  // Preview endpoint (Kd-approved 2026-07-16 at the Card-5a smoke): the SERVER
  // answers "what would these grams be?" live, without saving — the client
  // never computes nutrition (2B). No quota (curated-table math, no AI spend).
  it("preview computes server-side nutrition without persisting or metering",async()=>{const before=await sql<{n:string}[]>`SELECT count(*) AS n FROM meal_logs WHERE user_id=${userA}`;const res=await inject("POST","/v1/nutrition/meals/preview",cookieA,{items:[{canonical:"dal_lentil_curry",grams:150},{canonical:"rice_white_cooked",grams:200}]});expect(res.statusCode,res.body).toBe(200);const preview=res.json<{items:{kcalPoint:number;proteinG:number}[];totals:{kcalPoint:number}}>();const exact=(kcalPer100:number,grams:number):number=>Math.round(kcalPer100*grams/100);expect(preview.totals.kcalPoint).toBe(exact(110,150)+exact(130,200));expect(preview.items).toHaveLength(2);const after=await sql<{n:string}[]>`SELECT count(*) AS n FROM meal_logs WHERE user_id=${userA}`;expect(after[0]?.n).toBe(before[0]?.n);},30_000);
  it("preview consumes no meal_scan quota in either window",async()=>{const read=async()=>[await redis.get(quotaKey("meal_scan",userA,"day",new Date())),await redis.get(quotaKey("meal_scan",userA,"month",new Date()))];const before=await read();expect((await inject("POST","/v1/nutrition/meals/preview",cookieA,{items:[{canonical:"dal_lentil_curry",grams:100}]})).statusCode).toBe(200);expect(await read()).toEqual(before);},30_000);
  it("preview: unknown food is 400, unauthenticated is 401, .strict() boundary rejects extra keys and bad grams",async()=>{expect((await inject("POST","/v1/nutrition/meals/preview",cookieA,{items:[{canonical:"definitely_not_a_food_xyz",grams:100}]})).statusCode).toBe(400);expect((await inject("POST","/v1/nutrition/meals/preview","",{items:[{canonical:"dal_lentil_curry",grams:100}]})).statusCode).toBe(401);expect((await inject("POST","/v1/nutrition/meals/preview",cookieA,{items:[{canonical:"dal_lentil_curry",grams:100}],smuggled:true})).statusCode).toBe(400);expect((await inject("POST","/v1/nutrition/meals/preview",cookieA,{items:[{canonical:"dal_lentil_curry",grams:-1}]})).statusCode).toBe(400);},30_000);

  // T3 finding (nutrition-preview): for OFF-sourced photo items the preview
  // MUST equal what confirm saves — both must read the same draft snapshot,
  // and previewing must not consume the single-use draft.
  it("preview with scanToken matches the confirmed meal exactly for an OFF-sourced draft item",async()=>{
    const offFood={canonical:"off_test_dish",name:"Test Dish",kcal:200,proteinG:10,carbsG:20,fatG:5,fiberG:0,serving:100,unit:"g",source:"openfoodfacts" as const};
    const offVision=fakeVision();offVision.queue.push({...goodEvidence,meal_name:"Test dish plate",items:[{name:"Test Dish",canonical_hint:"off test dish",container:null,fill_level:null,size_class:null,count:1,confidence:"high"}]});
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

  it("dishware and body measurement CRUD are tenant-scoped; measurement owns current weight",async()=>{const dish=await inject("POST","/v1/nutrition/dishware",cookieA,{label:"My katori",containerClass:"standard_katori",volumeMl:180});dishId=dish.json<{dishware:{id:string}}>().dishware.id;expect((await inject("PATCH",`/v1/nutrition/dishware/${dishId}`,cookieB,{volumeMl:999})).statusCode).toBe(404);const measurement=await inject("POST","/v1/nutrition/body-measurements",cookieA,{measuredAt:new Date().toISOString(),weightKg:72.5,metrics:{waist_cm:80}});measurementId=measurement.json<{measurement:{id:string}}>().measurement.id;expect((await sql<{weight_kg:string|null}[]>`SELECT weight_kg FROM users WHERE id=${userA}`)[0]?.weight_kg).toBe("72.50");expect((await inject("DELETE",`/v1/nutrition/body-measurements/${measurementId}`,cookieB)).statusCode).toBe(404);expect((await inject("DELETE",`/v1/nutrition/body-measurements/${measurementId}`,cookieA)).statusCode).toBe(204);expect((await sql<{weight_kg:string|null}[]>`SELECT weight_kg FROM users WHERE id=${userA}`)[0]?.weight_kg).toBeNull();},30_000);

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
      expect(pv?.kcalPoint).toBe(Math.round(110*135/100)); // dal 110 kcal/100g
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

  // Nutrition targets (this card): the nutrition.py Mifflin-St Jeor port,
  // computed from the user's OWN stored profile. Kd ruled no fabricated
  // defaults — an incomplete profile yields NO targets plus an honest list of
  // what is missing, so the page can ask for it instead of inventing 2000.
  it("serves targets from the stored profile, withholds them when inputs are missing, and never crosses users",async()=>{
    const t=await session("p26a-targets@example.com");
    expect((await inject("GET","/v1/nutrition/targets","")).statusCode).toBe(401);

    // A brand-new user has no fitness-profile row and no weight: all five missing.
    const empty=await inject("GET","/v1/nutrition/targets",t.access);
    expect(empty.statusCode,empty.body).toBe(200);
    expect(empty.json()).toEqual({targets:null,missing:["age","gender","heightCm","weightKg","exerciseFrequency"]});

    // Fill the profile but NOT the weight — weight lives on users.weight_kg,
    // a different table, so this pins that the read spans both.
    expect((await inject("PUT","/v1/users/me/fitness-profile",t.access,{age:30,gender:"female",heightCm:165,exerciseFrequency:4,fitnessGoals:["weight_loss"],onboardingCompleted:true})).statusCode).toBe(200);
    expect((await inject("GET","/v1/nutrition/targets",t.access)).json()).toEqual({targets:null,missing:["weightKg"]});

    // Complete: the SAME golden the unit test hand-computes, now end-to-end
    // through real storage (a contract mismatch would show here, not there).
    expect((await inject("PATCH","/v1/users/me",t.access,{weightKg:60})).statusCode).toBe(200);
    expect((await inject("GET","/v1/nutrition/targets",t.access)).json())
      .toEqual({targets:{bmr:1320,tdee:2046,kcal:1646,proteinG:120,carbsG:189,fatG:46},missing:[]});

    // Tenancy: this route takes no id, so the proof is that a second user with
    // a different profile gets THEIR numbers and neither leaks into the other.
    const u=await session("p26a-targets2@example.com");
    expect((await inject("PUT","/v1/users/me/fitness-profile",u.access,{age:25,gender:"male",heightCm:180,exerciseFrequency:6,fitnessGoals:["muscle_gain"],onboardingCompleted:true})).statusCode).toBe(200);
    expect((await inject("PATCH","/v1/users/me",u.access,{weightKg:75})).statusCode).toBe(200);
    expect((await inject("GET","/v1/nutrition/targets",u.access)).json<{targets:{kcal:number}}>().targets.kcal).toBe(3327);
    expect((await inject("GET","/v1/nutrition/targets",t.access)).json<{targets:{kcal:number}}>().targets.kcal).toBe(1646);
  },30_000);
});
