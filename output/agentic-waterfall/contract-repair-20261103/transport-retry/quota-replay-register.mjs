import {registerHooks} from 'node:module';
const windowClient=new URL('../kuairand-window512-20261103/client.mjs',import.meta.url).href;
const replay=new URL('./quota-replay-client.mjs',import.meta.url).href;
registerHooks({
  resolve(specifier,context,nextResolve){
    const r=nextResolve(specifier,context);
    return r.url===windowClient && context.parentURL!==replay ? {url:replay,shortCircuit:true}:r;
  }
});
