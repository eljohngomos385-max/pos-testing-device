import sys
from PIL import Image
import numpy as np
k=3
def load(p): return np.asarray(Image.open(p).convert('RGB')).astype(int)
def bb(m,x0,y0):
    ys,xs=np.where(m); return [round(x0+xs.min()/k,1),round(y0+ys.min()/k,1),round(x0+(xs.max()+1)/k,1),round(y0+(ys.max()+1)/k,1)] if len(xs) else None
def parts(im):
    def reg(x0,y0,x1,y1): return im[int(y0*k):int(y1*k),int(x0*k):int(x1*k)]
    out={}
    out['time']=bb(reg(38,15,90,50).sum(2)<300,38,15)
    out['island']=bb(reg(100,5,285,55).sum(2)<30,100,5)
    r=reg(100,5,285,55); out['mic']=bb((r[:,:,0]>150)&(r[:,:,2]<120),100,5)
    r=reg(282,15,305,45); out['dot orange']=bb((r[:,:,0]>180)&(r[:,:,2]<120),282,15); out['dot ring']=bb(r.sum(2)<300,282,15)
    out['wifi']=bb(reg(308,15,333,45).sum(2)<300,308,15)
    r=reg(333,15,370,45); out['bat']=bb(np.abs(r-242).sum(2)>40,333,15); out['bat red']=bb((r[:,:,0]>200)&(r[:,:,1]<120),333,15)
    out['bat text']=bb(r.min(2)>250,333,15)
    r=reg(80,836,313,850); out['home']=bb(np.abs(r-67).max(2)<12,80,832)
    return out
a=parts(load(sys.argv[1])); b=parts(load(sys.argv[2]))
for n in a:
    d=[round(y-x,1) for x,y in zip(a[n],b[n])] if a[n] and b[n] else '-'
    print(f'{n:11} shot {a[n]}  ours {b[n]}  diff {d}')
