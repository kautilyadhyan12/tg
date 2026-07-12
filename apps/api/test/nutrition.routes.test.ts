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

  it("auth and validation run before quota",async()=>{expect((await inject("POST","/v1/nutrition/analyze-photo","",{imageBase64:jpeg,mimeType:"image/jpeg"})).statusCode).toBe(401);for(let i=0;i<3;i++)expect((await inject("POST","/v1/nutrition/analyze-photo",cookieA,{imageBase64:"bad",mimeType:"image/jpeg"})).statusCode).toBe(400);const key=quotaKey("meal_scan",userA,"month",new Date());expect(await redis.get(key)).toBeNull();},30_000);

  let scanToken="",mealId="",dishId="",measurementId="";
  it("poor parse grants one single-use retake without a second quota unit",async()=>{vision.queue.push({...goodEvidence,photo_quality:"poor"},goodEvidence);const poor=await inject("POST","/v1/nutrition/analyze-photo",cookieA,{imageBase64:jpeg,mimeType:"image/jpeg"});expect(poor.statusCode).toBe(422);const retakeToken=poor.json<{retakeToken:string}>().retakeToken;const good=await inject("POST","/v1/nutrition/analyze-photo",cookieA,{imageBase64:jpeg,mimeType:"image/jpeg",retakeToken});expect(good.statusCode).toBe(200);scanToken=good.json<{scanToken:string}>().scanToken;expect(await redis.get(quotaKey("meal_scan",userA,"month",new Date()))).toBe("1");expect((await inject("POST","/v1/nutrition/analyze-photo",cookieA,{imageBase64:jpeg,mimeType:"image/jpeg",retakeToken})).statusCode).toBe(400);},30_000);

  it("confirms a photo meal, records ledger, and fires photo badge",async()=>{const scanResponse=await inject("POST","/v1/nutrition/analyze-photo",cookieA,{imageBase64:jpeg,mimeType:"image/jpeg"});expect(scanResponse.statusCode,scanResponse.body).toBe(200);const scan=scanResponse.json<{scanToken:string;items:{canonical:string}[]}>();scanToken=scan.scanToken;const confirmed=await inject("POST","/v1/nutrition/meals",cookieA,{scanToken,takenAt:new Date().toISOString(),items:scan.items.map((i)=>({canonical:i.canonical,grams:100}))});expect(confirmed.statusCode,confirmed.body).toBe(201);const meal=confirmed.json<{meal:{id:string;origin:string}}>().meal;mealId=meal.id;expect(meal.origin).toBe("photo");const [counts]=await sql<{photo:string;costs:string}[]>`SELECT (SELECT count(*) FROM meal_logs WHERE user_id=${userA} AND origin='photo') AS photo,(SELECT count(*) FROM api_cost_events WHERE user_id=${userA} AND feature='meal_scan') AS costs`;expect(counts?.photo).toBe("1");expect(Number(counts?.costs)).toBeGreaterThanOrEqual(2);const earned=await sql<{code:string}[]>`SELECT code FROM user_achievements WHERE user_id=${userA}`;expect(earned.map((v)=>v.code)).toEqual(expect.arrayContaining(["first_meal","photo_meal"]));},30_000);

  it("PATCH preserves originals in meal_log_corrections; foreign user gets 404",async()=>{const patch=await inject("PATCH",`/v1/nutrition/meals/${mealId}`,cookieA,{mealName:"Corrected meal"});expect(patch.statusCode).toBe(200);const rows=await sql<{field:string;original:unknown;corrected:unknown}[]>`SELECT field,original,corrected FROM meal_log_corrections WHERE meal_log_id=${mealId}`;expect(rows.some((r)=>r.field==="meal_name"&&r.original==="Dal and roti"&&r.corrected==="Corrected meal")).toBe(true);expect((await inject("GET",`/v1/nutrition/meals/${mealId}`,cookieB)).statusCode).toBe(404);expect((await inject("PATCH",`/v1/nutrition/meals/${mealId}`,cookieB,{mealName:"stolen"})).statusCode).toBe(404);},30_000);

  it("manual meal (GAP-2): no scanToken, items via food search, origin=manual, badge fires without photo badge",async()=>{const m=await session("p26a-manual@example.com");const created=await inject("POST","/v1/nutrition/meals",m.access,{mealName:"Lunch dal and rice",takenAt:new Date().toISOString(),items:[{canonical:"dal_lentil_curry",grams:150},{canonical:"rice_white_cooked",grams:200}]});expect(created.statusCode,created.body).toBe(201);const meal=created.json<{meal:{origin:string;totals:{kcalPoint:number};items:{nutritionSource:string}[]}}>().meal;expect(meal.origin).toBe("manual");const round10=(v:number):number=>Math.round(v/10)*10;const clamp=(kcalPer100:number,grams:number):number=>{const low=round10(kcalPer100*grams/100);return Math.min(Math.max(Math.round(kcalPer100*grams/100),low),low);};expect(meal.totals.kcalPoint).toBe(clamp(110,150)+clamp(130,200));expect(meal.items.every((i)=>i.nutritionSource==="curated")).toBe(true);const earned=await sql<{code:string}[]>`SELECT code FROM user_achievements WHERE user_id=${m.userId}`;const codes=earned.map((v)=>v.code);expect(codes).toContain("first_meal");expect(codes).not.toContain("photo_meal");const unknown=await inject("POST","/v1/nutrition/meals",m.access,{mealName:"Mystery",takenAt:new Date().toISOString(),items:[{canonical:"definitely_not_a_food_xyz",grams:100}]});expect(unknown.statusCode).toBe(400);},30_000);

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

  it("§3.3 display: kcalPoint sits INSIDE its own collapsed range end-to-end (T3 finding 1)",async()=>{
    const m=await session("p26a-round@example.com");
    // chicken breast 165 kcal/100g → collapsed range [170,170]; point clamps to 170.
    const created=await inject("POST","/v1/nutrition/meals",m.access,{mealName:"Chicken",takenAt:new Date().toISOString(),items:[{canonical:"chicken_breast_cooked",grams:100}]});
    expect(created.statusCode,created.body).toBe(201);
    const item=created.json<{meal:{items:{kcalPoint:number;kcalLow:number;kcalHigh:number}[]}}>().meal.items[0];
    expect(item?.kcalLow).toBe(170);
    expect(item?.kcalHigh).toBe(170);
    expect(item?.kcalPoint).toBe(170);
    expect((item?.kcalPoint??0)>=(item?.kcalLow??0)&&(item?.kcalPoint??0)<=(item?.kcalHigh??1)).toBe(true);
  },30_000);

  it("dishware and body measurement CRUD are tenant-scoped; measurement owns current weight",async()=>{const dish=await inject("POST","/v1/nutrition/dishware",cookieA,{label:"My katori",containerClass:"standard_katori",volumeMl:180});dishId=dish.json<{dishware:{id:string}}>().dishware.id;expect((await inject("PATCH",`/v1/nutrition/dishware/${dishId}`,cookieB,{volumeMl:999})).statusCode).toBe(404);const measurement=await inject("POST","/v1/nutrition/body-measurements",cookieA,{measuredAt:new Date().toISOString(),weightKg:72.5,metrics:{waist_cm:80}});measurementId=measurement.json<{measurement:{id:string}}>().measurement.id;expect((await sql<{weight_kg:string|null}[]>`SELECT weight_kg FROM users WHERE id=${userA}`)[0]?.weight_kg).toBe("72.50");expect((await inject("DELETE",`/v1/nutrition/body-measurements/${measurementId}`,cookieB)).statusCode).toBe(404);expect((await inject("DELETE",`/v1/nutrition/body-measurements/${measurementId}`,cookieA)).statusCode).toBe(204);expect((await sql<{weight_kg:string|null}[]>`SELECT weight_kg FROM users WHERE id=${userA}`)[0]?.weight_kg).toBeNull();},30_000);
});
