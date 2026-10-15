/** One declared input before a real native request; responses remain owned by jQuery. */
export function gateNativeAjaxInput(host:any,matches:(options:any)=>boolean,input:()=>Promise<unknown>,owns:()=>boolean){
  const native=host.$.ajax;
  let admitted=false;
  const gated=function(this:any,...args:any[]){
    if(admitted||!matches(args[0]))return native.apply(this,args);
    admitted=true;
    const deferred=host.$.Deferred(),receiver=this;
    let cancelled=false,xhr:any;
    const output=deferred.promise();
    output.abort=function(){
      cancelled=true;
      if(xhr)xhr.abort();else deferred.rejectWith(receiver,[{status:0},'abort','abort']);
      return output;
    };
    Promise.resolve().then(()=>{
      if(cancelled)return;
      if(!owns())throw Error('Native checkpoint input ownership changed');
      return input();
    }).then(()=>{
      if(cancelled)return;
      if(!owns())throw Error('Native checkpoint input ownership changed');
      xhr=native.apply(receiver,args);
      xhr.done(function(this:any,...values:any[]){deferred.resolveWith(this,values);});
      xhr.fail(function(this:any,...values:any[]){deferred.rejectWith(this,values);});
    }).catch(error=>{if(!cancelled)deferred.rejectWith(receiver,[{status:0},'error',error]);});
    return output;
  };
  host.$.ajax=gated;
  return ()=>{if(host.$.ajax===gated)host.$.ajax=native;};
}
