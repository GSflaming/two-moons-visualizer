import gzip,json
from pathlib import Path
from fractions import Fraction
from collections import Counter
from bisect import bisect_right
import numpy as np
from scipy.io import wavfile
from scipy.signal import stft,find_peaks
from scipy.ndimage import gaussian_filter1d

import argparse
parser = argparse.ArgumentParser()
parser.add_argument('--workdir', type=Path, required=True)
parser.add_argument('--score', type=Path, required=True)
parser.add_argument('--drum-stem', type=Path)
args = parser.parse_args()
path=args.workdir/'toe-render-data.json'
d=json.loads(path.read_text())
bars=d['bars']
keys=[]
times=[]
beat=0
for i,b in enumerate(bars):
    n,den=b['meter']
    b['beat']=beat
    keys.extend(beat+j*4/den for j in range(n))
    times.extend(b['pulses'][:-1])
    beat+=n*4/den
keys.append(beat)
times.append(bars[-1]['end'])
assert np.min(np.diff(times))>.24
def mapped(beat): return float(np.interp(beat,keys,times))

def score(i): return json.load(gzip.open(args.score/f'{i}.json'))
guitars=[]
other=[]
for i in range(5):
    tr=score(i)
    events=[]
    for j,m in enumerate(tr['measures']):
        for voice in m['voices']:
            tick=Fraction(bars[j]['beat'])
            current={} if j==0 else current
            for item in voice['beats']:
                length=4*Fraction(*item['duration'])
                for n in item['notes']:
                    if n.get('rest'): continue
                    string=n.get('string',0)
                    fret=n.get('fret',-1)
                    if not 1<=string<=len(tr['tuning']) or fret<0:continue
                    pitch=tr['tuning'][string-1]+fret+tr.get('capo',0)
                    if n.get('harmonic')=='natural':
                        pitch=tr['tuning'][string-1]+tr.get('capo',0)+{5:24,7:19,12:12}.get(fret,fret)
                    previous=current.get(string)
                    if n.get('tie') and previous and previous['fret']==fret and abs(previous['endBeat']-tick)<1e-6:
                        previous['endBeat']=float(tick+length)
                        continue
                    event=dict(beat=float(tick),endBeat=float(tick+length),string=string,fret=fret,pitch=pitch,ghost=bool(n.get('ghost')))
                    events.append(event)
                    current[string]=event
                tick+=length
    for e in events:
        e['start']=mapped(e['beat'])
        e['end']=mapped(e['endBeat'])
    if i<2: guitars.append(dict(name=tr['name'],tuning=tr['tuning'],capo=tr.get('capo',0),notes=events))
    else: other.append(events)
d['guitars']=guitars
source=args.drum_stem
if source is not None and source.is_file():
    rate,wav=wavfile.read(source)
    mix=wav.astype('float32').mean(axis=1)
    if np.issubdtype(wav.dtype,np.integer): mix/=np.iinfo(wav.dtype).max
    # A centered, short analysis window preserves transient timing. The
    # separated audio is used as timing evidence, never mixed into the video.
    f,t,z=stft(mix,fs=rate,nperseg=2048,noverlap=2048-round(rate*.005))
    mag=abs(z)
    groups={36:(38,120),38:(170,4300),46:(4100,12500),49:(3500,11500),
            55:(3500,11500),57:(3500,11500),59:(3200,11500)}
    peaks={}
    for pitch,(lo,hi) in groups.items():
        band=np.log1p(450*mag[(f>=lo)&(f<hi)])
        flux=gaussian_filter1d(np.maximum(0,np.diff(band,axis=1,prepend=0)).mean(axis=0),.85)
        ids=find_peaks(flux,distance=4)[0]
        peaks[pitch]=(t[ids],flux[ids],np.interp(t[ids],t,gaussian_filter1d(flux,42)))
    # Fit the whole bar to the transient evidence, preserving metrical
    # relationships. Dense or soft hits retain their original spacing.
    perbar=[]
    shifts=np.arange(-.110,.111,.005)
    for bar in range(len(bars)):
        subset=[e for e in d['drums'] if e['bar']==bar+1 and e['pitch'] in [36,38] and not e['ghost']]
        tally=np.zeros(len(shifts))
        for e in subset:
            pts, strengths, floor=peaks[e['pitch']]
            ix=np.flatnonzero(abs(pts-e['time'])<.155)
            if len(ix)==0: continue
            distance=pts[ix,None]-(e['time']+shifts[None,:])
            w=np.minimum(3,strengths[ix]/(floor[ix]+.006))
            tally+=(np.exp(-.5*(distance/.018)**2)*w[:,None]).max(axis=0)
        if subset:
            choice=np.argmax(tally-.32*len(subset)*(shifts/.11)**2)
            perbar.append(float(shifts[choice]) if tally[choice]>.7 else 0)
        else: perbar.append(0)
    perbar=gaussian_filter1d(perbar,.85)
    mids=[(b['start']+b['end'])/2 for b in bars]
    def corrected(x):return float(x+np.interp(x,mids,perbar))
    for b in bars:
        b.update(start=corrected(b['start']),end=corrected(b['end']),pulses=[corrected(p) for p in b['pulses']])
    for g in guitars:
        for e in g['notes']:
            e.update(start=corrected(e['start']),end=corrected(e['end']))
    for e in d['drums']:
        e['time']=corrected(e['time'])
    print('Drum fit max shift',round(max(abs(perbar)),3))

harmonic=sorted([e for g in guitars for e in g['notes'] if not e['ghost']]+other[-1],key=lambda e:e['beat'])
bass=other[-1]
starts=[e['beat'] for e in harmonic]
names='C C# D Eb E F F# G Ab A Bb B'.split()
qualities={'':(0,4,7),'m':(0,3,7),'sus2':(0,2,7),'sus4':(0,5,7),'5':(0,7),
           'maj7':(0,4,7,11),'m7':(0,3,7,10),'7':(0,4,7,10),'6':(0,4,7,9),
           'add9':(0,2,4,7),'madd9':(0,2,3,7),'maj9':(0,2,4,7,11),'m9':(0,2,3,7,10),'m7b5':(0,3,6,10)}
templates=[(name+quality,r,{(r+x)%12 for x in intervals},quality)
           for r,name in enumerate(names) for quality,intervals in qualities.items()]
d['chords']=[]
for b in bars:
    n,den=b['meter']
    for step in range(0,n,2):
        beat0=b['beat']+step*4/den
        beat1=b['beat']+min(n,step+2)*4/den
        # Aggregate ring and attacks across the written subdivision.
        weights=Counter()
        window=[e for e in harmonic[:bisect_right(starts,beat1-1e-7)] if e['endBeat']>beat0]
        for e in window:
            strength=(min(beat1,e['endBeat'])-max(beat0,e['beat']))/(beat1-beat0)
            weights[e['pitch']%12]=min(1.5,weights[e['pitch']%12]+strength)
        lower=[e for e in bass if e['beat']<beat1 and e['endBeat']>beat0]
        low=min((e['pitch'] for e in lower),default=min((e['pitch'] for e in window),default=-1))
        total=sum(weights.values())
        if not total: continue
        last=d['chords'][-1] if d['chords'] else None
        candidates=[]
        for name,root,pcs,quality in templates:
            if quality=='5' and (not lower or root!=low%12 or len([p for p in weights if weights[p]>=.25])!=2):continue
            if min(weights[p] for p in pcs)<.16:continue
            cover=sum(weights[p] for p in pcs)/total
            if cover<.74:continue
            strength=cover+.105*(low>=0 and root==low%12)-.046*max(0,len(pcs)-3)
            if last and last['symbol']==name and abs(last['end']-b['pulses'][step])<.001: strength+=.025
            candidates.append((strength,name))
        if not candidates:continue
        _,symbol=max(candidates)
        start=b['pulses'][step]
        end=b['pulses'][min(n,step+2)]
        if last and last['symbol']==symbol and abs(last['end']-start)<.001:
            last['end']=end
        else:
            d['chords'].append(dict(start=start,end=end,symbol=symbol))
print('Guitars',[(x['capo'],len(x['notes']),x['notes'][0]['start']) for x in guitars])
print('Chords',len(d['chords']),Counter(x['symbol'] for x in d['chords']).most_common(10))
print('Meters',[(i+1,round(b['start'],3),b['meter']) for i,b in enumerate(bars) if i==0 or b['meter']!=bars[i-1]['meter']])

(args.workdir/'toe-band-render-data.json').write_text(json.dumps(d))
