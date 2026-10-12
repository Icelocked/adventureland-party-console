"use client";
import {useEffect,useState} from 'react';
/** Session UI preferences only: never restore a submitted command or item action. */
export function useSessionState<T>(key:string,initial:T){
  const [value,setValue]=useState(initial),[ready,setReady]=useState(false);
  useEffect(()=>{try{const saved=sessionStorage.getItem('party-ui:'+key);if(saved!==null)setValue(JSON.parse(saved));}catch{}setReady(true);},[key]);
  useEffect(()=>{if(ready)try{sessionStorage.setItem('party-ui:'+key,JSON.stringify(value));}catch{}},[key,value,ready]);
  return [value,setValue] as const;
}
