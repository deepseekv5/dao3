import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { launchChrome, Session, freePort } from "./cdp.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = await freePort(6300, 90);
const BASE = `http://127.0.0.1:${PORT}`;
const child = spawn(process.execPath, [path.join(ROOT, "server.js")], { cwd: ROOT, stdio: "ignore", env: { ...process.env, PORT: String(PORT), HOST: "127.0.0.1" } });
process.on("exit", () => { try { child.kill("SIGTERM"); } catch {} });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`); cond ? pass++ : fail++; };
let up = false;
for (let i = 0; i < 80; i++) { await sleep(150); try { const j = await (await fetch(BASE + "/api/whoami")).json(); if (j?.app) { up = true; break; } } catch {} }
if (!up) { console.log("FAIL  本地服务未启动"); process.exit(1); }

const chrome = await launchChrome({ port: await freePort(9770, 30) });
const s = await Session.open(chrome.port, { isolated: true, width: 1440, height: 900, initScripts: ['localStorage.setItem("dao3_disclaimer_ack","3");sessionStorage.setItem("dao3_no_autosave","1")'] });
const started = Date.now();
await s.goto(`${BASE}/edit/216d665d3ca92bd1b9a2`, { settleMs: 300 });
let readyMs = 0;
for (let i = 0; i < 600; i++) { if (await s.evaluate("!!window.__editor", { awaitPromise: false })) { readyMs = Date.now() - started; break; } await sleep(100); }
ok("默认地图工作区可用", readyMs > 0, `${readyMs}ms`);
let modelCount = 0;
for (let i = 0; i < 150; i++) { modelCount = await s.evaluate("window.__editor.state.models.length", { awaitPromise: false }); if (modelCount >= 150) break; await sleep(100); }
ok("小地图模型全量即时恢复", modelCount >= 150, String(modelCount));

await s.evaluate(`document.querySelector('.mtab[data-menu="blocks"]').click()`);
await sleep(250);
const blocks = await s.evaluate(`(() => {
  const tool=document.querySelector('#bsTool'),filter=document.querySelector('#bsFilter');
  const total=+tool.dataset.total;
  const general=tool.querySelectorAll('.bs-chip:not(.c-voxel)').length;
  const options=[...document.querySelectorAll('#bkBlockOptions option')];
  const bilingual=options.some(x=>x.value==='grass'&&x.label.includes('草')&&x.label.includes('grass'));
  filter.value='石头';filter.dispatchEvent(new Event('input',{bubbles:true}));
  const search=[...tool.querySelectorAll('.bs-chip')].length;
  const padded=[...tool.querySelectorAll('.bs-chip')].some(x=>/^vox_(set|if)_/.test(x.dataset.type||''));
  filter.value='设置天气';filter.dispatchEvent(new Event('input',{bubbles:true}));
  const weather=tool.querySelector('.bs-chip');if(weather)weather.click();
  return {total,general,options:options.length,bilingual,search,padded,code:document.querySelector('#blockScreen .bs-code code').textContent};
})()`);
ok("积木目录只保留真实操作，不用方块变体凑数", blocks.total >= 30 && blocks.total < 80 && !blocks.padded, String(blocks.total));
ok("通用玩法积木完整", blocks.general >= 30, String(blocks.general));
ok("方块选择器覆盖全图集且中英文双语", blocks.options >= 380 && blocks.bilingual, JSON.stringify({ options: blocks.options, bilingual: blocks.bilingual }));
ok("中英文搜索命中通用方块积木", blocks.search === 2, String(blocks.search));
ok("天气积木只生成真实运行时属性", blocks.code.includes("world.rainDensity") && !blocks.code.includes("world.setWeather"), blocks.code.split("\n").filter((x) => x.includes("Density")).join(" | "));
const catalogCompile = await s.evaluate(`(() => {const filter=document.querySelector('#bsFilter');filter.value='';filter.dispatchEvent(new Event('input',{bubbles:true}));const chips=[...document.querySelectorAll('#bsTool .bs-chip:not(.c-voxel)')];for(const chip of chips)chip.click();return {count:chips.length,bad:document.querySelector('#bsStat').classList.contains('bad'),code:document.querySelector('#blockScreen .bs-code code').textContent};})()`);
ok("全部通用积木默认可编译无语法错误", catalogCompile.count >= 30 && !catalogCompile.bad && !catalogCompile.code.includes("未知积木"), JSON.stringify({ count: catalogCompile.count, bad: catalogCompile.bad }));

const weather = await s.evaluate(`(() => {
  const e=window.__editor,b=[...document.querySelectorAll('.weather-row button')].find(x=>x.textContent==='雨');if(!b)return null;b.click();
  return {kind:e.state.terrain.weather,rain:e.state.terrain.weatherLevels.rain,dirty:e.state.dirty,renderer:e.renderer.weather.rain};
})()`);
ok("天气设置写强度并标记脏，编辑器保持晴天", weather?.kind === "rain" && weather.rain === .75 && weather.dirty && weather.renderer === 0, JSON.stringify(weather));
const atmosphere = await s.evaluate(`(() => {
  const e=window.__editor,row=[...document.querySelectorAll('#terrain .trow')].find(x=>x.querySelector('span')?.textContent==='云量');if(!row)return null;const input=row.querySelector('input');input.value='.6';input.dispatchEvent(new Event('input',{bubbles:true}));
  return {cloud:e.state.terrain.weatherLevels.cloud,uniform:e.renderer.skyMat.uniforms.uCloud.value,dirty:e.state.dirty};
})()`);
ok("云量设置持久化但编辑器不渲染坏天气", atmosphere?.cloud === .6 && atmosphere.uniform === 0 && atmosphere.dirty, JSON.stringify(atmosphere));
const cycle = await s.evaluate(`(() => {
  const e=window.__editor,row=[...document.querySelectorAll('#terrain .trow')].find(x=>x.querySelector('span')?.textContent==='天气轮转');if(!row)return null;row.querySelector('input').click();
  const period=[...document.querySelectorAll('#terrain .trow')].find(x=>x.querySelector('span')?.textContent==='天气周期');const input=period.querySelector('input');input.value='120';input.dispatchEvent(new Event('input',{bubbles:true}));
  return {enabled:e.state.meta.gameRules.doWeatherCycle,seconds:e.state.terrain.weatherCycleSeconds};
})()`);
ok("天气轮转开关与周期可配置", cycle?.enabled === false && cycle.seconds === 120, JSON.stringify(cycle));

const music = await s.evaluate(`(async()=>{
  const m=await import('/js/music-editor.js');window.__fakeE={state:{meta:{}},markDirty(){},toast(){}};const api=m.openMusicStudio(window.__fakeE);
  document.querySelector('#musicStudio [data-view="automation"]').click();await new Promise(r=>setTimeout(r,100));
  const c=document.querySelector('.da-autocanvas'),r=c.getBoundingClientRect(),t=api.doc().tracks[0],before=t.automation.volume.length;
  c.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:9,button:0,clientX:r.left+r.width*.45,clientY:r.top+r.height*.3}));
  c.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:9,button:0,clientX:r.left+r.width*.45,clientY:r.top+r.height*.3}));
  const points=t.automation.volume.length,stems=!!document.querySelector('#musicStudio [data-act="stems"]');
  const synth=await import('/js/music-synth.js'),blob=await synth.renderMusicToWav(api.doc(),{trackId:t.id});
  const zipmod=await import('/js/zip.js'),zip=await zipmod.writeZip([{name:'stem.wav',data:new Uint8Array(await blob.arrayBuffer())}]);
  const send=document.querySelector('#musicStudio [data-mixsend^="reverb"]');send.value='40';send.dispatchEvent(new Event('input',{bubbles:true}));send.dispatchEvent(new Event('change',{bubbles:true}));const sendValue=api.doc().tracks[0].sends.reverb,markers=api.doc().markers.length;
  document.querySelector('#musicStudio [data-act="play"]').click();await new Promise(r=>setTimeout(r,120));
  const notesBefore=api.doc().tracks[0].clips[0].notes.length;window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyA',key:'a',bubbles:true}));window.dispatchEvent(new KeyboardEvent('keyup',{code:'KeyA',key:'a',bubbles:true}));
  const notesAfter=api.doc().tracks[0].clips[0].notes.length;document.querySelector('#musicStudio [data-act="stop"]').click();
  return {points,stems,wav:blob.size,zipHead:String.fromCharCode(...zip.slice(0,2)),notesBefore,notesAfter,instruments:document.querySelectorAll('#musicStudio .da-instruments button').length,sendValue,markers};
})()`);
ok("音乐自动化控制点可编辑", music.points >= 2, JSON.stringify(music));
ok("专业乐器库至少 19 种", music.instruments >= 19, String(music.instruments));
ok("每条轨道有独立混响/延迟发送", music.sendValue === .4, String(music.sendValue));
ok("DAW 段落标记随项目保存", music.markers >= 2, String(music.markers));
ok("音乐工作台提供 WAV 分轨导出", music.stems && music.wav > 10000 && music.zipHead === "PK", JSON.stringify(music));
ok("电脑键盘可实时演奏并录入音符", music.notesAfter === music.notesBefore + 1, `${music.notesBefore}→${music.notesAfter}`);

await s.goto(`${BASE}/edit/216d665d3ca92bd1b9a2?play=1`, { settleMs: 300 });
for (let i = 0; i < 300; i++) { if (await s.evaluate("!!(window.__game&&window.__game.playerEntity)", { awaitPromise: false })) break; await sleep(100); }
const runtimeWeather = await s.evaluate(`(() => {const g=window.__game;g.e.state.terrain.weatherLevels={rain:.8,snow:0,thunder:.2,cloud:.5,wind:.3};g.rainDensity=.8;g.thunderDensity=.2;g._applyEnvironment();return{rain:g.e.renderer.weather.rain,cloud:g.e.renderer.weather.cloud,wind:g.e.renderer.weather.wind,uniform:g.e.renderer.skyMat.uniforms.uCloud.value};})()`);
ok("动态天气同步到真实运行时渲染", runtimeWeather.rain === .8 && runtimeWeather.cloud === .5 && runtimeWeather.wind === .3 && runtimeWeather.uniform === .5, JSON.stringify(runtimeWeather));
const camera = await s.evaluate(`(() => {
  const g=window.__game;g._jumpBuf=0;window.dispatchEvent(new KeyboardEvent('keydown',{code:'Space',key:' ',repeat:true,bubbles:true}));const repeatBuf=g._jumpBuf;
  g._tPitch=1;window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyR',key:'r',bubbles:true}));const recenter=g._tPitch;
  g.e.renderer.camera.position.y=999;g._updateCamera(.016);const camClamp=g.e.renderer.camera.position.y;
  g.playerEntity.position.y=g.e.world.shape[1]+20;g._vy=5;g._stepPlayer(g.player,g.playerEntity);const safeY=g.playerEntity.position.y,safeVy=g._vy;
  return {repeatBuf,recenter,camClamp,safeY,safeVy,ceiling:g.e.world.shape[1]+12};
})()`);
const after = { y: camera.safeY, vy: camera.safeVy };
ok("长按空格重复事件不会自动装填跳跃", camera.repeatBuf === 0, JSON.stringify(camera));
ok("R 可即时回正玩家视角", camera.recenter === -0.12, String(camera.recenter));
ok("跟随相机不会飞出世界上限", camera.camClamp <= camera.ceiling + 4, String(camera.camClamp));
ok("玩家飞出世界上限会安全回出生点", after.y <= camera.ceiling && after.vy === 0, JSON.stringify(after));
await s.evaluate(`(()=>{const g=window.__game;g.e.state.terrain.weatherLevels={rain:0,snow:0,thunder:0,cloud:0,wind:0};g.rainDensity=0;g.snowDensity=0;g.thunderDensity=0;g._applyEnvironment();return 1;})()`);

const largeStart = Date.now();
await s.goto(`${BASE}/edit/wmwx8en6qdbtx`, { settleMs: 200 });
let largeReady = 0;
for (let i = 0; i < 500; i++) { if (await s.evaluate("!!(window.__editor&&window.__editor.world&&window.__editor.world.shape[0]===512)", { awaitPromise: false })) { largeReady = Date.now() - largeStart; break; } await sleep(100); }
ok("512³ 源码精灵首屏可用", largeReady > 0 && largeReady < 10000, `${largeReady}ms`);

console.log(`\nPASS: ${pass}  FAIL: ${fail}`);
await s.close(); try { chrome.child?.kill(); } catch {}
process.exit(fail ? 1 : 0);
