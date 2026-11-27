import { useEffect, useMemo, useState } from 'react';
import { Maximize2, Minimize2, X } from 'lucide-react';
import { formatCryptoPrice, type Candle, type Timeframe } from '../lib/marketData';
import type { UnifiedSignalAuditRecord } from '../lib/signalHistory';
import { deriveTradeAuditIdentity } from '../lib/tradeAuditIdentity';

type ChartState = { source: 'binance' | 'unavailable'; candles: Candle[] } | null;

function parseSignalTimeUtc(input:string):number|null {
  const parsed=Date.parse(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(input)?`${input.replace(' ','T')}Z`:input);
  return Number.isFinite(parsed)?parsed:null;
}

export function SignalInspectChart({ record, onClose }: {
  record: UnifiedSignalAuditRecord;
  onClose: () => void;
}) {
  const [maximized, setMaximized] = useState(false);
  const [chart, setChart] = useState<ChartState>(null);
  const [loading, setLoading] = useState(true);
  const [timeframe, setTimeframe] = useState<Timeframe>('15m');
  const identity = useMemo(() => deriveTradeAuditIdentity(record), [record]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [onClose]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setChart(null);
    const signalTimeMs=parseSignalTimeUtc(record.timestamp);
    if (signalTimeMs===null || signalTimeMs>Date.now()) {
      setLoading(false);
      return () => controller.abort();
    }
    const endTime=Math.min(Date.now(),signalTimeMs+60*60*1000);
    const query=new URLSearchParams({symbol:record.symbol,interval:timeframe,limit:'360',market:'spot',endTime:String(endTime)});
    void fetch(`/api/binance/klines?${query.toString()}`,{signal:controller.signal,cache:'no-store'})
      .then(async response => {
        if(!response.ok)throw new Error('Historical data unavailable');
        const data=await response.json() as {source?:string;candles?:Candle[]};
        if(!controller.signal.aborted) setChart({
          source:data.source==='binance'?'binance':'unavailable',
          candles:Array.isArray(data.candles)?data.candles:[],
        });
      })
      .catch(() => { if (!controller.signal.aborted) setChart(null); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [record.symbol, timeframe]);

  const plot = useMemo(() => {
    if (!chart || chart.source !== 'binance' || chart.candles.length < 2) return null;
    const candles = chart.candles;
    const levels = [record.entryPrice, record.stopLoss, ...(record.takeProfits ?? [record.takeProfit]), record.exitOrMarkPrice];
    const prices = [...candles.flatMap(c => [c.high,c.low]),...levels].filter(x => Number.isFinite(x) && x > 0);
    if (prices.length < 2) return null;
    const lo=Math.min(...prices),hi=Math.max(...prices);
    const span=Math.max(hi-lo,hi*0.00001);
    const left=54, right=110, top=26, bottom=30, width=1040, height=470;
    const innerWidth=width-left-right, innerHeight=height-top-bottom;
    const y=(p:number)=>top+((hi-p)/span)*innerHeight;
    const x=(i:number)=>left+(i/Math.max(1,candles.length-1))*innerWidth;
    const barWidth=Math.max(1,Math.min(7,innerWidth/candles.length*0.7));
    const eventTimeMs=parseSignalTimeUtc(record.timestamp);
    const eventIndex=eventTimeMs===null?-1:candles.findIndex(c=>{
      const candleStartMs=c.time*1000;
      const durationMs=({'15m':900000,'1h':3600000,'4h':14400000,'1d':86400000} as const)[timeframe];
      return eventTimeMs>=candleStartMs&&eventTimeMs<candleStartMs+durationMs;
    });
    const lines=[
      {price:record.entryPrice,label:'ENTRY',color:'#38bdf8'},
      {price:record.stopLoss,label:'SL',color:'#f43f5e'},
      ...(record.takeProfits ? record.takeProfits.map((price,i)=>({price,label:`TP${i+1}`,color:'#22c55e'})) : [{price:record.takeProfit,label:'TP',color:'#22c55e'}]),
      {price:record.exitOrMarkPrice,label:record.status==='ACTIVE'?'LATEST MARK':'EXIT / MARK',color:'#eab308'},
    ];
    return {candles,lo,hi,y,x,barWidth,width,height,left,right,top,bottom,lines,eventIndex};
  }, [chart,record,timeframe]);

  return (
    <div role="dialog" aria-modal="true" aria-label={`Inspect signal ${record.symbol}`}
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/85 p-2 sm:p-5">
      <div className={`flex flex-col overflow-hidden rounded-2xl border border-slate-600 bg-[#0c1220] text-slate-100 shadow-2xl ${maximized?'h-[98dvh] w-[99vw]':'max-h-[92dvh] w-full max-w-6xl'}`}>
        <div className="flex items-center justify-between gap-2 border-b border-slate-700 p-3 sm:p-4">
          <div>
            <h2 className="font-bold">{record.symbol} · {record.direction} · {record.moduleLabel}</h2>
            <p className="text-xs text-slate-400">{identity.id} · {identity.verificationLabel}</p>
          </div>
          <div className="flex items-center gap-2">
            <select aria-label="Chart timeframe" value={timeframe} onChange={e=>setTimeframe(e.target.value as Timeframe)}
              className="rounded border border-slate-600 bg-[#121c2e] p-2 text-xs">
              <option value="15m">15m</option><option value="1h">1h</option>
              <option value="4h">4h</option><option value="1d">1d</option>
            </select>
            <button type="button" aria-label={maximized?'Restore chart':'Maximize chart'} onClick={()=>setMaximized(v=>!v)}
              className="rounded border border-slate-600 p-2 hover:bg-slate-700">
              {maximized?<Minimize2 size={16}/>:<Maximize2 size={16}/>}
            </button>
            <button type="button" aria-label="Close chart" onClick={onClose}
              className="rounded border border-slate-600 p-2 hover:bg-slate-700"><X size={16}/></button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-3 sm:p-5">
          <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
            {[
              ['ENTRY',record.entryPrice],['STOP LOSS',record.stopLoss],
              ['TAKE PROFIT',record.takeProfit],['EXIT / LAST MARK',record.exitOrMarkPrice],
            ].map(([label,value])=><div key={String(label)} className="rounded-lg border border-slate-700 p-3">
              <span className="text-slate-400">{label}</span>
              <p className="mt-1 font-mono font-bold">{formatCryptoPrice(Number(value))}</p>
            </div>)}
          </div>
          {record.takeProfits && <div className="mt-2 flex flex-wrap gap-2 text-xs">
            {record.takeProfits.map((value,i)=><span key={i} className="rounded border border-emerald-600/50 bg-emerald-950/20 px-3 py-1.5 text-emerald-300">
              TP{i+1}: ${formatCryptoPrice(value)}
            </span>)}
          </div>}
          <div className="mt-3 rounded-xl border border-slate-700 bg-[#080f1d] p-2">
            {loading?<p className="p-8 text-sm text-slate-300">Loading historical candles...</p>
              :plot?
                <svg viewBox={`0 0 ${plot.width} ${plot.height}`} width="100%" role="img"
                  aria-label={`Actual Binance market candles for ${record.symbol} with entry stop loss target and exit mark horizontal levels`}>
                  {plot.candles.map((c,i)=>{
                    const bullish=c.close>=c.open;
                    const color=bullish?'#10b981':'#f43f5e';
                    const xx=plot.x(i),top=Math.min(plot.y(c.open),plot.y(c.close)),height=Math.max(1,Math.abs(plot.y(c.open)-plot.y(c.close)));
                    return <g key={c.time}>
                      <line x1={xx} x2={xx} y1={plot.y(c.high)} y2={plot.y(c.low)} stroke={color} strokeWidth="1"/>
                      <rect x={xx-plot.barWidth/2} y={top} width={plot.barWidth} height={height} fill={color}/>
                    </g>;
                  })}
                  {plot.eventIndex>=0 && <g>
                    <line x1={plot.x(plot.eventIndex)} x2={plot.x(plot.eventIndex)} y1={plot.top} y2={plot.height-plot.bottom}
                      stroke="#a78bfa" strokeDasharray="3 3" />
                    <text x={plot.x(plot.eventIndex)+4} y={plot.top+12} fill="#c4b5fd" fontSize="11">SIGNAL TIMESTAMP</text>
                  </g>}
                  {plot.lines.map(line=><g key={line.label}>
                    <line x1={plot.left} x2={plot.width-plot.right+8} y1={plot.y(line.price)} y2={plot.y(line.price)}
                      stroke={line.color} strokeWidth="1.6" strokeDasharray="6 4"/>
                    <text x={plot.width-plot.right+12} y={plot.y(line.price)+4} fill={line.color} fontSize="12">{line.label}</text>
                  </g>)}
                </svg>:
                <p className="p-8 text-sm text-amber-200">Verified historical Binance candles unavailable. A simulated chart is deliberately not presented as a historical trade chart.</p>}
          </div>
          <p className="mt-2 text-xs text-slate-400">
            Chart source: {chart?.source==='binance'?'Binance historical candles around signal time':'Unavailable'}.
            {' '}The horizontal levels are saved signal prices, not proven historical fill markers.
            The inspection window does not establish when an order filled or verify an exchange trade ID.
          </p>
          <dl className="mt-3 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
            <div><dt className="text-slate-400">Strategy</dt><dd>{record.moduleLabel}</dd></div>
            <div><dt className="text-slate-400">Signal timestamp</dt><dd>{record.timestamp}</dd></div>
            <div><dt className="text-slate-400">Timeframe</dt><dd>{record.timeframe}</dd></div>
            <div><dt className="text-slate-400">Status</dt><dd>{record.status} · {record.origin}</dd></div>
            <div className="sm:col-span-2"><dt className="text-slate-400">Setup / strategy context</dt><dd>{record.retestStatus ?? 'Not recorded'} · {record.skepticVerdict ?? 'No independent risk verdict recorded'}</dd></div>
          </dl>
        </div>
      </div>
    </div>
  );
}
