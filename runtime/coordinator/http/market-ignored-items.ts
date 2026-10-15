import {marketItemKey,validMarketIgnoredItem,type MarketIgnoredItem} from '../../market-preferences.ts';
import {requestObject,type HttpRequest,type HttpResponse} from './contracts.ts';

export function marketIgnoredItemsRoute(state:{marketIgnoredItems:MarketIgnoredItem[]},persist:()=>void){
  return (req:HttpRequest,res:HttpResponse)=>{
    const body=requestObject(req.body);
    if(body.action==='clear')state.marketIgnoredItems=[];
    else if(body.action==='add'||body.action==='remove'){
      const item={name:body.name,level:body.level??0};
      if(!validMarketIgnoredItem(item))return res.status(400).json({error:'Provide an item name and nonnegative whole item level'});
      const key=marketItemKey(item),items=state.marketIgnoredItems.filter(entry=>marketItemKey(entry)!==key);
      if(body.action==='add'){
        if(items.length>=2048)return res.status(400).json({error:'The ignored-item list is full; remove an entry first'});
        items.push(item);
      }
      state.marketIgnoredItems=items;
    }else return res.status(400).json({error:'Choose add, remove, or clear'});
    persist();return res.json({ok:true,items:state.marketIgnoredItems});
  };
}
