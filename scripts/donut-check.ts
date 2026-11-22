import { countMatchedRooms } from "../src/lib/snap/vision/floorplan";
/** No model calls and no report writes. */
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { measureDonut } from '../src/lib/snap/vision/donut';
import { OFFLINE_LEGEND, validateChartExtraction, withPixelAllocation } from '../src/lib/snap/vision/chart';
async function main() {
  for(const [id,truth] of [['chart-donut-legend',[65,20,10,5]],['chart-app-both',[70,18,7,5]]] as const) {
    for(const size of [400,512,900]) {
      const {data,info}=await sharp(`public/samples/vision/${id}.svg`).resize({width:size}).ensureAlpha().raw().toBuffer({resolveWithObject:true});
      const image={width:info.width,height:info.height,data};
      const pixels=measureDonut(image);
      const jpeg=await sharp(data,{raw:{width:info.width,height:info.height,channels:4}}).jpeg({quality:65}).toBuffer();
      const decoded=await sharp(jpeg).ensureAlpha().raw().toBuffer();
      const jpegMapped=withPixelAllocation({legend:OFFLINE_LEGEND},measureDonut({...image,data:decoded}));
      assert.notEqual(jpegMapped.pixelStatus,'fallback',`${id}: JPEG rejected`);
      [jpegMapped.allocation!.equitiesPct!,jpegMapped.allocation!.bondsPct!,jpegMapped.allocation!.realEstatePct!,jpegMapped.allocation!.cashPct!].forEach((v,i)=>assert.ok(Math.abs(v-truth[i])<=1,`${id}: JPEG shares`));
      assert.ok(pixels, `${id} ${size}: geometry rejected`);
      const fixture=validateChartExtraction({legend:OFFLINE_LEGEND});assert.ok(fixture);
      const mapped=withPixelAllocation(fixture,pixels);
      assert.ok(Math.abs(pixels.clusters.reduce((sum,c)=>sum+c.share,0)-100)<1e-8);
      assert.equal(withPixelAllocation({...fixture,allocation:{equitiesPct:20}},pixels).pixelStatus,'disagreement');
      assert.equal(withPixelAllocation({...fixture,legend:OFFLINE_LEGEND.slice(0,3)},pixels).pixelStatus,'fallback');
      const legendOnly=await sharp(data,{raw:{width:info.width,height:info.height,channels:4}}).extract({left:Math.round(info.width*0.52),top:0,width:Math.floor(info.width*0.48),height:info.height}).raw().toBuffer({resolveWithObject:true});
      assert.equal(measureDonut({data:legendOnly.data,width:legendOnly.info.width,height:legendOnly.info.height}),undefined);assert.notEqual(mapped.pixelStatus,'fallback');
      const actual=[mapped.allocation!.equitiesPct!,mapped.allocation!.bondsPct!,mapped.allocation!.realEstatePct!,mapped.allocation!.cashPct!];
      actual.forEach((v,i)=>assert.ok(Math.abs(v-truth[i])<=1,`${id}: ${actual}`));
      console.log(id,size,actual.map(v=>v.toFixed(2)).join('/'));
      const degraded=await sharp(data,{raw:{width:info.width,height:info.height,channels:4}}).resize(size,Math.round(info.height*0.65),{fit:'fill'}).raw().toBuffer({resolveWithObject:true});
      assert.equal(withPixelAllocation(fixture,measureDonut({data:degraded.data,width:degraded.info.width,height:degraded.info.height})).pixelStatus,'fallback');
    }
  }
  assert.equal(validateChartExtraction({legend:[{assetClass:'stocks',colorHex:'red'}]}),undefined);
  assert.equal(withPixelAllocation({legend:OFFLINE_LEGEND}).pixelStatus,'fallback');
  // Synthetic matcher regression, NOT recorded live CAD output.
  assert.equal(countMatchedRooms({'Bad/WC':5,'Réduit':3},[{name:'Bad / WC',areaM2:5},{name:'Reduit',areaM2:3}]),2);
  assert.equal(countMatchedRooms({'Zimmer 1':12},[{name:'Zimmer 2',areaM2:12}]),0);
  assert.equal(countMatchedRooms({'Bad':5},[{name:'Bad',areaM2:5.3}]),0);
  console.log('CAD evidence: live report records 7/10 only; raw room names unavailable. No fabricated recorded-output assertion.');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
