import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createMemoryRedis } from "../src/redis.js";
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
  const inject=(method:"GET"|"POST"|"PATCH"|"DELETE",path:string,access:string,body?:unknown)=>api().inject({method,url:path,cookies:access===""?{}:{accessToken:access},headers:body===undefined?{}:{"content-type":"application/json"},...(body===undefined?{}:{payload:JSON.stringify(body)})});
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

  it("takenAt more than 24h in the future is a 400 (GAP-3)",async()=>{const future=new Date(Date.now()+25*60*60*1000).toISOString();const res=await inject("POST","/v1/nutrition/meals",cookieA,{mealName:"Time travel",takenAt:future,items:[{canonical:"dal_lentil_curry",grams:100}]});expect(res.statusCode).toBe(400);},30_000);

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
});
