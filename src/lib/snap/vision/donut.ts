/** Bounded saturated-component proposals; never a global colour centroid. */
export interface PixelImage { width: number; height: number; data: ArrayLike<number> }
export interface DonutMeasurement { quality: number; coverage: number; gapFraction: number; clusters: { colorHex: string; share: number }[] }
const rgb = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
export const colorDistance = (a: string, b: string) => Math.hypot(...rgb(a).map((v, i) => v - rgb(b)[i]));
const chroma = (hex: string) => { const c=rgb(hex), lo=Math.min(...c), span=Math.max(...c)-lo; return c.map(v=>(v-lo)/Math.max(1,span)); };
const hueDistance = (a:string,b:string) => Math.hypot(...chroma(a).map((v,i)=>v-chroma(b)[i]));
export function measureDonut(image: PixelImage): DonutMeasurement | undefined {
  const scale = Math.min(1, 400 / Math.max(image.width, image.height));
  const w = Math.round(image.width * scale), h = Math.round(image.height * scale);
  const colors: (string | undefined)[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (Math.min(image.height - 1, Math.floor(y / scale)) * image.width + Math.min(image.width - 1, Math.floor(x / scale))) * 4;
    const c = [image.data[i], image.data[i + 1], image.data[i + 2]];
    colors.push(image.data[i + 3] > 128 && Math.max(...c) - Math.min(...c) > 65 && Math.max(...c) > 95 ? '#' + c.map(v => v.toString(16).padStart(2, '0')).join('') : undefined);
  }
  const at = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h ? colors[Math.round(y) * w + Math.round(x)] : undefined;
  // Small dilation bridges white slice separators, but keeps distant legends separate.
  const mask = new Uint8Array(w * h), seen = new Uint8Array(w * h);
  for (let y = 2; y < h - 2; y++) for (let x = 2; x < w - 2; x++) if (at(x,y))
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) mask[(y+dy)*w+x+dx] = 1;
  const proposals: number[][] = [];
  for (let i = 0; i < mask.length; i++) if (mask[i] && !seen[i]) {
    const queue = [i]; seen[i] = 1; let l=w, r=0, t=h, b=0;
    for (let j=0; j<queue.length; j++) {
      const p=queue[j], x=p%w, y=Math.floor(p/w); l=Math.min(l,x); r=Math.max(r,x); t=Math.min(t,y); b=Math.max(b,y);
      for (const q of [p-1,p+1,p-w,p+w]) if(q>=0 && q<mask.length && Math.abs(q%w-x)<=1 && mask[q] && !seen[q]) {seen[q]=1; queue.push(q);}
    }
    if (r-l>30 && b-t>30 && Math.abs((r-l)/(b-t)-1)<0.08) proposals.push([(l+r)/2,(t+b)/2,((r-l)+(b-t))/4-2]);
  }
  let best: DonutMeasurement | undefined;
  for (const [cx,cy,outer] of proposals.slice(0,32)) {
    // Circular boundary must exist around nearly every angle (reject perspective and text).
    const edges:number[]=[];
    for(let a=0;a<180;a++) {const theta=a*Math.PI/90; let edge=0;
      for(let r=outer*0.65;r<outer*1.12;r+=0.5) if(at(cx+Math.cos(theta)*r,cy+Math.sin(theta)*r)) edge=r;
      edges.push(edge);
    }
    if(edges.filter(e=>Math.abs(e-outer)<outer*0.045+1).length/180<0.94) continue;
    const samples:(string|undefined)[]=[];
    for(let a=0;a<1440;a++) {const theta=a*Math.PI/720; const votes:string[]=[];
      for(const f of [0.68,0.74,0.8]) {const c=at(cx+Math.cos(theta)*outer*f,cy+Math.sin(theta)*outer*f);if(c) votes.push(c);}
      samples.push(votes[1] ?? votes[0]);
    }
    const coverage=samples.filter(Boolean).length/samples.length;
    if(coverage<0.94) continue;
    // Fill each gap by the nearer angular neighbour; ties go clockwise.
    const filled=samples.map((c,i)=> {if(c)return c;for(let d=1;d<samples.length;d++){const next=samples[(i+d)%samples.length],prev=samples[(i-d+samples.length)%samples.length];if(next||prev)return next??prev;}return undefined;});
    const groups:{colorHex:string;count:number}[]=[];
    for(const c of filled) if(c){let g=groups.find(g=>hueDistance(g.colorHex,c)<0.3);if(!g){g={colorHex:c,count:0};groups.push(g);}if (Math.max(...rgb(c))-Math.min(...rgb(c)) > Math.max(...rgb(g.colorHex))-Math.min(...rgb(g.colorHex))) g.colorHex=c; g.count++;}
    const noise = groups.filter(g => g.count < 15);
    if (noise.reduce((sum,g)=>sum+g.count,0)>21) continue;
    for(const g of noise) {
      const target=groups.filter(v=>v.count>=15).sort((a,b)=>hueDistance(a.colorHex,g.colorHex)-hueDistance(b.colorHex,g.colorHex))[0];
      if(target) target.count+=g.count;
      groups.splice(groups.indexOf(g),1);
    }
    if(groups.length<2 || groups.length>8 || groups.some(g=>g.count<15)) continue;
    const result={quality:coverage,coverage,gapFraction:1-coverage,clusters:groups.map(g=>({colorHex:g.colorHex,share:100*g.count/samples.length}))};
    if(!best || result.quality>best.quality)best=result;
  }
  return best;
}
