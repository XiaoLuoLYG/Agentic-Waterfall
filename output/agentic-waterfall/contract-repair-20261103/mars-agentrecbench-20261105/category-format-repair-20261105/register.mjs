import {registerHooks} from 'node:module';
const entry=new URL('../run-case.mjs',import.meta.url).href;
const original=new URL('../adapter.mjs',import.meta.url).href;
registerHooks({resolve(specifier,context,nextResolve){
  const result=nextResolve(specifier,context);
  return context.parentURL===entry&&result.url===original
    ? {url:new URL('./adapter.mjs',import.meta.url).href,shortCircuit:true}:result;
}});
