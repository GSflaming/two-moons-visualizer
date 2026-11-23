import gzip,json,subprocess
from pathlib import Path
from fractions import Fraction
import numpy as np
from scipy.signal import stft,find_peaks
from scipy.ndimage import gaussian_filter1d

import argparse

parser = argparse.ArgumentParser(description='Align a user-supplied score with a local recording.')
parser.add_argument('--audio', type=Path, required=True)
parser.add_argument('--score', type=Path, required=True)
parser.add_argument('--workdir', type=Path, required=True)
args = parser.parse_args()
args.workdir.mkdir(parents=True, exist_ok=True)

data=args.score
source=args.audio
tracks=[json.load(gzip.open(data/f'{i}.json')) for i in range(6)]
bars=[Fraction(0)]
meters=[]
meter=[4,4]
for i,b in enumerate(tracks[-1]['measures']):
    if 'signature' in b: meter=b['signature']
    meters.append(meter)
    bars.append(bars[-1]+4*Fraction(*meter))
tempo=[(float(bars[t['measure']]),t['bpm']) for t in tracks[0]['automations']['tempo']]
tempo_b=np.array([b for b,_ in tempo])
tempo_p=np.array([p for _,p in tempo])
tempo_s=np.r_[0,np.cumsum(np.diff(tempo_b)*60/tempo_p[:-1])]
def sec(beat):
    i=max(0,np.searchsorted(tempo_b,float(beat),side='right')-1)
    return float(tempo_s[i]+(float(beat)-tempo_b[i])*60/tempo_p[i])

parsed=[]
for i,tr in enumerate(tracks):
    events=[]
    for bar,(b,m) in enumerate(zip(bars,tr['measures'])):
        for v in m['voices']:
            p=b
            for beat in v['beats']:
                d=4*Fraction(*beat['duration'])
                for n in beat['notes']:
                    if n.get('rest') or n.get('tie'): continue
                    if i==5:
                        if n['fret']<=0: continue
                        pitch=n['fret']
                    else:
                        if not 1<=n['string']<=len(tr['tuning']) or n['fret']<0: continue
                        pitch=tr['tuning'][n['string']-1]+n['fret']+tr.get('capo',0)
                    events.append(dict(beat=float(p),length=float(d),nominal=sec(p),pitch=pitch,bar=bar+1,
                      ghost=bool(n.get('ghost')),accent=bool(n.get('accentuated')),velocity=beat.get('velocity')))
                p+=d
            assert p==bars[bar+1],(i,bar,p,bars[bar+1])
    parsed.append(events)
print('Nominal duration',sec(bars[-1]),'first drum',parsed[-1][0], 'meters',[(i+1,sec(bars[i]),m) for i,m in enumerate(meters) if i==0 or m!=meters[i-1]],flush=True)

rate=16000; step=160
samples=np.frombuffer(subprocess.check_output(['ffmpeg','-v','error','-i',str(source),'-ac','2','-ar',str(rate),'-f','f32le','-']),dtype='<f4').reshape(-1,2)
duration=len(samples)/rate
freq,t,z=stft(samples.T,fs=rate,nperseg=4096,noverlap=4096-step)
mag=abs(z).mean(axis=0)
log=np.log1p(mag*350)
def flux(lo,hi):
    x=log[(freq>=lo)&(freq<hi)]
    f=gaussian_filter1d(np.maximum(0,np.diff(x,axis=1,prepend=0)).mean(axis=0),1.1)
    return np.minimum(f/(gaussian_filter1d(f,48)+.004),4)/4
low=flux(40,105); mid=flux(135,3500); high=flux(4000,7800)
midi_f=440*2**((np.arange(128)-69)/12)
bins=np.argmin(abs(freq[None,:]-midi_f[:,None]),axis=1).clip(1,len(freq)-2)
tone=np.array([np.maximum(mag[b],np.maximum(mag[b-1],mag[b+1])*.60) for b in bins])
for lo,hi in [(22,44),(44,60),(60,75),(75,101)]:
    tone[lo:hi]/=tone[lo:hi].max(axis=0)+1e-7
print('duration',duration,flush=True)
for lo,hi in [(0,2),(100,127),(132,153),(211,231),(238,250)]:
    i=find_peaks(low)[0]
    a=sorted([j for j in i if lo<t[j]<hi],key=lambda j:low[j],reverse=True)[:10]
    print('strong low onsets',lo, sorted(round(float(t[j]),2) for j in a))
scores=scores.copy()
# The opening guitar, initial kick pattern, 3/4 drum entrance and
# the late cymbal roll anchor the metrical phase across repeated riffs.
anchor_times=np.array([0,110,120,134,144.75,159,189,216,240,247])
anchor_offsets=np.array([1.17,.35,-.02,.10,-.02,-.16,-.36,-.56,-.66,-.68])
expected=np.interp(centers,anchor_times,anchor_offsets)
score_raw=scores.copy()
diff=offsets[None,:]/100-expected[:,None]
limit=np.where(centers<108,.58,.31)
scores-=.16*(diff/limit[:,None])**2
scores[abs(diff)>limit[:,None]]=-1e4
steps=np.arange(-9,10)
i=np.arange(len(offsets))[:,None]+steps[None,:]
invalid=(i<0)|(i>=len(offsets))
i=np.clip(i,0,len(offsets)-1)
cost=.0028*abs(steps)+.00043*steps**2
best=scores[0].copy()
parents=[]
for row in scores[1:]:
    options=best[i]-cost
    options[invalid]=-np.inf
    change=np.argmax(options,axis=1)
    parents.append(i[np.arange(len(i)),change])
    best=row+options[np.arange(len(i)),change]
picks=[int(np.argmax(best))]
for row in reversed(parents):
    picks.append(int(row[picks[-1]]))
picks=np.array(picks[::-1])
raw=offsets[picks]/100
smooth=gaussian_filter1d(raw,.82,mode='nearest')
print('alignment',list(zip(centers[::6],np.round(smooth[::6],2))),flush=True)
for shift in [-50,-20,0,20,50]:
    print('offset control',shift,round(float(np.mean(scores[np.arange(len(picks)),np.clip(picks+shift//2,0,len(offsets)-1)])),4))
# Anchor the first attack and the three landmark drum transients
# at higher temporal resolution than the window-level fit.
anchor_points=[(0,1.168,2.2),(109.714285714,110.058,1.7),(112.285714286,112.57,1.25),
               (144.75,144.727,2.2),(240.019,239.327,1.9)]
base_centers=centers.copy()
base_smooth=smooth.copy()
def alignment(x):
    offset=float(np.interp(x,base_centers,base_smooth))
    for center,actual,r in anchor_points:
        residual=actual-center-float(np.interp(center,base_centers,base_smooth))
        offset+=float(np.exp(-((x-center)/r)**2))*residual
    return offset

def to_audio(x):
    return float(x+alignment(x))
out=dict(duration=duration,
         bars=[dict(start=to_audio(sec(b)),end=to_audio(sec(bars[i+1])),meter=meters[i],
                   pulses=[to_audio(sec(b+Fraction(j*4,meters[i][1]))) for j in range(meters[i][0]+1)])
                  for i,b in enumerate(bars[:-1])],
         drums=[{**e,'time':to_audio(e['nominal'])} for e in parsed[-1]],
         titles=[tr['name'] for tr in tracks])
(args.workdir/'toe-render-data.json').write_text(json.dumps(out))
print('mapped',out['bars'][0],out['bars'][82],out['bars'][143],out['bars'][-1],out['drums'][0],out['drums'][-1])
