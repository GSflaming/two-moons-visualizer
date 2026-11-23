import { createCanvas } from '@napi-rs/canvas';
import { floorIndex } from './timing.mjs';
import { fretX, noteX, fullName } from './vendor/fret-note/music.mjs';
import { display } from './theory.mjs';

export function createRenderer(data) {
const { bars, drums, duration, guitars, chords }=structuredClone(data);
for(const guitar of guitars)guitar.lastFret=Math.max(15,...guitar.notes.map(note=>note.fret));
const onset=data.presentation?.start ?? 67/60;
const W=1920,H=1080;
const canvas=createCanvas(W,H);
const ctx=canvas.getContext('2d',{alpha:false});


const ink='#172132', quiet='#546277', faint='#dce5f0', pale='#edf2f8';
const colors={
  kick:{ink:'#1958d8',fill:'#e8efff'},
  snare:{ink:'#ac432c',fill:'#faeae3'},
  hat:{ink:'#086e66',fill:'#e5f2ef'},
  cymbal:{ink:'#086e66',fill:'#e5f2ef'},
};
const lanes=['hat','cymbal','snare','kick'];
const classify=p=>p===36?'kick':p===38?'snare':p===46?'hat':'cymbal';
const events=drums.map(n=>({...n,kind:classify(n.pitch)})).sort((a,b)=>a.time-b.time);
const firstDrum=events[0]?.time ?? Infinity;
const lastDrum=events.at(-1)?.time ?? -Infinity;
const cap=(v,min=0,max=1)=>Math.max(min,Math.min(max,v));
const fmt=t=>`${Math.floor(Math.max(0,t)/60)}:${String(Math.floor(Math.max(0,t)%60)).padStart(2,'0')}`;
const line=(x,y,a,b,c=faint,w=1)=>{
  ctx.strokeStyle=c;ctx.lineWidth=w;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(a,b);ctx.stroke();
};
const dot=(x,y,r,c,stroke=null,w=1)=>{
  ctx.beginPath();ctx.arc(x,y,r,0,2*Math.PI);
  if(c){ctx.fillStyle=c;ctx.fill();}
  if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=w;ctx.stroke();}
};
function text(s,x,y,size=21,weight=550,color=ink,align='left'){
  ctx.font=`${Math.round(weight / 100) * 100} ${size}px "Helvetica Neue","Hiragino Sans GB",sans-serif`;
  ctx.textAlign=align;ctx.textBaseline='middle';ctx.fillStyle=color;ctx.fillText(s,x,y);
}
function clock(now,bar,index){
  const x=470,y=435,r=230;
  const n=bar.meter[0];
  const pulse=cap(floorIndex(bar.pulses,now),0,n-1);
  const f=cap((now-bar.pulses[pulse])/(bar.pulses[pulse+1]-bar.pulses[pulse]));
  const phase=(pulse+f)/n;
  const radial=(i,d)=>[x+d*Math.cos(i*2*Math.PI-Math.PI/2),y+d*Math.sin(i*2*Math.PI-Math.PI/2)];
  dot(x,y,r,null,'#c4d1e3',2);
  for(let beat=0;beat<n;beat++){
    for(let division=1;division<4;division++){
      const a=(beat+division/4)/n;
      const [x1,y1]=radial(a,r-12);
      const [x2,y2]=radial(a,r);
      line(x1,y1,x2,y2,'#cbd7e7',1.7);
    }
    const hot=beat===pulse;
    const [x1,y1]=radial(beat/n,r);
    if(hot) dot(x1,y1,20,'#e8efff');
    dot(x1,y1,hot?8:5.4,hot?colors.kick.ink:'#8195b0');
    const [xx,yy]=radial(beat/n,r-41);
    text(String(beat+1),xx,yy,25,hot?700:540,hot?colors.kick.ink:quiet,'center');
  }
  const [pointerX,pointerY]=radial(phase,r+13);
  ctx.beginPath();
  ctx.arc(x,y,r+13,-Math.PI/2,phase*2*Math.PI-Math.PI/2);
  ctx.strokeStyle=colors.kick.ink;ctx.lineWidth=3.6;ctx.stroke();
  dot(pointerX,pointerY,6.7,colors.kick.ink,'#fff',1.6);
  text(bar.meter.join('/'),x,y-9,109,640,ink,'center');

  return pulse;
}
function mark(e,x,y,main,opacity=1){
  const {ink,fill}=colors[e.kind];
  ctx.globalAlpha=opacity;
  const radius=e.ghost?4.6:e.accent?9.2:7.1;
  if(main) dot(x,y,radius+7,fill);
  if(e.kind==='hat'||e.kind==='cymbal'){
    if(e.ghost) dot(x,y,radius,null,ink,1.7);
    else{
      line(x-radius*.70,y-radius*.70,x+radius*.70,y+radius*.70,ink,2.7);
      line(x-radius*.70,y+radius*.70,x+radius*.70,y-radius*.70,ink,2.7);
    }
  } else {
    dot(x,y,radius,e.ghost?'#fff':ink,ink,e.ghost?1.8:1.2);
  }
  ctx.globalAlpha=1;
}
function measure(now,bar,index,pulse){
  const left=954,right=1782,top=312,spacing=80;
  const bottom=top+spacing*3;
  const count=bar.meter[0];
  const beatW=(right-left)/count;
  const f=cap((now-bar.pulses[pulse])/(bar.pulses[pulse+1]-bar.pulses[pulse]));
  const xPos=(i,f)=>left+(i+f)*beatW;
  const cursor=xPos(pulse,f);
  ctx.fillStyle='#f3f6fc';
  ctx.fillRect(xPos(pulse,0),top-35,beatW,bottom-top+70);
  for(let i=0;i<=count;i++){
    const x=xPos(i,0);
    line(x,top-35,x,bottom+36,'#c9d5e6',i===0||i===count?1.6:1.05);
    if(i<count){
      text(String(i+1),x,top-63,22,i===pulse?720:560,i===pulse?colors.kick.ink:quiet,'center');
      for(let j=1;j<4;j++) line(xPos(i,j/4),top-35,xPos(i,j/4),bottom+36,pale,.8);
    }
  }
  for(const [i,kind] of lanes.entries()){
    const y=top+spacing*i;
    mark({kind},left-46,y,false,.78);
    line(left,y,right,y,faint,1.35);
  }
  line(cursor,top-35,cursor,bottom+36,'#718cb9',1.7);
  dot(cursor,top-36,4.6,colors.kick.ink);
  const eventStart=Math.max(0,floorIndex(events,bar.start-.001,'time')-3);
  for(let i=eventStart;i<events.length;i++){
    const e=events[i];
    if(e.bar>index+1)break;
    if(e.bar!==index+1)continue;
    const lane=lanes.indexOf(e.kind);
    const p=cap(floorIndex(bar.pulses,e.time),0,count-1);
    const ratio=cap((e.time-bar.pulses[p])/(bar.pulses[p+1]-bar.pulses[p]));
    const x=xPos(p,ratio);
    const age=now-e.time;
    mark(e,x,top+lane*spacing,age>=0&&age<.115,age<0?.68:1);
  }
  const recent=floorIndex(events,now,'time');
  const active=new Map();
  for(let i=recent;i>=0;i--){
    const e=events[i];
    if(now-e.time>.155)break;
    if(!active.has(e.kind))active.set(e.kind,e);
  }
  for(const [kind,e] of active){
    const y=top+lanes.indexOf(kind)*spacing;
    const f=1-cap((now-e.time)/.155);
    ctx.globalAlpha=.25+f*.55;
    dot(left-46,y,6+f*8,colors[kind].fill,colors[kind].ink,1.4);
    dot(left-46,y,e.ghost?2.7:4.6,colors[kind].ink);
    ctx.globalAlpha=1;
  }
}
function footer(t,index){
  const left=130,right=1786,y=1001;
  const x=time=>left+cap((time-onset)/(duration-onset))*(right-left);
  line(left,y,right,y,faint,2);
  line(left,y,x(t),y,'#a6bcde',2.2);
  for(const [i,b] of bars.entries()){
    if(i===0||b.meter[0]===bars[i-1].meter[0])continue;
    const at=x(b.start);
    line(at,y-7,at,y+7,'#6e86ab',1.5);
  }
  dot(x(t),y,5.3,colors.kick.ink);
  text(fmt(t-onset),left,1037,21,550,quiet);
  text(fmt(duration-onset),right,1037,21,550,quiet,'right');
}
function fingerboard(guitar,index,t){
  const left=index===0?130:1024;
  const right=left+762;
  const nut=left+32, top=767, bottom=896;
  const finish=guitar.lastFret;
  const stretch=(right-nut)/fretX(finish);
  const place=fret=>fret===0?left+12:nut+noteX(fret)*stretch;
  const wire=fret=>nut+fretX(fret)*stretch;
  const y=string=>top+(string-1)*(bottom-top)/5;
  const color=index===0?'#33598d':'#47776c';
  line(left,741,left+24,741,color,2.5);
  for(let fret=0;fret<=finish;fret++)line(wire(fret),top,wire(fret),bottom,fret===0?'#8293a9':faint,fret===0?2:1);
  for(let string=1;string<=6;string++)line(left,y(string),right,y(string),'#bccbda',1.1);
  for(const fret of [3,5,7,9,12,15].filter(fret=>fret<=finish))text(String(fret),place(fret),bottom+18,14,520,quiet,'center');
  const active=new Set();
  for(let i=floorIndex(guitar.notes,t,'start');i>=0;i--){
    const n=guitar.notes[i];
    if(t-n.start>9)break;
    if(n.end<=t || n.fret>finish || active.has(n.string))continue;
    active.add(n.string);
    const x=place(n.fret), yy=y(n.string);
    const hit=1-cap((t-n.start)/.125);
    if(hit>0&&!n.ghost)dot(x,yy,12+hit*3,'#e8eef5');
    if(n.ghost)dot(x,yy,8.3,'#fff',color,1.35);
    else{
      dot(x,yy,10.4,color);
      text(fullName(n.pitch),x,yy+.4,10.2,680,'#fff','center');
    }
  }
}
function frame(t){
  ctx.fillStyle='#fff';ctx.fillRect(0,0,W,H);
  text(data.title ?? 'Two Moons',129,119,63,690);
  text(data.artist ?? 'toe',132,177,29,700,quiet);
  const chord=chords[floorIndex(chords,t,'start')];
  if(chord&&t<chord.end)text(display(chord.symbol),1784,124,49,650,ink,'right');
  const index=cap(floorIndex(bars,t,'start'),0,bars.length-1);
  const bar=bars[index];
  if(t>=bars[0].start-.04&&t<bars.at(-1).end){
    const p=clock(t,bar,index);
    measure(t,bar,index,p);
  }else{
    dot(470,435,230,null,'#dce5f0',2);
    for(const [i,kind] of lanes.entries()){
      mark({kind},908,312+80*i,false,.55);
      line(954,312+80*i,1782,312+80*i,pale,1.2);
    }
  }
  guitars.forEach((guitar,index)=>fingerboard(guitar,index,t));
  footer(t,index);
}

return { canvas, duration, draw: frame };
}
