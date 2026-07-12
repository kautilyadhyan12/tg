// P2.6a orchestration for Part 2B §3's five-stage nutrition pipeline.
import { createHash, randomBytes } from "node:crypto";
import type { FastifyBaseLogger } from "fastify";
import type { Sql } from "postgres";
import { z } from "zod";
import type { Meal, MealItem } from "@app/shared";
import type { RedisLike } from "../../redis.js";
import { onMealLogged } from "../gamification/service.js";
import { getUserSyncContext } from "../users/service.js";
import { CURATED_FOODS, findCurated, searchCurated } from "./foods.js";
import type { FoodReference, FoodSearchProvider } from "./openfoodfacts.adapter.js";
import { resolvePortion } from "./portion-priors.js";
import * as repo from "./repo.js";
import type { ConfirmMealRequest, ManualMealRequest, PatchMealRequest } from "./schemas.js";
import { VisionProviderError, type VisionProvider, type VisionResult } from "./vision.adapter.js";

export const VISION_INPUT_MICRO_USD_PER_MILLION = 110_000n;
export const VISION_OUTPUT_MICRO_USD_PER_MILLION = 340_000n;
export const RETAKE_TTL_SECONDS = 10 * 60;
const SCAN_TTL_SECONDS = RETAKE_TTL_SECONDS;
const FOOD_CACHE_TTL_SECONDS = 24 * 60 * 60;
const CALC_VERSION = 1;

export class NutritionError extends Error { constructor(readonly statusCode:number,readonly code:string,message:string){super(message);this.name="NutritionError";} }
export class RetakeRequiredError extends NutritionError { constructor(readonly retakeToken:string|null,message:string){super(422,"retake_required",message);this.name="RetakeRequiredError";} }
export interface NutritionDeps { sql:Sql;redis:RedisLike;vision:VisionProvider|null;foods:FoodSearchProvider;log:FastifyBaseLogger; }

// Internal draft/cache parser consumes the stable nutrition fields and strips
// curated inventory-only provenance such as sourceLine.
const foodSchema=z.object({canonical:z.string(),name:z.string(),kcal:z.number(),proteinG:z.number(),carbsG:z.number(),fatG:z.number(),fiberG:z.number(),serving:z.number(),unit:z.string(),source:z.enum(["curated","openfoodfacts"])});
const draftSchema=z.object({userId:z.string().uuid(),mealName:z.string(),foods:z.array(foodSchema),items:z.array(z.object({canonical:z.string(),gramsPoint:z.number(),gramsRange:z.tuple([z.number(),z.number()]),portionSource:z.enum(["user_dishware","regional_prior","default"])}).strict())}).strict();
type Draft=z.infer<typeof draftSchema>;
const token=():string=>randomBytes(32).toString("base64url");
const digest=(v:string):string=>createHash("sha256").update(v).digest("hex");
const retakeKey=(userId:string,v:string):string=>`meal-retake:${userId}:${digest(v)}`;
const scanKey=(userId:string,v:string):string=>`meal-scan:${userId}:${digest(v)}`;

export function visionCostMicro(tokensIn:number,tokensOut:number):bigint { const raw=BigInt(tokensIn)*VISION_INPUT_MICRO_USD_PER_MILLION+BigInt(tokensOut)*VISION_OUTPUT_MICRO_USD_PER_MILLION;return (raw+500_000n)/1_000_000n; }
async function ledger(deps:NutritionDeps,userId:string,v:{model:string;tokensIn:number;tokensOut:number}):Promise<void>{await repo.insertCostEvent(deps.sql,{userId,gymId:await repo.getLiveGymId(deps.sql,userId),model:v.model,tokens:v.tokensIn+v.tokensOut,costMicro:visionCostMicro(v.tokensIn,v.tokensOut)});}
async function issueRetake(deps:NutritionDeps,userId:string):Promise<string>{const value=token();const stored=await deps.redis.setex(retakeKey(userId,value),RETAKE_TTL_SECONDS,"1");if(!stored)throw new NutritionError(503,"quota_unavailable","Meal scanning is temporarily unavailable.");return value;}
export async function consumeRetake(deps:NutritionDeps,userId:string,value:string):Promise<boolean>{const taken=await deps.redis.take(retakeKey(userId,value));if(taken===null)throw new NutritionError(503,"quota_unavailable","Meal scanning is temporarily unavailable.");if(taken===undefined)throw new NutritionError(400,"invalid_retake","Invalid or expired retake token.");return true;}

async function cachedExternal(deps:NutritionDeps,query:string,limit:number):Promise<FoodReference[]>{const key=`food:off:${digest(`${query.toLowerCase()}:${String(limit)}`)}`;const cached=await deps.redis.get(key);if(cached!==null){try{const parsed=foodSchema.array().safeParse(JSON.parse(cached));if(parsed.success)return parsed.data;}catch{/* corrupt cache degrades to provider */}}const found=await deps.foods.search(query,limit);if(found.length>0)await deps.redis.setex(key,FOOD_CACHE_TTL_SECONDS,JSON.stringify(found));return found;}
export async function searchFoods(deps:NutritionDeps,query:string,limit:number):Promise<FoodReference[]>{const local=searchCurated(query,limit);if(local.length>=limit)return local;const external=await cachedExternal(deps,query,limit-local.length);return [...local,...external].slice(0,limit);}
async function findFood(deps:NutritionDeps,query:string):Promise<FoodReference|null>{const local=findCurated(query);if(local!==null)return local;return (await cachedExternal(deps,query,1))[0]??null;}

const round1=(v:number):number=>Math.round(v*10)/10;
const round10=(v:number):number=>Math.round(v/10)*10;
function nutritionItem(food:FoodReference,gramsPoint:number,gramsRange:[number,number],portionSource:"user_dishware"|"regional_prior"|"default"):MealItem {const scale=gramsPoint/100;return{name:food.name,canonical:food.canonical,gramsPoint,gramsRange,portionSource,nutritionSource:food.source,kcalPoint:Math.round(food.kcal*scale),kcalLow:Math.max(0,round10(food.kcal*gramsRange[0]/100)),kcalHigh:Math.max(0,round10(food.kcal*gramsRange[1]/100)),proteinG:round1(food.proteinG*scale),carbsG:round1(food.carbsG*scale),fatG:round1(food.fatG*scale)};}
const asMeal=(r:repo.MealRow):Meal=>({id:r.id,takenAt:r.takenAt.toISOString(),mealName:r.mealName,items:r.items,totals:{kcalPoint:r.kcalPoint,kcalLow:r.kcalLow,kcalHigh:r.kcalHigh,proteinG:r.proteinG,carbsG:r.carbsG,fatG:r.fatG},confirmed:r.confirmed,origin:r.origin,portionSource:r.portionSource==="legacy"?"legacy":r.portionSource==="default"?"default":r.portionSource==="regional_prior"?"regional_prior":"user_dishware",nutritionSources:r.nutritionSources,calcVersion:r.calcVersion});
const totals=(items:readonly MealItem[])=>({kcalPoint:items.reduce((n,i)=>n+i.kcalPoint,0),kcalLow:items.reduce((n,i)=>n+i.kcalLow,0),kcalHigh:items.reduce((n,i)=>n+i.kcalHigh,0),proteinG:round1(items.reduce((n,i)=>n+i.proteinG,0)),carbsG:round1(items.reduce((n,i)=>n+i.carbsG,0)),fatG:round1(items.reduce((n,i)=>n+i.fatG,0))});

export async function analyzePhoto(deps:NutritionDeps,userId:string,imageBase64:string,mimeType:string,usedRetake:boolean):Promise<{scanToken:string;mealName:string;cuisineGuess:string|null;items:MealItem[];unknownItems:string[];photoQuality:"good";totals:ReturnType<typeof totals>;confirmed:false}>{
  if(deps.vision===null)throw new NutritionError(503,"nutrition_unavailable","Meal scanning is temporarily unavailable.");let result:VisionResult;
  try{result=await deps.vision.analyze(imageBase64,mimeType);}catch(err){if(err instanceof VisionProviderError&&err.usage!==undefined)await ledger(deps,userId,err.usage);const rt=usedRetake?null:await issueRetake(deps,userId);throw new RetakeRequiredError(rt,"We could not read that photo. Please retake it with the full plate in frame.");}
  await ledger(deps,userId,result);if(result.evidence.photo_quality==="poor"){const rt=usedRetake?null:await issueRetake(deps,userId);throw new RetakeRequiredError(rt,"Please retake the photo in better light with the full plate visible.");}
  const dishware=await repo.listDishware(deps.sql,userId,100,null);const foods:FoodReference[]=[];const draftItems:Draft["items"]=[];const items:MealItem[]=[];
  for(const evidence of result.evidence.items){const food=await findFood(deps,evidence.canonical_hint);if(food===null)continue;const portion=resolvePortion({canonicalHint:evidence.canonical_hint,container:evidence.container,fillLevel:evidence.fill_level,sizeClass:evidence.size_class,count:evidence.count},dishware.map((d)=>({containerClass:d.containerClass,volumeMl:d.volumeMl,foodHint:d.foodHint})),food.serving);foods.push(food);draftItems.push({canonical:food.canonical,...portion});items.push(nutritionItem(food,portion.gramsPoint,portion.gramsRange,portion.portionSource));}
  const scanToken=token();const stored=await deps.redis.setex(scanKey(userId,scanToken),SCAN_TTL_SECONDS,JSON.stringify({userId,mealName:result.evidence.meal_name,foods,items:draftItems} satisfies Draft));if(!stored)throw new NutritionError(503,"nutrition_unavailable","Meal scanning is temporarily unavailable.");
  return{scanToken,mealName:result.evidence.meal_name,cuisineGuess:result.evidence.cuisine_guess,items,unknownItems:result.evidence.unknown_items,photoQuality:"good",totals:totals(items),confirmed:false};
}

async function takeDraft(deps:NutritionDeps,userId:string,value:string):Promise<Draft>{const raw=await deps.redis.take(scanKey(userId,value));if(raw===null)throw new NutritionError(503,"nutrition_unavailable","Meal confirmation is temporarily unavailable.");if(raw===undefined)throw new NutritionError(400,"invalid_scan","Invalid or expired scan token.");let json:unknown;try{json=JSON.parse(raw);}catch{throw new NutritionError(400,"invalid_scan","Invalid or expired scan token.");}const parsed=draftSchema.safeParse(json);if(!parsed.success||parsed.data.userId!==userId)throw new NutritionError(400,"invalid_scan","Invalid or expired scan token.");return parsed.data;}
export async function confirmMeal(deps:NutritionDeps,userId:string,input:ConfirmMealRequest):Promise<Meal>{const draft=await takeDraft(deps,userId,input.scanToken);const items:MealItem[]=[];const originalItems:MealItem[]=[];for(const chosen of input.items){const food=draft.foods.find((f)=>f.canonical===chosen.canonical);const estimate=draft.items.find((i)=>i.canonical===chosen.canonical);if(food===undefined||estimate===undefined)throw new NutritionError(400,"invalid_item","A confirmed item was not part of this scan.");originalItems.push(nutritionItem(food,estimate.gramsPoint,estimate.gramsRange,estimate.portionSource));items.push(nutritionItem(food,chosen.grams,[chosen.grams,chosen.grams],estimate.portionSource));}const row=await repo.createMeal(deps.sql,userId,{takenAt:new Date(input.takenAt),mealName:draft.mealName,items,origin:"photo",originalItems});const ctx=await getUserSyncContext(deps.sql,userId);await onMealLogged({sql:deps.sql},userId,ctx.timezone).catch((err:unknown)=>{deps.log.warn({event:"gamification.meal_award_failed",userId,errName:err instanceof Error?err.name:typeof err},"meal badge evaluation failed");});return asMeal(row);}
/** GAP-2 ruling: manual logging — items resolve via food search (curated →
 *  cached OpenFoodFacts); grams are user-chosen so ranges collapse to the
 *  point; origin='manual'; same badge hook as photo meals. */
export async function createManualMeal(
  deps: NutritionDeps,
  userId: string,
  input: ManualMealRequest,
): Promise<Meal> {
  const items: MealItem[] = [];
  for (const chosen of input.items) {
    const food = await findFood(deps, chosen.canonical);
    if (food === null) throw new NutritionError(400, "unknown_food", "Food reference not found.");
    items.push(nutritionItem(food, chosen.grams, [chosen.grams, chosen.grams], "default"));
  }
  const row = await repo.createMeal(deps.sql, userId, {
    takenAt: new Date(input.takenAt),
    mealName: input.mealName,
    items,
    origin: "manual",
  });
  const ctx = await getUserSyncContext(deps.sql, userId);
  await onMealLogged({ sql: deps.sql }, userId, ctx.timezone).catch((err: unknown) => {
    deps.log.warn(
      { event: "gamification.meal_award_failed", userId, errName: err instanceof Error ? err.name : typeof err },
      "meal badge evaluation failed",
    );
  });
  return asMeal(row);
}

export async function listMeals(deps:NutritionDeps,userId:string,limit:number,cursor:{at:Date;id:string}|null){const rows=await repo.listMeals(deps.sql,userId,limit,cursor);const page=rows.slice(0,limit);return{items:page.map(asMeal),next:rows.length>limit?page.at(-1)??null:null};}
export async function getMeal(deps:NutritionDeps,userId:string,id:string):Promise<Meal|null>{const row=await repo.getMeal(deps.sql,userId,id);return row===null?null:asMeal(row);}
export async function patchMeal(deps:NutritionDeps,userId:string,id:string,input:PatchMealRequest):Promise<Meal|null>{const before=await repo.getMeal(deps.sql,userId,id);if(before===null)return null;let items=before.items;if(input.items!==undefined){items=[];for(const chosen of input.items){const food=await findFood(deps,chosen.canonical);if(food===null)throw new NutritionError(400,"unknown_food","Food reference not found.");items.push(nutritionItem(food,chosen.grams,[chosen.grams,chosen.grams],"default"));}}const row=await repo.updateMeal(deps.sql,userId,id,{takenAt:input.takenAt===undefined?before.takenAt:new Date(input.takenAt),mealName:input.mealName??before.mealName??"Meal",items,origin:before.origin});return row===null?null:asMeal(row);}
export const deleteMeal=repo.deleteMeal;export const listDishware=repo.listDishware;export const createDishware=repo.createDishware;export const updateDishware=repo.updateDishware;export const deleteDishware=repo.deleteDishware;export const listMeasurements=repo.listMeasurements;export const createMeasurement=repo.createMeasurement;export const updateMeasurement=repo.updateMeasurement;export const deleteMeasurement=repo.deleteMeasurement;
export const CURATED_COUNT=CURATED_FOODS.length;export const CALC_VERSION_VALUE=CALC_VERSION;
