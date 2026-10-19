import { test, expect } from "./fixtures";
import { build } from "esbuild";
import path from "node:path";
import { readFileSync } from "node:fs";
import ts from "typescript";
// Failure inventory: docs/testing-map-sprites-steam-layout.md. Native renderer
// textures are the declared boundary; maintained collection + Canvas render run.
test("live maps draw native weapon cosmetic and projectile pixels without clipping or ghosts", async ({
  page,
  app,
}, info) => {
  const bundle = await build({
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    tsconfig: path.resolve("dashboard/tsconfig.json"),
    stdin: {
      resolveDir: path.resolve("dashboard"),
      loader: "tsx",
      contents: `import React from'react';import{createRoot}from'react-dom/client';import{MapCanvas}from'./features/party/map-canvas';import{captureNativeLayers}from'../runtime/characters/map-sprites';
 const atlas=document.createElement('canvas');atlas.width=64;atlas.height=32;const ctx=atlas.getContext('2d');for(const[x,y,w,h,color]of[[0,0,16,16,'#ff0000'],[16,0,4,16,'#ffff00'],[20,0,16,16,'#00ffff'],[36,0,8,8,'#ff00ff'],[44,0,4,4,'#00ff00']]){ctx.fillStyle=color;ctx.fillRect(x,y,w,h);}const url=atlas.toDataURL();
 const node=(sx,sy,width,height,x=0,y=0,ax=0,ay=0)=>({visible:true,renderable:true,alpha:1,position:{x,y},scale:{x:1,y:1},rotation:0,pivot:{x:0,y:0},anchor:{x:ax,y:ay},texture:{frame:{x:sx,y:sy,width,height},orig:{width,height},baseTexture:{resource:{url}}},children:[]});
 const actor=node(0,0,16,16,0,0,.5,1);actor.texture.orig={width:20,height:20};actor.texture.trim={x:2,y:4};actor.children=[node(20,0,16,16,-26,-16),node(36,0,8,8,-4,-30),node(16,0,4,16,14,-16)];actor.children[2].scale={x:-1,y:1};const layers=captureNativeLayers(actor);window.nativeLayers=layers;const projectile={id:'arrow',x:40,y:-10,layers:captureNativeLayers(node(44,0,4,4,40,-10,.5,.5))};const definition={name:'main',min_x:-200,min_y:-200,max_x:200,max_y:200,tiles:[],placements:[],groups:[],tilesets:{}};let running=true;window.removeProjectile=()=>{running=false;};function App(){const[t,s]=React.useState(0);React.useEffect(()=>{const timer=setInterval(()=>s(v=>v+1),50);return()=>clearInterval(timer);},[]);return <div style={{width:400,height:300}}><MapCanvas definition={definition} frame={{name:'Actor',map:'main',at:Date.now(),x:0,y:0,entities:[{id:'Actor',name:'Actor',type:'character',x:0,y:0,hp:100,max_hp:100,mp:10,max_mp:10,layers}],visuals:running?[projectile]:[]}} previous={null} receivedAt={performance.now()} scale={1} detailed={false}/></div>}createRoot(document.getElementById('root')).render(<App/>);`,
    },
  });
  await page.goto(app.url);
  await page.route("**/map-sprites-harness", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<head><style>canvas{display:block;width:100%;height:100%}</style></head><body style="margin:0"><div id="root"></div></body>',
    }),
  );
  await page.goto(app.url + "/map-sprites-harness");
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const canvas = page.locator("canvas");
  const pixels = () =>
    canvas.evaluate((element) => {
      const c = element as HTMLCanvasElement,
        ctx = c.getContext("2d")!;
      return [
        [200, 140],
        [180, 140],
        [200, 123],
        [211, 140],
        [240, 140],
      ].map(([x, y]) => Array.from(ctx.getImageData(x, y, 1, 1).data));
    });
  await expect.poll(pixels).toEqual([
    [255, 0, 0, 255],
    [0, 255, 255, 255],
    [255, 0, 255, 255],
    [255, 255, 0, 255],
    [0, 255, 0, 255],
  ]);
  await info.attach("native-map-layer-pixels", {
    body: await canvas.screenshot(),
    contentType: "image/png",
  });
  await page.evaluate(() => (window as any).removeProjectile());
  await expect.poll(async () => (await pixels())[4]).toEqual([7, 17, 15, 255]);
  await info.attach("native-map-layer-ledger", {
    body: JSON.stringify({
      layers: await page.evaluate(() => (window as any).nativeLayers),
      pixels: await pixels(),
    }),
    contentType: "application/json",
  });
});

test("map sprite publication remains subscriber-only and bounds native renderer payloads", async ({
  page,
}, info) => {
  const tree = ts.createSourceFile(
      "shared.js",
      readFileSync("characters/shared.js", "utf8"),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.JS,
    ),
    pieces: string[] = [];
  function visit(node: ts.Node) {
    if (
      ts.isFunctionDeclaration(node) &&
      node.name &&
      ["mapEntity", "publishMapFrame"].includes(node.name.text)
    )
      pieces.push(node.getText(tree));
    ts.forEachChild(node, visit);
  }
  visit(tree);
  const bundle = await build({
    entryPoints: ["runtime/characters/map-sprites.ts"],
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    globalName: "MapSprites",
  });
  await page.route("http://map-publication.test/**", (r) =>
    r.fulfill({ contentType: "text/html", body: "<body></body>" }),
  );
  await page.goto("http://map-publication.test/");
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await page.addScriptTag({
    content: `var mapTelemetryEnabled=false,mapTelemetryBusy=false,mapSpriteLayerBudget=192,mapSpriteEntityBudget=64,mapTelemetryEvents=[],combatTargetId=null,api='/party-api';var captureCalls=0,packets=[];var root={capturePartyMapLayers:function(entity){captureCalls++;return MapSprites.captureNativeLayers(entity);},capturePartyMapVisuals:MapSprites.captureMapVisuals};var G={items:{sword:{skin:'sword'},shield:{skin:'shield'}}};function spriteDefinition(){return null;}function mapDollHtml(){return null;}function liveCaveMapDefinition(){}function queueMarkers(){return [];}function groupedFarming(){return false;}var groupedCombat={},eventTargetTypes=[];var $={ajax:function(request){packets.push(JSON.parse(request.data));return{always:function(done){done();}};}};var url='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';function node(){return{visible:true,renderable:true,texture:{frame:{x:0,y:0,width:1,height:1},orig:{width:1,height:1},baseTexture:{resource:{url:url}}},children:[]};}var character=Object.assign(node(),{name:'Actor',id:'Actor',type:'character',map:'main',x:1,y:2,hp:100,max_hp:100,slots:{mainhand:{name:'sword'},offhand:{name:'shield'}}});parent.entities={};parent.map_animations={arrow:Object.assign(node(),{atype:'map',x:12,y:13}),deleted:Object.assign(node(),{atype:'map',to_delete:true,x:1,y:1})};${pieces.join("\n")}`,
  });
  await page.evaluate(() => (window as any).publishMapFrame());
  expect(
    await page.evaluate(() => ({
      calls: (window as any).captureCalls,
      packets: (window as any).packets.length,
    })),
  ).toEqual({ calls: 0, packets: 0 });
  await page.evaluate(() => {
    (window as any).mapTelemetryEnabled = true;
    (window as any).publishMapFrame();
  });
  const payload = await page.evaluate(() => (window as any).packets[0]);
  expect(payload.entities[0].weapons.map((weapon: any) => weapon.hand)).toEqual([
    "mainhand",
    "offhand",
  ]);
  expect(payload.entities[0].layers).toHaveLength(1);
  expect(payload.visuals.map((visual: any) => visual.id)).toEqual(["arrow"]);
  const limits = await page.evaluate(() => {
    const h = window as any,
      actor = h.node();
    actor.children = Array.from({ length: 1000 }, () => h.node());
    const animations = Object.fromEntries(
      Array.from({ length: 1000 }, (_, i) => [
        String(i),
        Object.assign(h.node(), { atype: "map", x: i, y: i }),
      ]),
    );
    return {
      entity: h.MapSprites.captureNativeLayers(actor).length,
      visuals: h.MapSprites.captureMapVisuals(animations, 64).reduce(
        (sum: number, entry: any) => sum + entry.layers.length,
        0,
      ),
    };
  });
  expect(limits).toEqual({ entity: 32, visuals: 64 });
  const captureTiming=await page.evaluate(()=>{const h=window as any,actor=h.node();actor.children=Array.from({length:12},()=>h.node());const samples=[];for(let run=0;run<5;run++){const start=performance.now();for(let frame=0;frame<1000;frame++)h.MapSprites.captureNativeLayers(actor);samples.push((performance.now()-start)/1000);}return{layers:13,capturesPerSample:1000,nativeMsPerCapture:samples};});
  await info.attach("subscribed-native-map-wire", {
    body: JSON.stringify({ payload, limits, captureTiming, bytes: Buffer.byteLength(JSON.stringify(payload)) }),
    contentType: "application/json",
  });
});
