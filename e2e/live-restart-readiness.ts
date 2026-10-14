export interface RestartStateProbe {
  at:number;
  elapsedMs:number;
  status?:number;
  body?:string;
  error?:string;
  code?:string;
  ready?:boolean;
}
function validState(value:unknown):boolean {
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  const state=value as {gameVersion?:unknown;characters?:unknown};
  return ['number','string'].includes(typeof state.gameVersion)&&!!state.characters&&
    typeof state.characters==='object'&&!Array.isArray(state.characters);
}
function transportDetails(error:unknown):Pick<RestartStateProbe,'error'|'code'> {
  const value=error as {message?:unknown;cause?:{code?:unknown}};
  return {error:String(value?.message||error).slice(0,512),code:String(value?.cause?.code||'').slice(0,80)};
}
/** Only explicit fixture restarts probe this read boundary; gameplay reads remain strict. */
export async function waitForLiveRestartState(base:string,observe:(row:RestartStateProbe)=>void,timeoutMs=15000):Promise<void> {
  const startedAt=Date.now(),deadline=startedAt+timeoutMs;
  const url=new URL('/party-api/state?catalog=0',base);
  let attempt=0;
  while(Date.now()<deadline){
    const row:RestartStateProbe={at:Date.now(),elapsedMs:Date.now()-startedAt};
    let response:Response|undefined,text='';
    try{
      response=await fetch(url,{method:'GET',redirect:'error',signal:AbortSignal.timeout(Math.max(1,Math.min(5000,deadline-Date.now())))});
      text=await response.text();
    }catch(error){row.status=response?.status;response=undefined;Object.assign(row,transportDetails(error));}
    if(response){
      row.status=response.status;
      if(!response.ok)row.body=text.slice(0,1024);
      if(response.status!==503){
        if(!response.ok){observe(row);throw Error('Restart state readiness rejected HTTP '+response.status+': '+row.body);}
        let state:unknown;
        try{state=JSON.parse(text);}catch{observe(row);throw Error('Restart state readiness returned invalid JSON');}
        if(!validState(state)){observe(row);throw Error('Restart state readiness returned invalid state');}
        row.ready=true;observe(row);return;
      }
    }
    observe(row);
    const delay=Math.min([50,100,250][Math.min(attempt++,2)],Math.max(0,deadline-Date.now()));
    if(delay)await new Promise(resolve=>setTimeout(resolve,delay));
  }
  throw Error('Coordinator public state not ready within '+timeoutMs+'ms');
}
